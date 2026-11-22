const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const pdfParse = require('pdf-parse');

const Chunk = require('../models/Chunk');
const CachedImage = require('../models/CachedImage');
const { splitIntoChunks } = require('../services/chunking');
const { embedBatch } = require('../services/embeddingService');
const {
  transcribeWithGemini,
  transcribeWithTesseract,
  looksLikeImageOnlyPdf,
} = require('../services/transcriptionService');
const {
  CACHE_DIR,
  CACHE_DURATION_HOURS,
  cacheImage,
  getCachedImage,
  deleteCachedImage,
  setStarred,
} = require('../services/imageCache');

const router = express.Router();

const UPLOAD_TEMP_DIR = path.join(__dirname, '..', 'uploads', 'temp');
fs.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true });

const ALLOWED_EXTENSIONS = ['.txt', '.md', '.pdf', '.jpg', '.jpeg', '.png'];
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

const IMAGE_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

// Uploaded files are written to a local temp folder just long enough to be
// parsed/transcribed, then always deleted (see the `finally` block below).
// Image uploads (.jpg/.png) are the one exception: a COPY is kept in
// uploads/cache/ for a limited time (see services/imageCache.js) so a
// student can view the original photo next to its transcription while
// studying - not a permanent store, just a time-boxed convenience cache.
const upload = multer({
  dest: UPLOAD_TEMP_DIR,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      const err = new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

/**
 * Chunk + embed a piece of text and insert the resulting Chunk documents.
 * Returns how many chunks were stored and any per-chunk embedding warnings.
 */
async function chunkEmbedAndStore(text, sourceFilename, sourceType) {
  const chunkTexts = splitIntoChunks(text);

  if (chunkTexts.length === 0) {
    return { chunkCount: 0, warnings: ['No text content found to chunk.'] };
  }

  const { embeddings, errors } = await embedBatch(chunkTexts);

  const docsToInsert = [];
  const warnings = [];

  chunkTexts.forEach((chunkText, i) => {
    if (embeddings[i]) {
      docsToInsert.push({
        sourceFilename,
        sourceType,
        chunkText,
        chunkIndex: i,
        embedding: embeddings[i],
      });
    } else {
      warnings.push(`Chunk ${i} failed to embed and was skipped: ${errors[i]}`);
    }
  });

  if (docsToInsert.length > 0) {
    await Chunk.insertMany(docsToInsert);
  }

  return { chunkCount: docsToInsert.length, warnings };
}

// POST /api/documents - upload and process a file
router.post('/', upload.single('file'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (expected form field "file").' });
  }

  const tempPath = req.file.path;
  const originalFilename = req.file.originalname;
  const ext = path.extname(originalFilename).toLowerCase();
  const ocrMethod = ['gemini', 'tesseract', 'both'].includes(req.body.ocrMethod)
    ? req.body.ocrMethod
    : 'gemini';

  try {
    let text = '';
    let sourceType = 'text';
    let ocrTranscripts;
    const warnings = [];

    if (ext === '.txt' || ext === '.md') {
      text = await fsp.readFile(tempPath, 'utf-8');
      sourceType = 'text';
    } else if (ext === '.pdf') {
      const buffer = await fsp.readFile(tempPath);
      const parsed = await pdfParse(buffer);

      if (looksLikeImageOnlyPdf(parsed)) {
        return res.status(400).json({
          error:
            'This PDF appears to have no selectable text layer (it looks like a scanned document). ' +
            'Scanned-PDF OCR isn\'t supported yet - please export/screenshot the pages as .jpg or .png ' +
            'and upload those instead, which fully supports OCR transcription.',
        });
      }

      text = parsed.text;
      sourceType = 'text';
    } else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
      const buffer = await fsp.readFile(tempPath);
      const mimeType = IMAGE_MIME_BY_EXT[ext];

      // Cache the image right away, before attempting OCR - this way the
      // student can still view (and re-try transcribing) the photo even if
      // transcription below ends up failing entirely.
      await cacheImage(tempPath, originalFilename, mimeType);

      if (ocrMethod === 'gemini') {
        text = await transcribeWithGemini(buffer, mimeType);
        sourceType = 'transcribed-gemini';
      } else if (ocrMethod === 'tesseract') {
        text = await transcribeWithTesseract(buffer);
        sourceType = 'transcribed-tesseract';
      } else {
        // "both": run both engines so the user can compare them side by
        // side, but only the Gemini transcription is chunked/embedded/
        // stored as searchable Chunk documents (see README for why).
        const [geminiResult, tesseractResult] = await Promise.allSettled([
          transcribeWithGemini(buffer, mimeType),
          transcribeWithTesseract(buffer),
        ]);

        ocrTranscripts = {
          gemini: geminiResult.status === 'fulfilled' ? geminiResult.value : null,
          tesseract: tesseractResult.status === 'fulfilled' ? tesseractResult.value : null,
        };

        if (geminiResult.status === 'rejected') {
          warnings.push(`Gemini transcription failed: ${geminiResult.reason.message}`);
        }
        if (tesseractResult.status === 'rejected') {
          warnings.push(`Tesseract transcription failed: ${tesseractResult.reason.message}`);
        }

        if (geminiResult.status !== 'fulfilled') {
          return res.status(502).json({
            error: 'Gemini transcription failed, so nothing could be stored for search.',
            warnings,
            ocrTranscripts,
          });
        }

        text = geminiResult.value;
        sourceType = 'transcribed-gemini';
      }
    }

    if (!text || !text.trim()) {
      return res.status(422).json({
        error: 'No text could be extracted or transcribed from this file.',
        warnings,
        ocrTranscripts,
      });
    }

    const { chunkCount, warnings: chunkWarnings } = await chunkEmbedAndStore(
      text,
      originalFilename,
      sourceType
    );

    const isImage = ['.jpg', '.jpeg', '.png'].includes(ext);

    res.status(201).json({
      filename: originalFilename,
      sourceType,
      chunkCount,
      ocrTranscripts,
      warnings: [...warnings, ...chunkWarnings],
      ...(isImage && { imageCached: true, imageCacheDurationHours: CACHE_DURATION_HOURS }),
    });
  } catch (err) {
    next(err);
  } finally {
    // Always clean up the temp upload, success or failure - uploaded files
    // never live on disk longer than it takes to process them.
    fs.unlink(tempPath, () => {});
  }
});

// GET /api/documents - list uploaded documents with chunk counts
router.get('/', async (req, res, next) => {
  try {
    const docs = await Chunk.aggregate([
      {
        $group: {
          _id: '$sourceFilename',
          sourceType: { $first: '$sourceType' },
          chunkCount: { $sum: 1 },
          uploadDate: { $min: '$createdAt' },
        },
      },
      { $sort: { uploadDate: -1 } },
    ]);

    // Small collection (one row per currently-cached image) - cheap to
    // fetch in full and join in JS rather than an aggregation $lookup.
    const cachedImages = await CachedImage.find({}).lean();
    const cacheByFilename = new Map(cachedImages.map((c) => [c.sourceFilename, c]));

    res.json(
      docs.map((d) => {
        const cached = cacheByFilename.get(d._id);
        return {
          filename: d._id,
          sourceType: d.sourceType,
          uploadDate: d.uploadDate,
          chunkCount: d.chunkCount,
          hasImage: Boolean(cached),
          imageStarred: cached ? cached.starred : false,
          imageExpiresAt:
            cached && !cached.starred
              ? new Date(new Date(cached.cachedAt).getTime() + CACHE_DURATION_HOURS * 60 * 60 * 1000)
              : null,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

// GET /api/documents/:filename/image - view a still-cached original image
router.get('/:filename/image', async (req, res, next) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const cached = await getCachedImage(filename);

    if (!cached) {
      return res.status(404).json({
        error: `No cached image for "${filename}" - it may have expired (images are kept for ${CACHE_DURATION_HOURS}h unless starred) or this document never had one.`,
      });
    }

    res.type(cached.mimeType).sendFile(path.join(CACHE_DIR, cached.storedFilename));
  } catch (err) {
    next(err);
  }
});

// PATCH /api/documents/:filename/star - star/un-star a cached image so it's
// kept indefinitely instead of expiring after CACHE_DURATION_HOURS
router.patch('/:filename/star', async (req, res, next) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const { starred } = req.body;

    if (typeof starred !== 'boolean') {
      return res.status(400).json({ error: 'Request body must include a boolean "starred" field.' });
    }

    const updated = await setStarred(filename, starred);

    if (!updated) {
      return res.status(404).json({ error: `No cached image for "${filename}" to star.` });
    }

    res.json({ filename, starred: updated.starred });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/documents/:filename - remove a document and its chunks
router.delete('/:filename', async (req, res, next) => {
  try {
    const filename = decodeURIComponent(req.params.filename);
    const result = await Chunk.deleteMany({ sourceFilename: filename });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: `No document found with filename "${filename}"` });
    }

    // Deleting a document removes its cached image too, starred or not -
    // there's no reason to keep an orphaned image around once its
    // transcription/chunks are gone.
    await deleteCachedImage(filename);

    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
