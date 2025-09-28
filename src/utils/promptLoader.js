const fs = require('fs');
const path = require('path');

function loadTemplate(relativePath) {
  const full = path.join(__dirname, '..', relativePath);
  return fs.readFileSync(full, 'utf8');
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const v = vars[key];
    return (v === undefined || v === null) ? '' : String(v);
  });
}

module.exports = { loadTemplate, fillTemplate };
