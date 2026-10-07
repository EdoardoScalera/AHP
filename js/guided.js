import { AHP } from './ahp-core.js';

// P3 guided pairwise helpers (pure functions; Q&A state lives in UI).
// Order: spanning-tree-first from hub (first Tier-A else first active),
// then top tier-contrast pairs up to round(n(n-1)/divisor).
// Phase 1 uses divisor 4; Phase 2 (KPIs) uses divisor 8 to minimise questions
// while keeping the graph connected (spanning tree = n-1 minimal links).
const Guided = (() => {
  function tierRank(t) {
    return t === 'A' ? 0 : t === 'C' ? 2 : 1;
  }

  function pairDistance(t1, t2) {
    return Math.abs(tierRank(t1 || 'B') - tierRank(t2 || 'B'));
  }

  function suggestedRange(t1, t2) {
    const d = pairDistance(t1, t2);
    if (d === 0) return '1–3';
    if (d === 1) return '3–5';
    return '7–9';
  }

  function targetCount(n, divisor = 4) {
    if (n <= 2) return 1;
    const d = typeof divisor === 'number' && divisor > 0 ? divisor : 4;
    return Math.max(n - 1, Math.round((n * (n - 1)) / d));
  }

  function generateOrder(activeIds, tiers, divisor = 4) {
    const ids = [...activeIds];
    const n = ids.length;
    if (n < 2) return { order: [], hub: ids[0] || null, target: 0 };
    const hub = ids.find(id => (tiers || {})[id] === 'A') || ids[0];
    const seen = new Set();
    const order = [];
    const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    ids.forEach(id => {
      if (id === hub) return;
      order.push([hub, id]);
      seen.add(key(hub, id));
    });
    const target = targetCount(n, divisor);
    if (order.length < target) {
      const idx = new Map(ids.map((id, i) => [id, i]));
      const cands = [];
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const k = key(ids[i], ids[j]);
          if (seen.has(k)) continue;
          cands.push({
            a: ids[i],
            b: ids[j],
            d: pairDistance((tiers || {})[ids[i]], (tiers || {})[ids[j]]),
            i,
            j
          });
        }
      }
      cands.sort((x, y) => (y.d - x.d) || (x.i - y.i) || (x.j - y.j));
      for (const c of cands) {
        if (order.length >= target) break;
        order.push([c.a, c.b]);
      }
    }
    return { order, hub, target };
  }

  function hasPath(aIdx, bIdx, knownPairs, n) {
    const adj = Array(n).fill(null).map(() => []);
    (knownPairs || []).forEach(p => {
      adj[p.i].push(p.j);
      adj[p.j].push(p.i);
    });
    const seen = Array(n).fill(false);
    const stack = [aIdx];
    seen[aIdx] = true;
    while (stack.length) {
      const u = stack.pop();
      if (u === bIdx) return true;
      adj[u].forEach(v => {
        if (!seen[v]) { seen[v] = true; stack.push(v); }
      });
    }
    return false;
  }

  // Implied a-over-b value from existing user chains, or null if unconnected.
  // Non-binding suggestion only; never auto-applied.
  function impliedValue(aIdx, bIdx, knownPairs, n) {
    if (!hasPath(aIdx, bIdx, knownPairs, n)) return null;
    try {
      const done = AHP.completeIncomplete(knownPairs, n);
      const v = done.matrix[aIdx][bIdx];
      if (!isFinite(v) || v <= 0) return null;
      return v;
    } catch (e) {
      return null;
    }
  }

  function formatValue(v) {
    if (v >= 1) return String(Math.max(1, Math.round(v)));
    return `1/${Math.max(1, Math.round(1 / v))}`;
  }

  return {
    tierRank,
    pairDistance,
    suggestedRange,
    targetCount,
    generateOrder,
    hasPath,
    impliedValue,
    formatValue
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Guided;
}

export { Guided };
