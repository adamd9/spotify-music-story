const express = require('express');
const path = require('path');
const fsp = require('fs').promises;
const { ttsToMp3Buffer } = require('../services/tts');
const config = require('../config');
const { dbg } = require('../utils/logger');

const router = express.Router();

router.post('/api/tts-batch', async (req, res) => {
  try {
    const { segments, playlistId, instructions } = req.body || {};
    if (!Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: 'segments must be a non-empty array of { text }' });
    }
    await fsp.mkdir(config.paths.ttsOutputDir, { recursive: true });
    dbg('tts-batch: start', { 
      count: segments.length, 
      model: config.openai.ttsModel, 
      voice: config.openai.ttsVoice, 
      outDir: config.paths.ttsOutputDir, 
      mock: !!config.features?.mockTts, 
      playlistId,
      customInstructions: !!instructions 
    });

    // Mock mode: return a known local MP3 for each segment (no OpenAI call)
    if (config.features && config.features.mockTts) {
      const placeholder = '/audio/voice-of-character-montervillain-expressions-132288.mp3';
      const urls = segments.map(() => placeholder);
      return res.json({ ok: true, urls, mock: true });
    }

    const urls = [];
    const pid = (typeof playlistId === 'string' && playlistId) ? playlistId.replace(/[^a-zA-Z0-9_-]/g, '-') : null;
    
    // Prepare options object for TTS (optional custom instructions)
    const ttsOptions = {};
    if (instructions !== undefined) {
      ttsOptions.instructions = instructions;
    }
    
    let idx = 0;
    for (const seg of segments) {
      const text = (seg && typeof seg.text === 'string') ? seg.text.trim() : '';
      if (!text) {
        urls.push(null);
        idx++;
        continue;
      }
      const base = pid ? `tts_${pid}_${idx}` : `tts_${Date.now()}_${idx}`;
      const fileName = `${base}.mp3`;
      const filePath = path.join(config.paths.ttsOutputDir, fileName);
      const publicUrl = `/tts/${fileName}`;
      try {
        const buf = await ttsToMp3Buffer(text, ttsOptions);
        await fsp.writeFile(filePath, buf);
        urls.push(publicUrl);
        dbg('tts-batch: wrote file', { i: idx, url: publicUrl });
      } catch (err) {
        console.error('tts-batch error', err);
        urls.push(null);
      }
      idx++;
    }

    return res.json({ ok: true, urls });
  } catch (e) {
    console.error('tts-batch error', e);
    return res.status(500).json({ error: 'Failed to generate TTS' });
  }
});

module.exports = router;
