// Auto-generate a concise meeting title from transcript + notes (Tweak 5).
// Called after a meeting ends only when the title is still the default "Untitled meeting"
// and there is a transcript to derive a title from. Runs through the active LLM provider
// (V06 block 05); if it isn't configured or the call fails, returns null so the caller
// can skip silently.
import { getEnhancerSegments, getMeeting } from '../db/meetings';
import { completeText } from '../llm/provider';
import { logger } from '../logger';
import { segmentsToText } from './prompt';
import { cleanTitle } from './title-format';

// Only the first N chars of transcript — enough to understand the topic.
const TRANSCRIPT_SNIPPET_CHARS = 3000;

/**
 * Generate a short meeting title (3-5 words) from the transcript and raw notes.
 * Returns null if there's no transcript, the provider isn't configured, or it fails.
 */
export async function suggestMeetingTitle(meetingId: number): Promise<string | null> {
  const segments = getEnhancerSegments(meetingId);
  if (segments.length === 0) return null;

  const meeting = getMeeting(meetingId);
  const transcriptSnippet = segmentsToText(segments).slice(0, TRANSCRIPT_SNIPPET_CHARS);
  const notes = meeting?.rawUserMd.trim() ?? '';

  try {
    const text = await completeText('title', {
      maxTokens: 30,
      messages: [
        {
          role: 'user',
          content:
            `Based on this meeting transcript${notes ? ' and notes' : ''}, ` +
            `suggest a concise meeting title of 3-5 words. ` +
            `Return only the title text, with no quotes and no punctuation at the end.\n\n` +
            (notes ? `NOTES:\n${notes}\n\n` : '') +
            `TRANSCRIPT (excerpt):\n${transcriptSnippet}`,
        },
      ],
    });
    return cleanTitle(text) || null;
  } catch (err) {
    // No provider configured / transient failure — skip the auto-title silently.
    logger.info('title suggestion skipped', err instanceof Error ? err.message : String(err));
    return null;
  }
}
