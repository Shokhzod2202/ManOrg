/** Error from the Bot API, with the fields the sender acts on. */
export class TelegramError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
    readonly retryAfter?: number,
  ) {
    super(`Telegram ${status}: ${description}`);
  }

  /** The person blocked the bot or deleted the chat: stop sending to it. */
  get chatGone(): boolean {
    return this.status === 403 || (this.status === 400 && /chat not found/i.test(this.description));
  }
}

/**
 * Minimal Bot API client. The token sits in the request path, so it is never logged: errors carry
 * the method name and Telegram's description only.
 */
export class TelegramClient {
  constructor(
    private readonly token: string,
    private readonly apiUrl: string,
  ) {}

  async call<T>(method: string, body: object, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.apiUrl}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new TelegramError(0, `${method}: network error`);
    }
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (!res.ok || !data?.ok) {
      throw new TelegramError(
        res.status,
        `${method}: ${data?.description ?? 'request failed'}`,
        data?.parameters?.retry_after,
      );
    }
    return data.result as T;
  }

  sendMessage(chatId: bigint | number | string, text: string, url?: string) {
    return this.call('sendMessage', {
      chat_id: chatId.toString(),
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(url ? { reply_markup: { inline_keyboard: [[{ text: 'Open Haydar', url }]] } } : {}),
    });
  }
}
