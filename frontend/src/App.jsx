import { useEffect, useState } from 'react';
import './App.css';
import UploadPanel from './components/UploadPanel';
import ChatWindow from './components/ChatWindow';
import ImageViewerPanel from './components/ImageViewerPanel';
import { uploadDocument, listDocuments, deleteDocument, askQuestion, setImageStarred } from './api';

let nextMessageId = 1;

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [deletingFilename, setDeletingFilename] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isAsking, setIsAsking] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // mobile-only tab switcher
  const [viewingImageFilename, setViewingImageFilename] = useState(null);

  async function refreshDocuments() {
    setIsLoadingDocuments(true);
    try {
      const docs = await listDocuments();
      setDocuments(docs);
    } catch (err) {
      console.error('Failed to load documents:', err);
    } finally {
      setIsLoadingDocuments(false);
    }
  }

  useEffect(() => {
    refreshDocuments();
  }, []);

  // If the document currently being viewed gets deleted, or its image
  // expires/is otherwise no longer cached, close the viewer rather than
  // leaving it pointed at a broken image.
  useEffect(() => {
    if (!viewingImageFilename) return;
    const stillHasImage = documents.some((d) => d.filename === viewingImageFilename && d.hasImage);
    if (!stillHasImage) viewImage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, viewingImageFilename]);

  // Opening an image switches to its own column (desktop) / its own mobile
  // tab, so it's immediately visible rather than requiring an extra tap.
  // Closing it falls back to the chat tab on mobile, since the "Image" tab
  // itself disappears once nothing is being viewed.
  function viewImage(filename) {
    setViewingImageFilename(filename);
    if (filename) {
      setActiveTab('image');
    } else {
      setActiveTab((prev) => (prev === 'image' ? 'chat' : prev));
    }
  }

  async function handleUpload(file, ocrMethod) {
    const result = await uploadDocument(file, ocrMethod);
    await refreshDocuments();
    return result;
  }

  async function handleDelete(filename) {
    setDeletingFilename(filename);
    try {
      await deleteDocument(filename);
      await refreshDocuments();
    } catch (err) {
      console.error('Failed to delete document:', err);
    } finally {
      setDeletingFilename(null);
    }
  }

  async function handleToggleStar(filename, starred) {
    try {
      await setImageStarred(filename, starred);
      await refreshDocuments();
    } catch (err) {
      console.error('Failed to update star status:', err);
    }
  }

  async function handleAsk(question) {
    setMessages((prev) => [...prev, { id: nextMessageId++, role: 'user', text: question }]);
    setIsAsking(true);
    try {
      const result = await askQuestion(question);
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId++, role: 'assistant', text: result.answer, sources: result.sources },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId++, role: 'assistant', text: err.message, isError: true },
      ]);
    } finally {
      setIsAsking(false);
    }
  }

  const viewingDoc = documents.find((d) => d.filename === viewingImageFilename);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>NoteWise</h1>
        <p className="app-tagline">Ask questions grounded in your own notes — everything stays local.</p>
      </header>

      <nav className="mobile-tabs">
        <button
          type="button"
          className={activeTab === 'documents' ? 'mobile-tab-active' : ''}
          onClick={() => setActiveTab('documents')}
        >
          Documents
        </button>
        <button
          type="button"
          className={activeTab === 'chat' ? 'mobile-tab-active' : ''}
          onClick={() => setActiveTab('chat')}
        >
          Chat
        </button>
        {viewingDoc && (
          <button
            type="button"
            className={activeTab === 'image' ? 'mobile-tab-active' : ''}
            onClick={() => setActiveTab('image')}
          >
            Image
          </button>
        )}
      </nav>

      <main className={`app-layout ${viewingDoc ? 'app-layout-has-image' : ''}`}>
        <div className={`layout-slot ${activeTab === 'documents' ? 'layout-slot-active-mobile' : ''}`}>
          <UploadPanel
            documents={documents}
            isLoadingDocuments={isLoadingDocuments}
            onUpload={handleUpload}
            onDelete={handleDelete}
            deletingFilename={deletingFilename}
            onToggleStar={handleToggleStar}
            viewingImageFilename={viewingImageFilename}
            onViewImage={viewImage}
          />
        </div>
        <div className={`layout-slot ${activeTab === 'chat' ? 'layout-slot-active-mobile' : ''}`}>
          <ChatWindow
            messages={messages}
            onAsk={handleAsk}
            isAsking={isAsking}
            hasDocuments={documents.length > 0}
          />
        </div>
        {viewingDoc && (
          <div className={`layout-slot ${activeTab === 'image' ? 'layout-slot-active-mobile' : ''}`}>
            <ImageViewerPanel
              filename={viewingDoc.filename}
              starred={viewingDoc.imageStarred}
              onToggleStar={handleToggleStar}
              onClose={() => viewImage(null)}
            />
          </div>
        )}
      </main>
    </div>
  );
}
