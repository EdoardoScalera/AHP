const fs = require('fs');
const h = fs.readFileSync('index.html', 'utf8');
const need = ['start-screen', 'start-form', 'identity-section', 'phases-section',
  'input-phase1-select', 'input-phase2-select', 'start-error', 'btn-start',
  'phase2-invite-screen', 'phase2-invite-detail',
  'btn-phase2-finish', 'btn-phase2-proceed', 'phase2-screen', 'phase2-tabs',
  'phase2-kpi-checklist', 'phase2-tier-board', 'phase2-tier-col-A', 'phase2-tier-col-B',
  'phase2-tier-col-C', 'phase2-crit-title', 'phase2-progress', 'phase2-bar-fill',
  'phase2-guided-card', 'phase2-qtext', 'phase2-suggest', 'phase2-hint', 'phase2-yes',
  'phase2-no', 'phase2-equal', 'phase2-scale-wrap', 'phase2-scale-label', 'phase2-scale',
   'phase2-back', 'phase2-restart', 'phase2-done', 'phase2-legend', 'phase2-matrix',
   'phase2-cr-value', 'phase2-cr-status', 'phase2-cr-bar-fill', 'phase2-prev',
   'phase2-next', 'phase2-ranking-empty', 'phase2-ranking-wrap', 'phase2-plot-canvas',
   'phase2-plot-cr', 'phase2-ranking-tbody', 'btn-phase2-save', 'btn-phase2-submit',
   'info-modal', 'info-modal-title', 'info-modal-body', 'info-modal-close'];
const miss = need.filter((i) => !h.includes('id="' + i + '"'));
if (miss.length) { console.error('missing IDs: ' + miss.join(', ')); process.exit(1); }
console.log('all ' + need.length + ' flow IDs present');
// Identity now lives on the start screen (before the survey screen),
// and the old thank-you-screen opt-in is gone (replaced by upfront selection).
const startPos = h.indexOf('start-screen');
const identPos = h.indexOf('identity-section');
const surveyPos = h.indexOf('survey-screen');
if (!(startPos < identPos && identPos < surveyPos)) {
  console.error('identity section is not inside the start screen');
  process.exit(1);
}
if (h.includes('input-phase2-optin')) {
  console.error('stale thank-you-screen opt-in checkbox still present');
  process.exit(1);
}
console.log('start screen order OK, stale opt-in removed');
const app = fs.readFileSync('js/app.js', 'utf8');
console.log('app imports phase2: ' + app.includes('phase2.js'));
console.log('app fetches indicators: ' + app.includes('indicators.json'));
const routing = [
  'start-screen', // unlock lands on start
  'startPhase2Standalone', // scenario B: Phase 2 only
  'equal-default', // scenario B weights source
  'phase1Skipped', // scenario B standalone link
  'phasesSelected', // analysis traceability
];
const routingMiss = routing.filter((s) => !app.includes(s));
if (routingMiss.length) { console.error('app routing missing: ' + routingMiss.join(', ')); process.exit(1); }
console.log('scenario routing present (' + routing.length + ' checks)');
const p2 = fs.readFileSync('js/phase2.js', 'utf8');
const wiring = [
  'draggable="true"', // tier blocks draggable like Phase 1
  'drop', // column drop zones
  'updateLowerCell', // surgical mirrored-cell updates (focus-safe typing)
  'renderGuidedCard', // guided card refresh without matrix rebuild
  'td.classList', // provenance classes on TDs (stylesheet selects td.upper.user input)
];
const wiringMiss = wiring.filter((s) => !p2.includes(s));
if (wiringMiss.length) { console.error('phase2 wiring missing: ' + wiringMiss.join(', ')); process.exit(1); }
console.log('phase2 interaction wiring present (' + wiring.length + ' checks)');
if (/renderAll\(\);\s*\n\s*persistDraft\(\);\s*\n\s*\} else \{\s*\n\s*input\.classList\.add\('invalid'\)/.test(p2)) {
  console.error('matrix input still rebuilds the table on every keystroke');
  process.exit(1);
}
console.log('no full rebuild on matrix keystroke');
if (/\bID:\s*\$/ .test(app) || app.includes('(ID:')) {
  console.error('user-facing messages still contain response IDs');
  process.exit(1);
}
console.log('no response IDs in user-facing messages');
const worker = fs.readFileSync('../entrance-submission-api/src/index.js', 'utf8');
const naming = [
  'phase1-only/phase1_',
  'phase2-only/phase2_',
  'complete/',
  'movePhase1ToComplete',
];
const namingMiss = naming.filter((s) => !worker.includes(s));
if (namingMiss.length) { console.error('worker layout missing: ' + namingMiss.join(', ')); process.exit(1); }
console.log('worker folder layout + move logic present (' + naming.length + ' checks)');
const mock = fs.readFileSync('tools/mock-worker.mjs', 'utf8');
const mockChecks = ['phase1-only', 'phase2-only', 'complete', 'movePhase1ToComplete', 'phase1_', 'phase2_'];
const mockMiss = mockChecks.filter((s) => !mock.includes(s));
if (mockMiss.length) { console.error('mock layout missing: ' + mockMiss.join(', ')); process.exit(1); }
console.log('mock folder layout + move logic present (' + mockChecks.length + ' checks)');
