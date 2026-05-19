import { useState, useCallback, useRef, useEffect } from 'react';
import { API_BASE } from './useEntries';

const initialMessage = {
  role: 'assistant',
  content:
    'Ask about symptoms, fixes, or a known case. I will answer only from the saved knowledge pages and cite the pages I use.',
  citations: [],
  refusal: false,
};

/**
 * Parse a chunk of SSE wire-format text and emit `(event, data)` pairs.
 * Buffer state is kept in the `state` object across calls.
 */
function parseSSE(state, chunk, onEvent) {
  state.buffer += chunk;
  let idx;
  while ((idx = state.buffer.indexOf('\n\n')) !== -1) {
    const frame = state.buffer.slice(0, idx);
    state.buffer = state.buffer.slice(idx + 2);
    if (!frame.trim()) continue;
    let event = 'message';
    const dataLines = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5));
      }
    }
    onEvent(event, dataLines.join('\n'));
  }
}

export function useAssistant() {
  const [messages, setMessages] = useState([initialMessage]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef(null);

  // Cancel any in-flight stream when the component unmounts
  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed || isLoading) return;

      const userMessage = { role: 'user', content: trimmed };
      // Append the user message and an empty assistant placeholder we'll fill via stream
      setMessages((prev) => [
        ...prev,
        userMessage,
        { role: 'assistant', content: '', citations: [], refusal: false, streaming: true },
      ]);
      setInput('');
      setError('');
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`${API_BASE}/api/assistant/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({ question: trimmed }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed (HTTP ${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        const parseState = { buffer: '' };
        let sources = [];
        let streamError = '';

        const handleEvent = (evt, data) => {
          if (evt === 'message' && data) {
            // Append chunk to the last (streaming) assistant message
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === 'assistant' && last.streaming) {
                next[next.length - 1] = { ...last, content: last.content + data };
              }
              return next;
            });
          } else if (evt === 'sources') {
            try {
              const parsed = JSON.parse(data);
              sources = Array.isArray(parsed.ids) ? parsed.ids : [];
            } catch {
              /* ignore malformed sources frame */
            }
          } else if (evt === 'error') {
            streamError = data || 'Assistant error.';
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          parseSSE(parseState, decoder.decode(value, { stream: true }), handleEvent);
        }
        // Flush any final bytes
        parseSSE(parseState, decoder.decode(), handleEvent);

        // Finalise the assistant message: clear streaming flag, attach citations
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant' && last.streaming) {
            next[next.length - 1] = {
              ...last,
              streaming: false,
              citations: sources.map((id) => ({ id, summary: id, sf_case: '' })),
            };
          }
          return next;
        });

        if (streamError) {
          setError(streamError);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message || 'The assistant could not answer right now.');
        // Remove the empty placeholder bubble if we never received any content
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant' && last.streaming && !last.content) {
            next.pop();
          }
          return next;
        });
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [input, isLoading]
  );

  return { messages, input, setInput, error, isLoading, submit };
}
