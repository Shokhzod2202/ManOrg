import { type INestApplication } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobsService } from '../../src/jobs/jobs.service';
import { createTestApp } from '../helpers/app';
import { disconnectDatabases, resetDatabase } from '../helpers/db';

const REDIS = process.env.REDIS_URL ?? 'redis://localhost:6379';
const QUEUE = `manorg-jobs-test-${process.pid}`;
const connection = { host: new URL(REDIS).hostname, port: Number(new URL(REDIS).port || 6379) };

let app: INestApplication;

beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp({
    JOBS_ENABLED: 'true',
    JOBS_QUEUE: QUEUE,
    REDIS_URL: REDIS,
    TELEGRAM_BOT_TOKEN: '',
  });
});

afterAll(async () => {
  await app.close();
  const q = new Queue(QUEUE, { connection });
  await q.obliterate({ force: true });
  await q.close();
  await disconnectDatabases();
});

describe('scheduled jobs on Redis (BullMQ)', () => {
  it('stores one scheduler per job, so several API instances still run each job once', async () => {
    const names = (await app.get(JobsService).schedulers()).map((s) => s.key ?? s.name).sort();
    // Telegram delivery is scheduled only when a bot token is set.
    expect(names).toEqual(['bot-retention', 'ingredient-reminders', 'punch-flags', 'push-send']);
  });

  it('runs a job through the worker', async () => {
    const q = new Queue(QUEUE, { connection });
    const events = new QueueEvents(QUEUE, { connection });
    await events.waitUntilReady();
    const job = await q.add('ingredient-reminders', {});
    // The result is the number of reminders written (none in an empty database).
    await expect(job.waitUntilFinished(events, 10_000)).resolves.toBe(0);
    await events.close();
    await q.close();
  });
});
