// Generic OpenAI-compatible provider (V06 block 05). One adapter for any endpoint that
// speaks the OpenAI chat-completions API — OpenAI, OpenRouter, local Ollama, etc. —
// configured by base URL + model id + key. Calls originate in main; the key never reaches
// the renderer (CLAUDE.md §1.2). Structured enhancement is requested via function calling
// and validated by the SAME EnhancedNotesSchema as Anthropic (§1.6); non-conforming output
// falls back to plain markdown, exactly as the Anthropic path does.
import OpenAI from 'openai';
import { EnhancedNotesSchema } from '../../shared/ipc-contract';
import type { EnhancedNotes } from '../../shared/types';
import { repairBlocks } from '../enhancer/anthropic';
import { chunkByLines } from '../enhancer/chunking';
import {
  ENHANCE_TOOL_DESCRIPTION,
  ENHANCE_TOOL_NAME,
  ENHANCE_TOOL_SCHEMA,
} from '../enhancer/enhance-tool';
import type { EnhanceInput, EnhanceResult, Enhancer, EnhancerSegment, EnhancerUsage } from '../enhancer/enhancer';
import {
  FALLBACK_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildSystemPrompt,
  buildUserContent,
  markdownFallbackToNotes,
  segmentsToText,
} from '../enhancer/prompt';
import { buildChatContext, buildChatSystemPrompt } from '../chat/prompt';
import type { ChatAnswer, ChatEngine, ChatRunInput, ChatUsage } from '../chat/engine';

/** Connection details for the generic provider (resolved in main, never in the renderer). */
export type OpenAiClientConfig = { baseUrl: string; model: string; apiKey: string };

const ENHANCE_MAX_TOKENS = 16000;
const CHAT_MAX_TOKENS = 4096;
const SUMMARY_MAX_TOKENS = 1500;
const CHUNK_THRESHOLD_CHARS = 120_000;
const CHUNK_SIZE_CHARS = 60_000;

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

function client(cfg: OpenAiClientConfig): OpenAI {
  return new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
}

function usageOf(u: OpenAI.CompletionUsage | undefined): EnhancerUsage {
  return { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0 };
}

/**
 * Parse the function-call arguments string into validated EnhancedNotes, or null when the
 * output isn't usable (non-JSON or schema mismatch even after repair) — the caller then
 * degrades to the markdown fallback. Pure: unit-tested without a network call.
 */
export function parseEnhanceArguments(args: string | undefined): EnhancedNotes | null {
  if (!args) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(args);
  } catch {
    return null;
  }
  const parsed = EnhancedNotesSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const repaired = EnhancedNotesSchema.safeParse(repairBlocks(raw));
  return repaired.success ? repaired.data : null;
}

/** One-shot, non-streaming completion (titles, prompt-optimization). */
export async function openAiComplete(
  cfg: OpenAiClientConfig,
  opts: { system?: string; messages: ChatMsg[]; maxTokens: number },
): Promise<string> {
  const messages: ChatMsg[] = opts.system
    ? [{ role: 'system', content: opts.system }, ...opts.messages]
    : opts.messages;
  const resp = await client(cfg).chat.completions.create({
    model: cfg.model,
    max_tokens: opts.maxTokens,
    messages,
  });
  return resp.choices[0]?.message?.content?.trim() ?? '';
}

/** Validate the endpoint + key with a 1-token ping; throws on failure (Settings → Test). */
export async function testOpenAiConnection(cfg: OpenAiClientConfig): Promise<void> {
  await client(cfg).chat.completions.create({
    model: cfg.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
}

export class OpenAiEnhancer implements Enhancer {
  constructor(private cfg: OpenAiClientConfig) {}

  async enhance(input: EnhanceInput): Promise<EnhanceResult> {
    const { text: transcriptText, usage } = await this.prepareTranscript(
      input.transcript,
      input.speakerNames,
    );
    const total: EnhancerUsage = { ...usage };
    const system = buildSystemPrompt({
      templateInstructions: input.templateInstructions,
      globalInstructions: input.globalInstructions,
      detectedLanguage: input.detectedLanguage,
    });
    const userContent = buildUserContent(input.userNotes, transcriptText);

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await client(this.cfg).chat.completions.create({
          model: this.cfg.model,
          max_tokens: ENHANCE_MAX_TOKENS,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
          tools: [
            {
              type: 'function',
              function: {
                name: ENHANCE_TOOL_NAME,
                description: ENHANCE_TOOL_DESCRIPTION,
                parameters: ENHANCE_TOOL_SCHEMA as unknown as Record<string, unknown>,
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: ENHANCE_TOOL_NAME } },
        });
        total.inputTokens += resp.usage?.prompt_tokens ?? 0;
        total.outputTokens += resp.usage?.completion_tokens ?? 0;
        const toolCall = resp.choices[0]?.message?.tool_calls?.[0];
        const argsStr = toolCall?.type === 'function' ? toolCall.function.arguments : undefined;
        const notes = parseEnhanceArguments(argsStr);
        if (notes) return { notes, usage: total };
        lastError = new Error('Provider returned no valid structured output.');
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Enhancement failed.');
  }

  async enhanceFallback(input: EnhanceInput): Promise<EnhanceResult> {
    const { text: transcriptText, usage } = await this.prepareTranscript(
      input.transcript,
      input.speakerNames,
    );
    const resp = await client(this.cfg).chat.completions.create({
      model: this.cfg.model,
      max_tokens: ENHANCE_MAX_TOKENS,
      messages: [
        { role: 'system', content: FALLBACK_SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(input.userNotes, transcriptText) },
      ],
    });
    return {
      notes: markdownFallbackToNotes(input.userNotes, resp.choices[0]?.message?.content?.trim() ?? ''),
      usage: {
        inputTokens: usage.inputTokens + (resp.usage?.prompt_tokens ?? 0),
        outputTokens: usage.outputTokens + (resp.usage?.completion_tokens ?? 0),
      },
    };
  }

  private async prepareTranscript(
    segments: EnhancerSegment[],
    speakerNames?: Record<string, string>,
  ): Promise<{ text: string; usage: EnhancerUsage }> {
    const full = segmentsToText(segments, speakerNames);
    if (full.length <= CHUNK_THRESHOLD_CHARS) {
      return { text: full, usage: { inputTokens: 0, outputTokens: 0 } };
    }
    const summaries: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    for (const chunk of chunkByLines(full, CHUNK_SIZE_CHARS)) {
      const resp = await client(this.cfg).chat.completions.create({
        model: this.cfg.model,
        max_tokens: SUMMARY_MAX_TOKENS,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: chunk },
        ],
      });
      inputTokens += resp.usage?.prompt_tokens ?? 0;
      outputTokens += resp.usage?.completion_tokens ?? 0;
      summaries.push(resp.choices[0]?.message?.content ?? '');
    }
    return { text: summaries.join('\n\n'), usage: { inputTokens, outputTokens } };
  }
}

export class OpenAiChat implements ChatEngine {
  constructor(private cfg: OpenAiClientConfig) {}

  async streamAnswer(opts: {
    systemPrompt: string;
    context: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    onToken: (token: string) => void;
  }): Promise<{ text: string; usage: ChatUsage }> {
    // OpenAI endpoints expect a single system message; fold the context into it.
    const messages: ChatMsg[] = [
      { role: 'system', content: `${opts.systemPrompt}\n\n${opts.context}` },
      ...opts.messages,
    ];
    const stream = await client(this.cfg).chat.completions.create({
      model: this.cfg.model,
      max_tokens: CHAT_MAX_TOKENS,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });
    let text = '';
    let usage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        text += delta;
        opts.onToken(delta);
      }
      if (chunk.usage) usage = usageOf(chunk.usage);
    }
    return { text, usage };
  }

  async answer(input: ChatRunInput): Promise<ChatAnswer> {
    const { text: transcriptText, usage: summaryUsage, summarized } = await this.prepareTranscript(
      input.transcript,
      input.speakerNames,
    );
    const context = buildChatContext({
      userNotes: input.userNotes,
      enhancedNotes: input.enhancedNotes,
      transcriptText,
    });
    const { text, usage } = await this.streamAnswer({
      systemPrompt: buildChatSystemPrompt(),
      context,
      messages: input.messages,
      onToken: input.onToken,
    });
    return {
      text,
      usage: {
        inputTokens: summaryUsage.inputTokens + usage.inputTokens,
        outputTokens: summaryUsage.outputTokens + usage.outputTokens,
      },
      contextSummarized: summarized,
    };
  }

  private async prepareTranscript(
    segments: EnhancerSegment[],
    speakerNames?: Record<string, string>,
  ): Promise<{ text: string; usage: ChatUsage; summarized: boolean }> {
    const full = segmentsToText(segments, speakerNames);
    if (full.length <= CHUNK_THRESHOLD_CHARS) {
      return { text: full, usage: { inputTokens: 0, outputTokens: 0 }, summarized: false };
    }
    const summaries: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    for (const chunk of chunkByLines(full, CHUNK_SIZE_CHARS)) {
      const resp = await client(this.cfg).chat.completions.create({
        model: this.cfg.model,
        max_tokens: SUMMARY_MAX_TOKENS,
        messages: [
          { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
          { role: 'user', content: chunk },
        ],
      });
      inputTokens += resp.usage?.prompt_tokens ?? 0;
      outputTokens += resp.usage?.completion_tokens ?? 0;
      summaries.push(resp.choices[0]?.message?.content ?? '');
    }
    return { text: summaries.join('\n\n'), usage: { inputTokens, outputTokens }, summarized: true };
  }
}
