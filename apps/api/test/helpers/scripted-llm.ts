import {
  type LlmBlock,
  type LlmProvider,
  type LlmRequest,
  type LlmTurn,
} from '../../src/bot/llm/types';

type Step = (request: LlmRequest) => LlmBlock[];

/**
 * A stand-in model for tests: each call takes the next scripted step. It records every request,
 * so tests can check exactly what the model was shown.
 */
export class ScriptedLlm implements LlmProvider {
  readonly id = 'test:scripted';
  readonly requests: LlmRequest[] = [];
  private steps: Step[] = [];
  private n = 0;

  script(...steps: Step[]): void {
    this.steps.push(...steps);
  }

  async complete(request: LlmRequest): Promise<LlmTurn> {
    // Copy: the loop keeps appending to the same array.
    this.requests.push({
      ...request,
      messages: request.messages.map((m) => ({ ...m, content: [...m.content] })),
    });
    const step = this.steps.shift() ?? (() => [{ type: 'text', text: 'Done.' } as LlmBlock]);
    const content = step(request);
    return {
      content,
      stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
      usage: { inputTokens: 100, outputTokens: 20 },
      from: this.id,
    };
  }

  /** The text of every tool result the model has been shown so far. */
  seenToolResults(): string {
    return this.requests
      .flatMap((r) => r.messages)
      .flatMap((m) => m.content)
      .filter((b) => b.type === 'tool_result')
      .map((b) => (b as { content: string }).content)
      .join('\n');
  }

  call(name: string, input: unknown): LlmBlock {
    this.n += 1;
    return { type: 'tool_use', id: `call_${this.n}`, name, input };
  }
}

export const say = (text: string): LlmBlock => ({ type: 'text', text });
