import React, { useEffect, useRef, useCallback } from 'react';
import { useAssistant } from '../hooks/useAssistant';

function AssistantPanel() {
  const { messages, input, setInput, error, isLoading, submit } = useAssistant();
  const messagesRef = useRef(null);
  const formRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isLoading]);

  // Submit on Enter, newline on Shift+Enter
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    },
    []
  );

  return (
    <aside className="assistant-panel card">
      <div className="assistant-header">
        <div>
          <p className="eyebrow">AI Assistant</p>
          <h2>Grounded support chat</h2>
        </div>
        <span
          className={`assistant-status${isLoading ? ' assistant-status-busy' : ''}`}
          aria-live="polite"
        >
          <span className="status-dot" />
          {isLoading ? 'Thinking' : 'Online'}
        </span>
      </div>

      <div className="assistant-messages" ref={messagesRef} aria-live="polite">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`chat-bubble ${message.role === 'user' ? 'user-bubble' : 'assistant-bubble'}${message.refusal ? ' refusal-bubble' : ''}`}
          >
            <span className="chat-role">
              {message.role === 'user' ? 'You' : 'Assistant'}
            </span>
            <p>{message.content}</p>

            {message.citations?.length > 0 && (
              <div className="citation-list">
                {message.citations.map((citation) => (
                  <span key={citation.id} className="citation-chip">
                    {citation.summary} · {citation.sf_case}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="chat-bubble assistant-bubble typing-bubble">
            <span className="chat-role">Assistant</span>
            <span className="typing-indicator" aria-label="Assistant is typing">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
      </div>

      {error && <div className="feedback-banner">{error}</div>}

      <form ref={formRef} onSubmit={submit} className="assistant-form">
        <textarea
          className="assistant-input"
          rows="2"
          placeholder="Ask a symptom, case ID, or next step. Enter to send."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
        />
        <button
          type="submit"
          className="btn-primary assistant-send"
          disabled={isLoading || !input.trim()}
          aria-label="Send message"
        >
          {isLoading ? '…' : 'Send'}
        </button>
      </form>
    </aside>
  );
}

export default AssistantPanel;
