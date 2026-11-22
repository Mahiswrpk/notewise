const express = require('express');
const Chunk = require('../models/Chunk');
const { embedText } = require('../services/embeddingService');
const { findTopMatches } = require('../services/similarity');
const { generateAnswer } = require('../services/llmService');

const router = express.Router();

const NO_DOCS_MESSAGE = 'No documents have been uploaded yet. Upload something to get started!';
const NO_MATCH_MESSAGE = "I don't know based on the uploaded documents.";

// Plain small talk ("hi", "thanks", "bye"...) never semantically matches any
// stored chunk, so without this check it would fall through to the same
// "I don't know" refusal as a genuinely unanswerable question - correct in
// principle, but a strange experience for a simple greeting. Matched as a
// WHOLE-message check (not "contains"), so a real question that happens to
// include one of these words (e.g. "explain the chi-square test") is never
// misdetected as small talk.
const SMALL_TALK_PATTERN =
  /^(hi+|hello+|hey+|yo|sup|howdy|greetings|hola|good\s?(morning|afternoon|evening|night)|thanks?( you)?|thx|ty|ok(ay)?|cool|nice|bye|goodbye|see ya)[!.? ]*$/i;
const SMALL_TALK_REPLY =
  "Hi! I'm NoteWise - ask me a question about your uploaded notes and I'll answer using what's in them.";

// POST /api/chat - ask a question, get an answer grounded in uploaded docs
router.post('/', async (req, res, next) => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Request body must include a non-empty "question" string.' });
    }

    if (SMALL_TALK_PATTERN.test(question.trim())) {
      return res.json({ answer: SMALL_TALK_REPLY, sources: [] });
    }

    // Step 1: turn the question into an embedding vector, same as we did for
    // every chunk at upload time - this lets us compare "meaning to meaning".
    const questionEmbedding = await embedText(question);

    // Step 2: manual cosine-similarity search across every stored chunk (see
    // services/similarity.js for the actual math and the relevance cutoff).
    const topMatches = await findTopMatches(questionEmbedding);

    // Step 3: if nothing relevant was found, don't call the LLM at all -
    // there's nothing grounded to answer from, and calling it anyway risks
    // a hallucinated answer.
    if (topMatches.length === 0) {
      const hasAnyChunks = await Chunk.exists({});
      return res.json({
        answer: hasAnyChunks ? NO_MATCH_MESSAGE : NO_DOCS_MESSAGE,
        sources: [],
      });
    }

    console.log(
      `[chat] Retrieved ${topMatches.length} relevant chunk(s), calling Groq for an answer...`
    );

    // Step 4: hand the retrieved chunks to Groq's LLM as grounding context.
    const answer = await generateAnswer(question, topMatches);

    const sources = topMatches.map((m) => ({
      filename: m.sourceFilename,
      sourceType: m.sourceType,
      chunkIndex: m.chunkIndex,
      score: Number(m.score.toFixed(4)),
    }));

    res.json({ answer, sources });
  } catch (err) {
    err.status = err.status || 502;
    next(err);
  }
});

module.exports = router;
