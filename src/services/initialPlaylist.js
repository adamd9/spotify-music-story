const { getPlaylist } = require('./storage');
const fsp = require('fs').promises;
const path = require('path');
const config = require('../config');

// For now this is hard-coded. In the future we can randomize or select by policy
const DEFAULT_PLAYLIST_ID = '0vz2mkarftsamg4aqnov';

async function getInitialPlaylistId() {
  return DEFAULT_PLAYLIST_ID;
}

async function getInitialPlaylist() {
  const id = await getInitialPlaylistId();
  // Prefer public resource so it's available in production builds
  const publicPath = path.join(config.paths.publicDir, 'playlists', `${id}.json`);
  try {
    const buf = await fsp.readFile(publicPath, 'utf8');
    const playlist = JSON.parse(buf);
    return { id, playlist };
  } catch (_) {
    // Fallback to storage (e.g., local data directory)
    const playlist = await getPlaylist(id);
    return { id, playlist };
  }
}

module.exports = { getInitialPlaylistId, getInitialPlaylist };
