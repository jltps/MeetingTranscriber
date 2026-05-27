import { useCallback, useRef, useState } from 'react';
import type { ChatMessage, CrossChatCitation, RetrievalScope } from '../../../shared/types';

/** An assistant turn carries the meeting-tagged citations and the per-query usage. */
export type CrossChatTurn = ChatMessage & {
  citations?: CrossChatCitation[];
  usage?: { inputTokens: number; outputTokens: number };
};

export type CrossChatController = {
  messages: CrossChatTurn[];
  streamingText: string;
  busy: boolean;
  error: string | null;
  ask: (question: string, scope: RetrievalScope) => void;
};

// Owns the ephemeral cross-meeting conversation for the session (ROADMAP_07 Phase 2).
// One ask at a time (busy guard); streamed tokens arrive on the shared chat:token
// channel — the cross-meeting view replaces the per-meeting view, so they never overlap.
export function useCrossChat(): CrossChatController {
  const [messages, setMessages] = useState<CrossChatTurn[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<CrossChatTurn[]>([]);
  messagesRef.current = messages;

  const ask = useCallback(
    (question: string, scope: RetrievalScope): void => {
      const q = question.trim();
      if (!q || busy) return;

      const history: CrossChatTurn[] = [...messagesRef.current, { role: 'user', content: q }];
      setMessages(history);
      setStreamingText('');
      setBusy(true);
      setError(null);

      const off = window.api.chat.onToken(({ token }) => {
        setStreamingText((prev) => prev + token);
      });

      void window.api.chat
        .askAcross({ scope, messages: history.map(({ role, content }) => ({ role, content })) })
        .then((result) => {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: result.text,
              citations: result.citations,
              usage: result.usage,
            },
          ]);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          off();
          setStreamingText('');
          setBusy(false);
        });
    },
    [busy],
  );

  return { messages, streamingText, busy, error, ask };
}
