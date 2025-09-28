const config = require('../config');

function dbg(...args) {
  if (config.serverDebug) {
    console.log('[DBG]', ...args);
  }
}
function safeToken(t) {
  if (!t || typeof t !== 'string') return '';
  return t.slice(0, 6) + '...' + t.slice(-4);
}
function truncate(str, n = 500) {
  if (typeof str !== 'string') return str;
  return str.length > n ? str.slice(0, n) + ` ... [${str.length} chars]` : str;
}

module.exports = { dbg, safeToken, truncate };
