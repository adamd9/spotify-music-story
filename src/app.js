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

const app = express();

// Core middleware
app.use(express.json());

// Static files
app.use(express.static(config.paths.publicDir));

// Mount routes
app.use(configRoute);
app.use(authRoutes);
app.use(spotifyRoutes);
app.use(ttsRoutes);
app.use(musicDocRoutes);

// Health
app.get('/healthz', (_req, res) => res.json({ ok: true }));

module.exports = app;
