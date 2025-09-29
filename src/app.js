const express = require('express');
const path = require('path');
const config = require('./config');
const { dbg } = require('./utils/logger');

// Routes
const configRoute = require('./routes/configRoute');
const authRoutes = require('./routes/auth');
const spotifyRoutes = require('./routes/spotify');
const ttsRoutes = require('./routes/tts');
const musicDocRoutes = require('./routes/musicDoc');
const jobsRoutes = require('./routes/jobs');
const playlistsRoutes = require('./routes/playlists');

const app = express();

// Core middleware
app.use(express.json());

// Static files
app.use(express.static(config.paths.publicDir));
// Serve TTS output directory at /tts even if stored outside publicDir
app.use('/tts', express.static(config.paths.ttsOutputDir));

// Mount routes
app.use(configRoute);
app.use(authRoutes);
app.use(spotifyRoutes);
app.use(ttsRoutes);
app.use(musicDocRoutes);
app.use(jobsRoutes);
app.use(playlistsRoutes);

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

module.exports = app;
