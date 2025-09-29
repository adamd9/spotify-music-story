const express = require('express');
const config = require('../config');
const { dbg, safeToken, truncate } = require('../utils/logger');
const { normalizeArtistQuery } = require('../services/identifyLLM');

const router = express.Router();

// Identify an artist by name using Spotify Search (requires user's access token)
router.post('/api/identify-artist', async (req, res) => {
  try {
    const { query, accessToken } = req.body || {};
    if (!query || !accessToken) {
      return res.status(400).json({ error: 'Missing query or accessToken' });
    }
    // Mandatory LLM normalization step
    const norm = await normalizeArtistQuery(query);
    const normalized = (norm && norm.normalized) ? norm.normalized : query;
    const hint = (norm && norm.notes) ? norm.notes : '';
    // Search only by normalized name (don't include hint/notes - too restrictive)
    // Get top 5 results to validate and find best match
    const url = `https://api.spotify.com/v1/search?type=artist&limit=5&q=${encodeURIComponent(normalized)}`;
    dbg('identify-artist: request', { original: query, normalized, hint, url, accessToken: safeToken(accessToken) });
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    dbg('identify-artist: response status', r.status);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      dbg('identify-artist: error body', truncate(txt));
      return res.status(r.status).json({ error: 'Spotify search failed', details: txt });
    }
    const data = await r.json();
    const results = data.artists?.items || [];
    dbg('identify-artist: results', {
      count: results.length,
      results: results.slice(0, 3).map(a => ({ name: a.name, id: a.id }))
    });
    
    // Validate: find best match by comparing normalized name to results
    // Use case-insensitive fuzzy matching to handle variations
    const normalizedLower = normalized.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;
    
    for (const artist of results) {
      const artistNameLower = (artist.name || '').toLowerCase().trim();
      
      // Exact match (best)
      if (artistNameLower === normalizedLower) {
        bestMatch = artist;
        bestScore = 1.0;
        break;
      }
      
      // Contains match (good)
      if (artistNameLower.includes(normalizedLower) || normalizedLower.includes(artistNameLower)) {
        const score = 0.8;
        if (score > bestScore) {
          bestMatch = artist;
          bestScore = score;
        }
      }
    }
    
    if (!bestMatch || bestScore < 0.8) {
      dbg('identify-artist: no good match found', { 
        searched: normalized, 
        topResult: results[0]?.name,
        bestScore 
      });
      return res.status(404).json({ 
        error: 'Artist not found or ambiguous match',
        searched: normalized,
        suggestions: results.slice(0, 3).map(a => a.name)
      });
    }
    
    dbg('identify-artist: matched', { 
      searched: normalized, 
      matched: bestMatch.name, 
      score: bestScore 
    });
    return res.json({ ok: true, artist: bestMatch });
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

    // 2) Fetch ALL albums first (paginate through album list)
    const allAlbums = [];
    let offset = 0;
    const pageLimit = 50; // Spotify max per page for albums
    const maxAlbumPages = 4; // Fetch up to 200 albums (4 pages × 50)
    
    while (offset < pageLimit * maxAlbumPages) {
      const albumsResp = await fetch(`https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single,compilation&market=${market}&limit=${pageLimit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!albumsResp.ok) break;
      const albumsData = await albumsResp.json();
      const albums = albumsData.items || [];
      if (albums.length === 0) break;
      allAlbums.push(...albums);
      dbg('artist-tracks: albums page', { offset, pageCount: albums.length, totalAlbums: allAlbums.length });
      offset += pageLimit;
      if (albums.length < pageLimit) break; // No more pages
    }

    // 3) Fetch tracks from albums, distributing across the catalog for better coverage
    // Process albums in order, but limit tracks per album to ensure we sample broadly
    const tracksPerAlbum = Math.max(3, Math.ceil(desiredCount / Math.max(allAlbums.length, 1)));
    dbg('artist-tracks: strategy', { totalAlbums: allAlbums.length, tracksPerAlbum, target: desiredCount });
    
    for (const album of allAlbums) {
      if (tracksMap.size >= desiredCount) break;
      
      const albumTracksResp = await fetch(`https://api.spotify.com/v1/albums/${album.id}/tracks?market=${market}&limit=50`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!albumTracksResp.ok) continue;
      const albumTracks = await albumTracksResp.json();
      
      // Add tracks from this album (up to tracksPerAlbum, to ensure broad coverage)
      let addedFromAlbum = 0;
      for (const t of (albumTracks.items || [])) {
        if (tracksMap.size >= desiredCount) break;
        if (addedFromAlbum >= tracksPerAlbum) break;
        
        const trackData = {
          id: t.id,
          uri: t.uri,
          name: t.name,
          artists: t.artists,
          album: { name: album.name, release_date: album.release_date },
          duration_ms: t.duration_ms
        };
        
        if (!tracksMap.has(t.id)) {
          pushTrack(trackData);
          addedFromAlbum++;
        }
      }
      
      dbg('artist-tracks: album tracks added', { 
        album: album.name, 
        year: album.release_date?.substring(0, 4) || 'unknown',
        added: addedFromAlbum, 
        totalUnique: tracksMap.size 
      });
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
