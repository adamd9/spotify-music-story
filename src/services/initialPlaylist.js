const { getPlaylist } = require('./storage');

// For now this is hard-coded. In the future we can randomize or select by policy
const DEFAULT_PLAYLIST_ID = '0vz2mkarftsamg4aqnov';

async function getInitialPlaylistId() {
  return DEFAULT_PLAYLIST_ID;
}

async function getInitialPlaylist() {
  const id = await getInitialPlaylistId();
  const playlist = await getPlaylist(id);
  return { id, playlist };
}

module.exports = { getInitialPlaylistId, getInitialPlaylist };
