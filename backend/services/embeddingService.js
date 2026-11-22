// ---------------------------------------------------------------------------
// embeddingService.js
//
// WHAT IS AN "EMBEDDING"?
// An embedding is what you get when you ask a special AI model to turn a
// piece of text into a list of numbers (a vector) that captures its meaning.
// Texts with similar meaning end up with numerically similar vectors, even
// if they don't share many of the same words. That's what lets us do
// "semantic search" later: compare the *meaning* of a question to the
// *meaning* of each stored chunk, not just keyword-match them.
//
// We use Google Gemini's "gemini-embedding-001" model (free tier) to produce
// these vectors. Each vector this model returns has 3072 numbers in it.
// (The older "text-embedding-004" model this project originally targeted has
// since been retired by Google - this is a good example of why the model
// name is kept as a single named constant here, so it's a one-line change
// if Google renames/retires the free embedding model again.)
//
// PRIVACY NOTE: only the small chunk of text (a few hundred words) is sent to
// Gemini here - never the whole document, never the database. See the README
// for a fuller privacy note about Gemini's free tier.
// ---------------------------------------------------------------------------

const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Gemini's free tier has a fairly low "requests per minute" limit. We embed
// chunks one at a time (never in parallel) and add a tiny pause between
// calls so a large upload doesn't blow through that limit and start failing.
const DELAY_BETWEEN_CALLS_MS = 150;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Turn a single piece of text into an embedding vector using Gemini.
 *
 * @param {string} text
 * @returns {Promise<number[]>} the embedding vector (768 numbers)
 */
async function embedText(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set - check your .env file');
  }

  const url = `${GEMINI_API_BASE}/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${apiKey}`;

  const requestBody = {
    model: `models/${GEMINI_EMBEDDING_MODEL}`,
    content: { parts: [{ text }] },
  };

  const doRequest = async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    return response;
  };

  let response = await doRequest();

  // Gemini's free tier can return 429 (rate limited) if you call it too
  // quickly. We retry once after a short pause before giving up.
  if (response.status === 429) {
    await sleep(1000);
    response = await doRequest();
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `Failed to embed text via Gemini (status ${response.status}): ${errorText}`
    );
  }

  const data = await response.json();
  const values = data?.embedding?.values;

  if (!Array.isArray(values)) {
    throw new Error('Gemini embedding response did not contain the expected "embedding.values" array');
  }

  return values;
}

/**
 * Embed an array of text chunks, one at a time, with a small delay between
 * each call. We deliberately do this sequentially (not with Promise.all)
 * to stay within the free-tier rate limit and to make it easy to catch and
 * skip an individual chunk that fails without losing the whole batch.
 *
 * @param {string[]} texts
 * @returns {Promise<{ embeddings: (number[]|null)[], errors: (string|null)[] }>}
 *   embeddings[i] is null and errors[i] is set if that chunk failed to embed.
 */
async function embedBatch(texts) {
  const embeddings = [];
  const errors = [];

  for (let i = 0; i < texts.length; i++) {
    try {
      const vector = await embedText(texts[i]);
      embeddings.push(vector);
      errors.push(null);
    } catch (err) {
      embeddings.push(null);
      errors.push(err.message);
    }

    if (i < texts.length - 1) {
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  return { embeddings, errors };
}

module.exports = {
  embedText,
  embedBatch,
  GEMINI_EMBEDDING_MODEL,
};
