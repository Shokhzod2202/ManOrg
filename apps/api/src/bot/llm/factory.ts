import { type Env } from '../../config/env';
import { AnthropicProvider } from './anthropic.provider';
import { GrokProvider } from './grok.provider';
import { type LlmProvider } from './types';

/** Picks the model from LLM_PROVIDER; none configured means the Bot screen says it is not set up. */
export function createLlmProvider(config: Env): LlmProvider | null {
  if (config.LLM_PROVIDER === 'anthropic') {
    return new AnthropicProvider(
      config.LLM_API_KEY || undefined,
      config.LLM_MODEL || 'claude-opus-5-5',
      config.LLM_EFFORT,
      config.LLM_BASE_URL || undefined,
    );
  }
  if (config.LLM_PROVIDER === 'xai') {
    if (!config.LLM_API_KEY || !config.LLM_MODEL) return null;
    return new GrokProvider(config.LLM_API_KEY, config.LLM_MODEL, config.LLM_BASE_URL || undefined);
  }
  return null;
}
