import Anthropic from '@anthropic-ai/sdk';
import { EnhancedNotesSchema } from '../../shared/ipc-contract';
import { logger } from '../logger';
import { HAIKU } from './models';
import { chunkByLines } from './chunking';
import {
  ENHANCE_TOOL_DESCRIPTION,
  ENHANCE_TOOL_NAME,
  ENHANCE_TOOL_SCHEMA,
} from './enhance-tool';
import type { EnhanceInput, EnhanceResult, Enhancer, EnhancerSegment, EnhancerUsage } from './enhancer';
import {
  FALLBACK_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildSystemPrompt,
  buildUserContent,
  markdownFallbackToNotes,
  segmentsToText,
} from './prompt';

// Models are resolved per quality mode by the caller (V06 block 04) and injected via
// the constructor: `enhance` for the structured/fallback calls, `summarize` (cheap) for
// long-transcript chunking.
export type EnhancerModels = { enhance: string; summarize: string };
// The structured tool output is verbose (every block repeats type/origin/
// sourceSegmentIds), so a real meeting's notes can blow past a small ceiling — when
// that happens the tool JSON is truncated, Zod rejects it, and we fall back to the
// degraded plain-text path. 16k leaves ample headroom for normal meetings.
const MAX_TOKENS = 16000;
// Transcripts above this many characters are summarized chunk-by-chunk first,
// then merged, rather than truncated (CLAUDE.md §8). Sonnet's context is large,
// so most meetings take the single-call path.
const CHUNK_THRESHOLD_CHARS = 120_000;
const CHUNK_SIZE_CHARS = 60_000;

// Forced tool — guarantees the model returns the structured shape. The schema is shared
// with the OpenAI-compatible provider (enhance-tool.ts) so the contract never drifts. The
// tool input is still validated with Zod (defense in depth); never trust the model blindly.
const ENHANCE_TOOL: Anthropic.Tool = {
  name: ENHANCE_TOOL_NAME,
  description: ENHANCE_TOOL_DESCRIPTION,
  input_schema: ENHANCE_TOOL_SCHEMA as unknown as Anthropic.Tool['input_schema'],
};

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

const BLOCK_TYPES = ['heading', 'paragraph', 'bullet', 'action_item'];
const ORIGINS = ['user', 'ai'];
const isType = (v: unknown): boolean => typeof v === 'string' && BLOCK_TYPES.includes(v);
const isOrigin = (v: unknown): boolean => typeof v === 'string' && ORIGINS.includes(v);

// The model occasionally confuses the `type` and `origin` fields — most often a
// clean swap (it emits `type:"user"` with the real type sitting in `origin`).
// Rather than discard the entire structured result over one block, repair the
// recoverable cases (preserving each block's text + sourceSegmentIds) and let the
// schema re-validate afterwards (§1.6). Genuinely malformed output — bad `text`
// or `sourceSegmentIds` — still fails and falls through to the plain-text path.
export function repairBlocks(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const blocks = (input as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return input;
  return {
    ...(input as object),
    blocks: blocks.map((b) => {
      if (typeof b !== 'object' || b === null) return b;
      const block = { ...(b as Record<string, unknown>) };
      let type = block.type;
      let origin = block.origin;
      if (isOrigin(type) && isType(origin)) [type, origin] = [origin, type]; // clean swap
      block.type = isType(type) ? type : 'paragraph';
      block.origin = isOrigin(origin) ? origin : 'ai';
      return block;
    }),
  };
}

// Minimal auth check for Settings → "Test connection". A 1-token request both
// validates the key and confirms model access; throws on failure.
export async function testAnthropicKey(apiKey: string): Promise<void> {
  const client = new Anthropic({ apiKey });
  await client.messages.create({
    model: HAIKU, // cheapest model is enough to validate the key + model access
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  });
}

export class AnthropicEnhancer implements Enhancer {
  private client: Anthropic;

  constructor(
    apiKey: string,
    private models: EnhancerModels,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async enhance(input: EnhanceInput): Promise<EnhanceResult> {
    const { text: transcriptText, usage: summaryUsage } = await this.prepareTranscript(
      input.transcript,
      input.speakerNames,
    );
    const userContent = buildUserContent(input.userNotes, transcriptText);

    // Accumulated tokens across retries and chunk-summarization.
    const totalUsage: EnhancerUsage = {
      inputTokens: summaryUsage.inputTokens,
      outputTokens: summaryUsage.outputTokens,
    };

    let lastError: unknown;
    // Strict JSON via forced tool use; retry once on parse/validation failure (§8).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.models.enhance,
          max_tokens: MAX_TOKENS,
          system: [
            {
              type: 'text',
              text: buildSystemPrompt({
                templateInstructions: input.templateInstructions,
                globalInstructions: input.globalInstructions,
                detectedLanguage: input.detectedLanguage,
              }),
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [{ role: 'user', content: userContent }],
          tools: [ENHANCE_TOOL],
          tool_choice: { type: 'tool', name: ENHANCE_TOOL.name },
        });
        totalUsage.inputTokens += response.usage.input_tokens;
        totalUsage.outputTokens += response.usage.output_tokens;
        const toolUse = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === ENHANCE_TOOL.name,
        );
        const parsed = EnhancedNotesSchema.safeParse(toolUse?.input);
        if (parsed.success) return { notes: parsed.data, usage: totalUsage };
        // Recover the model's occasional type/origin field mix-ups before giving up.
        const repaired = EnhancedNotesSchema.safeParse(repairBlocks(toolUse?.input));
        if (repaired.success) {
          logger.warn('enhance: recovered malformed type/origin via repair', `attempt=${attempt + 1}`);
          return { notes: repaired.data, usage: totalUsage };
        }
        // Distinguish the remaining causes so the failure isn't a mystery: a truncated
        // response (hit max_tokens) yields incomplete tool JSON, vs. the model not
        // calling the tool at all, vs. a genuine schema mismatch.
        lastError =
          response.stop_reason === 'max_tokens'
            ? new Error(`Structured output hit max_tokens (${MAX_TOKENS}); tool JSON was truncated.`)
            : !toolUse
              ? new Error(`Model did not call ${ENHANCE_TOOL.name} (stop_reason=${response.stop_reason}).`)
              : parsed.error;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Enhancer returned no valid structured output after one retry.');
  }

  // Degraded path: plain-Markdown enhancement wrapped into EnhancedNotes (§8).
  async enhanceFallback(input: EnhanceInput): Promise<EnhanceResult> {
    const { text: transcriptText, usage: summaryUsage } = await this.prepareTranscript(
      input.transcript,
      input.speakerNames,
    );
    const response = await this.client.messages.create({
      model: this.models.enhance,
      max_tokens: MAX_TOKENS,
      system: [
        { type: 'text', text: FALLBACK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: buildUserContent(input.userNotes, transcriptText) }],
    });
    const usage: EnhancerUsage = {
      inputTokens: summaryUsage.inputTokens + response.usage.input_tokens,
      outputTokens: summaryUsage.outputTokens + response.usage.output_tokens,
    };
    return {
      notes: markdownFallbackToNotes(input.userNotes, textOf(response.content).trim()),
      usage,
    };
  }

  // For very long meetings: summarize each chunk, then merge (CLAUDE.md §8).
  // Segment ids are not preserved through summarization, so source links degrade
  // for those blocks — acceptable, and far better than truncating the transcript.
  // Returns the merged transcript text AND cumulative token usage for all summary calls.
  private async prepareTranscript(
    segments: EnhancerSegment[],
    speakerNames?: Record<string, string>,
  ): Promise<{ text: string; usage: EnhancerUsage }> {
    const full = segmentsToText(segments, speakerNames);
    if (full.length <= CHUNK_THRESHOLD_CHARS) {
      return { text: full, usage: { inputTokens: 0, outputTokens: 0 } };
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
    return { text: summaries.join('\n\n'), usage: { inputTokens, outputTokens } };
  }
}
