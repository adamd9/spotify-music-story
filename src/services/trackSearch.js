const { dbg, truncate } = require('../utils/logger');

/**
 * Search for specific tracks by name and artist
 * Returns tracks with match confidence
 */
async function searchSpecificTracks(requiredTracks, artistName, accessToken, market = 'US') {
  const results = [];

  for (const req of requiredTracks) {
    const query = `track:"${req.song_title}" artist:"${artistName}"`;
    const url = `https://api.spotify.com/v1/search?type=track&limit=5&q=${encodeURIComponent(query)}&market=${market}`;
    
    dbg('trackSearch: searching', { 
      song: req.song_title, 
      year: req.approximate_year,
      query 
    });

    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!resp.ok) {
        dbg('trackSearch: failed', { song: req.song_title, status: resp.status });
        results.push({ 
          requested: req, 
          found: null, 
          confidence: 0 
        });
        continue;
      }

      const data = await resp.json();
      const tracks = data.tracks?.items || [];

      if (tracks.length === 0) {
        dbg('trackSearch: no results', { song: req.song_title });
        results.push({ 
          requested: req, 
          found: null, 
          confidence: 0 
        });
        continue;
      }

      // Take the top match
      const match = tracks[0];
      const matchData = {
        id: match.id,
        uri: match.uri,
        name: match.name,
        artist: (match.artists || []).map(a => a.name).join(', '),
        album: match.album?.name || '',
        release_date: match.album?.release_date || '',
        duration_ms: match.duration_ms || 0
      };

      dbg('trackSearch: found', { 
        requested: req.song_title, 
        matched: match.name,
        album: match.album?.name,
        year: match.album?.release_date?.substring(0, 4)
      });

      results.push({
        requested: req,
        found: matchData,
        confidence: 1.0 // Could implement fuzzy matching score here
      });

    } catch (err) {
      console.error('trackSearch: error', err);
      results.push({ 
        requested: req, 
        found: null, 
        confidence: 0 
      });
    }
  }

  return results;
}

module.exports = { searchSpecificTracks };
