// Splits an assistant answer into plain-text runs and [id=N] citation markers so
// ChatPanel can render the markers as clickable chips that flash the cited
// transcript line. Pure (no React) so it can be unit-tested directly (CLAUDE.md §9).
// Mirrors the [id=N] convention emitted by enhancer/prompt.ts `segmentsToText`.

export type CitationNode =
  | { kind: 'text'; text: string }
  | { kind: 'cite'; segmentId: number };

const CITATION_RE = /\[id=(\d+)\]/g;

export function parseCitations(text: string): CitationNode[] {
  const nodes: CitationNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION_RE)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push({ kind: 'text', text: text.slice(last, start) });
    nodes.push({ kind: 'cite', segmentId: Number(match[1]) });
    last = start + match[0].length;
  }
  if (last < text.length) nodes.push({ kind: 'text', text: text.slice(last) });
  return nodes;
}
