const openai = require('./openaiClient');
const { dbg, truncate } = require('../utils/logger');
const { loadTemplate, fillTemplate } = require('../utils/promptLoader');

async function generateMusicDoc({ topic, prompt, catalog, narrationTargetSecs }) {
  // Single interleaved timeline schema
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      topic: { type: 'string' },
      summary: { type: 'string' },
      timeline: {
        type: 'array',
        minItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: ['narration', 'song'] },
            // narration item
            title: { type: 'string' },  // Title for both narration and song
            text: { type: 'string' },   // Narration text
            // song item
            artist: { type: 'string' },
            album: { type: 'string' },
            year: { type: 'string' },
            spotify_query: { type: 'string' },
            track_id: { type: 'string' },
            track_uri: { type: 'string' }
          },
          required: ['type']
        }
      }
    },
    required: ['title', 'topic', 'summary', 'timeline']
  };
  const schemaStr = JSON.stringify(schema, null, 2);
  // Load externalized templates
  const systemTpl = loadTemplate('prompts/musicDoc/system.txt');
  const userTpl = loadTemplate('prompts/musicDoc/user.txt');
  const systemPrompt = fillTemplate(systemTpl, { SCHEMA: schemaStr });

  const extra = prompt && typeof prompt === 'string' && prompt.trim().length > 0
    ? `\n\nAdditional instructions from user (apply carefully):\n${prompt.trim()}`
    : '';
  let catalogNote = '';
  if (Array.isArray(catalog) && catalog.length > 0) {
    const trimmed = catalog.map(t => ({ id: t.id, uri: t.uri, name: t.name, artist: t.artist, album: t.album, release_date: t.release_date, duration_ms: t.duration_ms })).slice(0, 500);
    catalogNote = `\n\nCandidate track catalog (MUST choose ONLY from these if selecting songs):\n${JSON.stringify(trimmed, null, 2)}`;
  }

  const targetSecs = Number.isFinite(narrationTargetSecs) && narrationTargetSecs > 0 ? Math.floor(narrationTargetSecs) : 30;
  const userPrompt = fillTemplate(userTpl, {
    TOPIC: topic,
    EXTRA: (extra || '').trim(),
    CATALOG_NOTE: (catalogNote || '').trim(),
    NARRATION_TARGET_SECS: String(targetSecs)
  });

  dbg('music-doc: request', {
    model: 'gpt-5-mini',
    instructionsPreview: truncate(systemPrompt, 400),
    inputPreview: truncate(userPrompt, 400),
    catalogCount: Array.isArray(catalog) ? catalog.length : 0
  });

  const response = await openai.responses.create({
    model: 'gpt-5-mini',
    reasoning: { effort: 'minimal' },
    instructions: systemPrompt,
    input: userPrompt
  });
  const text = response.output_text || '';
  dbg('music-doc: response output_text', truncate(text, 800));
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}$/);
    if (match) {
      data = JSON.parse(match[0]);
    } else {
      throw e;
    }
  }
  return data;
}

module.exports = { generateMusicDoc };
