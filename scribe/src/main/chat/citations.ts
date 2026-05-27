// Pure helpers for the [id=N] citation convention shared with the enhancer
// (see enhancer/prompt.ts `segmentsToText`). No electron/node imports so this is
// unit-testable in isolation (CLAUDE.md §9).

const CITATION_RE = /\[id=(\d+)\]/g;

/** Every segment id referenced by a `[id=N]` marker, in order of appearance (with repeats). */
export function extractCitedIds(text: string): number[] {
  const ids: number[] = [];
  for (const match of text.matchAll(CITATION_RE)) {
    ids.push(Number(match[1]));
  }
  return ids;
}

/**
 * Cited ids that actually exist in the meeting, de-duplicated and order-preserving.
 * The model is never trusted blindly — hallucinated ids are dropped so the UI only
 * ever links to real transcript segments (mirrors the enhancer's Zod defense).
 */
export function validateCitations(text: string, validIds: Iterable<number>): number[] {
  const valid = new Set(validIds);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of extractCitedIds(text)) {
    if (valid.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
