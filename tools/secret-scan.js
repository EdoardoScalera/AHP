const fs = require('fs');
const pats = ['github_pat_', 'ghp_', 'gho_', 'BEGIN PRIVATE KEY'];
const files = [...fs.readdirSync('js').map((f) => 'js/' + f),
  ...fs.readdirSync('tools').map((f) => 'tools/' + f), 'index.html'];
let hit = false;
for (const f of files) {
  if (f.endsWith('tools/secret-scan.js')) continue; // self: pattern list only
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const p of pats) {
    if (s.includes(p)) { console.error(`HIT ${p} in ${f}`); hit = true; }
  }
}
if (!hit) console.log('secret scan clean');
const ex = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };
for (const p of ['tools/offline-submissions', '.dev.vars', '.env']) {
  if (ex(p)) { console.error('must not commit: ' + p); hit = true; }
}
process.exit(hit ? 1 : 0);
