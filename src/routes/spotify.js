const express = require('express');
const config = require('../config');
const { dbg, safeToken, truncate } = require('../utils/logger');

const router = express.Router();

// Identify an artist by name using Spotify Search (requires user's access token)
router.post('/api/identify-artist', async (req, res) => {
  try {
    const { query, accessToken } = req.body || {};
    if (!query || !accessToken) {
      return res.status(400).json({ error: 'Missing query or accessToken' });
    }
    const url = `https://api.spotify.com/v1/search?type=artist&limit=5&q=${encodeURIComponent(query)}`;
    dbg('identify-artist: request', { url, accessToken: safeToken(accessToken) });
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    dbg('identify-artist: response status', r.status);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      dbg('identify-artist: error body', truncate(txt));
      return res.status(r.status).json({ error: 'Spotify search failed', details: txt });
    }
    const data = await r.json();
    dbg('identify-artist: top result', {
      count: data?.artists?.items?.length || 0,
      first: data?.artists?.items?.[0]?.name || null,
      id: data?.artists?.items?.[0]?.id || null
    });
    const artist = data.artists?.items?.[0] || null;
    return res.json({ ok: true, artist });
  } catch (e) {
    console.error('identify-artist error', e);
    return res.status(500).json({ error: 'Failed to identify artist' });
  }
});

// Fetch an artist's track catalog (combines top tracks + several albums)
router.post('/api/artist-tracks', async (req, res) => {
  try {
    const { artistId, accessToken, market = 'US', desiredCount = 100 } = req.body || {};
    if (!artistId || !accessToken) {
      return res.status(400).json({ error: 'Missing artistId or accessToken' });
    }
    dbg('artist-tracks: start', { artistId, market, desiredCount, accessToken: safeToken(accessToken) });

    // 1) Top tracks
    const topResp = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=${market}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const topData = topResp.ok ? await topResp.json() : { tracks: [] };
    dbg('artist-tracks: top-tracks', { ok: topResp.ok, count: (topData.tracks || []).length });
    const tracksMap = new Map();
    const pushTrack = (t) => {
      if (!t || !t.id) return;
      if (tracksMap.has(t.id)) return;
      tracksMap.set(t.id, {
        id: t.id,
        uri: t.uri,
        name: t.name,
        artist: (t.artists || []).map(a => a.name).join(', '),
        album: t.album?.name || '',
        release_date: t.album?.release_date || '',
        duration_ms: t.duration_ms || 0
      });
    };
    (topData.tracks || []).forEach(pushTrack);

    // 2) Albums + singles + compilations (paginate up to ~100 unique tracks total)
    let offset = 0;
    const pageLimit = 50; // Spotify max per page for albums
    while (tracksMap.size < desiredCount) {
      const albumsResp = await fetch(`https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single,compilation&market=${market}&limit=${pageLimit}&offset=${offset}` , {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!albumsResp.ok) break;
      const albumsData = await albumsResp.json();
      const albums = albumsData.items || [];
      if (albums.length === 0) break;
      dbg('artist-tracks: albums page', { offset, pageCount: albums.length });

      for (const album of albums) {
        if (tracksMap.size >= desiredCount) break;
        const albumTracksResp = await fetch(`https://api.spotify.com/v1/albums/${album.id}/tracks?market=${market}&limit=50`, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        if (!albumTracksResp.ok) continue;
        const albumTracks = await albumTracksResp.json();
        (albumTracks.items || []).forEach((t) => pushTrack({
          id: t.id,
          uri: t.uri,
          name: t.name,
          artists: t.artists,
          album: { name: album.name, release_date: album.release_date },
          duration_ms: t.duration_ms
        }));
        dbg('artist-tracks: album tracks added', { album: album.name, added: (albumTracks.items || []).length, totalUnique: tracksMap.size });
        if (tracksMap.size >= desiredCount) break;
      }

      // Next page
      offset += pageLimit;
      if (offset > 200) break; // up to 200 albums fetched
    }

    const tracks = Array.from(tracksMap.values()).slice(0, desiredCount);
    dbg('artist-tracks: done', { total: tracks.length });
    return res.json({ ok: true, tracks });
  } catch (e) {
    console.error('artist-tracks error', e);
    return res.status(500).json({ error: 'Failed to fetch artist tracks' });
  }
});

module.exports = router;
