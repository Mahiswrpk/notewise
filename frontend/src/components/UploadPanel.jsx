import { useRef, useState } from 'react';
import DocumentList from './DocumentList';

const OCR_METHODS = [
  { value: 'gemini', label: 'Gemini vision', hint: 'Most accurate, uses your free API quota' },
  { value: 'tesseract', label: 'Tesseract.js', hint: 'Offline, no API key, less accurate' },
  { value: 'both', label: 'Both (compare)', hint: 'Shows both; only Gemini\'s is searchable' },
];

export default function UploadPanel({
  documents,
  isLoadingDocuments,
  onUpload,
  onDelete,
  deletingFilename,
  onToggleStar,
  viewingImageFilename,
  onViewImage,
}) {
  const fileInputRef = useRef(null);
  const [ocrMethod, setOcrMethod] = useState('gemini');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setLastResult(null);

    try {
      const result = await onUpload(file, ocrMethod);
      setLastResult(result);
      if (result.imageCached) {
        onViewImage(result.filename);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <section className="panel upload-panel">
      <h2 className="panel-title">Your documents</h2>

      <div className="ocr-selector" role="radiogroup" aria-label="OCR method">
        {OCR_METHODS.map((method) => (
          <label
            key={method.value}
            className={`ocr-option ${ocrMethod === method.value ? 'ocr-option-selected' : ''}`}
          >
            <input
              type="radio"
              name="ocrMethod"
              value={method.value}
              checked={ocrMethod === method.value}
              onChange={() => setOcrMethod(method.value)}
            />
            <span className="ocr-option-label">{method.label}</span>
            <span className="ocr-option-hint">{method.hint}</span>
          </label>
        ))}
      </div>
      <p className="field-hint">Only applies to image uploads (.jpg/.png) — text files skip OCR.</p>

      <label className="upload-dropzone">
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          disabled={isUploading}
        />
        <span className="upload-dropzone-text">
          {isUploading ? 'Processing…' : 'Click to choose a file (.txt, .md, .pdf, .jpg, .png)'}
        </span>
      </label>

      {error && <p className="error-message">{error}</p>}

      {lastResult?.warnings?.length > 0 && (
        <ul className="warning-list">
          {lastResult.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {lastResult?.ocrTranscripts && (
        <div className="ocr-comparison">
          <h3 className="ocr-comparison-title">OCR comparison for {lastResult.filename}</h3>
          <div className="ocr-comparison-grid">
            <div>
              <h4>Gemini vision</h4>
              <p className="ocr-transcript">{lastResult.ocrTranscripts.gemini || '(failed)'}</p>
            </div>
            <div>
              <h4>Tesseract.js</h4>
              <p className="ocr-transcript">{lastResult.ocrTranscripts.tesseract || '(failed)'}</p>
            </div>
          </div>
          <p className="field-hint">Only the Gemini transcription was stored and is searchable in chat.</p>
        </div>
      )}

      {lastResult?.imageCached && (
        <p className="field-hint">
          The original image is cached for {lastResult.imageCacheDurationHours}h and now showing on
          the right — star it below to keep it longer.
        </p>
      )}

      <h3 className="panel-subtitle">
        Uploaded {isLoadingDocuments ? '' : `(${documents.length})`}
      </h3>
      <DocumentList
        documents={documents}
        onDelete={onDelete}
        deletingFilename={deletingFilename}
        onToggleStar={onToggleStar}
        viewingImageFilename={viewingImageFilename}
        onViewImage={onViewImage}
      />
    </section>
  );
}
