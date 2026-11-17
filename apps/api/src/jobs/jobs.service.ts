import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { BotService } from '../bot/bot.service';
import { type ConnectionOptions, Queue, Worker } from 'bullmq';
import { env } from '../config/env';
import { IngredientOrdersService } from '../tasks/ingredient-orders.service';
import { TelegramService } from '../telegram/telegram.service';

/** Repeating work, by job name: what it does and how often. */
const SCHEDULE = {
  /** ING-7: remind responsible employees on an ingredient's ordering day. */
  'ingredient-reminders': 5 * 60_000,
  /** Telegram alongside the app (decided 2026-11-13). */
  'telegram-send': 10_000,
  /** Spec section 10: bot conversations and tool calls are kept 90 days. */
  'bot-retention': 24 * 60 * 60_000,
} as const;
export type JobName = keyof typeof SCHEDULE;

function connection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    // Required by BullMQ workers: blocking commands must not time out.
    maxRetriesPerRequest: null,
  };
}

/**
 * Scheduled jobs on Redis with BullMQ (spec section 6). Job schedulers are stored in Redis, so
 * however many API instances run with JOBS_ENABLED=true, each run happens once.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly config = env();
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly ingredients: IngredientOrdersService,
    private readonly telegram: TelegramService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** What one job run does; also called directly by tests. */
  async run(name: JobName): Promise<number> {
    if (name === 'ingredient-reminders') return this.ingredients.sendDueReminders();
    if (name === 'bot-retention')
      return this.moduleRef.get(BotService, { strict: false }).removeOld();
    return this.telegram.sendPending();
  }

  async onModuleInit(): Promise<void> {
    if (this.config.JOBS_ENABLED !== 'true') return;
    const conn = connection(this.config.REDIS_URL);
    this.queue = new Queue(this.config.JOBS_QUEUE, { connection: conn });
    for (const [name, every] of Object.entries(SCHEDULE) as [JobName, number][]) {
      if (name === 'telegram-send' && !this.telegram.configured) {
        await this.queue.removeJobScheduler(name);
        continue;
      }
      await this.queue.upsertJobScheduler(
        name,
        { every },
        {
          name,
          opts: { removeOnComplete: 100, removeOnFail: 500 },
        },
      );
    }
    this.worker = new Worker(this.config.JOBS_QUEUE, (job) => this.run(job.name as JobName), {
      connection: conn,
      concurrency: 1,
    });
    this.worker.on('failed', (job, error) =>
      this.logger.error(`Job ${job?.name ?? '?'} failed: ${error.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** For tests and the health check: the schedulers stored in Redis. */
  async schedulers() {
    return (await this.queue?.getJobSchedulers()) ?? [];
  }
}
