const path = require('path');
const fsp = require('fs').promises;
const { dbg } = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const PLAYLISTS_DIR = path.join(DATA_DIR, 'playlists');

async function ensureDirs() {
  await fsp.mkdir(PLAYLISTS_DIR, { recursive: true });
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

async function savePlaylist({ ownerId, title, topic, summary, timeline }) {
  await ensureDirs();
  const id = genId();
  const createdAt = new Date().toISOString();
  const record = { id, ownerId, title, topic, summary, timeline, createdAt };
  const filePath = path.join(PLAYLISTS_DIR, `${id}.json`);
  await fsp.writeFile(filePath, JSON.stringify(record, null, 2));
  dbg('storage: saved playlist', { id, ownerId });
  return record;
}

async function getPlaylist(id) {
  await ensureDirs();
  const filePath = path.join(PLAYLISTS_DIR, `${id}.json`);
  const data = await fsp.readFile(filePath, 'utf-8');
  return JSON.parse(data);
}

async function listPlaylistsByOwner(ownerId) {
  await ensureDirs();
  const files = await fsp.readdir(PLAYLISTS_DIR);
  const results = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const content = await fsp.readFile(path.join(PLAYLISTS_DIR, f), 'utf-8');
      const rec = JSON.parse(content);
      if (rec.ownerId === ownerId) {
        results.push(rec);
      }
    } catch {}
  }
  // Sort by createdAt desc
  results.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return results;
}

async function updatePlaylist(id, partial) {
  await ensureDirs();
  const filePath = path.join(PLAYLISTS_DIR, `${id}.json`);
  const data = await fsp.readFile(filePath, 'utf-8').catch(() => null);
  if (!data) return null;
  const current = JSON.parse(data);
  const merged = { ...current, ...partial, updatedAt: new Date().toISOString() };
  await fsp.writeFile(filePath, JSON.stringify(merged, null, 2));
  dbg('storage: updated playlist', { id });
  return merged;
}

module.exports = { savePlaylist, getPlaylist, listPlaylistsByOwner, updatePlaylist };
