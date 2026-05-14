import { useState, useCallback } from 'react';
import { requestJson } from './useEntries';

const initialMessage = {
  role: 'assistant',
  content:
    'Ask about symptoms, fixes, or a known case. I will answer only from the saved knowledge pages and cite the pages I use.',
  citations: [],
  refusal: false,
};

export function useAssistant() {
  const [messages, setMessages] = useState([initialMessage]);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const submit = useCallback(
    async (event) => {
      event.preventDefault();
      const trimmed = input.trim();
      if (!trimmed) return;

      const userMessage = { role: 'user', content: trimmed };
      const outgoing = [...messages, userMessage]
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setError('');
      setIsLoading(true);

      try {
        const response = await requestJson('/api/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed }),
        });

        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: response.answer,
            citations: Array.isArray(response.sources) ? response.sources : [],
            refusal: false,
          },
        ]);
      } catch (err) {
        setError(err.message || 'The assistant could not answer right now.');
      } finally {
        setIsLoading(false);
      }
    },
    [input, messages]
  );

  return { messages, input, setInput, error, isLoading, submit };
}
