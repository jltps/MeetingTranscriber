import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage, EnhancedNotes } from '../../shared/types';
import type { EnhancerSegment } from '../enhancer/enhancer';
import { SUMMARY_SYSTEM_PROMPT, segmentsToText } from '../enhancer/prompt';
import { buildChatContext, buildChatSystemPrompt } from './prompt';

// Current Anthropic Sonnet — same model as the enhancer (CLAUDE.md §8).
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
// Mirror the enhancer's long-transcript handling: summarize chunk-by-chunk past
// this size rather than truncate (CLAUDE.md §8). Summaries drop [id=N] markers, so
// citations degrade for very long meetings — acceptable, and noted to the UI.
const CHUNK_THRESHOLD_CHARS = 120_000;
const CHUNK_SIZE_CHARS = 60_000;

export type ChatUsage = { inputTokens: number; outputTokens: number };

export type ChatAnswer = {
  text: string;
  usage: ChatUsage;
  /** True when the transcript had to be summarized (segment ids lost → citations degrade). */
  contextSummarized: boolean;
};

export type ChatRunInput = {
  userNotes: string;
  enhancedNotes: EnhancedNotes | null;
  transcript: EnhancerSegment[];
  /** rawLabel → displayName (ROADMAP_02), so the model sees real names. */
  speakerNames?: Record<string, string>;
  /** Full ephemeral conversation; the last entry is the new user turn. */
  messages: ChatMessage[];
  /** Called with each streamed text delta. */
  onToken: (token: string) => void;
};

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Streams a grounded answer over the Anthropic SDK. The big transcript context is
// a cached system block so multi-turn follow-ups in the same session are cheap
// (same ephemeral-cache pattern as the enhancer).
export class AnthropicChat {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  // Generic streaming core: a fixed system prompt + a cached context block +
  // the conversation. Shared by per-meeting and cross-meeting chat — the context
  // is built differently by each caller, but the streaming + caching is identical.
  async streamAnswer(opts: {
    systemPrompt: string;
    context: string;
    messages: ChatMessage[];
    onToken: (token: string) => void;
  }): Promise<{ text: string; usage: ChatUsage }> {
    const stream = this.client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: 'text', text: opts.systemPrompt },
        { type: 'text', text: opts.context, cache_control: { type: 'ephemeral' } },
      ],
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
    });
    stream.on('text', (delta) => opts.onToken(delta));

    const final = await stream.finalMessage();
    return {
      text: textOf(final.content),
      usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
    };
  }

  async answer(input: ChatRunInput): Promise<ChatAnswer> {
    const {
      text: transcriptText,
      usage: summaryUsage,
      summarized,
    } = await this.prepareTranscript(input.transcript, input.speakerNames);

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

  // For very long meetings: summarize each chunk, then merge (CLAUDE.md §8).
  private async prepareTranscript(
    segments: EnhancerSegment[],
    speakerNames?: Record<string, string>,
  ): Promise<{ text: string; usage: ChatUsage; summarized: boolean }> {
    const full = segmentsToText(segments, speakerNames);
    if (full.length <= CHUNK_THRESHOLD_CHARS) {
      return { text: full, usage: { inputTokens: 0, outputTokens: 0 }, summarized: false };
    }

    const chunks = chunkByLines(full, CHUNK_SIZE_CHARS);
    const summaries: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    for (const chunk of chunks) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: [
          { type: 'text', text: SUMMARY_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: chunk }],
      });
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      summaries.push(textOf(response.content));
    }
    return { text: summaries.join('\n\n'), usage: { inputTokens, outputTokens }, summarized: true };
  }
}

function chunkByLines(text: string, size: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current && current.length + line.length + 1 > size) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);
  return chunks;
}
