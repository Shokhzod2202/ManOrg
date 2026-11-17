/**
 * Provider-neutral shapes for the bot (spec section 10, open question 12: the model sits behind a
 * provider interface). The loop in bot.service.ts only speaks these; each adapter translates.
 */
export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema with additionalProperties: false. */
  inputSchema: Record<string, unknown>;
}

export type LlmBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: LlmBlock[];
  /** The provider's own assistant content, replayed unchanged on the next request (thinking etc). */
  native?: unknown;
  /** Which provider and model wrote `native`; other providers ignore it. */
  nativeFrom?: string;
}

export interface LlmTurn {
  content: LlmBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  usage: { inputTokens: number; outputTokens: number };
  native?: unknown;
  /** provider:model that produced this turn. */
  from: string;
}

export interface LlmRequest {
  system: string;
  tools: LlmTool[];
  messages: LlmMessage[];
}

export interface LlmProvider {
  /** e.g. "anthropic:claude-opus-5-5". */
  readonly id: string;
  complete(request: LlmRequest): Promise<LlmTurn>;
}

/** The provider failed in a way the admin should hear about in plain words. */
export class LlmUnavailableError extends Error {}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
