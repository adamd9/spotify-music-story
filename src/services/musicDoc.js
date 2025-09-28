const openai = require('./openaiClient');
const { dbg, truncate } = require('../utils/logger');

async function generateMusicDoc({ topic, prompt, catalog }) {
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
            text: { type: 'string' },
            // song item
            title: { type: 'string' },
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

  const systemPrompt = [
    'You are a music documentarian AI. Given a band or music topic, produce a concise documentary-style outline interspersing narration segments and exactly 5 notable songs.',
    'Output REQUIREMENTS:',
    '- Return ONLY a single JSON object. No prose, no markdown, no backticks.',
    '- The JSON MUST strictly conform to the following JSON Schema (names and types must match exactly). Use a single interleaved array named "timeline" whose items are narration or song objects:',
    schemaStr,
    'Additional rules:',
    '- Include a short, human-friendly title string suitable as a playlist title in the `title` field.',
    '- Each song should be suitable to search on Spotify via a helpful spotify_query string such as "Song Title artist:Band Name". Prefer including track_id and track_uri if known or when selecting from a provided catalog.',
    '- Narration should be broken into short, TTS-friendly segments (2-5 sentences each), and reference the songs where relevant.',
    '- If a track catalog is provided by the user (described in the user input), you MUST pick all 5 songs ONLY from that catalog and include the exact track_id and track_uri for those selections.',
    '- Ensure the timeline intersperses narration and songs like a music documentary and contains exactly 5 song items.'
  ].join('\n');

  const extra = prompt && typeof prompt === 'string' && prompt.trim().length > 0
    ? `\n\nAdditional instructions from user (apply carefully):\n${prompt.trim()}`
    : '';
  let catalogNote = '';
  if (Array.isArray(catalog) && catalog.length > 0) {
    const trimmed = catalog.map(t => ({ id: t.id, uri: t.uri, name: t.name, artist: t.artist, album: t.album, release_date: t.release_date, duration_ms: t.duration_ms })).slice(0, 500);
    catalogNote = `\n\nCandidate track catalog (MUST choose ONLY from these if selecting songs):\n${JSON.stringify(trimmed, null, 2)}`;
  }

  const userPrompt = `Topic: ${topic}\n\nGoals:\n- Provide a short, human-friendly playlist title and place it in the 'title' field.\n- Provide a brief summary.\n- Pick exactly 5 songs that represent the topic narrative.\n- Create narration segments that reference songs and can be placed between songs.\n- Build a single interleaved timeline array mixing narration and songs.\n- If a catalog is provided, select songs only from it and include track_id and track_uri.\n\nIMPORTANT: Return ONLY a single raw JSON object that validates against the provided JSON Schema. Do NOT include any extra commentary or formatting.\n${extra}${catalogNote}`;

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
