const express = require('express');
const router = express.Router();
const config = require('../config');
const { dbg, truncate } = require('../utils/logger');
const { planMusicDocumentary } = require('../services/musicPlan');
const { searchSpecificTracks } = require('../services/trackSearch');
const { generateMusicDoc } = require('../services/musicDoc');
const { savePlaylist } = require('../services/storage');
const jobManager = require('../services/jobManager');

/**
 * Multi-stage music documentary generation with job management
 * Returns immediately with jobId, client subscribes to SSE for progress
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

    if (!ownerId || typeof ownerId !== 'string') {
      return res.status(400).json({ error: 'Missing required field: ownerId (string) - needed for job management' });
    }

    // Create job
    let job;
    try {
      job = jobManager.createJob(ownerId, {
        topic,
        prompt,
        accessToken,
        narrationTargetSecs,
        market,
      });
    } catch (err) {
      return res.status(429).json({ error: err.message });
    }

    // Return job ID immediately
    res.json({ ok: true, jobId: job.id });

    // Start async processing
    processDocumentaryJob(job).catch(err => {
      console.error('Job processing error:', err);
      jobManager.failJob(job.id, err);
    });

  } catch (err) {
    console.error('music-doc error', err);
    return res.status(500).json({ error: 'Failed to create documentary job', details: err.message });
  }
});

/**
 * Async job processing function
 */
async function processDocumentaryJob(job) {
  const { topic, prompt, accessToken, narrationTargetSecs, market } = job.params;
  const baseUrl = `http://localhost:${config.port}`; // Internal requests

  try {
    job.status = 'running';
    jobManager.updateProgress(job.id, {
      stage: 1,
      stageLabel: 'Identifying artist',
      progress: 10,
      detail: `Searching for "${topic}"`,
    });

    // STAGE 1: Identify artist
    const identifyResp = await fetch(`${baseUrl}/api/identify-artist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: topic, accessToken })
    });
    
    if (!identifyResp.ok) {
      throw new Error('Failed to identify artist');
    }
    
    const identifyData = await identifyResp.json();
    const artist = identifyData.artist;
    
    if (!artist || !artist.id) {
      throw new Error('Artist not found');
    }

    jobManager.updateProgress(job.id, {
      stage: 1,
      stageLabel: 'Artist identified',
      progress: 15,
      detail: `Found: ${artist.name}`,
    });

    // Get top tracks for context
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

    jobManager.updateProgress(job.id, {
      stage: 1,
      stageLabel: 'Top tracks fetched',
      progress: 20,
      detail: `${topTracks.length} popular tracks loaded`,
    });

    // STAGE 2: Plan documentary
    jobManager.updateProgress(job.id, {
      stage: 2,
      stageLabel: 'Planning documentary',
      progress: 25,
      detail: 'AI is creating narrative outline...',
    });

    const plan = await planMusicDocumentary(artist.name, topTracks, prompt);
    
    jobManager.updateProgress(job.id, {
      stage: 2,
      stageLabel: 'Documentary planned',
      progress: 35,
      detail: `"${plan.title}" - ${plan.required_tracks?.length || 0} tracks selected`,
    });

    // STAGE 3: Search for required tracks
    jobManager.updateProgress(job.id, {
      stage: 3,
      stageLabel: 'Searching for tracks',
      progress: 40,
      detail: 'Finding specific tracks on Spotify...',
    });

    const requiredTracks = plan.required_tracks || [];
    const searchResults = await searchSpecificTracks(requiredTracks, artist.name, accessToken, market);
    
    const foundTracks = searchResults.filter(r => r.found).map(r => r.found);
    const missingTracks = searchResults.filter(r => !r.found).map(r => r.requested);
    
    jobManager.updateProgress(job.id, {
      stage: 3,
      stageLabel: 'Track search complete',
      progress: 50,
      detail: `Found ${foundTracks.length}/5 tracks`,
    });

    // STAGE 4: Fetch backup catalog if needed
    let backupTracks = [];
    if (foundTracks.length < 5) {
      jobManager.updateProgress(job.id, {
        stage: 4,
        stageLabel: 'Fetching backup catalog',
        progress: 55,
        detail: `${5 - foundTracks.length} tracks missing, loading alternatives...`,
      });

      const catalogResp = await fetch(`${baseUrl}/api/artist-tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          artistId: artist.id, 
          accessToken, 
          market,
          desiredCount: 50
        })
      });
      
      if (catalogResp.ok) {
        const catalogData = await catalogResp.json();
        backupTracks = catalogData.tracks || [];
      }

      jobManager.updateProgress(job.id, {
        stage: 4,
        stageLabel: 'Backup catalog loaded',
        progress: 60,
        detail: `${backupTracks.length} additional tracks available`,
      });
    }

    // Combine tracks
    const allTracks = [...foundTracks];
    const trackIds = new Set(foundTracks.map(t => t.id));
    for (const t of backupTracks) {
      if (!trackIds.has(t.id)) {
        allTracks.push(t);
        trackIds.add(t.id);
      }
    }

    // STAGE 5: Generate final documentary
    jobManager.updateProgress(job.id, {
      stage: 5,
      stageLabel: 'Generating documentary',
      progress: 65,
      detail: 'AI is creating final timeline...',
    });

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

    jobManager.updateProgress(job.id, {
      stage: 5,
      stageLabel: 'Timeline generated',
      progress: 75,
      detail: `${data.timeline?.length || 0} segments created`,
    });

    // Enrich timeline with duration_ms
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

    // STAGE 6: Save playlist
    jobManager.updateProgress(job.id, {
      stage: 6,
      stageLabel: 'Saving playlist',
      progress: 85,
      detail: 'Persisting documentary...',
    });

    const record = await savePlaylist({
      ownerId: job.userId,
      title: data.title || plan.title || `Music history: ${artist.name}`,
      topic: data.topic || artist.name,
      summary: data.summary || plan.narrative_arc || '',
      timeline: enrichedTimeline
    });
    
    jobManager.updateProgress(job.id, {
      stage: 6,
      stageLabel: 'Playlist saved',
      progress: 80,
      detail: `Saved as "${record.title}"`,
    });

    // STAGE 7: Generate TTS narration
    const narrationSegments = enrichedTimeline.filter(item => item && item.type === 'narration' && item.text);
    const narrationCount = narrationSegments.length;
    
    if (narrationCount > 0) {
      jobManager.updateProgress(job.id, {
        stage: 7,
        stageLabel: 'Generating narration',
        progress: 85,
        detail: `Preparing ${narrationCount} narration tracks...`,
      });

      // Generate TTS for each narration segment
      const ttsSegments = narrationSegments.map(seg => ({ text: seg.text }));
      
      try {
        // Call TTS batch endpoint with jobId for progress updates
        const ttsResp = await fetch(`${baseUrl}/api/tts-batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            segments: ttsSegments, 
            playlistId: record.id,
            jobId: job.id
          })
        });

        if (ttsResp.ok) {
          const ttsData = await ttsResp.json();
          const urls = ttsData.urls || [];
          
          // Attach TTS URLs to timeline
          let urlIndex = 0;
          enrichedTimeline = enrichedTimeline.map(item => {
            if (item && item.type === 'narration' && item.text) {
              const url = urls[urlIndex];
              urlIndex++;
              return { ...item, url };
            }
            return item;
          });

          // Update playlist with TTS URLs
          await savePlaylist({
            ownerId: job.userId,
            title: data.title || plan.title || `Music history: ${artist.name}`,
            topic: data.topic || artist.name,
            summary: data.summary || plan.narrative_arc || '',
            timeline: enrichedTimeline
          });

          jobManager.updateProgress(job.id, {
            stage: 7,
            stageLabel: 'Narration complete',
            progress: 95,
            detail: `Generated ${narrationCount} narration tracks`,
          });
        } else {
          jobManager.updateProgress(job.id, {
            stage: 7,
            stageLabel: 'Narration skipped',
            progress: 95,
            detail: 'TTS generation failed, continuing...',
          });
        }
      } catch (ttsErr) {
        console.error('TTS generation error:', ttsErr);
        jobManager.updateProgress(job.id, {
          stage: 7,
          stageLabel: 'Narration skipped',
          progress: 95,
          detail: 'TTS generation failed, continuing...',
        });
      }
    }

    // Complete job
    jobManager.completeJob(job.id, {
      data: { ...data, timeline: enrichedTimeline },
      playlistId: record.id,
      plan,
      trackSearchResults: {
        found: foundTracks.length,
        missing: missingTracks.length,
        backup: backupTracks.length
      }
    });

  } catch (err) {
    console.error('processDocumentaryJob error:', err);
    jobManager.failJob(job.id, err);
  }
}

module.exports = router;
