const express = require('express');
const router = express.Router();
const config = require('../config');
const { dbg, truncate } = require('../utils/logger');
const { generateMusicDoc } = require('../services/musicDoc');

router.post('/api/music-doc', async (req, res) => {
  try {
    if (!config.openai.apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const { topic, prompt, catalog } = req.body || {};
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Missing required field: topic (string)' });
    }

    const data = await generateMusicDoc({ topic, prompt, catalog });
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('music-doc error', err);
    return res.status(500).json({ error: 'Failed to generate music documentary' });
  }
});

module.exports = router;
