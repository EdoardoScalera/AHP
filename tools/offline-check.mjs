// Offline math/data checks for Phase 1 + Phase 2. No network, no Worker, no GitHub.
// Run: node tools/offline-check.mjs   (from the AHP repo root)
import { AHP } from '../js/ahp-core.js';
import { Guided } from '../js/guided.js';
import { Phase2 } from '../js/phase2.js';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}: ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 1. Consistent matrix -> equal weights, CR ~ 0
check('ahp-core: 3x3 all-ones matrix', () => {
  const r = AHP.calculateAll([[1, 1, 1], [1, 1, 1], [1, 1, 1]]);
  assert(r.weights.every(w => Math.abs(w - 1 / 3) < 1e-9), 'weights should be 1/3');
  assert(Math.abs(r.CR) < 1e-9, 'CR should be 0');
  assert(r.consistent === true, 'should be consistent');
});

// 2. Global priorities Eq.9
check('ahp-core: calculateGlobalPriorities', () => {
  const g = AHP.calculateGlobalPriorities([0.5, 0.5], [[1, 0], [0, 1]]);
  assert(Math.abs(g.scores[0] - 0.5) < 1e-9 && Math.abs(g.scores[1] - 0.5) < 1e-9, 'Pi should be [0.5,0.5]');
  assert(g.ranking.length === 2, 'ranking length');
  const g2 = AHP.calculateGlobalPriorities([1], [[0.2, 0.3, 0.5]]);
  assert(g2.ranking[0].index === 2 && g2.ranking[0].rank === 1, 'top rank should be index 2');
});

// 3. Guided divisors: Phase1 /4 -> 11 for n=7; Phase2 /8 -> 6 (spanning tree)
check('guided: targetCount divisors', () => {
  assert(Guided.targetCount(7) === 11, `phase1 target should be 11, got ${Guided.targetCount(7)}`);
  assert(Guided.targetCount(7, 8) === 6, `phase2 target should be 6, got ${Guided.targetCount(7, 8)}`);
});

// 4. Phase-2 order covers all 7 nodes with 6 links (connected graph)
check('guided: phase-2 order is connected over 7 indicators', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const { order } = Guided.generateOrder(ids, null, 8);
  assert(order.length === 6, `order should be 6, got ${order.length}`);
  const adj = new Map(ids.map(id => [id, []]));
  order.forEach(([x, y]) => { adj.get(x).push(y); adj.get(y).push(x); });
  const seen = new Set(['a']);
  const stack = ['a'];
  while (stack.length) {
    const u = stack.pop();
    for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  }
  assert(seen.size === 7, 'graph should connect all 7 nodes');
});

// 5. LLS completion from 6 known pairs yields valid reciprocal 7x7
check('ahp-core: completeIncomplete 6 pairs -> 7x7', () => {
  const known = [
    { i: 0, j: 1, value: 3 }, { i: 0, j: 2, value: 1 }, { i: 0, j: 3, value: 5 },
    { i: 0, j: 4, value: 1 }, { i: 0, j: 5, value: 2 }, { i: 0, j: 6, value: 4 }
  ];
  const done = AHP.completeIncomplete(known, 7);
  assert(done.matrix.length === 7, 'matrix 7x7');
  for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
    assert(Math.abs(done.matrix[i][j] - 1 / done.matrix[j][i]) < 1e-9, 'reciprocal');
    assert(done.matrix[i][j] >= 1 / 9 - 1e-9 && done.matrix[i][j] <= 9 + 1e-9, 'range');
  }
  const r = AHP.calculateAll(done.matrix);
  assert(r.weights.length === 7 && Math.abs(r.weights.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'weights sum 1');
});

// 6. indicators.json: 14 unique real KPIs (G1x2, G2x3, G3x2, G4x1, G5x2, G6x4)
check('data: indicators.json has 14 unique KPIs (real-14-v3)', () => {
  const data = JSON.parse(readFileSync(new URL('../data/indicators.json', import.meta.url), 'utf8'));
  assert(data.version === 'real-14-v3', 'version');
  assert(data.indicators.length === 14, 'should list 14');
  const groups = data.indicators.map(k => k.group).sort();
  assert(JSON.stringify(groups) === JSON.stringify(['G1', 'G1', 'G2', 'G2', 'G2', 'G3', 'G3', 'G4', 'G5', 'G5', 'G6', 'G6', 'G6', 'G6']), `groups: ${groups}`);
  assert(new Set(data.indicators.map(k => k.id)).size === 14, 'ids unique');
  assert(new Set(data.indicators.map(k => k.code)).size === 14, 'codes unique');
  const iod = data.indicators.find(k => k.id === 'indoor_discomfort_degree');
  assert(iod && iod.name.includes('[°Ch]'), 'G5.2 unit should be [°Ch]');
  assert(iod && iod.name.includes('Indoor Discomfort Degree'), 'G5.2 renamed to Indoor Discomfort Degree');
  assert(!data.indicators.some(k => k.id === 'indoor_overheating_degree'), 'old overheating id should be gone');
  const sfi = data.indicators.find(k => k.id === 'saifi');
  assert(sfi && sfi.code === 'G4.2' && sfi.group === 'G4' && sfi.direction === 'lower', 'G4.2 SAIFI entry');
  assert(!data.indicators.some(k => k.id === 'saidi'), 'SAIDI should be replaced by SAIFI');
});

// 7. End-to-end math simulation: 2 criteria x 7 KPIs -> Pi sums to 1
check('phase2: simulated global ranking sums to 1', () => {
  const w = [0.6, 0.4];
  const perCrit = [
    [0.3, 0.2, 0.15, 0.1, 0.1, 0.1, 0.05],
    [0.1, 0.1, 0.1, 0.2, 0.2, 0.15, 0.15]
  ];
  const g = AHP.calculateGlobalPriorities(w, perCrit);
  const sum = g.scores.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 1e-9, `Pi sum should be 1, got ${sum}`);
});

// 8. Phase-2 guided divisor is 4 -> 11 questions for 7 KPIs, 39 for 13, 46 for 14
check('guided: phase-2 divisor 4 gives 11 for n=7, 39 for n=13, 46 for n=14', () => {
  assert(Guided.targetCount(7, 4) === 11, `expected 11, got ${Guided.targetCount(7, 4)}`);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const { order } = Guided.generateOrder(ids, null, 4);
  assert(order.length === 11, `order should be 11, got ${order.length}`);
  assert(Guided.targetCount(13, 4) === 39, `expected 39, got ${Guided.targetCount(13, 4)}`);
  const ids13 = Array.from({ length: 13 }, (_, i) => `k${i}`);
  const built13 = Guided.generateOrder(ids13, null, 4);
  assert(built13.order.length === 39, `order should be 39, got ${built13.order.length}`);
  assert(Guided.targetCount(14, 4) === 46, `expected 46, got ${Guided.targetCount(14, 4)}`);
  const ids14 = Array.from({ length: 14 }, (_, i) => `k${i}`);
  const built14 = Guided.generateOrder(ids14, null, 4);
  assert(built14.order.length === 46, `order should be 46, got ${built14.order.length}`);
});

// 9. Tiered order starts from the Tier-A hub
check('guided: tiered order uses Tier-A hub', () => {
  const ids = ['a', 'b', 'c'];
  const tiers = { a: 'B', b: 'C', c: 'A' };
  const { order, hub } = Guided.generateOrder(ids, tiers, 4);
  assert(hub === 'c', `hub should be c, got ${hub}`);
  assert(order.length === 2, `order should be 2, got ${order.length}`);
  assert(order.every(([x, y]) => x === 'c' || y === 'c'), 'hub should anchor the tree');
  assert(Guided.suggestedRange('A', 'C') === '7–9', 'A-vs-C band');
});

// 10. NA synthesis: excluded KPI gets no contribution, weights renormalized
check('phase2: NA exclusion renormalizes per KPI', () => {
  // C excluded under criterion 0 -> G_C = 0.4*0.5/0.4 = 0.5 (not penalized).
  const w = [0.6, 0.4];
  const perCrit = [
    [0.5, 0.5, null],
    [0.2, 0.3, 0.5]
  ];
  const g = AHP.calculateGlobalPriorities(w, perCrit);
  assert(Math.abs(g.scores[0] - 0.38) < 1e-9, `G_A should be 0.38, got ${g.scores[0]}`);
  assert(Math.abs(g.scores[1] - 0.42) < 1e-9, `G_B should be 0.42, got ${g.scores[1]}`);
  assert(Math.abs(g.scores[2] - 0.5) < 1e-9, `G_C should be 0.5, got ${g.scores[2]}`);
  const rc = g.ranking.find((r) => r.index === 2);
  assert(rc.scored && rc.evaluatedIn === 1 && Math.abs(rc.weightBase - 0.4) < 1e-9, 'coverage metadata');
});

// 11. KPI excluded everywhere -> unscored, ranked last with null rank
check('phase2: fully excluded KPI is unscored', () => {
  const g = AHP.calculateGlobalPriorities([1], [[0.6, 0.4, null]]);
  const u = g.ranking.find((r) => r.index === 2);
  assert(u.scored === false && u.score === null && u.rank === null, 'should be unscored');
  assert(g.ranking[g.ranking.length - 1].index === 2, 'unscored sorts last');
});

// 12. Matcher buckets a mixed submissions folder correctly
check('matcher: pairs, orphans and folder anomalies', () => {
  const toolsDir = dirname(fileURLToPath(import.meta.url));
  const matcher = join(toolsDir, 'match-responses.mjs');
  const tmp = mkdtempSync(join(tmpdir(), 'ahp-match-'));
  try {
    const put = (sub, name, body) => {
      mkdirSync(join(tmp, sub), { recursive: true });
      writeFileSync(join(tmp, sub, name), JSON.stringify(body));
    };
    const t = '2026-10-07T00:00:00.000Z';
    // Matched pair in complete/.
    put('complete', 'phase1_t1_ID2.json', { submissionId: 'ID2', phase: 1, submittedAt: t, phasesSelected: [1, 2] });
    put('complete', 'phase2_t2_ID2.json', { submissionId: 'ID2', phase: 2, submittedAt: t });
    // Finish-early orphan in phase1-only/.
    put('phase1-only', 'phase1_t3_ID1.json', { submissionId: 'ID1', phase: 1, submittedAt: t, phasesSelected: [1, 2] });
    // Standalone phase-2 orphan.
    put('phase2-only', 'phase2_t4_ID3.json', { submissionId: 'ID3', phase: 2, submittedAt: t, phase1Skipped: true });
    execFileSync(process.execPath, [matcher, tmp], { stdio: 'pipe' });
    const report = JSON.parse(readFileSync(join(tmp, 'matched-pairs.json'), 'utf8'));
    assert(report.matched.length === 1 && report.matched[0].responseId === 'ID2', 'one matched pair');
    assert(report.orphanPhase1.length === 1 && report.orphanPhase1[0].scenario === 'finish-early', 'one finish-early orphan');
    assert(report.orphanPhase2.length === 1 && report.orphanPhase2[0].scenario === 'B', 'one standalone orphan');
    // Lone phase-1 in complete/ is a move anomaly -> exit 1.
    put('complete', 'phase1_t5_ID9.json', { submissionId: 'ID9', phase: 1, submittedAt: t });
    let failed = false;
    try {
      execFileSync(process.execPath, [matcher, tmp], { stdio: 'pipe' });
    } catch {
      failed = true;
    }
    assert(failed, 'lone phase-1 in complete/ should fail');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// 13. Info overlay content: every criterion and KPI has a non-empty info
// text, and every KPI declares its direction (higher/lower is better).
check('data: criteria + indicators carry info overlay text', () => {
  const crit = JSON.parse(readFileSync(new URL('../data/criteria.json', import.meta.url), 'utf8'));
  assert(crit.criteria.length === 7, 'should list 7 criteria');
  crit.criteria.forEach(c => {
    assert(typeof c.info === 'string' && c.info.trim().length > 10, `criterion ${c.id} needs info text`);
  });
  const data = JSON.parse(readFileSync(new URL('../data/indicators.json', import.meta.url), 'utf8'));
  data.indicators.forEach(k => {
    assert(typeof k.info === 'string' && k.info.trim().length > 10, `KPI ${k.id} needs info text`);
    assert(k.direction === 'higher' || k.direction === 'lower', `KPI ${k.id} needs direction`);
  });
});

// 13b. Per-criterion default KPI pre-selection (docs/kpi choices.txt): every
// default references a real id; non-empty defaults respect the min-2 floor;
// water_use and climate_impact deliberately default to nothing selected.
check('data: per-criterion default KPI selections are valid', () => {
  const crit = JSON.parse(readFileSync(new URL('../data/criteria.json', import.meta.url), 'utf8'));
  const ind = JSON.parse(readFileSync(new URL('../data/indicators.json', import.meta.url), 'utf8'));
  const ids = new Set(ind.indicators.map(k => k.id));
  assert(crit.criteria.length === 7, 'should list 7 criteria');
  const expected = {
    energy_performance: ['primary_energy', 'energy_savings', 'demand_response', 'energy_shift_flexibility', 'no_grid_interaction', 'load_cover_factor', 'load_matching_index', 'specific_cost_flexibility'],
    water_use: [],
    climate_impact: [],
    economic_performance: ['investment_cost', 'specific_cost_flexibility', 'npv', 'spp'],
    ieq: ['saifi', 'ppd', 'indoor_discomfort_degree'],
    energy_system_integration: ['demand_response', 'energy_shift_flexibility', 'no_grid_interaction', 'load_cover_factor', 'load_matching_index'],
    practical_implementation: ['investment_cost', 'npv', 'spp', 'saifi', 'ppd']
  };
  crit.criteria.forEach(c => {
    assert(Array.isArray(c.defaultKpis), `${c.id} needs a defaultKpis array`);
    assert(JSON.stringify(c.defaultKpis) === JSON.stringify(expected[c.id]),
      `${c.id} defaultKpis mismatch: got ${JSON.stringify(c.defaultKpis)}`);
    c.defaultKpis.forEach(id => assert(ids.has(id), `${c.id} default references unknown id ${id}`));
    assert(new Set(c.defaultKpis).size === c.defaultKpis.length, `${c.id} defaults must be unique`);
    if (c.defaultKpis.length) assert(c.defaultKpis.length >= 2, `${c.id} needs >= 2 defaults (min-eval floor)`);
  });
});

// 14. Partial pair sets complete to valid reciprocal matrices (live provisional CR).
check('phase2: partial LLS completion is valid (1 and 3 pairs, n=7)', () => {
  for (const known of [
    [{ i: 0, j: 1, value: 3 }],
    [{ i: 0, j: 1, value: 3 }, { i: 2, j: 5, value: 1 / 5 }, { i: 3, j: 4, value: 7 }]
  ]) {
    const done = AHP.completeIncomplete(known, 7);
    assert(done.matrix.length === 7, 'matrix 7x7');
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      assert(Math.abs(done.matrix[i][j] - 1 / done.matrix[j][i]) < 1e-9, 'reciprocal');
      assert(done.matrix[i][j] >= 1 / 9 - 1e-9 && done.matrix[i][j] <= 9 + 1e-9, 'range');
    }
    const r = AHP.calculateAll(done.matrix);
    assert(isFinite(r.CR) && r.CR >= 0 && r.CR <= 1, `CR should be in [0,1], got ${r.CR}`);
    assert(Math.abs(r.weights.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'weights sum 1');
  }
});

// 15. Partial-criteria global synthesis renormalizes over completed criteria.
check('phase2: live ranking over a subset of criteria', () => {
  // Second criterion not yet completed (all null) -> scores from the first only.
  const g = AHP.calculateGlobalPriorities([0.6, 0.4], [[0.5, 0.5], [null, null]]);
  assert(Math.abs(g.scores[0] - 0.5) < 1e-9 && Math.abs(g.scores[1] - 0.5) < 1e-9, `scores should be [0.5,0.5], got ${g.scores}`);
  const rc = g.ranking.find((r) => r.index === 0);
  assert(rc.scored && rc.evaluatedIn === 1 && Math.abs(rc.weightBase - 0.6) < 1e-9, 'coverage metadata');
});

// 16. Guided answers land in canonical (matrix-display-order) positions.
// Regression: answers were indexed by hub-first question order, permuting
// the matrix whenever the Tier-A hub was not the first evaluated KPI
// (e.g. G6.4-over-G1.2 = 7 appeared at row G1.2 x col G2.1).
check('phase2: guided answers map to canonical matrix positions', () => {
  const ids = ['g1.2', 'g2.1', 'g6.1', 'g6.2', 'g6.4', 'g6.5'];
  const { order, hub } = Guided.generateOrder(ids, { 'g6.4': 'A' }, 4);
  assert(hub === 'g6.4', `hub should be g6.4, got ${hub}`);
  // The trap: first-seen (hub-first) order differs from canonical order.
  const seen = [];
  order.forEach(([a, b]) => { if (!seen.includes(a)) seen.push(a); if (!seen.includes(b)) seen.push(b); });
  assert(seen.join('|') !== ids.join('|'), 'hub-first order must differ from matrix order here');
  // Q1 is [g6.4, g1.2]; answering g6.4-over-g1.2 = 7 belongs in the lower
  // triangle at row g6.4 (idx 4) x col g1.2 (idx 1), reciprocal upper.
  assert(order[0][0] === 'g6.4' && order[0][1] === 'g1.2', `first pair should be hub vs g1.2, got ${order[0]}`);
  const p = Guided.locatePair(ids, 'g6.4', 'g1.2', 7);
  assert(p.i === 0 && p.j === 4 && Math.abs(p.value - 1 / 7) < 1e-12,
    `upper should be 1/7 at [0][4], got [${p.i}][${p.j}] = ${p.value}`);
  // Reverse direction: g1.2-over-g6.4 = 7 goes straight to upper [0][4].
  const q = Guided.locatePair(ids, 'g1.2', 'g6.4', 7);
  assert(q.i === 0 && q.j === 4 && q.value === 7, `upper should be 7, got ${q.value}`);
  // Canonical-order pair passes through unchanged.
  const r = Guided.locatePair(ids, 'g2.1', 'g6.1', 3);
  assert(r.i === 1 && r.j === 2 && r.value === 3, `should be [1][2] = 3, got [${r.i}][${r.j}] = ${r.value}`);
  // Unknown or identical ids are rejected.
  assert(Guided.locatePair(ids, 'g1.2', 'nope', 3) === null, 'unknown id should give null');
  assert(Guided.locatePair(ids, 'g1.2', 'g1.2', 1) === null, 'diagonal should give null');
});

// 17. Adding a custom KPI extends the state without clearing answers.
check('phase2: extendForAddedKpi preserves answers, appends new pairs', () => {
  const T = Phase2.__test;
  assert(T && typeof T.extendForAddedKpi === 'function', 'test hook missing');
  const st = {
    excluded: [], tiers: { a: 'B', b: 'B', c: 'B' }, skipped: false,
    order: [], hub: null, target: 0, answers: {}, idx: 0, choice: null,
    matrix: [], user: [], estimated: [], result: { weights: [1 / 3, 1 / 3, 1 / 3] }
  };
  T.resetAnswers(st, ['a', 'b', 'c']);
  // Answer every guided pair (canonical keys, like recordKnown).
  st.order.forEach(([x, y]) => {
    const i = st.ids.indexOf(x), j = st.ids.indexOf(y);
    const u = Math.min(i, j), v = Math.max(i, j);
    st.answers[`${u}|${v}`] = { i: u, j: v, value: 2 };
  });
  const nAnswered = Object.keys(st.answers).length;
  const oldOrder = st.order.map(([x, y]) => `${x}|${y}`);
  const m00 = st.matrix[0][0], m01 = st.matrix[0][1], m22 = st.matrix[2][2];
  st.tiers.d = 'B';
  assert(T.extendForAddedKpi(st, 'd') === true, 'extend should apply');
  assert(st.ids.join('|') === 'a|b|c|d', `ids append-only, got ${st.ids.join('|')}`);
  assert(st.matrix.length === 4 && st.matrix.every(r => r.length === 4), 'matrix 4x4');
  assert(st.matrix[0][0] === m00 && st.matrix[0][1] === m01 && st.matrix[2][2] === m22, 'old cells intact');
  assert(st.matrix[3][3] === 1 && st.matrix[0][3] === 1 && st.user[0][3] === false, 'new row/col fresh');
  assert(Object.keys(st.answers).length === nAnswered, 'no answers lost');
  assert(st.order.length > oldOrder.length, 'pairs were appended');
  assert(oldOrder.every((k, i) => {
    const [x, y] = st.order[i];
    return `${x < y ? x : y}|${x < y ? y : x}` === k.split('|').sort().join('|');
  }), 'old order prefix intact');
  assert(st.order.slice(oldOrder.length).every(([x, y]) => x === 'd' || y === 'd'), 'new pairs involve d');
  assert(st.idx === oldOrder.length, `idx at first new pair, got ${st.idx}`);
  assert(st.result === null, 'result cleared until new pairs answered');
  // Guards: skipped tabs and duplicates fall back.
  assert(T.extendForAddedKpi({ skipped: true, ids: ['a'] }, 'd') === false, 'skipped should refuse');
  assert(T.extendForAddedKpi(st, 'd') === false, 'duplicate should refuse');
});

// 18. Tier changes rebuild the order but keep every answer.
check('phase2: rebuildOrderKeepAnswers keeps answers on re-tier', () => {
  const T = Phase2.__test;
  const st = {
    excluded: [], tiers: { a: 'B', b: 'B', c: 'B' }, skipped: false,
    order: [], hub: null, target: 0, answers: {}, idx: 0, choice: null,
    matrix: [], user: [], estimated: [], result: null
  };
  T.resetAnswers(st, ['a', 'b', 'c']);
  const [x0, y0] = st.order[0];
  const i0 = st.ids.indexOf(x0), j0 = st.ids.indexOf(y0);
  st.answers[`${Math.min(i0, j0)}|${Math.max(i0, j0)}`] = { i: Math.min(i0, j0), j: Math.max(i0, j0), value: 3 };
  const m = st.matrix.map(r => [...r]);
  st.tiers.c = 'A';
  T.rebuildOrderKeepAnswers(st);
  assert(Object.keys(st.answers).length === 1, 'the one answer survives');
  assert(st.matrix.every((r, i) => r.every((v, j) => v === m[i][j])), 'matrix untouched');
  assert(st.hub === 'c', `hub should follow Tier-A, got ${st.hub}`);
  assert(st.ids.join('|') === 'a|b|c', 'ids unchanged');
});

// 19. Excluding (N/A) a KPI shrinks the state, keeping other judgments.
check('phase2: reduceForRemovedKpi keeps other answers on N/A toggle', () => {
  const T = Phase2.__test;
  assert(T && typeof T.reduceForRemovedKpi === 'function', 'test hook missing');
  const fresh = (ids) => ({
    excluded: [], tiers: Object.fromEntries(ids.map(id => [id, 'B'])), skipped: false,
    order: [], hub: null, target: 0, answers: {}, idx: 0, choice: null,
    matrix: [], user: [], estimated: [], result: null
  });
  const answerAll = (st) => {
    st.order.forEach(([x, y]) => {
      const i = st.ids.indexOf(x), j = st.ids.indexOf(y);
      const u = Math.min(i, j), v = Math.max(i, j);
      st.answers[`${u}|${v}`] = { i: u, j: v, value: 2 + ((u * 4 + v) % 7) };
    });
  };
  const st = fresh(['a', 'b', 'c', 'd']);
  T.resetAnswers(st, ['a', 'b', 'c', 'd']);
  answerAll(st);
  const before = JSON.parse(JSON.stringify(st.answers));
  const dropped = Object.keys(before).filter(k => {
    const [u, v] = k.split('|').map(Number);
    return u === 2 || v === 2; // 'c' is index 2
  });
  assert(T.reduceForRemovedKpi(st, 'c') === true, 'reduce should apply');
  assert(st.ids.join('|') === 'a|b|d', `ids shrunk, got ${st.ids.join('|')}`);
  assert(st.matrix.length === 3 && st.matrix.every(r => r.length === 3), 'matrix 3x3');
  assert(Object.keys(st.answers).length === Object.keys(before).length - dropped.length, 'only c-pairs dropped');
  for (const [k, p] of Object.entries(st.answers)) {
    const a = st.ids[p.i], b = st.ids[p.j];
    assert(a !== 'c' && b !== 'c', 'no c-pair survives');
    const oldKey = ['a', 'b', 'c', 'd'].indexOf(a) < ['a', 'b', 'c', 'd'].indexOf(b)
      ? `${['a', 'b', 'c', 'd'].indexOf(a)}|${['a', 'b', 'c', 'd'].indexOf(b)}`
      : `${['a', 'b', 'c', 'd'].indexOf(b)}|${['a', 'b', 'c', 'd'].indexOf(a)}`;
    assert(before[oldKey] && before[oldKey].value === p.value, `value kept for ${k}`);
  }
  assert(st.order.every(([x, y]) => x !== 'c' && y !== 'c'), 'order covers remaining ids');
  assert(st.result === null, 'result cleared until complete again');
  // Hub re-derived when the hub itself is removed (5 ids so a non-hub
  // pair exists: n=4 orders only hub links under divisor 4).
  const st2 = fresh(['a', 'b', 'c', 'd', 'e']);
  T.resetAnswers(st2, ['a', 'b', 'c', 'd', 'e']);
  st2.tiers.e = 'A';
  T.rebuildOrderKeepAnswers(st2);
  assert(st2.hub === 'e', `hub should be e, got ${st2.hub}`);
  answerAll(st2);
  const nonHub = Object.entries(st2.answers).filter(([k, p]) => st2.ids[p.i] !== 'e' && st2.ids[p.j] !== 'e');
  assert(nonHub.length > 0, 'setup needs a non-hub pair');
  assert(T.reduceForRemovedKpi(st2, 'e') === true, 'hub removal should apply');
  assert(st2.hub !== 'e' && st2.ids.includes(st2.hub), `hub re-derived, got ${st2.hub}`);
  assert(Object.keys(st2.answers).length === nonHub.length, 'non-hub answers survive hub removal');
  // Guards: unknown id is a no-op success, floor and skip refuse.
  const snap = JSON.stringify(st2);
  assert(T.reduceForRemovedKpi(st2, 'zz') === true, 'unknown id no-op');
  assert(JSON.stringify(st2) === snap, 'no-op leaves state identical');
  const st3 = fresh(['a', 'b']);
  T.resetAnswers(st3, ['a', 'b']);
  assert(T.reduceForRemovedKpi(st3, 'b') === false, 'floor keeps min 2');
  assert(T.reduceForRemovedKpi({ skipped: true, ids: ['a', 'b', 'c'] }, 'c') === false, 'skipped refuses');
});

// 20. Toggle on then off round-trips without losing the original answers.
check('phase2: extend then reduce round-trip keeps original answers', () => {
  const T = Phase2.__test;
  const st = {
    excluded: [], tiers: { a: 'B', b: 'B', c: 'B' }, skipped: false,
    order: [], hub: null, target: 0, answers: {}, idx: 0, choice: null,
    matrix: [], user: [], estimated: [], result: null
  };
  T.resetAnswers(st, ['a', 'b', 'c']);
  st.order.forEach(([x, y]) => {
    const i = st.ids.indexOf(x), j = st.ids.indexOf(y);
    const u = Math.min(i, j), v = Math.max(i, j);
    st.answers[`${u}|${v}`] = { i: u, j: v, value: 3 };
  });
  const snapshot = JSON.stringify(st.answers);
  const oldOrder = JSON.stringify(st.order);
  st.tiers.d = 'B';
  assert(T.extendForAddedKpi(st, 'd') === true, 'extend applies');
  assert(T.reduceForRemovedKpi(st, 'd') === true, 'reduce applies');
  assert(st.ids.join('|') === 'a|b|c', 'ids back to original');
  assert(JSON.stringify(st.answers) === snapshot, 'original answers identical');
  assert(JSON.stringify(st.order) === oldOrder, 'order regenerated identically');
});

if (failures) {  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll offline checks passed.');
}
