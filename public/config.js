// Basic client-side config placeholder. You can extend this to expose server-provided config.
// Currently, DEBUG can be toggled via URL ?debug=1 already in player.js.
// This file exists to avoid 404s when index.html loads /config.js
window.APP_CONFIG = {
  version: '0.1.0',
  loadedAt: new Date().toISOString()
};
