const openai = require('./openaiClient');
const config = require('../config');

async function ttsToMp3Buffer(text) {
  const speech = await openai.audio.speech.create({
    model: config.openai.ttsModel,
    voice: config.openai.ttsVoice,
    input: text,
  });
  const arrayBuffer = await speech.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { ttsToMp3Buffer };
