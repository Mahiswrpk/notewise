# NoteWise

Upload your own notes and documents — typed, PDF, or handwritten photos — then ask questions and get answers grounded in exactly what you uploaded. Everything runs locally: your files, your database, your search. Only small pieces of text (a chunk, a question) ever leave your machine, and only to call the Gemini and Groq APIs that do the AI work.

This is a learning project built to make every step of a RAG (Retrieval-Augmented Generation) pipeline visible and understandable — nothing is hidden behind a managed vector database or a black-box SDK.

## Table of contents

- [How it works (the RAG pipeline)](#how-it-works-the-rag-pipeline)
- [Viewing your original images (temporary caching)](#viewing-your-original-images-temporary-caching)
- [Why manual cosine similarity instead of MongoDB Atlas?](#why-manual-cosine-similarity-instead-of-mongodb-atlas)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Setup](#setup)
  1. [Install MongoDB Community Server](#1-install-mongodb-community-server-locally)
  2. [Browse your data with MongoDB Compass](#2-browse-your-data-with-mongodb-compass)
  3. [Get a free Gemini API key](#3-get-a-free-gemini-api-key)
  4. [Get a free Groq API key](#4-get-a-free-groq-api-key)
  5. [Configure and run NoteWise](#5-configure-and-run-notewise)
- [Access NoteWise from your phone](#access-notewise-from-your-phone)
- [API reference](#api-reference)
- [Privacy note](#privacy-note)
- [Gemini vision vs. Tesseract.js](#gemini-vision-vs-tesseractjs)
- [Limits of manual similarity search](#limits-of-manual-similarity-search)
- [Troubleshooting](#troubleshooting)
- [Ideas to extend this project](#ideas-to-extend-this-project)

---

## How it works (the RAG pipeline)

**RAG** stands for **R**etrieval-**A**ugmented **G**eneration: instead of asking an LLM a question and hoping it happens to know the answer (and doesn't make something up), you first *retrieve* the most relevant pieces of your own documents, then *generate* an answer using an LLM that's told "answer using only this text." That's the whole idea. NoteWise implements it in two halves:

**Uploading a document:**

```
your file (.txt/.md/.pdf/.jpg/.png)
   │
   ├─ image or scanned file? ─► transcribe to text (Gemini vision, and/or Tesseract.js)
   │                            (a copy of the image is also cached locally
   │                             for 24h so you can view it later - see below)
   │
   ▼
split into overlapping ~300-500 word chunks
   │
   ▼
send each chunk's text to Gemini's embedding API → get back a vector (list of numbers)
   │
   ▼
store { sourceFilename, sourceType, chunkText, chunkIndex, embedding } in local MongoDB
```

**Asking a question:**

```
your question
   │
   ▼
send question text to Gemini's embedding API → get back a vector
   │
   ▼
fetch every stored chunk's embedding from local MongoDB
   │
   ▼
compute cosine similarity (in plain Node.js) between the question vector
and every chunk vector — take the top 4-5 highest-scoring chunks
   │
   ├─ nothing scores high enough? ─► reply "I don't know" (never call the LLM)
   │
   ▼
send the retrieved chunks + your question to Groq's LLM, instructed to
work only from that text (answering directly, or generating something
like a quiz question, but never using outside knowledge)
   │
   ▼
return { answer, sources } to the UI
```

**What is an embedding, conceptually?** It's a list of numbers that represents the *meaning* of a piece of text, produced by a model trained to place texts with similar meaning near each other in that number-space. "The dog ran fast" and "the canine sprinted" end up with numerically similar vectors even though they share almost no words.

**What is cosine similarity, conceptually?** It measures the *angle* between two vectors, which tells you how similarly "aimed" they are, regardless of their length. A score of `1` means "pointing in exactly the same direction" (very similar meaning), `0` means unrelated, and `-1` means opposite. See [`backend/services/similarity.js`](backend/services/similarity.js) for the actual formula, implemented from scratch and heavily commented.

## Viewing your original images (temporary caching)

Handwritten/scanned notes are always transcribed to text and chunked/embedded like any other document — but purely deleting the photo the instant transcription finishes makes it hard to compare the OCR output against the original while you're actively studying. So NoteWise keeps a local copy of each uploaded image for **24 hours** after upload, in `backend/uploads/cache/` (gitignored, never committed) — long enough for one or two study sessions without becoming a permanent photo library.

- Click **"View image"** on any document in the left panel and it opens in its **own dedicated column on the right** — a three-column layout (Documents → Chat → Image), not a small inline thumbnail — so you can look at the original handwriting full-height while reading answers or asking follow-up questions in the chat next to it. Uploading a new image opens this column automatically; on mobile it becomes a third "Image" tab alongside Documents/Chat instead of its own column.
- A background sweep runs every 30 minutes and deletes any cached image older than 24 hours (see [`backend/services/imageCache.js`](backend/services/imageCache.js)). It also checks lazily whenever an image is requested, as a backstop.
- **Star** an image (in the document list, or in the image viewer itself, or via `PATCH /api/documents/:filename/star`) to keep it indefinitely instead — starred images are skipped by the sweep until you un-star or delete the document.
- Deleting a document (`DELETE /api/documents/:filename`) always removes its cached image too, starred or not.
- This is still a deliberate trade-off, not a full archive: only the **most recently uploaded copy** of a given filename is kept (re-uploading the same filename replaces the old cached image), and non-image files (`.txt`/`.md`/`.pdf`) are never cached — there's no "original photo" to view for those.

## Why manual cosine similarity instead of MongoDB Atlas?

MongoDB has a built-in vector search feature, `$vectorSearch` — but it **only works on MongoDB Atlas**, MongoDB's cloud-hosted product. This project's whole point is to run entirely on your own machine with a local, free, Community Server install and no cloud dependency for storage. So instead of a managed vector index, NoteWise stores each chunk's embedding as a plain array of numbers in a normal MongoDB document, and does the comparison itself: fetch every chunk, compute cosine similarity against the question in a JavaScript loop, sort, take the top matches. It's slower and less sophisticated than a real vector index, but it's transparent, free, and entirely local — see [Limits of manual similarity search](#limits-of-manual-similarity-search) for the honest trade-off.

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | MongoDB Community Server, local, via Mongoose |
| Vector search | Manual cosine similarity in application code |
| Frontend | React + Vite |
| Embeddings | Google Gemini, `gemini-embedding-001` (free tier) |
| Generation | Groq, `openai/gpt-oss-20b` (free tier, OpenAI-compatible API) |
| PDF/text parsing | `pdf-parse`, plain `fs` reads |
| Handwriting/scan OCR | Gemini vision (primary), Tesseract.js (offline, optional) |

## Project structure

```
NoteWise/
├── backend/
│   ├── server.js                    Express app, Mongo connection, error handling
│   ├── models/Chunk.js              Mongoose schema for a stored chunk
│   ├── models/CachedImage.js        Mongoose schema for a temporarily-cached image
│   ├── routes/documents.js          upload/list/delete/image/star endpoints
│   ├── routes/chat.js               question-answering endpoint
│   └── services/
│       ├── chunking.js              word-count sliding-window text splitter
│       ├── embeddingService.js      Gemini embedding API calls
│       ├── llmService.js            Groq chat completion calls
│       ├── similarity.js            cosineSimilarity() + retrieval logic
│       ├── transcriptionService.js  Gemini vision + Tesseract.js OCR
│       └── imageCache.js            24h image cache + star/expiry/sweep logic
├── frontend/                        React (Vite) chat UI
├── docs/
│   ├── HOWTORUN.md                  copy-paste command reference
│   └── interview-notes.docx         interview-prep notes on this project
├── .env.example
└── .gitignore
```

## Setup

### 1. Install MongoDB Community Server locally

NoteWise needs a MongoDB server running at `mongodb://localhost:27017`. This is the free, self-hosted MongoDB — not Atlas, and no account needed.

**Windows**
1. Download the MSI installer from [mongodb.com/try/download/community](https://www.mongodb.com/try/download/community).
2. Run it, choosing "Complete" setup. Leave "Install MongoDB as a Service" checked — this makes MongoDB start automatically on boot, so you never need to manually launch it.
3. Verify it's running: open PowerShell and run `Get-Service MongoDB` — `Status` should say `Running`. If not: `Start-Service MongoDB`.

**macOS** (via Homebrew)
```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community
```

**Linux** (Ubuntu/Debian — see MongoDB's docs for other distros)
```bash
# Follow the official install steps at:
# https://www.mongodb.com/docs/manual/administration/install-on-linux/
sudo systemctl start mongod
sudo systemctl enable mongod   # start on boot
```

To confirm it's up on any OS, run `mongosh` (MongoDB's shell) — if it connects without an error, you're good.

### 2. Browse your data with MongoDB Compass

[MongoDB Compass](https://www.mongodb.com/try/download/compass) is a free GUI for MongoDB — handy for actually *seeing* your chunks and embeddings, not just trusting the API.

1. Install and open Compass.
2. Connect using the connection string `mongodb://localhost:27017` (the default "New Connection" screen usually has this pre-filled).
3. In the left sidebar, open the `chat-with-notes` database (created automatically the first time NoteWise stores a chunk) → `chunks` collection.
4. Upload a document through NoteWise, then refresh the collection in Compass. You should see one document per chunk, with `chunkText` (readable text) and `embedding` (a long array of decimal numbers) fields — this is the most direct way to confirm the pipeline is actually working.

### 3. Get a free Gemini API key

1. Go to [aistudio.google.com](https://aistudio.google.com).
2. Sign in with a Google account.
3. Click "Get API key" → "Create API key". No credit card is required for the free tier.
4. Copy the key — you'll paste it into `.env` as `GEMINI_API_KEY`.

### 4. Get a free Groq API key

1. Go to [console.groq.com](https://console.groq.com).
2. Sign up / sign in.
3. Go to "API Keys" → "Create API Key".
4. Copy the key — you'll paste it into `.env` as `GROQ_API_KEY`.

### 5. Configure and run NoteWise

```bash
# from the project root
cp .env.example .env
# now edit .env and fill in GEMINI_API_KEY and GROQ_API_KEY
```

`.env` (project root):
```
GEMINI_API_KEY=your-gemini-key-here
GROQ_API_KEY=your-groq-key-here
MONGODB_URI=mongodb://localhost:27017/chat-with-notes
PORT=5000
```

**Backend** (terminal 1):
```bash
cd backend
npm install
npm run dev
# -> "Connected to MongoDB ..." and "NoteWise backend listening on http://localhost:5000"
```

**Frontend** (terminal 2):
```bash
cd frontend
npm install
npm run dev
# -> Local: http://localhost:5173
```

Open `http://localhost:5173` in your browser. Upload a `.txt`/`.md`/`.pdf`/`.jpg`/`.png` file, then ask a question about it.

## Access NoteWise from your phone

Since everything runs locally with no cloud deployment, your phone needs to be on the **same Wi-Fi network** as the computer running NoteWise.

1. Find your computer's local IP address:
   - Windows: `ipconfig` → look for "IPv4 Address" (something like `192.168.1.23`)
   - macOS/Linux: `ifconfig` or `ip addr` → look for your Wi-Fi interface's `inet` address
2. Both `npm run dev` commands already bind to your whole network (not just `localhost`) — the backend listens on `0.0.0.0`, and the frontend's `vite.config.js` sets `server.host: true`. When you run the frontend, its terminal output will print a "Network" URL like `http://192.168.1.23:5173` — that's what to open on your phone.
3. Optionally, create `frontend/.env` (copy `frontend/.env.example`) with:
   ```
   VITE_API_BASE_URL=http://192.168.1.23:5000/api
   ```
   using your own machine's IP, then restart the frontend dev server. This isn't strictly required if you're only browsing from the same machine, but it's needed for the phone to reach the *backend* (the frontend's default `http://localhost:5000/api` means "localhost as seen by the phone," which isn't your computer).

## API reference

Base URL: `http://localhost:5000/api`

### `POST /documents`

Upload and process a file. `multipart/form-data` with fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `file` | File | yes | `.txt`, `.md`, `.pdf`, `.jpg`, `.jpeg`, or `.png`, up to 20MB |
| `ocrMethod` | string | no | `gemini` (default), `tesseract`, or `both` — only affects image uploads |

Example (curl):
```bash
curl -X POST http://localhost:5000/api/documents \
  -F "file=@notes.pdf"
```

Example response:
```json
{
  "filename": "notes.pdf",
  "sourceType": "text",
  "chunkCount": 7,
  "warnings": []
}
```

Any image upload (`.jpg`/`.png`, regardless of `ocrMethod`) also includes `imageCached: true` — the original is kept viewable for 24h, see [Viewing your original images](#viewing-your-original-images-temporary-caching). With `ocrMethod=both`, the response additionally includes both transcripts:
```json
{
  "filename": "handwritten.jpg",
  "sourceType": "transcribed-gemini",
  "chunkCount": 3,
  "ocrTranscripts": {
    "gemini": "…full Gemini transcription…",
    "tesseract": "…full Tesseract transcription…"
  },
  "warnings": [],
  "imageCached": true,
  "imageCacheDurationHours": 24
}
```

### `GET /documents`

List uploaded documents.

```bash
curl http://localhost:5000/api/documents
```
```json
[
  {
    "filename": "notes.pdf",
    "sourceType": "text",
    "uploadDate": "2026-08-08T09:12:00.000Z",
    "chunkCount": 7,
    "hasImage": false,
    "imageStarred": false,
    "imageExpiresAt": null
  },
  {
    "filename": "handwritten.jpg",
    "sourceType": "transcribed-gemini",
    "uploadDate": "2026-08-08T10:03:00.000Z",
    "chunkCount": 3,
    "hasImage": true,
    "imageStarred": false,
    "imageExpiresAt": "2026-08-09T10:03:00.000Z"
  }
]
```

### `DELETE /documents/:filename`

Remove a document, all of its chunks, and its cached image if it has one (starred or not).

```bash
curl -X DELETE http://localhost:5000/api/documents/notes.pdf
```
```json
{ "deletedCount": 7 }
```

### `GET /documents/:filename/image`

Fetch a still-cached original image (see [Viewing your original images](#viewing-your-original-images-temporary-caching)). Returns the raw image bytes with the right `Content-Type`, or a 404 if there's nothing cached for that filename (never an image upload, or it expired).

```bash
curl http://localhost:5000/api/documents/photo.jpg/image --output photo.jpg
```

### `PATCH /documents/:filename/star`

Star or un-star a cached image, exempting/re-including it from the 24-hour auto-expiry.

```bash
curl -X PATCH http://localhost:5000/api/documents/photo.jpg/star \
  -H "Content-Type: application/json" \
  -d '{"starred": true}'
```
```json
{ "filename": "photo.jpg", "starred": true }
```

### `POST /chat`

Ask a question grounded in your uploaded documents.

```bash
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "What did my notes say about photosynthesis?"}'
```
```json
{
  "answer": "Photosynthesis is the process by which plants convert sunlight into energy using chlorophyll.",
  "sources": [
    { "filename": "notes.pdf", "sourceType": "text", "chunkIndex": 2, "score": 0.81 }
  ]
}
```

If nothing relevant is found, `sources` is `[]` and `answer` explains that NoteWise doesn't know — the LLM is never called in that case, so it can't hallucinate an answer.

## Privacy note

Gemini's free tier (used for embeddings and vision OCR) may be used by Google to improve their products — that's part of what makes it free. Avoid uploading sensitive or confidential documents through NoteWise, even though **storage itself** (the database, and the temporary image cache described [above](#viewing-your-original-images-temporary-caching)) is 100% local and never leaves your machine. Only chunk text and images you explicitly upload are sent to Gemini's API; Groq's API only ever receives the retrieved chunk text and your question, never a whole document. Note that uploaded images aren't fully ephemeral anymore — they're kept locally for up to 24 hours (indefinitely if starred) rather than deleted immediately after transcription, purely for your own convenience while studying.

## Gemini vision vs. Tesseract.js

| | Gemini vision | Tesseract.js |
|---|---|---|
| Runs | Google's cloud API | 100% locally, offline |
| Cost | Free tier (rate-limited) | Free, no limits |
| API key needed | Yes | No |
| Handwriting accuracy | Generally strong | Generally weaker, especially on messy handwriting |
| Privacy | Image sent to Google | Image never leaves your machine |
| First-run cost | None | Downloads English language data once (~a few MB) |

NoteWise defaults to Gemini vision since it tends to produce noticeably better transcriptions of handwritten notes, but you can pick Tesseract for a fully offline, no-API-key path, or "both" to compare them side by side for the same image (see the upload panel in the UI).

## Limits of manual similarity search

`findTopMatches()` in [`backend/services/similarity.js`](backend/services/similarity.js) pulls **every** stored chunk out of MongoDB and scores it against the question on every single chat request — an O(n) scan. That's genuinely fine for hundreds or a few thousand chunks on one machine (which is the scale a personal notes app lives at), but it would not scale to millions of chunks or many simultaneous users — at that point you'd want a real vector index (like MongoDB Atlas `$vectorSearch`, Pinecone, or a local option like FAISS/Qdrant) that avoids re-scanning everything on every query. That's an intentional, documented trade-off for this project, not a bug — see [Ideas to extend](#ideas-to-extend-this-project).

## Troubleshooting

**"Could not connect to MongoDB" / connection refused**
MongoDB isn't running. On Windows, check `Get-Service MongoDB` and `Start-Service MongoDB` if it's stopped. On macOS/Linux, `brew services start mongodb-community` or `sudo systemctl start mongod`.

**"models/... is not found for API version v1beta" (404) from Gemini**
Google periodically retires specific Gemini model versions (this happened to both `text-embedding-004` and `gemini-1.5-flash` during this project's development, replaced with `gemini-embedding-001` and `gemini-flash-latest`). If you hit this, call `GET https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY` to see what's currently available to your key, then update the relevant constant — `GEMINI_EMBEDDING_MODEL` in `embeddingService.js` or `GEMINI_VISION_MODEL` in `transcriptionService.js`. Prefer a `-latest` alias (like `gemini-flash-latest`) over a pinned version number where available, since Google keeps those pointed at whatever their current recommended model is instead of retiring them outright.

**"The model `...` does not exist or you do not have access to it" (404) from Groq**
Groq's free-tier model lineup shifts too — `llama-3.1-8b-instant` (this project's original target) was retired at some point and replaced with `openai/gpt-oss-20b`. If you hit this, call `GET https://api.groq.com/openai/v1/models` with `Authorization: Bearer YOUR_GROQ_KEY` to see what's currently available, then update `GROQ_MODEL` in `backend/services/llmService.js`. Note that some newer Groq models are "reasoning" models whose response includes a `message.reasoning` field alongside `message.content` — `llmService.js` only ever reads `message.content` (the final answer), so this doesn't need special handling, just be aware of it if you inspect raw API responses.

**Embedding dimension mismatch errors from `cosineSimilarity`**
This means two vectors you're comparing have different lengths — almost always because you changed embedding models mid-project (e.g. some chunks were embedded with a different model than the one currently configured). Re-upload your documents after changing `GEMINI_EMBEDDING_MODEL` in `embeddingService.js`, or clear the `chunks` collection in Compass and start fresh.

**Chat always says "I don't know" even though I uploaded something relevant**
The relevance cutoff (`MIN_SIMILARITY_THRESHOLD` in `similarity.js`, currently `0.5`, calibrated against real `gemini-embedding-001` output) may still be too strict for your documents/questions — cosine similarity scores from real embeddings don't map perfectly onto an intuitive 0-1 scale, and short/terse notes tend to score lower even when genuinely relevant. Try lowering the constant and restarting the backend, or check Compass to confirm chunks were actually stored with real embedding arrays (not empty).

**CORS errors in the browser console**
Make sure the backend is actually running on the port your frontend expects (`VITE_API_BASE_URL` / the default `http://localhost:5000/api`), and that you're not mixing `localhost` and `127.0.0.1` between frontend and backend (browsers treat them as different origins).

**"GEMINI_API_KEY is not set" / "GROQ_API_KEY is not set"**
Your `.env` file (project root, not inside `backend/`) is missing the key, or the backend was started before you added it — restart `npm run dev` in `backend/` after editing `.env`.

**Poor OCR quality on blurry/angled photos**
Both OCR engines do much better on well-lit, flat, in-focus photos. Try retaking the photo straight-on with good lighting, or crop tightly to just the written area before uploading.

**Tesseract.js seems to hang or is slow on first use**
The first time `tesseract.js` runs, it downloads English language data (a few MB) and caches it locally — subsequent runs are much faster. Make sure you have an internet connection for that first run even though later runs are fully offline.

**"View image" shows a 404 / no cached image found**
Uploaded images are only kept for 24 hours unless starred (see [Viewing your original images](#viewing-your-original-images-temporary-caching)) — this is expected once that window passes. Star an image before it expires if you want to keep viewing it indefinitely. Text-based uploads (`.txt`/`.md`/`.pdf`) never have a cached image to view in the first place.

**Uploaded a scanned PDF and got an error about "no text layer"**
This version of NoteWise doesn't rasterize PDF pages into images for OCR (see [Ideas to extend](#ideas-to-extend-this-project)). Export or screenshot the scanned pages as `.jpg`/`.png` and upload those instead — that path is fully supported.

## Ideas to extend this project

- **`.docx` support** — add a parser (e.g. `mammoth`) alongside `pdf-parse` for Word documents.
- **Multi-user support** — add auth and scope documents/chunks per user (a `userId` field on `Chunk` and a filter on every query).
- **Scanned-PDF OCR** — add a PDF-to-image rasterizer (e.g. `pdf-to-img`) so image-only PDFs can go through the same OCR path as `.jpg`/`.png` instead of being rejected.
- **A real vector index at scale** — if your document collection grows into the tens of thousands of chunks (or beyond), swap the manual O(n) cosine scan for a proper local vector index (e.g. FAISS, Qdrant, or an embedded option) or, if you're willing to use the cloud, MongoDB Atlas's native `$vectorSearch`.
- **A "study companion" phase** — a natural next direction discussed while planning this project, intentionally kept out of scope for v1:
  - **Automatic subject detection**: when a document is uploaded, ask an LLM to classify which subject it belongs to (matching an existing subject or proposing a new one), storing a `subject` field alongside each document/chunk.
  - **Subject-grouped organization**: group the document list and chat history by subject in the UI, so a student's biology notes and history notes don't blend together.
  - **Timetables and course plans**: let a student attach a syllabus/timetable per subject, giving NoteWise more context about what's coming up and what's already been covered.
  - **Question-paper pattern prediction**: upload previous years' question papers for a subject, have the system analyze recurring topics/formats, and surface likely areas to focus on ahead of an exam — essentially RAG over past papers instead of (or alongside) notes.

  This would be a meaningfully larger project (new data model, subject-aware retrieval, new UI navigation) and is deliberately left as a future direction rather than built into this version.
