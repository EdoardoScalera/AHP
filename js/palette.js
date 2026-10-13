// Shared categorical palette for result plots (Phase 1 + Phase 2).
// Rank-based assignment: rank 1 -> PALETTE[0], rank 2 -> PALETTE[1], ...
// Custom criteria / KPIs are treated like any other bar: colour follows the
// sorted rank position, not the item id. Cycles with modulo as a safety net
// (Phase 1 max 9 bars, Phase 2 max 14 bars).
const PALETTE = [
  '#1a5c8a', // brand primary (rank 1)
  '#59a14f',
  '#f28e2b',
  '#b07aa1',
  '#76b7b2',
  '#e15759',
  '#edc948',
  '#9467bd',
  '#00838f',
  '#ff9da7',
  '#7cb342',
  '#ffb300',
  '#5c6bc0',
  '#9c755f'
];

function colorsFor(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(PALETTE[i % PALETTE.length]);
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PALETTE, colorsFor };
}

export { PALETTE, colorsFor };
