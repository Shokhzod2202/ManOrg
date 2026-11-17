import {
  type LlmBlock,
  type LlmProvider,
  type LlmRequest,
  type LlmTurn,
  LlmUnavailableError,
} from './types';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/**
 * Grok through xAI's chat completions REST API (the notebook's first choice, open question 12).
 * Uses xAI's own endpoint and function-calling format; nothing here is shared with the Claude
 * adapter except the neutral shapes in types.ts.
 */
export class GrokProvider implements LlmProvider {
  readonly id: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl = 'https://api.x.ai/v1',
  ) {
    this.id = `xai:${model}`;
  }

  async complete(request: LlmRequest): Promise<LlmTurn> {
    const messages: ChatMessage[] = [{ role: 'system', content: request.system }];
    for (const m of request.messages) {
      if (m.role === 'assistant') {
        const text = m.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('\n');
        const calls = m.content.filter((b) => b.type === 'tool_use') as Extract<
          LlmBlock,
          { type: 'tool_use' }
        >[];
        messages.push({
          role: 'assistant',
          content: text || null,
          ...(calls.length
            ? {
                tool_calls: calls.map((c) => ({
                  id: c.id,
                  type: 'function' as const,
                  function: { name: c.name, arguments: JSON.stringify(c.input) },
                })),
              }
            : {}),
        });
        continue;
      }
      for (const b of m.content) {
        if (b.type === 'tool_result')
          messages.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });
        else if (b.type === 'text') messages.push({ role: 'user', content: b.text });
      }
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages,
          tools: request.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })),
        }),
      });
    } catch {
      throw new LlmUnavailableError('The AI model could not be reached. Try again.');
    }
    if (res.status === 429)
      throw new LlmUnavailableError('The AI model is busy. Try again in a minute.');
    if (res.status === 401 || res.status === 403) {
      throw new LlmUnavailableError(
        'The AI model key is not valid. An admin needs to fix the server settings.',
      );
    }
    if (!res.ok)
      throw new LlmUnavailableError(`The AI model could not answer (${res.status}). Try again.`);
    const data = (await res.json()) as {
      choices: { finish_reason: string; message: ChatMessage }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = data.choices[0];
    const content: LlmBlock[] = [];
    if (choice?.message.content) content.push({ type: 'text', text: choice.message.content });
    for (const call of choice?.message.tool_calls ?? []) {
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        input = { __invalid_json: call.function.arguments };
      }
      content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
    }
    const finish = choice?.finish_reason;
    return {
      content,
      stopReason:
        finish === 'tool_calls'
          ? 'tool_use'
          : finish === 'stop'
            ? 'end_turn'
            : finish === 'length'
              ? 'max_tokens'
              : 'other',
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
      from: this.id,
    };
  }
}
