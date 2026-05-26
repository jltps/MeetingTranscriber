// Auto-generate a concise meeting title from transcript + notes (Tweak 5).
// Called after a meeting ends only when the title is still the default "Untitled meeting"
// and there is a transcript to derive a title from. Requires an Anthropic key — if
// one is not set, returns null so the caller can skip silently.
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '../secrets/api-keys';
import { getEnhancerSegments, getMeeting } from '../db/meetings';
import { segmentsToText } from './prompt';

// Keep the title call cheap: same model for consistency, minimal tokens.
const MODEL = 'claude-sonnet-4-6';
// Only the first N chars of transcript — enough to understand the topic.
const TRANSCRIPT_SNIPPET_CHARS = 3000;

/**
 * Generate a short meeting title (≤ 7 words) from the transcript and raw notes.
 * Returns null if: no API key, no transcript, or the model returns nothing useful.
 */
export async function suggestMeetingTitle(meetingId: number): Promise<string | null> {
  const apiKey = getAnthropicKey();
  if (!apiKey) return null;

  const segments = getEnhancerSegments(meetingId);
  if (segments.length === 0) return null;

  const meeting = getMeeting(meetingId);
  const transcriptSnippet = segmentsToText(segments).slice(0, TRANSCRIPT_SNIPPET_CHARS);
  const notes = meeting?.rawUserMd.trim() ?? '';

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 30,
    messages: [
      {
        role: 'user',
        content:
          `Based on this meeting transcript${notes ? ' and notes' : ''}, ` +
          `suggest a concise meeting title (max 7 words). ` +
          `Return only the title text, no quotes or punctuation at the end.\n\n` +
          (notes ? `NOTES:\n${notes}\n\n` : '') +
          `TRANSCRIPT (excerpt):\n${transcriptSnippet}`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  return text || null;
}
