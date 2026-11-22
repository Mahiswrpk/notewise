const mongoose = require('mongoose');

// Tracks an uploaded image that's being kept around temporarily (see
// services/imageCache.js) so a student can look at the original photo
// side-by-side with its transcription while studying. One row per
// uploaded image file - NOT one per chunk, since a single image can
// produce several chunks but only ever has one cached file.
const cachedImageSchema = new mongoose.Schema({
  // The original uploaded filename, e.g. "biology-notes.jpg" - matches
  // Chunk.sourceFilename for the same upload, so the two can be joined.
  sourceFilename: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },

  // The actual filename this image is stored under inside
  // backend/uploads/cache/ (not the same as sourceFilename, to avoid
  // collisions between different uploads that happen to share a name).
  storedFilename: {
    type: String,
    required: true,
  },

  mimeType: {
    type: String,
    required: true,
  },

  cachedAt: {
    type: Date,
    default: Date.now,
  },

  // Starred images are exempt from the 24-hour auto-expiry sweep - the
  // student keeps them until they explicitly un-star or delete the
  // document. Everything else is temporary by default.
  starred: {
    type: Boolean,
    default: false,
  },
});

module.exports = mongoose.model('CachedImage', cachedImageSchema);
