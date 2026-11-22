// ---------------------------------------------------------------------------
// chunking.js
//
// WHY WE CHUNK AT ALL:
// Embedding models and LLMs work best on smallish pieces of text. If we
// embedded an entire 20-page PDF as one vector, that vector would be a vague
// "average" of everything in the document, and retrieval would be useless
// (every question would vaguely match the whole document instead of the one
// paragraph that actually answers it). So instead we split documents into
// small overlapping "chunks" of roughly 300-500 words, embed each one
// separately, and let similarity search find the *specific* chunk that
// answers a given question.
//
// WHY OVERLAP:
// If we chunked with hard, non-overlapping cuts, a sentence that happens to
// sit right on a chunk boundary could get split in half, with its meaning
// spread across two chunks that individually don't make much sense. A small
// overlap (the last ~50 words of one chunk become the first ~50 words of the
// next) makes it much more likely that any given sentence appears intact in
// at least one chunk.
// ---------------------------------------------------------------------------

// Target chunk size and overlap, in words. 400 sits in the middle of the
// requested 300-500 word range. 50 words of overlap (~12% of a chunk) is a
// common, reasonable default for RAG pipelines - enough to avoid losing
// context at boundaries without duplicating too much text (and therefore
// too many embedding calls).
const CHUNK_SIZE_WORDS = 400;
const CHUNK_OVERLAP_WORDS = 50;

// If the last chunk produced by the sliding window would be tiny (e.g. just
// a few leftover words), it's not worth its own embedding call - we merge it
// into the previous chunk instead.
const MIN_TRAILING_CHUNK_WORDS = 40;

/**
 * Split a block of text into overlapping, word-count-based chunks.
 *
 * @param {string} text - The full text to split (already extracted or transcribed).
 * @returns {string[]} - An array of chunk strings, in reading order.
 */
function splitIntoChunks(text) {
  // Collapse all whitespace (newlines, tabs, repeated spaces) down to single
  // spaces so word-counting is consistent, then split into individual words.
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (words.length === 0) {
    return [];
  }

  // If the whole document is already shorter than one chunk, just return it
  // as a single chunk - no need to slide a window over it.
  if (words.length <= CHUNK_SIZE_WORDS) {
    return [words.join(' ')];
  }

  const chunks = [];
  let start = 0;
  const step = CHUNK_SIZE_WORDS - CHUNK_OVERLAP_WORDS; // how far the window advances each time

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE_WORDS, words.length);
    chunks.push(words.slice(start, end).join(' '));

    // We've reached the end of the text - stop.
    if (end === words.length) {
      break;
    }

    start += step;
  }

  // If the final chunk ended up very small, merge it into the previous chunk
  // rather than shipping a near-empty chunk that would waste an embedding call.
  if (chunks.length > 1) {
    const lastChunkWordCount = chunks[chunks.length - 1].split(' ').length;
    if (lastChunkWordCount < MIN_TRAILING_CHUNK_WORDS) {
      const removed = chunks.pop();
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${removed}`;
    }
  }

  return chunks;
}

module.exports = {
  splitIntoChunks,
  CHUNK_SIZE_WORDS,
  CHUNK_OVERLAP_WORDS,
};
