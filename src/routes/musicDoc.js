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

    const { topic, prompt, catalog, ownerId, narrationTargetSecs } = req.body || {};
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Missing required field: topic (string)' });
    }

    dbg('music-doc route: start', { topic, hasCatalog: Array.isArray(catalog) && catalog.length > 0, ownerId: ownerId ? 'yes' : 'no', narrationTargetSecs });
    const data = await generateMusicDoc({ topic, prompt, catalog, narrationTargetSecs });

    // Optionally enrich the generated timeline with duration_ms from provided catalog
    let enrichedTimeline = Array.isArray(data.timeline) ? [...data.timeline] : [];
    try {
      if (Array.isArray(catalog) && catalog.length > 0 && enrichedTimeline.length > 0) {
        // Build fast lookup maps
        const byId = new Map();
        const byUri = new Map();
        const byKey = new Map(); // title|artist key
        for (const t of catalog) {
          if (!t) continue;
          if (t.id) byId.set(String(t.id), t);
          if (t.uri) byUri.set(String(t.uri), t);
          const key = (t.name ? t.name.trim().toLowerCase() : '') + '|' + (t.artist ? t.artist.trim().toLowerCase() : '');
          if (key.trim() !== '|') byKey.set(key, t);
        }
        enrichedTimeline = enrichedTimeline.map(item => {
          if (!item || item.type !== 'song') return item;
          let match = null;
          if (item.track_id && byId.has(String(item.track_id))) match = byId.get(String(item.track_id));
          if (!match && item.track_uri && byUri.has(String(item.track_uri))) match = byUri.get(String(item.track_uri));
          if (!match) {
            const key = (item.title ? item.title.trim().toLowerCase() : '') + '|' + (item.artist ? item.artist.trim().toLowerCase() : '');
            if (byKey.has(key)) match = byKey.get(key);
          }
          if (match && Number.isFinite(match.duration_ms) && match.duration_ms > 0) {
            return { ...item, duration_ms: match.duration_ms, duration: match.duration_ms / 1000 };
          }
          return item;
        });
      }
    } catch {}

    // Early persistence (store durations if present)
    const record = await savePlaylist({
      ownerId: ownerId || 'anonymous',
      title: data.title || (data.topic ? `Music history: ${data.topic}` : 'Music history'),
      topic: data.topic || topic,
      summary: data.summary || '',
      timeline: enrichedTimeline
    });
    dbg('music-doc route: saved draft', { id: record.id, title: record.title, ownerId: record.ownerId });
    return res.json({ ok: true, data, playlistId: record.id });
  } catch (err) {
    console.error('music-doc error', err);
    return res.status(500).json({ error: 'Failed to generate music documentary' });
  }
});

module.exports = router;
