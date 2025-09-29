const openai = require('./openaiClient');
const { loadTemplate, fillTemplate } = require('../utils/promptLoader');
const { dbg, truncate } = require('../utils/logger');

async function normalizeArtistQuery(query) {
  const q = (query || '').toString().trim();
  if (!q) return { normalized: '', confidence: 0, notes: '' };

  const systemTpl = loadTemplate('prompts/identify/system.txt');
  const userTpl = loadTemplate('prompts/identify/user.txt');
  const systemPrompt = systemTpl; // no placeholders beyond static content
  const userPrompt = fillTemplate(userTpl, { QUERY: q });

  dbg('identifyLLM: request', {
    model: 'gpt-5-mini',
    systemPreview: truncate(systemPrompt, 300),
    userPreview: truncate(userPrompt, 300)
  });

  const resp = await openai.responses.create({
    model: 'gpt-5-mini',
    reasoning: { effort: 'minimal' },
    instructions: systemPrompt,
    input: userPrompt
  });
  const text = resp.output_text || '';
  dbg('identifyLLM: response output_text', truncate(text, 600));

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}$/);
    if (match) data = JSON.parse(match[0]);
    else throw e;
  }

  const normalized = (data && typeof data.normalized === 'string') ? data.normalized.trim() : '';
  const confidence = (data && typeof data.confidence === 'number') ? Math.max(0, Math.min(1, data.confidence)) : 0;
  const notes = (data && typeof data.notes === 'string') ? data.notes.trim() : '';
  return { normalized, confidence, notes };
}

module.exports = { normalizeArtistQuery };
