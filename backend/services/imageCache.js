// ---------------------------------------------------------------------------
// imageCache.js
//
// NoteWise's core privacy rule is "don't keep uploaded images long-term" -
// but for a student actively studying, being able to glance at the original
// handwritten photo next to its transcription for a while is genuinely
// useful. This file implements a middle ground: uploaded images are kept in
// a local cache folder for a limited time (CACHE_DURATION_HOURS), then
// automatically deleted by a periodic sweep - UNLESS the student "stars" an
// image, in which case it's kept until they un-star or delete the document.
//
// This is intentionally a separate, small collection (CachedImage) from
// Chunk - a cached image is a property of the whole uploaded file, not of
// any individual chunk, and most uploads (.txt/.md/.pdf) never have one.
// ---------------------------------------------------------------------------

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

const CachedImage = require('../models/CachedImage');

const CACHE_DIR = path.join(__dirname, '..', 'uploads', 'cache');
fsSync.mkdirSync(CACHE_DIR, { recursive: true });

const CACHE_DURATION_HOURS = 24;
const CACHE_DURATION_MS = CACHE_DURATION_HOURS * 60 * 60 * 1000;

/**
 * Move a just-uploaded image from multer's temp location into the
 * persistent cache folder, and record it in MongoDB. Replaces any
 * previously cached image for the same filename (e.g. on re-upload).
 *
 * @param {string} tempPath - where multer wrote the uploaded file
 * @param {string} sourceFilename - the original filename (matches Chunk.sourceFilename)
 * @param {string} mimeType
 */
async function cacheImage(tempPath, sourceFilename, mimeType) {
  const ext = path.extname(sourceFilename) || '.jpg';
  // A short random prefix keeps stored filenames from colliding when two
  // different uploads happen to share the same original filename - the
  // sourceFilename -> storedFilename mapping lives in MongoDB, not in the
  // filename itself, which is what makes this a "proper" structure rather
  // than relying on the original name being unique on disk.
  const storedFilename = `${crypto.randomBytes(8).toString('hex')}${ext}`;
  const destPath = path.join(CACHE_DIR, storedFilename);

  await fs.copyFile(tempPath, destPath);

  const existing = await CachedImage.findOne({ sourceFilename });
  if (existing) {
    // Replacing an old cached copy (e.g. the file was re-uploaded) -
    // delete the old file on disk before overwriting the DB record.
    await deleteFileQuietly(path.join(CACHE_DIR, existing.storedFilename));
  }

  await CachedImage.findOneAndUpdate(
    { sourceFilename },
    { sourceFilename, storedFilename, mimeType, cachedAt: new Date(), starred: existing?.starred || false },
    { upsert: true }
  );
}

/**
 * Look up a cached image by its original filename. Returns null if there
 * isn't one, or if it's expired (and lazily cleans it up right then, as a
 * backstop alongside the periodic sweep in case nothing else ever touches
 * this particular expired entry).
 */
async function getCachedImage(sourceFilename) {
  const record = await CachedImage.findOne({ sourceFilename }).lean();
  if (!record) return null;

  if (!record.starred && isExpired(record.cachedAt)) {
    await deleteCachedImage(sourceFilename);
    return null;
  }

  return record;
}

function isExpired(cachedAt) {
  return Date.now() - new Date(cachedAt).getTime() > CACHE_DURATION_MS;
}

async function deleteFileQuietly(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    // Already gone or never existed - fine, nothing to clean up.
  }
}

/** Remove a cached image's file and DB record, regardless of starred status. */
async function deleteCachedImage(sourceFilename) {
  const record = await CachedImage.findOneAndDelete({ sourceFilename }).lean();
  if (record) {
    await deleteFileQuietly(path.join(CACHE_DIR, record.storedFilename));
  }
}

/** Star or un-star a cached image, exempting/re-including it from expiry. */
async function setStarred(sourceFilename, starred) {
  return CachedImage.findOneAndUpdate({ sourceFilename }, { starred }, { new: true }).lean();
}

/**
 * Delete every expired, non-starred cached image. Meant to be called on a
 * timer (see server.js) so images are cleaned up even if nobody ever visits
 * them again after they expire.
 */
async function sweepExpiredImages() {
  const cutoff = new Date(Date.now() - CACHE_DURATION_MS);
  const expired = await CachedImage.find({ starred: false, cachedAt: { $lt: cutoff } }).lean();

  for (const record of expired) {
    await deleteFileQuietly(path.join(CACHE_DIR, record.storedFilename));
  }

  if (expired.length > 0) {
    await CachedImage.deleteMany({ _id: { $in: expired.map((r) => r._id) } });
    console.log(`[imageCache] Swept ${expired.length} expired cached image(s).`);
  }
}

module.exports = {
  CACHE_DIR,
  CACHE_DURATION_HOURS,
  cacheImage,
  getCachedImage,
  deleteCachedImage,
  setStarred,
  sweepExpiredImages,
};
