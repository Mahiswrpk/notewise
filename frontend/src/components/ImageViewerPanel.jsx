import { getImageUrl } from '../api';

// Shown in its own column (desktop) or its own tab (mobile) when a student
// clicks "View image" on an uploaded document — lets them look at the
// original handwritten/scanned photo side-by-side with the chat while
// studying, instead of it being buried in the small left-hand document list.
export default function ImageViewerPanel({ filename, starred, onToggleStar, onClose }) {
  return (
    <section className="panel image-viewer-panel">
      <div className="image-viewer-header">
        <span className="image-viewer-filename" title={filename}>
          {filename}
        </span>
        <div className="image-viewer-actions">
          <button
            type="button"
            className={`text-button star-button ${starred ? 'star-button-active' : ''}`}
            onClick={() => onToggleStar(filename, !starred)}
            title={starred ? 'Un-star (will expire again)' : 'Star to keep this image indefinitely'}
          >
            {starred ? '★ Starred' : '☆ Star'}
          </button>
          <button type="button" className="icon-button-static" onClick={onClose} aria-label="Close image viewer">
            ✕
          </button>
        </div>
      </div>
      {/* Scrollable so the photo can always render at full column width
          (no empty left/right bars) even if that makes it taller than the
          panel - better to scroll than to shrink and waste horizontal space
          or crop the photo. */}
      <div className="image-viewer-scroll">
        <img className="image-viewer-image" src={getImageUrl(filename)} alt={`Original upload: ${filename}`} />
      </div>
    </section>
  );
}
