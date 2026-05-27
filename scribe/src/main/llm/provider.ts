// Central LLM provider factory (V06 block 05). The one place that, based on the user's
// provider setting, hands callers a concrete Enhancer / ChatEngine / text-completion —
// so runEnhancement, chat, title, and optimize never branch on the provider themselves.
// Anthropic is the default and the provider the app is tuned for; the OpenAI-compatible
// adapter covers any user-configured endpoint. All calls originate here in main (§1.2).
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey, getOpenAiKey } from '../secrets/api-keys';
import {
  getLlmProvider,
  getOpenAiBaseUrl,
  getOpenAiModel,
  getQualityMode,
} from '../db/settings';
import { AnthropicEnhancer } from '../enhancer/anthropic';
import { resolveModel, type LlmTask } from '../enhancer/models';
import type { Enhancer } from '../enhancer/enhancer';
import { AnthropicChat } from '../chat/anthropic-chat';
import type { ChatEngine } from '../chat/engine';
import {
  OpenAiChat,
  OpenAiEnhancer,
  openAiComplete,
  type OpenAiClientConfig,
} from './openai-compatible';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

/** Resolve + validate the OpenAI-compatible config; throws a clear error if incomplete. */
function requireOpenAiConfig(): OpenAiClientConfig {
  const baseUrl = getOpenAiBaseUrl();
  const model = getOpenAiModel();
  const apiKey = getOpenAiKey();
  if (!baseUrl || !model || !apiKey) {
    throw new Error(
      'OpenAI-compatible provider is not fully configured. Set the base URL, model, and key in Settings.',
    );
  }
  return { baseUrl, model, apiKey };
}

function requireAnthropicKey(): string {
  const key = getAnthropicKey();
  if (!key) throw new Error('Anthropic API key not set. Add it in Settings before using AI features.');
  return key;
}

/** The Enhancer for the active provider (model tiering applies to Anthropic only). */
export function activeEnhancer(): Enhancer {
  if (getLlmProvider() === 'openai-compatible') return new OpenAiEnhancer(requireOpenAiConfig());
  const mode = getQualityMode();
  return new AnthropicEnhancer(requireAnthropicKey(), {
    enhance: resolveModel('enhance', mode),
    summarize: resolveModel('summarize', mode),
  });
}

/** The chat engine for the active provider. */
export function activeChat(): ChatEngine {
  if (getLlmProvider() === 'openai-compatible') return new OpenAiChat(requireOpenAiConfig());
  const mode = getQualityMode();
  return new AnthropicChat(requireAnthropicKey(), {
    chat: resolveModel('chat', mode),
    summarize: resolveModel('summarize', mode),
  });
}

/**
 * One-shot text completion for the simple callers (title, optimize). Branches on provider;
 * for Anthropic the model follows the block-04 tiering (Haiku for these tasks).
 */
export async function completeText(
  task: Extract<LlmTask, 'title' | 'optimize'>,
  opts: { system?: string; messages: ChatMsg[]; maxTokens: number },
): Promise<string> {
  if (getLlmProvider() === 'openai-compatible') {
    return openAiComplete(requireOpenAiConfig(), opts);
  }
  const client = new Anthropic({ apiKey: requireAnthropicKey() });
  const resp = await client.messages.create({
    model: resolveModel(task, getQualityMode()),
    max_tokens: opts.maxTokens,
    ...(opts.system ? { system: opts.system } : {}),
    messages: opts.messages,
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}
