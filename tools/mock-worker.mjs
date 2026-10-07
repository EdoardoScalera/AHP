// Minimal local mock of the Cloudflare Worker for OFFLINE testing only.
// Validates Phase-1 and Phase-2 payloads (same rules as the Worker, minus GitHub)
// and writes accepted submissions to tools/offline-submissions/{phase1-only,
// phase2-only, complete}/ instead of GitHub (same layout + move-on-completion).
// Run: node tools/mock-worker.mjs   (listens on http://localhost:8787)
// Then set js/config.js WORKER_URL to 'http://localhost:8787' TEMPORARILY for the test
// and restore it before committing.
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const PORT = 8787;
const ACCESS_CODE = process.env.MOCK_CODE || 'test-code';
const OUT_DIR = new URL('./offline-submissions/', import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });
for (const sub of ['phase1-only', 'phase2-only', 'complete']) {
  mkdirSync(new URL(`./offline-submissions/${sub}/`, import.meta.url), { recursive: true });
}

function localPath(sub, name) {
  return new URL(`./offline-submissions/${sub}/${name}`, import.meta.url);
}

// Mirror of the Worker's movePhase1ToComplete (filesystem rename = atomic).
function movePhase1ToComplete(responseId) {
  const dir = new URL('./offline-submissions/phase1-only/', import.meta.url);
  let mate = null;
  try {
    mate = readdirSync(dir).find((f) => f.startsWith('phase1_') && f.endsWith(`_${responseId}.json`));
  } catch { mate = null; }
  if (!mate) return; // already moved (repeat submit) or mate absent
  renameSync(localPath('phase1-only', mate), localPath('complete', mate));
}

const MIN_N = 3, MAX_N = 9;

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=UTF-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function checkMatrix(matrix, n) {
  if (!Array.isArray(matrix) || matrix.length !== n) return false;
  for (let i = 0; i < n; i++) {
    if (!Array.isArray(matrix[i]) || matrix[i].length !== n) return false;
    for (let j = 0; j < n; j++) {
      const v = matrix[i][j];
      if (typeof v !== 'number' || !isFinite(v) || v < 1 / 9 - 1e-9 || v > 9 + 1e-9) return false;
      if (i === j && Math.abs(v - 1) > 1e-9) return false;
      if (Math.abs(matrix[i][j] - 1 / matrix[j][i]) > 1e-6) return false;
    }
  }
  return true;
}
function checkWeights(w, n) {
  return Array.isArray(w) && w.length === n &&
    w.every(x => typeof x === 'number' && isFinite(x) && x >= 0 && x <= 1) &&
    Math.abs(w.reduce((a, b) => a + b, 0) - 1) <= 0.02;
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
    return send(res, 200, { ok: true, service: 'mock-worker-offline' });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });
  let raw = '';
  req.on('data', c => { raw += c; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid submission.' }); }
    if (body.accessCode !== ACCESS_CODE) return send(res, 403, { error: 'The access code is not valid.' });
    if (url.pathname === '/verify') return send(res, 200, { ok: true });

    if (url.pathname === '/submit' || url.pathname === '/') {
      // Basic identity check shared by both phases
      for (const f of ['name', 'role', 'pilot', 'country']) {
        if (typeof body[f] !== 'string' || !body[f].trim()) return send(res, 400, { error: 'Please complete all required fields.' });
      }
      if (body.consent !== true) return send(res, 400, { error: 'Consent is required to submit.' });

      if (body.phase === 2) {
        const m = (body.indicatorIds || []).length;
        const q = (body.criteriaIds || []).length;
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const skipped = body.phase1Skipped === true;
        if (skipped) {
          if (!UUID_RE.test(body.responseId || '')) {
            return send(res, 400, { error: 'Response ID is missing or invalid.' });
          }
        } else if (!UUID_RE.test(body.phase1SubmissionId || '')) {
          return send(res, 400, { error: 'Phase-1 link is missing or invalid.' });
        }
        if (body.weightsSource !== 'phase1' && body.weightsSource !== 'equal-default') {
          return send(res, 400, { error: 'Criteria weight source is invalid.' });
        }
        if (m < 2 || m > 9 || q < MIN_N || q > MAX_N) return send(res, 400, { error: 'Phase-2 indicator/criteria lists invalid.' });
        if (!checkWeights(body.criteriaWeights, q)) return send(res, 400, { error: 'Criteria weights must sum to 1.' });
        for (const cid of body.criteriaIds) {
          const o = body.options && body.options[cid];
          const ev = o && o.evaluatedIds;
          const ex = o && o.excludedIds;
          const ids = body.indicatorIds;
          if (!o || !Array.isArray(ev) || ev.length < 2 ||
              !ids.every((id) => ev.includes(id) !== ex.includes(id))) {
            return send(res, 400, { error: `Evaluated/excluded KPIs for ${cid} are invalid.` });
          }
          const mk = ev.length;
          const tiers = o.tiers || {};
          if (Object.keys(tiers).sort().join('|') !== [...ev].sort().join('|') ||
              !Object.values(tiers).every((t) => t === 'A' || t === 'B' || t === 'C')) {
            return send(res, 400, { error: `Tiers for ${cid} must cover exactly the evaluated KPIs.` });
          }
          if (!checkMatrix(o.matrix, mk) || !checkWeights(o.weights, mk)) {
            return send(res, 400, { error: `Scores for ${cid} are invalid.` });
          }
        }
        const gs = body.globalScores;
        if (!Array.isArray(gs) || gs.length !== m) {
          return send(res, 400, { error: 'Global scores are invalid.' });
        }
        for (const g of gs) {
          if (!g || typeof g.scored !== 'boolean') return send(res, 400, { error: 'Global score entries invalid.' });
          if (!g.scored) {
            if (g.score !== null) return send(res, 400, { error: 'Unscored KPIs must have null score.' });
            continue;
          }
          let num = 0, den = 0;
          body.criteriaIds.forEach((cid, k) => {
            const o = body.options[cid];
            const p = o.evaluatedIds.indexOf(g.indicatorId);
            if (p < 0) return;
            num += body.criteriaWeights[k] * o.weights[p];
            den += body.criteriaWeights[k];
          });
          if (den === 0 || Math.abs(num / den - g.score) > 0.02) {
            return send(res, 400, { error: `Global score for ${g.indicatorId} does not match.` });
          }
        }
        // Shared response ID: Phase-1 link (scenario C) or client responseId (scenario B).
        const id = skipped ? body.responseId : body.phase1SubmissionId;
        const sub2 = skipped ? 'phase2-only' : 'complete';
        writeFileSync(localPath(sub2, `phase2_${Date.now()}_${id}.json`),
          JSON.stringify({ ...body, submissionId: id, accessCode: undefined }, null, 2));
        if (!skipped) movePhase1ToComplete(id);
        return send(res, 201, { ok: true, submissionId: id, message: 'Mock Phase-2 saved offline.' });
      }

      // Phase 1
      const n = (body.criteria && body.criteria.activeIds && body.criteria.activeIds.length) || (body.matrix || []).length;
      if (!checkMatrix(body.matrix, n) || !checkWeights(body.weights, n)) {
        return send(res, 400, { error: 'Phase-1 matrix/weights invalid.' });
      }
      const id = randomUUID();
      writeFileSync(localPath('phase1-only', `phase1_${Date.now()}_${id}.json`),
        JSON.stringify({ ...body, submissionId: id, accessCode: undefined }, null, 2));
      return send(res, 201, { ok: true, submissionId: id, message: 'Mock Phase-1 saved offline.' });
    }
    return send(res, 404, { error: 'Not found.' });
  });
});

server.listen(PORT, () => {
  console.log(`Mock worker listening on http://localhost:${PORT}`);
  console.log(`Access code for offline test: "${ACCESS_CODE}" (override with MOCK_CODE env)`);
  console.log('Files are written to tools/offline-submissions/ (never to GitHub).');
});
