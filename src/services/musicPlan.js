const openai = require('./openaiClient');
const { loadTemplate, fillTemplate } = require('../utils/promptLoader');
const { dbg, truncate } = require('../utils/logger');

async function planMusicDocumentary(topic, topTracks = [], extraInstructions = '') {
  const systemTpl = loadTemplate('prompts/musicPlan/system.txt');
  const userTpl = loadTemplate('prompts/musicPlan/user.txt');

  // Format top tracks for context
  const topTracksStr = topTracks.length > 0
    ? topTracks.slice(0, 20).map((t, i) => 
        `${i + 1}. "${t.name}" (${t.album || 'unknown album'}, ${t.release_date?.substring(0, 4) || 'unknown year'})`
      ).join('\n')
    : 'No top tracks provided';

  const extra = extraInstructions && extraInstructions.trim().length > 0
    ? `\nAdditional instructions:\n${extraInstructions.trim()}`
    : '';

  const systemPrompt = systemTpl;
  const userPrompt = fillTemplate(userTpl, { 
    TOPIC: topic,
    TOP_TRACKS: topTracksStr,
    EXTRA: extra
  });

  dbg('musicPlan: request', {
    model: 'gpt-5-mini',
    topic,
    topTracksCount: topTracks.length,
    systemPreview: truncate(systemPrompt, 300),
    userPreview: truncate(userPrompt, 400)
  });

  const resp = await openai.responses.create({
    model: 'gpt-5-mini',
    reasoning: { effort: 'medium' },
    instructions: systemPrompt,
    input: userPrompt
  });

  const text = resp.output_text || '';
  dbg('musicPlan: response output_text', truncate(text, 800));

  let plan;
  try {
    plan = JSON.parse(text);
  } catch (e) {
    // Fallback: try to locate a JSON object in the text
    const match = text.match(/\{[\s\S]*\}$/);
    if (match) {
      plan = JSON.parse(match[0]);
    } else {
      throw e;
    }
  }

  return plan;
}

module.exports = { planMusicDocumentary };
