// ---------------------------------------------------------------------------
// similarity.js
//
// This file is the heart of "manual vector search". Instead of using
// MongoDB's built-in $vectorSearch (which only works on MongoDB Atlas, a
// cloud service), we do the math ourselves, in plain JavaScript, using
// embeddings we already stored as normal number arrays in local MongoDB.
//
// THE CORE IDEA - COSINE SIMILARITY:
// An embedding is a list of numbers (a "vector") that represents the meaning
// of a piece of text. Texts with similar meaning end up with vectors that
// point in similar directions in this high-dimensional space. Cosine
// similarity measures the angle between two vectors, which tells us how
// "similar in direction" (and therefore how similar in meaning) they are -
// regardless of how long the vectors are.
//
//   cosine similarity = (A . B) / (|A| * |B|)
//
// where "A . B" is the dot product and "|A|", "|B|" are the vector magnitudes
// (lengths). The result is always between -1 and 1:
//   1  -> the vectors point in exactly the same direction (very similar meaning)
//   0  -> the vectors are unrelated (perpendicular)
//  -1  -> the vectors point in opposite directions (opposite meaning)
// ---------------------------------------------------------------------------

const Chunk = require('../models/Chunk');

/**
 * Compute the cosine similarity between two equal-length numeric vectors.
 * This is a small, pure function on purpose - it has no dependency on
 * MongoDB or any API, so you can test it by hand with simple arrays.
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} similarity score between -1 and 1
 */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) {
    throw new Error('cosineSimilarity expects two arrays of numbers');
  }
  if (vecA.length !== vecB.length) {
    throw new Error(
      `Vectors must be the same length to compare (got ${vecA.length} and ${vecB.length})`
    );
  }

  let dotProduct = 0; // sum of element-wise products: how much the vectors "agree"
  let magnitudeA = 0; // sum of squares of A's components (before sqrt): A's length
  let magnitudeB = 0; // same, for B

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  // Avoid dividing by zero if either vector is all zeros (shouldn't normally
  // happen with real embeddings, but better safe than crashing).
  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

// How many of the best-scoring chunks to hand to the LLM as context.
const DEFAULT_TOP_N = 5;

// Chunks whose best similarity score falls below this are considered "not
// actually relevant" - this is what stops us from ever handing the LLM a
// pile of unrelated text and getting a hallucinated answer back. This number
// is an empirical value, calibrated against real gemini-embedding-001
// output: genuinely answerable questions about a chunk's content tended to
// score ~0.55-0.75 against it, while a vague, content-free question like
// "what is this note?" scored ~0.49. Cosine scores from real embedding
// models don't map cleanly onto an intuitive 0-1 "relevance" scale, so this
// may still need tuning for your own documents - see the README's
// troubleshooting section.
const MIN_SIMILARITY_THRESHOLD = 0.5;

/**
 * Find the top N stored chunks most relevant to a question's embedding.
 *
 * This is the "manual vector search": we pull every chunk's embedding out of
 * MongoDB, score each one against the question with cosineSimilarity, and
 * sort. It's a simple O(n) scan - fine for hundreds or thousands of chunks
 * on one machine, but it re-reads and re-scores every chunk on every
 * question, so it would not scale to a huge, shared, many-user document
 * store (see README "limits of manual similarity search").
 *
 * @param {number[]} questionEmbedding
 * @param {number} topN
 * @returns {Promise<Array<{sourceFilename, sourceType, chunkText, chunkIndex, score}>>}
 */
async function findTopMatches(questionEmbedding, topN = DEFAULT_TOP_N) {
  // Pull only the fields we need. .lean() returns plain JS objects instead of
  // full Mongoose documents, which is faster since we're just reading.
  const allChunks = await Chunk.find(
    {},
    { sourceFilename: 1, sourceType: 1, chunkText: 1, chunkIndex: 1, embedding: 1 }
  ).lean();

  if (allChunks.length === 0) {
    return [];
  }

  const scored = allChunks.map((chunk) => ({
    sourceFilename: chunk.sourceFilename,
    sourceType: chunk.sourceType,
    chunkText: chunk.chunkText,
    chunkIndex: chunk.chunkIndex,
    score: cosineSimilarity(questionEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  const topMatches = scored
    .slice(0, topN)
    .filter((match) => match.score >= MIN_SIMILARITY_THRESHOLD);

  return topMatches;
}

module.exports = {
  cosineSimilarity,
  findTopMatches,
  MIN_SIMILARITY_THRESHOLD,
  DEFAULT_TOP_N,
};
