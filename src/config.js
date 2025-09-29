require('dotenv').config();
const path = require('path');

// Helper to sanitize and absolutize env paths (strip quotes/leading '=' and ensure absolute)
function normalizePathEnv(val, fallback) {
  if (!val) return fallback;
  const cleaned = String(val).trim().replace(/^['"]|['"]$/g, '').replace(/^=+/, '');
  return path.isAbsolute(cleaned) ? cleaned : path.resolve(cleaned);
}

// Compute runtime data directory (for Docker or local)
const dataDir = normalizePathEnv(process.env.RUNTIME_DATA_DIR, path.join(__dirname, '..', 'data'));

// Compute TTS output directory (defaults to a subfolder of dataDir)
const ttsDir = normalizePathEnv(process.env.TTS_OUTPUT_DIR, path.join(dataDir, 'tts'));

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8888', 10),
  clientDebug: process.env.CLIENT_DEBUG === '1' || process.env.DEBUG === '1',
  serverDebug: process.env.SERVER_DEBUG === '1' || process.env.DEBUG === '1',
  initialPlaylistId: (process.env.INITIAL_PLAYLIST_ID || '').trim(),
  spotify: {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.REDIRECT_URI || 'http://localhost:8888/callback',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    ttsModel: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    ttsVoice: process.env.OPENAI_TTS_VOICE || 'alloy',
    ttsSpeed: parseFloat(process.env.OPENAI_TTS_SPEED || '1.0'),
  },
  features: {
    mockTts: process.env.MOCK_TTS === '1',
  },
  paths: {
    publicDir: path.join(__dirname, '..', 'public'),
    dataDir,
    ttsOutputDir: ttsDir
  }
};

module.exports = config;
