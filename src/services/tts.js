const openai = require('./openaiClient');
const config = require('../config');
const { loadTemplate, fillTemplate } = require('../utils/promptLoader');

// Load TTS prompt templates once at module initialization
let ttsInstructions = null;
let ttsInputTemplate = null;

function loadTtsPrompts() {
  if (!ttsInstructions) {
    try {
      ttsInstructions = loadTemplate('prompts/tts/instructions.txt');
      ttsInputTemplate = loadTemplate('prompts/tts/input.txt');
    } catch (err) {
      console.warn('TTS prompts not found, using default behavior', err.message);
      ttsInstructions = '';
      ttsInputTemplate = '{{TEXT}}';
    }
  }
}

async function ttsToMp3Buffer(text, options = {}) {
  loadTtsPrompts();
  
  // Allow overriding instructions per call if needed
  const instructions = options.instructions !== undefined 
    ? options.instructions 
    : ttsInstructions;
  
  // Fill input template with the text
  const input = fillTemplate(ttsInputTemplate, { TEXT: text });
  
  const createParams = {
    model: config.openai.ttsModel,
    voice: config.openai.ttsVoice,
    input,
  };
  
  // Only add instructions if they exist and are non-empty
  if (instructions && instructions.trim().length > 0) {
    createParams.instructions = instructions.trim();
  }
  
  const speech = await openai.audio.speech.create(createParams);
  const arrayBuffer = await speech.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { ttsToMp3Buffer };
