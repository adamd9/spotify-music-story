require('dotenv').config();
const express = require('express');
const request = require('request');
const querystring = require('querystring');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8888;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:8888/callback';

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

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

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
