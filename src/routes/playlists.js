const express = require('express');
const router = express.Router();
const { savePlaylist, getPlaylist, listPlaylistsByOwner, updatePlaylist } = require('../services/storage');
const { getInitialPlaylist } = require('../services/initialPlaylist');
const { dbg, truncate } = require('../utils/logger');

// Create/save a generated playlist record
// body: { ownerId: string, title: string, topic: string, summary: string, timeline: array }
router.post('/api/playlists', async (req, res) => {
  try {
    const { ownerId, title, topic, summary, timeline } = req.body || {};
    if (!ownerId || !title || !Array.isArray(timeline)) {
      return res.status(400).json({ error: 'ownerId, title and timeline are required' });
    }
    dbg('playlists:create', { ownerId, title, tcount: timeline.length });
    const rec = await savePlaylist({ ownerId, title, topic, summary, timeline });
    return res.json({ ok: true, playlist: rec });
  } catch (e) {
    console.error('save playlist error', e);
    return res.status(500).json({ error: 'Failed to save playlist' });
  }
});

// Fetch a playlist by id
router.get('/api/playlists/:id', async (req, res) => {
  try {
    dbg('playlists:get', { id: req.params.id });
    const rec = await getPlaylist(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, playlist: rec });
  } catch (e) {
    console.error('get playlist error', e);
    return res.status(404).json({ error: 'Not found' });
  }
});

// List playlists for a specific owner
router.get('/api/users/:ownerId/playlists', async (req, res) => {
  try {
    dbg('playlists:list', { ownerId: req.params.ownerId });
    const list = await listPlaylistsByOwner(req.params.ownerId);
    return res.json({ ok: true, playlists: list });
  } catch (e) {
    console.error('list playlists error', e);
    return res.status(500).json({ error: 'Failed to list playlists' });
  }
});

// Update/finalize a playlist (e.g., attach TTS URLs after client generation)
// body: { title?, topic?, summary?, timeline? }
router.patch('/api/playlists/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const partial = req.body || {};
    dbg('playlists:update', { id, keys: Object.keys(partial || {}) });
    const rec = await updatePlaylist(id, partial);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    return res.json({ ok: true, playlist: rec });
  } catch (e) {
    console.error('update playlist error', e);
    return res.status(500).json({ error: 'Failed to update playlist' });
  }
});

// Return initial playlist to load by default on the client
router.get('/api/initial-playlist', async (_req, res) => {
  try {
    const { id, playlist } = await getInitialPlaylist();
    if (!playlist) return res.status(404).json({ error: 'Initial playlist not found', id });
    return res.json({ ok: true, id, playlist });
  } catch (e) {
    console.error('initial playlist error', e);
    return res.status(500).json({ error: 'Failed to fetch initial playlist' });
  }
});

module.exports = router;
