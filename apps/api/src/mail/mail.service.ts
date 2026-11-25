import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Decided 2026-11-29: sends email through SMTP (SMTP_URL). Without SMTP_URL, as in development
 * and tests, the message is written to the log instead and kept in `outbox` for tests to read.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly config = env();
  private transport?: Transporter;
  /** The last messages sent, newest last (only without SMTP). */
  readonly outbox: Mail[] = [];

  async send(mail: Mail): Promise<void> {
    if (!this.config.SMTP_URL) {
      this.outbox.push(mail);
      if (this.outbox.length > 50) this.outbox.shift();
      // The link is a secret: in development it is shown so the reset can be finished locally.
      this.logger.log(`Email to ${mail.to}: ${mail.subject}\n${mail.text}`);
      return;
    }
    this.transport ??= createTransport(this.config.SMTP_URL);
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...mail });
  }
}
