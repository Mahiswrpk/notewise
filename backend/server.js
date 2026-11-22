const fs = require('fs');
const path = require('path');

// The .env file lives at the project root (one level up from backend/), not
// inside backend/, so it can be shared/found regardless of which folder you
// run `node server.js` from.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const documentsRouter = require('./routes/documents');
const chatRouter = require('./routes/chat');
const { sweepExpiredImages } = require('./services/imageCache');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chat-with-notes';

// Make sure the local temp-upload folder exists before multer needs it.
fs.mkdirSync(path.join(__dirname, 'uploads', 'temp'), { recursive: true });

const app = express();

// Allow the Vite dev server (and, per the README, your phone on the same
// Wi-Fi network) to call this API. This is a local learning project, so a
// permissive dev CORS policy is fine - lock this down before ever deploying
// anywhere public.
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/documents', documentsRouter);
app.use('/api/chat', chatRouter);

// Central error handler - every route's catch block calls next(err) and
// ends up here, so failures always come back as clean JSON instead of
// crashing the server or leaking a stack trace to the client.
app.use((err, req, res, next) => {
  console.error(err);
  // Multer errors (e.g. file too large) don't set err.status themselves -
  // treat them as client errors (bad request) rather than server errors.
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log(`Connected to MongoDB at ${MONGODB_URI}`);
  } catch (err) {
    console.error(
      '\nCould not connect to MongoDB.\n' +
        `Tried: ${MONGODB_URI}\n` +
        'Is MongoDB Community Server installed and running locally? ' +
        '(See the README for setup instructions - on Windows this usually means ' +
        'starting the "MongoDB" service, or running `mongod` yourself.)\n'
    );
    process.exit(1);
  }

  // "0.0.0.0" (rather than the default localhost-only bind) lets other
  // devices on the same Wi-Fi network - like your phone - reach this server
  // using your machine's local IP address. See the README's "Access
  // NoteWise from your phone" section.
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NoteWise backend listening on http://localhost:${PORT}`);
  });

  // Clean up expired cached images (see services/imageCache.js) once on
  // boot - in case the server was down past an image's expiry time - and
  // then every 30 minutes after that. Non-starred images older than
  // CACHE_DURATION_HOURS get deleted; getCachedImage() also lazily cleans
  // up on access, so this is a backstop for images nobody ever revisits.
  sweepExpiredImages().catch((err) => console.error('[imageCache] Initial sweep failed:', err));
  setInterval(() => {
    sweepExpiredImages().catch((err) => console.error('[imageCache] Sweep failed:', err));
  }, 30 * 60 * 1000);
}

start();
