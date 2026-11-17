import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from './anthropic.provider';
import { GrokProvider } from './grok.provider';
import { type LlmRequest } from './types';

/** A stand-in HTTP server: records each request and answers with the next scripted body. */
let server: Server;
let base = '';
const seen: { path: string; headers: Record<string, unknown>; body: Record<string, unknown> }[] =
  [];
const replies: unknown[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(replies.shift()));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const request: LlmRequest = {
  system: 'You are the bot.',
  tools: [
    {
      name: 'search_data',
      description: 'Read',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
  ],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'List products' }] }],
};

describe('Claude adapter', () => {
  it('sends adaptive thinking, effort, server-side fallback and caching, and replays its own content unchanged', async () => {
    const assistant = [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'toolu_1', name: 'search_data', input: { kind: 'products' } },
    ];
    replies.push({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: assistant,
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: {
        input_tokens: 50,
        output_tokens: 10,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 0,
      },
    });
    const llm = new AnthropicProvider('test-key', 'claude-opus-5-5', 'high', base);
    const turn = await llm.complete(request);
    expect(turn).toMatchObject({
      stopReason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'search_data', input: { kind: 'products' } },
      ],
      usage: { inputTokens: 55, outputTokens: 10 },
      from: 'anthropic:claude-opus-5-5',
    });
    const first = seen.at(-1)!;
    expect(first.path).toContain('/v1/messages');
    expect(String(first.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(first.body).toMatchObject({
      model: 'claude-opus-5-5',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      fallbacks: 'default',
      cache_control: { type: 'ephemeral' },
      system: 'You are the bot.',
    });
    expect((first.body.tools as { input_schema: unknown }[])[0]!.input_schema).toBeTruthy();

    replies.push({
      id: 'msg_2',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'Here they are.' }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 80, output_tokens: 5 },
    });
    await llm.complete({
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', content: turn.content, native: turn.native, nativeFrom: turn.from },
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: 'toolu_1', content: '{"data":[]}' }],
        },
      ],
    });
    const second = seen.at(-1)!.body.messages as { role: string; content: unknown }[];
    // The thinking block goes back exactly as received.
    expect(second[1]).toEqual({ role: 'assistant', content: assistant });
    expect(second[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"data":[]}', is_error: false },
      ],
    });
  });
});

describe('Grok adapter', () => {
  it("uses xAI's chat completions with functions and maps tool calls both ways", async () => {
    replies.push({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'search_data', arguments: '{"kind":"products"}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 40, completion_tokens: 8 },
    });
    const llm = new GrokProvider('xai-key', 'grok-test', base);
    const turn = await llm.complete(request);
    expect(turn).toMatchObject({
      stopReason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'call_1', name: 'search_data', input: { kind: 'products' } },
      ],
      usage: { inputTokens: 40, outputTokens: 8 },
    });
    const sent = seen.at(-1)!;
    expect(sent.path).toBe('/chat/completions');
    expect(sent.headers.authorization).toBe('Bearer xai-key');
    expect(sent.body).toMatchObject({
      model: 'grok-test',
      messages: [
        { role: 'system', content: 'You are the bot.' },
        { role: 'user', content: 'List products' },
      ],
      tools: [{ type: 'function', function: { name: 'search_data' } }],
    });
  });
});
