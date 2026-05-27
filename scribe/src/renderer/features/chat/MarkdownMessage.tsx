import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseCitations } from './parse-citations';

// Renders an assistant answer as real Markdown (bold, lists, headings, code, …) while
// still turning the [id=N] citation markers into interactive chips. react-markdown owns
// the block/inline structure; we only post-process the string runs inside paragraphs and
// list items — where citations actually appear — replacing each marker via `renderCite`.
type MarkdownMessageProps = {
  content: string;
  /** Render a single [id=N] marker as a chip (caller decides clickability/labeling). */
  renderCite: (segmentId: number, key: string) => ReactNode;
};

// Walk react-markdown's children: split plain-string runs on [id=N] into text + chips;
// leave already-rendered elements (e.g. <strong>) untouched.
function withCitations(
  children: ReactNode,
  renderCite: MarkdownMessageProps['renderCite'],
  keyPrefix: string,
): ReactNode {
  const arr = Array.isArray(children) ? children : [children];
  return arr.map((child, idx) => {
    if (typeof child !== 'string') return child;
    return parseCitations(child).map((node, i) =>
      node.kind === 'text' ? (
        <span key={`${keyPrefix}-${idx}-${i}`}>{node.text}</span>
      ) : (
        renderCite(node.segmentId, `${keyPrefix}-${idx}-${i}`)
      ),
    );
  });
}

export function MarkdownMessage({ content, renderCite }: MarkdownMessageProps) {
  return (
    <div className="chat-md text-sm leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{withCitations(children, renderCite, 'p')}</p>,
          li: ({ children }) => <li>{withCitations(children, renderCite, 'li')}</li>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
