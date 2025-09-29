const express = require('express');
const router = express.Router();
const config = require('../config');
const { dbg, truncate } = require('../utils/logger');
const { planMusicDocumentary } = require('../services/musicPlan');
const { searchSpecificTracks } = require('../services/trackSearch');
const { generateMusicDoc } = require('../services/musicDoc');
const { savePlaylist } = require('../services/storage');

/**
 * Multi-stage music documentary generation:
 * 1. Plan: LLM creates documentary outline with specific track requirements
 * 2. Search: Find those specific tracks on Spotify + fetch broader catalog
 * 3. Generate: LLM creates final timeline with actual available tracks
 */
router.post('/api/music-doc', async (req, res) => {
  try {
    if (!config.openai.apiKey) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const { topic, prompt, accessToken, ownerId, narrationTargetSecs, market = 'US' } = req.body || {};
    
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Missing required field: topic (string)' });
    }
    
    if (!accessToken || typeof accessToken !== 'string') {
      return res.status(400).json({ error: 'Missing required field: accessToken (string) - needed for Spotify track search' });
    }

    dbg('music-doc-v2: start', { topic, ownerId: ownerId ? 'yes' : 'no', narrationTargetSecs });

    // STAGE 1: Get artist info and top tracks for context
    dbg('music-doc-v2: stage 1 - identify artist');
    const identifyResp = await fetch(`${req.protocol}://${req.get('host')}/api/identify-artist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: topic, accessToken })
    });
    
    if (!identifyResp.ok) {
      return res.status(identifyResp.status).json({ error: 'Failed to identify artist' });
    }
    
    const identifyData = await identifyResp.json();
    const artist = identifyData.artist;
    
    if (!artist || !artist.id) {
      return res.status(404).json({ error: 'Artist not found' });
    }

    dbg('music-doc-v2: identified artist', { name: artist.name, id: artist.id });

    // Get top tracks for planning context
    const topTracksUrl = `https://api.spotify.com/v1/artists/${artist.id}/top-tracks?market=${market}`;
    const topTracksResp = await fetch(topTracksUrl, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const topTracksData = topTracksResp.ok ? await topTracksResp.json() : { tracks: [] };
    const topTracks = (topTracksData.tracks || []).map(t => ({
      id: t.id,
      name: t.name,
      album: t.album?.name,
      release_date: t.album?.release_date,
      duration_ms: t.duration_ms
    }));

    dbg('music-doc-v2: got top tracks', { count: topTracks.length });

    // STAGE 2: Plan the documentary (LLM decides which tracks are essential)
    dbg('music-doc-v2: stage 2 - plan documentary');
    const plan = await planMusicDocumentary(artist.name, topTracks, prompt);
    
    dbg('music-doc-v2: plan created', { 
      title: plan.title,
      era: plan.era_covered,
      requiredTracks: plan.required_tracks?.length || 0
    });

    // STAGE 3: Search for the specific tracks the LLM requested
    dbg('music-doc-v2: stage 3 - search for required tracks');
    const requiredTracks = plan.required_tracks || [];
    const searchResults = await searchSpecificTracks(requiredTracks, artist.name, accessToken, market);
    
    const foundTracks = searchResults.filter(r => r.found).map(r => r.found);
    const missingTracks = searchResults.filter(r => !r.found).map(r => r.requested);
    
    dbg('music-doc-v2: track search complete', { 
      found: foundTracks.length, 
      missing: missingTracks.length 
    });

    if (missingTracks.length > 0) {
      dbg('music-doc-v2: missing tracks', { 
        tracks: missingTracks.map(t => `${t.song_title} (${t.approximate_year})`) 
      });
    }

    // STAGE 4: Fetch broader catalog as backup options (if we're missing tracks)
    let backupTracks = [];
    if (foundTracks.length < 5) {
      dbg('music-doc-v2: stage 4 - fetching backup tracks');
      const catalogResp = await fetch(`${req.protocol}://${req.get('host')}/api/artist-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          artistId: artist.id, 
          accessToken, 
          market,
          desiredCount: 50 // Smaller backup set
        })
      });
      
      if (catalogResp.ok) {
        const catalogData = await catalogResp.json();
        backupTracks = catalogData.tracks || [];
        dbg('music-doc-v2: backup catalog fetched', { count: backupTracks.length });
      }
    }

    // Combine found tracks + backup tracks, removing duplicates
    const allTracks = [...foundTracks];
    const trackIds = new Set(foundTracks.map(t => t.id));
    for (const t of backupTracks) {
      if (!trackIds.has(t.id)) {
        allTracks.push(t);
        trackIds.add(t.id);
      }
    }

    dbg('music-doc-v2: combined catalog', { total: allTracks.length });

    // STAGE 5: Generate final documentary with actual tracks
    dbg('music-doc-v2: stage 5 - generate final documentary');
    
    // Build enhanced prompt that includes the plan
    const enhancedPrompt = `
DOCUMENTARY PLAN (use this as your guide):
Title: ${plan.title}
Narrative Arc: ${plan.narrative_arc}
Era Covered: ${plan.era_covered}

REQUIRED TRACKS (prioritize these in your selection):
${requiredTracks.map((t, i) => `${i + 1}. "${t.song_title}" (${t.approximate_year}) - ${t.why_essential}`).join('\n')}

${prompt ? `\nADDITIONAL INSTRUCTIONS:\n${prompt}` : ''}

IMPORTANT: Follow the plan above. Use the required tracks if they are available in the catalog. The narrative arc and track selection rationale have already been determined.
`.trim();

    const data = await generateMusicDoc({ 
      topic: artist.name, 
      prompt: enhancedPrompt, 
      catalog: allTracks, 
      narrationTargetSecs 
    });

    // Enrich timeline with duration_ms from catalog
    let enrichedTimeline = Array.isArray(data.timeline) ? [...data.timeline] : [];
    try {
      if (allTracks.length > 0 && enrichedTimeline.length > 0) {
        const byId = new Map();
        const byUri = new Map();
        const byKey = new Map();
        for (const t of allTracks) {
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

    // Save the playlist
    const record = await savePlaylist({
      ownerId: ownerId || 'anonymous',
      title: data.title || plan.title || `Music history: ${artist.name}`,
      topic: data.topic || artist.name,
      summary: data.summary || plan.narrative_arc || '',
      timeline: enrichedTimeline
    });
    
    dbg('music-doc-v2: saved', { id: record.id, title: record.title });
    
    return res.json({ 
      ok: true, 
      data, 
      playlistId: record.id,
      plan, // Include the plan in response for debugging
      trackSearchResults: {
        found: foundTracks.length,
        missing: missingTracks.length,
        backup: backupTracks.length
      }
    });
    
  } catch (err) {
    console.error('music-doc-v2 error', err);
    return res.status(500).json({ error: 'Failed to generate music documentary', details: err.message });
  }
});

module.exports = router;
