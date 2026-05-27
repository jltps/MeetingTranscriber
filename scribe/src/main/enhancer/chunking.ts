// Shared transcript chunking for long-meeting summarization (CLAUDE.md §8). Used by both
// the enhancer and chat summarizers, and any provider adapter. Splits on line boundaries
// so a chunk never cuts a transcript line in half.
export function chunkByLines(text: string, size: number): string[] {
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
