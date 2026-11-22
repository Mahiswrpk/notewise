const SOURCE_TYPE_SHORT_LABELS = {
  text: 'text',
  'transcribed-gemini': 'Gemini OCR',
  'transcribed-tesseract': 'Tesseract OCR',
};

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`message-row ${isUser ? 'message-row-user' : 'message-row-assistant'}`}>
      <span className="message-sender-label">{isUser ? 'You' : 'NoteWise'}</span>
      <div className={`message-bubble ${isUser ? 'message-bubble-user' : 'message-bubble-assistant'}`}>
        {message.isError ? (
          <p className="message-text message-error-text">{message.text}</p>
        ) : (
          <p className="message-text">{message.text}</p>
        )}

        {!isUser && message.sources && message.sources.length > 0 && (
          <details className="sources-details">
            <summary>Sources ({message.sources.length})</summary>
            <ul className="sources-list">
              {message.sources.map((s, i) => (
                <li key={i}>
                  <span className="source-filename">{s.filename}</span>
                  <span className="source-meta">
                    {SOURCE_TYPE_SHORT_LABELS[s.sourceType] || s.sourceType} · chunk {s.chunkIndex} · score{' '}
                    {s.score.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
