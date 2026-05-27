import Anthropic from '@anthropic-ai/sdk';
import type { ChatMessage } from '../../shared/types';
import type { EnhancerSegment } from '../enhancer/enhancer';
import { SUMMARY_SYSTEM_PROMPT, segmentsToText } from '../enhancer/prompt';
import { chunkByLines } from '../enhancer/chunking';
import { buildChatContext, buildChatSystemPrompt } from './prompt';
import type { ChatAnswer, ChatEngine, ChatRunInput, ChatUsage } from './engine';

// Models are resolved per quality mode by the caller (V06 block 04) and injected via
// the constructor: `chat` for the streamed answer, `summarize` (cheap) for chunking.
export type ChatModels = { chat: string; summarize: string };
const MAX_TOKENS = 4096;
// Mirror the enhancer's long-transcript handling: summarize chunk-by-chunk past
// this size rather than truncate (CLAUDE.md §8). Summaries drop [id=N] markers, so
// citations degrade for very long meetings — acceptable, and noted to the UI.
const CHUNK_THRESHOLD_CHARS = 120_000;
const CHUNK_SIZE_CHARS = 60_000;

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

// Streams a grounded answer over the Anthropic SDK. The big transcript context is
// a cached system block so multi-turn follow-ups in the same session are cheap
// (same ephemeral-cache pattern as the enhancer).
export class AnthropicChat implements ChatEngine {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private models: ChatModels,
  ) {
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
      model: this.models.chat,
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
        model: this.models.summarize,
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
