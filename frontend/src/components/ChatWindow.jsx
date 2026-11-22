import { useEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';

export default function ChatWindow({ messages, onAsk, isAsking, hasDocuments }) {
  const [question, setQuestion] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || isAsking) return;
    onAsk(trimmed);
    setQuestion('');
  }

  return (
    <section className="panel chat-panel">
      <h2 className="panel-title">Ask NoteWise</h2>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-empty-state">
            <span className="chat-empty-sparkle" aria-hidden="true">
              ✦
            </span>
            <p className="chat-empty-title">Ask NoteWise anything</p>
            <p className="empty-hint">
              {hasDocuments
                ? 'Ask a question about your uploaded documents.'
                : 'Upload a document to get started.'}
            </p>
          </div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
        {isAsking && (
          <div className="message-row message-row-assistant">
            <span className="message-sender-label">NoteWise</span>
            <div className="message-bubble message-bubble-assistant message-bubble-thinking">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          placeholder="Ask me anything about your notes…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={isAsking}
        />
        <button
          type="submit"
          className="send-button"
          disabled={isAsking || !question.trim()}
          aria-label="Send"
        >
          ➤
        </button>
      </form>
    </section>
  );
}
