// ---------------------------------------------------------------------------
// transcriptionService.js
//
// This file turns IMAGES into TEXT ("transcription" / "OCR" - Optical
// Character Recognition) so that handwritten or scanned notes can enter the
// same chunk -> embed -> store pipeline as a normal .txt file. Nothing here
// ever saves the image itself anywhere permanent - the caller (routes/documents.js)
// deletes the uploaded temp file once transcription is done.
//
// We support two transcription methods:
//
// 1. Gemini vision (the default / primary path): we send the image to a
//    Gemini model that can "see" images and ask it to transcribe exactly
//    what's written. This tends to be much more accurate on messy
//    handwriting, since it's a large, general-purpose AI model.
//
// 2. Tesseract.js (optional comparison mode): a free, open-source OCR
//    engine that runs entirely on your own machine, offline, with no API
//    key and no per-request cost. It uses a more "classical" LSTM-based
//    text recognition approach rather than a general AI model, so it's
//    usually less accurate on handwriting, but it never sends the image
//    anywhere and has no rate limits.
// ---------------------------------------------------------------------------

const { createWorker } = require('tesseract.js');

// "gemini-flash-latest" is a Google-maintained ALIAS that always points at
// their current recommended fast/free-tier-eligible Gemini model, rather
// than a specific pinned version (e.g. "gemini-1.5-flash") that eventually
// gets retired and starts returning 404s. Note this is a DIFFERENT model
// from gemini-embedding-001 (used in embeddingService.js) - embedding
// models only turn text into vectors, they can't "look at" an image. Kept
// as a constant here so it's a one-line change if you ever want to pin a
// specific version instead.
const GEMINI_VISION_MODEL = 'gemini-flash-latest';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const TRANSCRIBE_INSTRUCTION =
  'Transcribe all text visible in this image exactly as written, including any handwriting. ' +
  'Return only the transcribed text with no extra commentary, headers, or markdown formatting. ' +
  'If the image contains no legible text, respond with exactly: [NO TEXT FOUND]';

/**
 * Transcribe an image to text using Gemini's vision capability.
 *
 * @param {Buffer} imageBuffer - the raw image bytes
 * @param {string} mimeType - e.g. "image/png" or "image/jpeg"
 * @returns {Promise<string>} the transcribed text
 */
async function transcribeWithGemini(imageBuffer, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set - check your .env file');
  }

  const url = `${GEMINI_API_BASE}/models/${GEMINI_VISION_MODEL}:generateContent?key=${apiKey}`;

  // Gemini expects image bytes as base64 text inside an "inline_data" part,
  // alongside a normal text instruction part.
  const requestBody = {
    contents: [
      {
        parts: [
          { text: TRANSCRIBE_INSTRUCTION },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBuffer.toString('base64'),
            },
          },
        ],
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Gemini vision transcription failed (status ${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (typeof text !== 'string') {
    throw new Error('Gemini vision response did not contain the expected transcribed text');
  }

  const trimmed = text.trim();
  if (trimmed === '[NO TEXT FOUND]') {
    return '';
  }
  return trimmed;
}

/**
 * Transcribe an image to text using tesseract.js, entirely offline.
 *
 * @param {Buffer} imageBuffer - the raw image bytes
 * @returns {Promise<string>} the transcribed text
 */
async function transcribeWithTesseract(imageBuffer) {
  // createWorker('eng') downloads (once, then caches) the English language
  // data tesseract.js needs, then spins up a local recognition worker.
  const worker = await createWorker('eng');
  try {
    const {
      data: { text },
    } = await worker.recognize(imageBuffer);
    return text.trim();
  } finally {
    // Always shut the worker down, even if recognition throws, so we don't
    // leak background processes.
    await worker.terminate();
  }
}

// If pdf-parse extracts fewer than this many characters (or the text is
// essentially empty once trimmed), we assume the PDF has no real text layer
// - i.e. it's a scan of a page, not a document with selectable text - and we
// can't extract anything useful from it with pdf-parse alone.
const MIN_PDF_TEXT_CHARS = 20;

/**
 * Heuristic check: does this PDF appear to have no usable text layer (i.e.
 * is it a scanned/image-only PDF)? We don't attempt to rasterize PDF pages
 * into images and OCR them in this version of NoteWise - see the README's
 * "ideas to extend" section. Instead, when this returns true, the upload
 * route rejects the file with a clear message asking the user to export the
 * pages as .jpg/.png instead, which IS fully supported.
 *
 * @param {{ text: string }} pdfParseResult - the object returned by pdf-parse
 * @returns {boolean}
 */
function looksLikeImageOnlyPdf(pdfParseResult) {
  const text = (pdfParseResult?.text || '').trim();
  return text.length < MIN_PDF_TEXT_CHARS;
}

module.exports = {
  transcribeWithGemini,
  transcribeWithTesseract,
  looksLikeImageOnlyPdf,
  GEMINI_VISION_MODEL,
};
