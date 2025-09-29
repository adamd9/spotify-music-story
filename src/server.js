const app = require('./app');
const config = require('./config');
const fsp = require('fs').promises;
const path = require('path');

async function startup() {
  try {
    // Ensure runtime directories exist (best effort)
    try { await fsp.mkdir(config.paths.dataDir, { recursive: true }); } catch {}
    try { await fsp.mkdir(path.join(config.paths.dataDir, 'playlists'), { recursive: true }); } catch {}
    try { await fsp.mkdir(config.paths.ttsOutputDir, { recursive: true }); } catch {}

    // Debug: print effective configuration paths and key envs
    console.log('[CFG] env:', config.env);
    console.log('[CFG] port:', config.port);
    console.log('[CFG] publicDir:', config.paths.publicDir);
    console.log('[CFG] dataDir:', config.paths.dataDir);
    console.log('[CFG] ttsOutputDir:', config.paths.ttsOutputDir);
    console.log('[CFG] features.mockTts:', config.features.mockTts);
    console.log('[CFG] openai.ttsModel:', config.openai.ttsModel, 'voice:', config.openai.ttsVoice);
    console.log('[ENV] RUNTIME_DATA_DIR:', process.env.RUNTIME_DATA_DIR || '(unset)');
    console.log('[ENV] TTS_OUTPUT_DIR:', process.env.TTS_OUTPUT_DIR || '(unset)');
  } catch (e) {
    console.error('[CFG] startup path check failed:', e);
  }

  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

startup();
