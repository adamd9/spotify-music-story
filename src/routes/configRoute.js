const express = require('express');
const router = express.Router();
const config = require('../config');

router.get('/config.js', (_req, res) => {
  const clientDebug = config.clientDebug || config.serverDebug;
  res.type('application/javascript').send(
    `// Generated from server env\nwindow.CLIENT_DEBUG = ${JSON.stringify(clientDebug)};\n`
  );
});

module.exports = router;
