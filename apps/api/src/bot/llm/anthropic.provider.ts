import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import {
  type LlmBlock,
  type LlmProvider,
  type LlmRequest,
  type LlmTurn,
  LlmUnavailableError,
} from './types';

type Msg = Anthropic.Beta.Messages.BetaMessageParam;
type Block = Anthropic.Beta.Messages.BetaContentBlockParam;

/**
 * Claude through the official SDK. Thinking is adaptive (always on for this model); assistant
 * content is replayed unchanged so thinking blocks stay valid; a refusal falls back on the server
 * (server-side fallback beta). The tool loop itself is ours, so every tool runs inside our API
 * with the admin's organization and permissions.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id: string;
  private readonly client: Anthropic;
  private readonly logger = new Logger('ClaudeProvider');

  constructor(
    apiKey: string | undefined,
    private readonly model: string,
    private readonly effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max',
    baseURL?: string,
  ) {
    // LLM_API_KEY is the bot's own key; with it set, a bearer token in the environment is not used.
    // Without it the SDK reads its usual sources (ANTHROPIC_API_KEY and so on).
    this.client = new Anthropic({
      ...(apiKey ? { apiKey, authToken: null } : {}),
      ...(baseURL ? { baseURL } : {}),
      maxRetries: 2,
    });
    this.id = `anthropic:${model}`;
  }

  async complete(request: LlmRequest): Promise<LlmTurn> {
    let response: Anthropic.Beta.Messages.BetaMessage;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: this.effort },
        // Stable system prompt and tool list first, so they cache across turns.
        cache_control: { type: 'ephemeral' },
        system: request.system,
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
          strict: true,
        })),
        messages: request.messages.map((m) => this.toParam(m)),
      });
    } catch (error) {
      // For operators: the status and the API's message; never the key or the conversation.
      if (error instanceof Anthropic.APIError) {
        this.logger.warn(
          `Claude request failed: ${error.status ?? 'network'} ${error.message.slice(0, 300)}`,
        );
      }
      if (error instanceof Anthropic.RateLimitError) {
        throw new LlmUnavailableError('The AI model is busy. Try again in a minute.');
      }
      if (
        error instanceof Anthropic.AuthenticationError ||
        error instanceof Anthropic.PermissionDeniedError
      ) {
        throw new LlmUnavailableError(
          'The AI model key is not valid. An admin needs to fix the server settings.',
        );
      }
      if (error instanceof Anthropic.APIError) {
        throw new LlmUnavailableError(
          `The AI model could not answer (${error.status ?? 'network'}). Try again.`,
        );
      }
      throw error;
    }

    const content: LlmBlock[] = [];
    for (const block of response.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text });
      else if (block.type === 'tool_use') {
        content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
      }
    }
    const stop = response.stop_reason;
    return {
      content,
      stopReason:
        stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' || stop === 'refusal'
          ? stop
          : 'other',
      usage: {
        inputTokens:
          response.usage.input_tokens +
          (response.usage.cache_read_input_tokens ?? 0) +
          (response.usage.cache_creation_input_tokens ?? 0),
        outputTokens: response.usage.output_tokens,
      },
      native: response.content,
      from: this.id,
    };
  }

  private toParam(m: LlmRequest['messages'][number]): Msg {
    // Our own earlier assistant turns go back exactly as the API sent them.
    if (m.role === 'assistant' && m.native && m.nativeFrom?.startsWith('anthropic:')) {
      return { role: 'assistant', content: m.native as Block[] };
    }
    const content: Block[] = m.content.map((b): Block => {
      if (b.type === 'text') return { type: 'text', text: b.text };
      if (b.type === 'tool_use') {
        return {
          type: 'tool_use',
          id: b.id,
          name: b.name,
          input: b.input as Record<string, unknown>,
        };
      }
      return {
        type: 'tool_result',
        tool_use_id: b.toolUseId,
        content: b.content,
        is_error: b.isError ?? false,
      };
    });
    return { role: m.role, content };
  }
}
