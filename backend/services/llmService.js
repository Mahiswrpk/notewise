// ---------------------------------------------------------------------------
// llmService.js
//
// This is the "generation" half of RAG (Retrieval-Augmented Generation).
// Once we've retrieved the most relevant chunks for a question (see
// services/similarity.js), we hand those chunks to a chat LLM and ask it to
// answer the question using ONLY that context. We use Groq's free API,
// which is compatible with the same request/response shape as OpenAI's
// chat completions endpoint, running OpenAI's open-weight gpt-oss-20b model
// (Groq's free-tier lineup shifts over time - Meta's originally-targeted
// llama-3.1-8b-instant was retired at some point during this project; the
// model name is kept as a single named constant below for exactly that
// reason). This is a "reasoning" model, so its raw response includes a
// separate internal reasoning trace alongside the actual answer - we only
// ever read message.content (the final answer), never message.reasoning.
//
// WHY A STRICT SYSTEM PROMPT MATTERS:
// LLMs are very good at confidently making things up ("hallucinating") when
// they don't actually know an answer. To keep NoteWise trustworthy, we
// explicitly instruct the model to work only from the provided context and
// to say it doesn't know rather than guess. Combined with the "don't even
// call the LLM if nothing relevant was retrieved" logic in routes/chat.js,
// this is our main defense against hallucinated answers.
//
// GROUNDED "GENERATIVE" REQUESTS:
// A first version of this prompt only allowed direct factual Q&A ("what does
// the note say about X"), which meant study-tool requests like "quiz me on
// this" or "give me a similar question" got refused with "I don't know" -
// technically correct (the literal answer isn't "in the context"), but not
// actually useful. The prompt below explicitly carves out room for that:
// the model MAY generate something new (a question, a summary, a
// restatement), but every fact/number/concept it uses in doing so must still
// come from the retrieved context - it still can't invent new facts or pull
// in outside knowledge. This is a deliberate, slightly looser trade-off than
// pure fact-retrieval, made because a notes app benefits from being able to
// quiz you on your own material, not just answer lookup questions about it.
// ---------------------------------------------------------------------------

const GROQ_MODEL = 'openai/gpt-oss-20b';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const SYSTEM_PROMPT = `You are a helpful study assistant that works ONLY from the context provided below, which was retrieved from the user's own uploaded documents. Never use outside knowledge, even if you happen to know the topic from elsewhere.

Two kinds of requests are allowed:
1. Factual questions ("what does this say about X") - answer using only facts, numbers, and statements that appear in the context.
2. Requests to generate something derived from the context ("quiz me on this", "give me a similar practice question", "summarize this", "explain this differently") - you may generate new text, but every fact, number, or concept it relies on must come from the context. Do not invent details that aren't supported by it.

If the context doesn't contain enough information to answer the question OR to fulfill the request, respond exactly with: "I don't know based on the uploaded documents."

Keep responses concise.`;

/**
 * Build the user-facing prompt message: the retrieved context chunks
 * (each labeled with which file it came from) followed by the question.
 */
function buildUserMessage(question, contextChunks) {
  const contextBlock = contextChunks
    .map(
      (chunk, i) =>
        `[Source ${i + 1}: ${chunk.sourceFilename}]\n${chunk.chunkText}`
    )
    .join('\n\n---\n\n');

  return `Context:\n${contextBlock}\n\nQuestion: ${question}`;
}

/**
 * Ask Groq's chat model to answer a question, grounded in the given context
 * chunks.
 *
 * @param {string} question
 * @param {Array<{sourceFilename: string, chunkText: string}>} contextChunks
 * @returns {Promise<string>} the model's answer text
 */
async function generateAnswer(question, contextChunks) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not set - check your .env file');
  }

  const requestBody = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(question, contextChunks) },
    ],
    temperature: 0.2, // low temperature = more focused/deterministic, less "creative"
    // gpt-oss-20b is a "reasoning" model - its internal reasoning trace
    // (message.reasoning) is generated using this same token budget before
    // the visible answer (message.content), so this needs more headroom
    // than a non-reasoning model would for the same answer length. Raise
    // further if you see answers cut off mid-sentence for complex questions.
    max_tokens: 2048,
  };

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Failed to generate answer via Groq (status ${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const answer = data?.choices?.[0]?.message?.content;

  if (typeof answer !== 'string') {
    throw new Error('Groq response did not contain the expected "choices[0].message.content" field');
  }

  return answer.trim();
}

module.exports = {
  generateAnswer,
  GROQ_MODEL,
};
