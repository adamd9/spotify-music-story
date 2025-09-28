const express = require('express');
const router = express.Router();
const config = require('../config');
const { dbg, truncate } = require('../utils/logger');
const { generateMusicDoc } = require('../services/musicDoc');
const { savePlaylist } = require('../services/storage');

router.post('/api/music-doc', async (req, res) => {
  try {
    if (!config.openai.apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const { topic, prompt, catalog, ownerId } = req.body || {};
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Missing required field: topic (string)' });
    }

    dbg('music-doc route: start', { topic, hasCatalog: Array.isArray(catalog) && catalog.length > 0, ownerId: ownerId ? 'yes' : 'no' });
    const data = await generateMusicDoc({ topic, prompt, catalog });
    // Early persistence
    const record = await savePlaylist({
      ownerId: ownerId || 'anonymous',
      title: data.title || (data.topic ? `Music history: ${data.topic}` : 'Music history'),
      topic: data.topic || topic,
      summary: data.summary || '',
      timeline: Array.isArray(data.timeline) ? data.timeline : []
    });
    dbg('music-doc route: saved draft', { id: record.id, title: record.title, ownerId: record.ownerId });
    return res.json({ ok: true, data, playlistId: record.id });
  } catch (err) {
    console.error('music-doc error', err);
    return res.status(500).json({ error: 'Failed to generate music documentary' });
  }
});

module.exports = router;
