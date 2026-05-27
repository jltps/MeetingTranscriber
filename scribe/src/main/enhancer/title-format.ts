// Pure title formatting (V06 block 04). Kept separate from title.ts so it can be
// unit-tested without pulling in the Anthropic SDK or the DB layer.

/**
 * Tidy a model-suggested title: strip wrapping quotes, collapse whitespace, and remove
 * trailing punctuation/dashes so it reads as a clean headline.
 */
export function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, '') // wrapping quotes
    .replace(/\s+/g, ' ')
    .replace(/[\s.,;:!?—–-]+$/g, '') // trailing punctuation/dashes
    .trim();
}
