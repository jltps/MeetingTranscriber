import Anthropic from '@anthropic-ai/sdk';
import { EnhancedNotesSchema } from '../../shared/ipc-contract';
import type { EnhancedNotes } from '../../shared/types';
import type { EnhanceInput, Enhancer, EnhancerSegment } from './enhancer';
import {
  FALLBACK_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildUserContent,
  markdownFallbackToNotes,
  segmentsToText,
} from './prompt';

// Current Anthropic Sonnet (PRODUCT_SPEC.md §5, CLAUDE.md §8).
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
// Transcripts above this many characters are summarized chunk-by-chunk first,
// then merged, rather than truncated (CLAUDE.md §8). Sonnet's context is large,
// so most meetings take the single-call path.
const CHUNK_THRESHOLD_CHARS = 120_000;
const CHUNK_SIZE_CHARS = 60_000;

// Forced tool — guarantees the model returns the structured shape. The tool input
// is still validated with Zod (defense in depth); never trust the model blindly.
const ENHANCE_TOOL: Anthropic.Tool = {
  name: 'emit_enhanced_notes',
  description: 'Return the enhanced meeting notes as an ordered list of structured blocks.',
  input_schema: {
    type: 'object',
    properties: {
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['heading', 'paragraph', 'bullet', 'action_item'] },
            text: { type: 'string' },
            origin: { type: 'string', enum: ['user', 'ai'] },
            sourceSegmentIds: { type: 'array', items: { type: 'number' } },
          },
          required: ['type', 'text', 'origin', 'sourceSegmentIds'],
        },
      },
    },
    required: ['blocks'],
  },
};

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export class AnthropicEnhancer implements Enhancer {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async enhance(input: EnhanceInput): Promise<EnhancedNotes> {
    const transcriptText = await this.prepareTranscript(input.transcript);
    const userContent = buildUserContent(input.userNotes, transcriptText);

    let lastError: unknown;
    // Strict JSON via forced tool use; retry once on parse/validation failure (§8).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userContent }],
          tools: [ENHANCE_TOOL],
          tool_choice: { type: 'tool', name: ENHANCE_TOOL.name },
        });
        const toolUse = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === ENHANCE_TOOL.name,
        );
        const parsed = EnhancedNotesSchema.safeParse(toolUse?.input);
        if (parsed.success) return parsed.data;
        lastError = parsed.success ? undefined : parsed.error;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Enhancer returned no valid structured output after one retry.');
  }

  // Degraded path: plain-Markdown enhancement wrapped into EnhancedNotes (§8).
  async enhanceFallback(input: EnhanceInput): Promise<EnhancedNotes> {
    const transcriptText = await this.prepareTranscript(input.transcript);
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: 'text', text: FALLBACK_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: buildUserContent(input.userNotes, transcriptText) }],
    });
    return markdownFallbackToNotes(input.userNotes, textOf(response.content).trim());
  }

  // For very long meetings: summarize each chunk, then merge (CLAUDE.md §8).
  // Segment ids are not preserved through summarization, so source links degrade
  // for those blocks — acceptable, and far better than truncating the transcript.
  private async prepareTranscript(segments: EnhancerSegment[]): Promise<string> {
    const full = segmentsToText(segments);
    if (full.length <= CHUNK_THRESHOLD_CHARS) return full;

    const chunks = chunkByLines(full, CHUNK_SIZE_CHARS);
    const summaries: string[] = [];
    for (const chunk of chunks) {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: [
          { type: 'text', text: SUMMARY_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: chunk }],
      });
      summaries.push(textOf(response.content));
    }
    return summaries.join('\n\n');
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
