import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../../shared/types';

/** An assistant turn carries the validated segment ids it cited; user turns don't. */
export type ChatTurn = ChatMessage & { citationIds?: number[] };

export type ChatController = {
  messages: ChatTurn[];
  /** The answer accumulating token-by-token for the in-flight ask ('' when idle). */
  streamingText: string;
  busy: boolean;
  error: string | null;
  ask: (question: string) => void;
};

// Owns one meeting's ephemeral chat (ROADMAP_07 Phase 1 — history is not persisted).
// History resets when the meeting changes. A generation counter drops any answer or
// token that arrives after the user has switched meetings mid-stream.
export function useChat(meetingId: number | null): ChatController {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generation = useRef(0);
  const messagesRef = useRef<ChatTurn[]>([]);
  messagesRef.current = messages;

  useEffect(() => {
    generation.current += 1; // invalidate any in-flight ask for the previous meeting
    setMessages([]);
    setStreamingText('');
    setError(null);
    setBusy(false);
  }, [meetingId]);

  const ask = useCallback(
    (question: string): void => {
      const q = question.trim();
      if (!q || meetingId === null || busy) return;

      const myGen = generation.current;
      const history: ChatTurn[] = [...messagesRef.current, { role: 'user', content: q }];
      setMessages(history);
      setStreamingText('');
      setBusy(true);
      setError(null);

      const off = window.api.chat.onToken(({ token }) => {
        if (generation.current !== myGen) return;
        setStreamingText((prev) => prev + token);
      });

      void window.api.chat
        .ask({ meetingId, messages: history.map(({ role, content }) => ({ role, content })) })
        .then((result) => {
          if (generation.current !== myGen) return;
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: result.text, citationIds: result.citationIds },
          ]);
        })
        .catch((e: unknown) => {
          if (generation.current !== myGen) return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          off();
          if (generation.current !== myGen) return;
          setStreamingText('');
          setBusy(false);
        });
    },
    [meetingId, busy],
  );

  return { messages, streamingText, busy, error, ask };
}
