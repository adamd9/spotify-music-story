const { getPlaylist } = require('./storage');
const config = require('../config');

async function getInitialPlaylistId() {
  return (config.initialPlaylistId || '').trim();
}

async function getInitialPlaylist() {
  const id = await getInitialPlaylistId();
  if (!id) return { id: null, playlist: null };
  const playlist = await getPlaylist(id).catch(() => null);
  return { id, playlist };
}

module.exports = { getInitialPlaylistId, getInitialPlaylist };
