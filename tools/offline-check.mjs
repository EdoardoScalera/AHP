// Offline math/data checks for Phase 1 + Phase 2. No network, no Worker, no GitHub.
// Run: node tools/offline-check.mjs   (from the AHP repo root)
import { AHP } from '../js/ahp-core.js';
import { Guided } from '../js/guided.js';
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

// 6. indicators.json: 7 unique KPIs, one per group G1..G7
check('data: indicators.json has 7 unique KPIs (G1..G7)', () => {
  const data = JSON.parse(readFileSync(new URL('../data/indicators.json', import.meta.url), 'utf8'));
  assert(data.version === 'sample-7-v1', 'version');
  assert(data.indicators.length === 7, 'should list 7');
  const groups = data.indicators.map(k => k.group).sort();
  assert(JSON.stringify(groups) === JSON.stringify(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7']), `groups: ${groups}`);
  assert(new Set(data.indicators.map(k => k.id)).size === 7, 'ids unique');
  assert(new Set(data.indicators.map(k => k.code)).size === 7, 'codes unique');
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

// 8. Phase-2 guided divisor is 4 -> 11 questions for 7 KPIs
check('guided: phase-2 divisor 4 gives 11 for n=7', () => {
  assert(Guided.targetCount(7, 4) === 11, `expected 11, got ${Guided.targetCount(7, 4)}`);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const { order } = Guided.generateOrder(ids, null, 4);
  assert(order.length === 11, `order should be 11, got ${order.length}`);
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

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll offline checks passed.');
}
