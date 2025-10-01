const express = require('express');
const querystring = require('querystring');
const path = require('path');
const request = require('request');
const config = require('../config');
const { dbg } = require('../utils/logger');

const router = express.Router();

// Generate a random string for state
function generateRandomString(length) {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Login endpoint - redirects to Spotify's authorization page
router.get('/login', (req, res) => {
  const state = generateRandomString(16);
  const scope = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
  
  // Get redirect URI from query param (provided by frontend) or construct from request
  const redirectUri = req.query.redirect_uri || `${req.protocol}://${req.get('host')}/callback`;

  res.redirect('https://accounts.spotify.com/authorize?' +
    querystring.stringify({
      response_type: 'code',
      client_id: config.spotify.clientId,
      scope: scope,
      redirect_uri: redirectUri,
      state: state
    }));
});

// Callback endpoint - handles the response from Spotify
router.get('/callback', (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  
  // Get redirect URI from query param (provided by frontend) or construct from request
  const redirectUri = req.query.redirect_uri || `${req.protocol}://${req.get('host')}/callback`;

  if (state === null) {
    res.redirect('/#' + querystring.stringify({ error: 'state_mismatch' }));
  } else {
    const authOptions = {
      url: 'https://accounts.spotify.com/api/token',
      form: {
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      },
      headers: {
        'Authorization': 'Basic ' + (Buffer.from(config.spotify.clientId + ':' + config.spotify.clientSecret).toString('base64'))
      },
      json: true
    };

    request.post(authOptions, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        const access_token = body.access_token;
        const refresh_token = body.refresh_token;
        dbg('auth callback ok');
        res.redirect('/player.html#' +
          querystring.stringify({ access_token, refresh_token }));
      } else {
        dbg('auth callback failed', { status: response?.statusCode });
        res.redirect('/#' + querystring.stringify({ error: 'invalid_token' }));
      }
    });
  }
});

// Get a new access token using refresh token
router.get('/refresh_token', (req, res) => {
  const refresh_token = req.query.refresh_token;
  const authOptions = {
    url: 'https://accounts.spotify.com/api/token',
    headers: { 'Authorization': 'Basic ' + (Buffer.from(config.spotify.clientId + ':' + config.spotify.clientSecret).toString('base64')) },
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh_token
    },
    json: true
  };

  request.post(authOptions, (error, response, body) => {
    if (!error && response.statusCode === 200) {
      const access_token = body.access_token;
      res.send({ access_token });
    } else {
      res.status(400).send('Error refreshing token');
    }
  });
});

// Serve the main player page shortcut
router.get('/player', (req, res) => {
  res.sendFile(path.join(config.paths.publicDir, 'player.html'));
});

module.exports = router;
