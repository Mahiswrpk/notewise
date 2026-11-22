const SOURCE_TYPE_LABELS = {
  text: { label: 'Text', className: 'badge-text' },
  'transcribed-gemini': { label: 'OCR: Gemini', className: 'badge-gemini' },
  'transcribed-tesseract': { label: 'OCR: Tesseract', className: 'badge-tesseract' },
};

function formatDate(dateString) {
  const d = new Date(dateString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimeLeft(expiresAt) {
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return 'expiring soon';
  const hoursLeft = Math.ceil(msLeft / (60 * 60 * 1000));
  return `image expires in ${hoursLeft}h`;
}

export default function DocumentList({
  documents,
  onDelete,
  deletingFilename,
  onToggleStar,
  viewingImageFilename,
  onViewImage,
}) {
  if (documents.length === 0) {
    return <p className="empty-hint">No documents uploaded yet.</p>;
  }

  return (
    <ul className="document-list">
      {documents.map((doc) => {
        const badge = SOURCE_TYPE_LABELS[doc.sourceType] || { label: doc.sourceType, className: '' };
        const isViewing = viewingImageFilename === doc.filename;

        return (
          <li key={doc.filename} className="document-item">
            <div className="document-item-main">
              <span className="document-filename" title={doc.filename}>
                {doc.filename}
              </span>
              <span className={`badge ${badge.className}`}>{badge.label}</span>
            </div>
            <div className="document-item-meta">
              <span>{doc.chunkCount} chunk{doc.chunkCount === 1 ? '' : 's'}</span>
              <span>&middot;</span>
              <span>{formatDate(doc.uploadDate)}</span>
              {doc.hasImage && !doc.imageStarred && doc.imageExpiresAt && (
                <>
                  <span>&middot;</span>
                  <span>{formatTimeLeft(doc.imageExpiresAt)}</span>
                </>
              )}
            </div>

            {doc.hasImage && (
              <div className="document-item-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onViewImage(isViewing ? null : doc.filename)}
                >
                  {isViewing ? 'Hide image' : 'View image →'}
                </button>
                <button
                  type="button"
                  className={`text-button star-button ${doc.imageStarred ? 'star-button-active' : ''}`}
                  onClick={() => onToggleStar(doc.filename, !doc.imageStarred)}
                  title={doc.imageStarred ? 'Un-star (will expire again)' : 'Star to keep this image indefinitely'}
                >
                  {doc.imageStarred ? '★ Starred' : '☆ Star'}
                </button>
              </div>
            )}

            <button
              type="button"
              className="icon-button delete-button"
              onClick={() => onDelete(doc.filename)}
              disabled={deletingFilename === doc.filename}
              aria-label={`Delete ${doc.filename}`}
            >
              {deletingFilename === doc.filename ? '…' : '✕'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
