const mongoose = require('mongoose');

// A "Chunk" is one small piece of a document (roughly 300-500 words) along with
// the embedding vector that represents its meaning. We store many chunks per
// uploaded file. At question time we compare the question's embedding against
// every chunk's embedding to find which chunks are most relevant (see
// services/similarity.js for the actual comparison math).
const chunkSchema = new mongoose.Schema({
  // Original uploaded file this chunk came from, e.g. "biology-notes.pdf"
  sourceFilename: {
    type: String,
    required: true,
    index: true,
  },

  // How the text in this chunk was obtained:
  // - "text": extracted directly from a .txt/.md/.pdf with a real text layer
  // - "transcribed-gemini": OCR'd from an image via Gemini's vision model
  // - "transcribed-tesseract": OCR'd from an image via the offline tesseract.js engine
  sourceType: {
    type: String,
    enum: ['text', 'transcribed-gemini', 'transcribed-tesseract'],
    required: true,
  },

  // The actual text content of this chunk.
  chunkText: {
    type: String,
    required: true,
  },

  // Position of this chunk within its source document (0, 1, 2, ...).
  // Lets us reconstruct reading order or show "chunk 3 of notes.txt".
  chunkIndex: {
    type: Number,
    required: true,
  },

  // The embedding vector for chunkText, produced by Gemini's gemini-embedding-001
  // model. This is just an array of numbers (3072 of them for this model) that
  // represents the *meaning* of the text in a way we can compare mathematically.
  embedding: {
    type: [Number],
    required: true,
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Speeds up "all chunks for this file, in order" queries (used when deleting
// a document, and when grouping chunks per file for GET /api/documents).
chunkSchema.index({ sourceFilename: 1, chunkIndex: 1 });

module.exports = mongoose.model('Chunk', chunkSchema);
