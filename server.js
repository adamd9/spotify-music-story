require('dotenv').config();
const express = require('express');
const request = require('request');
const querystring = require('querystring');
const path = require('path');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 8888;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:8888/callback';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Middlewares
app.use(express.json());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Expose selected environment config to the client
// This serves a tiny JS file that defines window.CLIENT_DEBUG
app.get('/config.js', (_req, res) => {
  const clientDebug = process.env.CLIENT_DEBUG || '';
  res.type('application/javascript').send(
    `// Generated from server env\nwindow.CLIENT_DEBUG = ${JSON.stringify(clientDebug)};\n`
  );
});

// Init OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Generate a random string for state
const generateRandomString = (length) => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

// Login endpoint - redirects to Spotify's authorization page
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  const scope = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
  
  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: scope,
      redirect_uri: REDIRECT_URI,
      state: state
    }));
});

// Callback endpoint - handles the response from Spotify
app.get('/callback', (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;

  if (state === null) {
    res.redirect('/#' +
      querystring.stringify({
        error: 'state_mismatch'
      }));
  } else {
    const authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'))
      },
      json: true
    };

    request.post(authOptions, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        const access_token = body.access_token;
        const refresh_token = body.refresh_token;
        
        // Redirect to the player with the access token
        res.redirect('/player.html#' +
          querystring.stringify({
            access_token: access_token,
            refresh_token: refresh_token
          }));
      } else {
        res.redirect('/#' +
          querystring.stringify({
            error: 'invalid_token'
          }));
      }
    });
  }
});

// Get a new access token using refresh token
app.get('/refresh_token', (req, res) => {
  const refresh_token = req.query.refresh_token;
  const authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: { 'Authorization': 'Basic ' + (Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64')) },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  };

  request.post(authOptions, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      const access_token = body.access_token;
      res.send({
        'access_token': access_token
      });
    } else {
      res.status(400).send('Error refreshing token');
    }
  });
});

// Serve the main player page
app.get('/player', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

// Identify an artist by name using Spotify Search (requires user's access token)
app.post('/api/identify-artist', async (req, res) => {
  try {
    const { query, accessToken } = req.body || {};
    if (!query || !accessToken) {
      return res.status(400).json({ error: 'Missing query or accessToken' });
    }
    const url = `https://api.spotify.com/v1/search?type=artist&limit=5&q=${encodeURIComponent(query)}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Spotify search failed', details: txt });
    }
    const data = await r.json();
    const artist = data.artists?.items?.[0] || null;
    return res.json({ ok: true, artist });
  } catch (e) {
    console.error('identify-artist error', e);
    return res.status(500).json({ error: 'Failed to identify artist' });
  }
});

// Fetch an artist's track catalog (combines top tracks + several albums)
app.post('/api/artist-tracks', async (req, res) => {
  try {
    const { artistId, accessToken, market = 'US', maxAlbums = 10 } = req.body || {};
    if (!artistId || !accessToken) {
      return res.status(400).json({ error: 'Missing artistId or accessToken' });
    }

    // 1) Top tracks
    const topResp = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=${market}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const topData = topResp.ok ? await topResp.json() : { tracks: [] };
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

    // 2) Albums (limited)
    const albumsResp = await fetch(`https://api.spotify.com/v1/artists/${artistId}/albums?include_groups=album,single,compilation&market=${market}&limit=${maxAlbums}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const albumsData = albumsResp.ok ? await albumsResp.json() : { items: [] };
    const albums = albumsData.items || [];
    for (const album of albums) {
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
    }

    return res.json({ ok: true, tracks: Array.from(tracksMap.values()) });
  } catch (e) {
    console.error('artist-tracks error', e);
    return res.status(500).json({ error: 'Failed to fetch artist tracks' });
  }
});
// Generate a music documentary structure via OpenAI Responses API
app.post('/api/music-doc', async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured on the server.' });
    }

    const { topic, prompt, catalog } = req.body || {};
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Missing required field: topic (string)' });
    }

    // JSON schema for the response
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        topic: { type: 'string' },
        summary: { type: 'string' },
        tracks: {
          type: 'array',
          minItems: 5,
          maxItems: 5,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              artist: { type: 'string' },
              year: { type: 'string' },
              album: { type: 'string' },
              // A helpful search string to resolve on Spotify
              spotify_query: { type: 'string' },
              // When selecting from provided catalog, include these:
              track_id: { type: 'string' },
              track_uri: { type: 'string' }
            },
            required: ['title', 'artist', 'spotify_query']
          }
        },
        narration_segments: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string' },
              // Optionally reference one or more track indices that this segment discusses
              references: {
                type: 'array',
                items: { type: 'integer', minimum: 0, maximum: 4 }
              }
            },
            required: ['text']
          }
        },
        // Interspersed flow mixing narration and songs, by index
        structure: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['narration', 'song'] },
              narration_index: { type: 'integer', minimum: 0 },
              track_index: { type: 'integer', minimum: 0, maximum: 4 }
            },
            required: ['type']
          }
        }
      },
      required: ['topic', 'summary', 'tracks', 'narration_segments', 'structure']
    };

    const systemPrompt = [
      'You are a music documentarian AI. Given a band or music topic, produce a concise documentary-style outline interspersing narration segments and exactly 5 notable songs.',
      'Return JSON only, conforming to the provided schema. Each song should be suitable to search on Spotify via a helpful spotify_query string such as "Song Title artist:Band Name".',
      'Narration should be broken into short, TTS-friendly segments (2-5 sentences each), and reference the songs where relevant.',
      'If a track catalog is provided by the user, you MUST pick all 5 songs ONLY from that catalog and include the exact track_id and track_uri for those selections.'
    ].join(' ');

    const extra = prompt && typeof prompt === 'string' && prompt.trim().length > 0
      ? `\n\nAdditional instructions from user (apply carefully):\n${prompt.trim()}`
      : '';
    let catalogNote = '';
    if (Array.isArray(catalog) && catalog.length > 0) {
      // Keep only fields the model needs
      const trimmed = catalog.map(t => ({ id: t.id, uri: t.uri, name: t.name, artist: t.artist, album: t.album, release_date: t.release_date, duration_ms: t.duration_ms })).slice(0, 500);
      catalogNote = `\n\nCandidate track catalog (MUST choose ONLY from these if selecting songs):\n${JSON.stringify(trimmed, null, 2)}`;
    }

    const userPrompt = `Topic: ${topic}\n\nGoals:\n- Provide a brief summary.\n- Pick 5 songs that represent the topic narrative.\n- Create narration segments that reference songs and can be placed between songs.\n- Build an interspersed structure mixing narration and songs.\n- If a catalog is provided, select songs only from it and include track_id and track_uri.\n${extra}${catalogNote}`;

    const response = await openai.responses.create({
      model: 'gpt-5-mini',
      reasoning: {
        effort: 'minimal',
      },      
      instructions: systemPrompt,
      input: userPrompt
    });

    // Extract JSON string and parse
    const text = response.output_text || '';
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // Fallback: try to locate a JSON object in the text
      const match = text.match(/\{[\s\S]*\}$/);
      if (match) {
        data = JSON.parse(match[0]);
      } else {
        throw e;
      }
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('music-doc error', err);
    return res.status(500).json({ error: 'Failed to generate music documentary' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
