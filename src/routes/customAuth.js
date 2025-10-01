const express = require('express');
const router = express.Router();
const querystring = require('querystring');
const config = require('../config');

/**
 * Custom OAuth flow for users with their own Spotify credentials
 * Credentials are passed via query params (client-side managed)
 */

// Login with custom credentials
router.get('/login-custom', (req, res) => {
  const { client_id, redirect_uri } = req.query;
  
  if (!client_id) {
    return res.status(400).send('Missing client_id');
  }
  
  // Get redirect URI from query param (provided by frontend) or construct from request
  const redirectUri = redirect_uri || `${req.protocol}://${req.get('host')}/callback`;

  const scope = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
  const state = Math.random().toString(36).substring(7);

  // Encode redirect URI in state so we can retrieve it in callback
  const stateData = JSON.stringify({ state, redirectUri, custom: true });
  const encodedState = Buffer.from(stateData).toString('base64');

  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id,
      scope,
      redirect_uri: redirectUri,
      state: encodedState
    }));
});

// Exchange code for token (client-side will call this with credentials)
router.post('/api/exchange-code', async (req, res) => {
  const { code, client_id, client_secret, redirect_uri } = req.body;

  if (!code || !client_id || !client_secret || !redirect_uri) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const authOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      body: new URLSearchParams({
        code,
        redirect_uri,
        grant_type: 'authorization_code'
      })
    };

    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error('Token exchange failed:', errorData);
      return res.status(response.status).json({ error: 'Failed to exchange code for token' });
    }

    const data = await response.json();
    res.json({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in
    });
  } catch (error) {
    console.error('Code exchange error:', error);
    res.status(500).json({ error: 'Failed to exchange code' });
  }
});

// Refresh token with custom credentials
router.get('/refresh_token-custom', async (req, res) => {
  const refresh_token = req.query.refresh_token;
  const { client_id, client_secret } = req.query;

  if (!refresh_token || !client_id || !client_secret) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    const authOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(client_id + ':' + client_secret).toString('base64')
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token
      })
    };

    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    
    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    const data = await response.json();
    res.json({ access_token: data.access_token });
  } catch (error) {
    console.error('Custom refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

module.exports = router;
