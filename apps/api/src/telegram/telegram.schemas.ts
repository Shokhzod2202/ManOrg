import { z } from 'zod';

/** The raw initData string from Telegram.WebApp. A user id on its own is rejected. */
export const telegramLoginSchema = z.strictObject({
  initData: z.string().min(1, 'Missing Telegram sign-in data.').max(8192),
});

export type TelegramLoginInput = z.infer<typeof telegramLoginSchema>;
