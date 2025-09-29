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
  // Always load initial from public bundle
  const publicPath = path.join(config.paths.publicDir, 'playlists', `${id}.json`);
  const buf = await fsp.readFile(publicPath, 'utf8');
  const playlist = JSON.parse(buf);
  return { id, playlist };
}

module.exports = { getInitialPlaylistId, getInitialPlaylist };
