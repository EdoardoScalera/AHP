// Match Phase-1 and Phase-2 submissions by shared response ID (offline, read-only
// except for the matched-pairs.json report it writes).
// Scans a submissions folder recursively: the three Worker folders
// (phase1-only/, phase2-only/, complete/), legacy flat files, and the mock's
// tools/offline-submissions/ mirror.
// Usage: node tools/match-responses.mjs [dir]   (default: tools/offline-submissions)
// Exit 1 on malformed files or folder/move anomalies; orphans are normal (exit 0).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPORT_NAME = 'matched-pairs.json';

function collect(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (e.isFile() && e.name.endsWith('.json') && e.name !== REPORT_NAME) out.push(p);
  }
  return out;
}

function phaseOf(body, file, rootDir) {
  if (body && (body.phase === 1 || body.phase === 2)) return body.phase;
  const rel = relative(rootDir, file).replace(/\\/g, '/');
  if (/(^|\/)phase1-only\//.test(rel) || /(^|\/)phase1_/.test(rel)) return 1;
  if (/(^|\/)phase2-only\//.test(rel) || /(^|\/)phase2_/.test(rel) || /(^|\/)complete\//.test(rel)) {
    return /(^|\/)phase1_/.test(rel) ? 1 : 2;
  }
  return null;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const rootDir = resolve(process.argv[2] || join(here, 'offline-submissions'));
  let files;
  try {
    files = collect(rootDir);
  } catch (e) {
    console.error(`Cannot scan ${rootDir}: ${e.message}`);
    process.exit(2);
  }
  const malformed = [];
  const byId = new Map(); // submissionId -> { phase1: [{file, body}], phase2: [...] }
  const unidentified = [];
  for (const f of files) {
    let body;
    try {
      body = JSON.parse(readFileSync(f, 'utf8'));
    } catch {
      malformed.push(relative(rootDir, f));
      continue;
    }
    const id = body && typeof body.submissionId === 'string' ? body.submissionId : null;
    if (!id) {
      unidentified.push(relative(rootDir, f));
      continue;
    }
    const phase = phaseOf(body, f, rootDir);
    if (phase !== 1 && phase !== 2) {
      malformed.push(`${relative(rootDir, f)} (unknown phase)`);
      continue;
    }
    if (!byId.has(id)) byId.set(id, { phase1: [], phase2: [] });
    byId.get(id)[phase === 1 ? 'phase1' : 'phase2'].push({ file: relative(rootDir, f), body });
  }

  const latest = (arr) => arr.slice().sort((a, b) =>
    String(a.body.submittedAt || '') < String(b.body.submittedAt || '') ? 1 : -1)[0];

  const matched = [];
  const orphanPhase1 = [];
  const orphanPhase2 = [];
  const anomalies = [];
  for (const [id, g] of byId) {
    if (g.phase1.length > 1 || g.phase2.length > 1) {
      anomalies.push(`${id}: repeat submits (${g.phase1.length}x phase-1, ${g.phase2.length}x phase-2) — latest wins`);
    }
    const p1 = g.phase1.length ? latest(g.phase1) : null;
    const p2 = g.phase2.length ? latest(g.phase2) : null;
    if (p1 && p2) {
      matched.push({ responseId: id, scenario: 'C', phase1File: p1.file, phase2File: p2.file });
      // Folder placement check: mates of a finished pair belong in complete/.
      if (!/(^|\/)complete\//.test(p1.file.replace(/\\/g, '/'))) {
        anomalies.push(`${id}: phase-1 mate not in complete/ (move incomplete): ${p1.file}`);
      }
      if (!/(^|\/)complete\//.test(p2.file.replace(/\\/g, '/'))) {
        anomalies.push(`${id}: phase-2 file not in complete/: ${p2.file}`);
      }
      continue;
    }
    if (p1) {
      const sel = p1.body.phasesSelected;
      orphanPhase1.push({
        responseId: id,
        scenario: Array.isArray(sel) && sel.includes(2) ? 'finish-early' : 'A',
        phase1File: p1.file,
      });
      if (/(^|\/)complete\//.test(p1.file.replace(/\\/g, '/'))) {
        anomalies.push(`${id}: lone phase-1 in complete/ without mate: ${p1.file}`);
      }
    } else {
      const skipped = p2.body.phase1Skipped === true;
      orphanPhase2.push({ responseId: id, scenario: skipped ? 'B' : 'anomaly', phase2File: p2.file });
      if (!skipped) anomalies.push(`${id}: phase-2 without mate and not standalone: ${p2.file}`);
    }
  }

  const report = { generatedAt: new Date().toISOString(), rootDir, matched, orphanPhase1, orphanPhase2 };
  try {
    writeFileSync(join(rootDir, REPORT_NAME), JSON.stringify(report, null, 2));
  } catch (e) {
    console.error(`Cannot write report: ${e.message}`);
    process.exit(2);
  }

  console.log(`Scanned ${files.length} file(s) in ${rootDir}`);
  console.log(`Matched pairs (C): ${matched.length}`);
  matched.forEach((m) => console.log(`  ✓ ${m.responseId}\n      ${m.phase1File}\n      ${m.phase2File}`));
  console.log(`Orphan Phase-1: ${orphanPhase1.length}`);
  orphanPhase1.forEach((o) => console.log(`  - [${o.scenario}] ${o.responseId} ${o.phase1File}`));
  console.log(`Orphan Phase-2: ${orphanPhase2.length}`);
  orphanPhase2.forEach((o) => console.log(`  - [${o.scenario}] ${o.responseId} ${o.phase2File}`));
  if (malformed.length) console.log(`Malformed: ${malformed.length}\n  ! ${malformed.join('\n  ! ')}`);
  if (unidentified.length) console.log(`Unidentified (no submissionId): ${unidentified.length}`);
  if (anomalies.length) {
    console.log(`Anomalies: ${anomalies.length}\n  ! ${anomalies.join('\n  ! ')}`);
    process.exit(1);
  }
  console.log(`Report written to ${join(rootDir, REPORT_NAME)}`);
}

main();
