// Phase 2: KPI (option) scoring — one pairwise matrix per active criterion.
// Reuses AHP core (calculateAll/completeIncomplete/calculateGlobalPriorities)
// and Guided ordering with divisor 4.
// Per criterion the respondent may:
//  - remove KPIs unrelated to it (checklist, min 2 evaluated; removed = NA,
//    skipped in the final synthesis with per-KPI weight renormalization), and
//  - rank evaluated KPIs into A/B/C tiers (same logic as Phase 1: tier-driven
//    suggestions, scale highlights, hub-first order).
// Own DOM namespace (phase2-*) so Phase-1 ui.js is untouched.
import { AHP } from './ahp-core.js';
import { Guided } from './guided.js';
import { Info } from './info.js';
import { colorsFor } from './palette.js';
import { exportBarPng, triggerDownload } from './plot-export.js';

const Phase2 = (() => {
  const DIVISOR = 4;
  const MIN_EVAL = 2;
  const DRAFT_KEY = 'ahp-phase2-v4';
  const TIERS = ['A', 'B', 'C'];
  const INDICATOR_SET = 'real-14-v3';
  const MAX_CUSTOM = 5;
  const SKIPPED_NOTE = 'This criterion is marked as not applicable (“None of the above”). Uncheck it in the selection above to evaluate KPIs.';
  const TOO_FEW_NOTE = 'Select at least 2 indicators above (or mark this criterion as not applicable) to start comparisons.';

  let indicators = [];
  let customIndicators = [];
  let customCounter = 1;
  let criteria = []; // active criteria from Phase 1 [{id,name,...}]
  let criteriaWeights = []; // parallel array, sums to 1
  let current = 0; // index into criteria
  let state = {}; // criterionId -> {excluded,tiers,order,hub,target,answers,idx,choice,matrix,user,estimated,result}
  let onSubmit = null;
  let onSaveDraft = null;
  let chart = null;
  let lastExport = null; // { labels, values, colors, crText } for 3x PNG export

  function init(opts) {
    indicators = opts.indicators || [];
    criteria = opts.criteria || [];
    criteriaWeights = opts.criteriaWeights || [];
    Info.setup();
    Info.registerCriteria(criteria);
    Info.registerKpis(indicators);
    Info.register('phase2-na', 'What does N/A mean?', [
      'Marking a KPI as not applicable under a criterion means it cannot be meaningfully compared, not that it is the worst option.',
      'The final indicator score is averaged only over the criteria where it was evaluated.',
      'Toggling N/A keeps your other answers — only new comparisons are asked. Only "Restart this criterion" clears them.'
    ]);
    onSubmit = opts.onSubmit || null;
    onSaveDraft = opts.onSaveDraft || null;
    current = 0;
    state = {};
    customIndicators = [];
    customCounter = 1;
    criteria.forEach(c => { state[c.id] = freshCriterionState(defaultExclusions(c)); });
    attachOnce();
    buildTabs();
    loadDraft();
    renderAll();
  }

  function evalIds(cid) {
    const st = state[cid];
    const excluded = new Set((st && st.excluded) || []);
    return indicators.filter(k => !excluded.has(k.id)).map(k => k.id);
  }

  function freshCriterionState(excluded) {
    const ids = indicators.filter(k => !excluded.includes(k.id)).map(k => k.id);
    const tiers = {};
    ids.forEach(id => { tiers[id] = 'B'; });
    const st = {
      excluded: [...excluded],
      tiers,
      skipped: false,
      order: [], hub: null, target: 0,
      answers: {}, idx: 0, choice: null,
      matrix: [], user: [], estimated: [], result: null
    };
    resetAnswers(st, ids);
    return st;
  }

  // Default exclusions per criterion from data/criteria.json `defaultKpis`
  // (docs/kpi choices.txt). Suggested pre-selection only — respondents can
  // freely re-check/unchecked indicators. An empty defaultKpis list excludes
  // every indicator (respondent must pick at least 2 or mark the criterion
  // not applicable); criteria without the field (custom ones) start with
  // everything checked. Unknown ids are dropped and the >= 2 floor applies:
  // fewer than 2 valid defaults fall back to no exclusion.
  function defaultExclusions(c) {
    const all = indicators.map(k => k.id);
    if (!c || !Array.isArray(c.defaultKpis)) return [];
    if (c.defaultKpis.length === 0) return all;
    const valid = new Set(c.defaultKpis.filter(id => all.includes(id)));
    if (valid.size < MIN_EVAL) return [];
    return all.filter(id => !valid.has(id));
  }

  function resetAnswers(st, ids) {
    const built = Guided.generateOrder(ids, st.tiers, DIVISOR);
    // Canonical index space (Phase-1 idToIndex equivalent): every matrix
    // position, answer key and completion index maps pair ids through this
    // evaluated-KPI list. Never derive positions from question order — the
    // guided order is hub-first and would permute the matrix.
    st.ids = [...ids];
    st.order = built.order;
    st.hub = built.hub;
    st.target = built.target;
    st.answers = {};
    st.idx = 0;
    st.choice = null;
    const m = ids.length;
    st.matrix = Array(m).fill(null).map(() => Array(m).fill(1));
    st.user = Array(m).fill(null).map(() => Array(m).fill(false));
    st.estimated = Array(m).fill(null).map(() => Array(m).fill(false));
    st.result = null;
  }

  function posOf(ids, id) {
    return ids.indexOf(id);
  }

  // Tiers only steer order/suggestions: rebuild the guided order, keep every
  // answer (the id list is unchanged, so all positions stay valid), resume
  // at the first unanswered pair.
  function rebuildOrderKeepAnswers(st) {
    const built = Guided.generateOrder(st.ids, st.tiers, DIVISOR);
    st.order = built.order;
    st.hub = built.hub;
    st.target = built.target;
    st.choice = null;
    st.idx = firstUnansweredIndex(st);
  }

  // Index of the first guided pair without an answer (canonical pair keys).
  function firstUnansweredIndex(st) {
    const ans = st.answers || {};
    for (let k = 0; k < st.order.length; k++) {
      const [a, b] = st.order[k];
      const i = st.ids.indexOf(a), j = st.ids.indexOf(b);
      if (i < 0 || j < 0) return k;
      if (!ans[pairKey(Math.min(i, j), Math.max(i, j))]) return k;
    }
    return st.order.length;
  }

  // Grow a criterion state for one added KPI without clearing answers.
  // Append-only on st.ids: every existing canonical index (and therefore
  // every answer key and matrix cell) stays valid. New pairs involving the
  // added KPI are appended at the end of the guided order. Returns false
  // when extension does not apply (skipped tab) — caller falls back to
  // resetAnswers. Excluded (N/A) tabs are the caller's job: their id list
  // is unchanged, so there is nothing to extend.
  function extendForAddedKpi(st, newId) {
    if (!st || st.skipped || st.ids.includes(newId)) return false;
    st.ids.push(newId);
    const m = st.ids.length;
    st.matrix.forEach(row => row.push(1));
    st.matrix.push(Array(m).fill(1));
    st.user.forEach(row => row.push(false));
    st.user.push(Array(m).fill(false));
    st.estimated.forEach(row => row.push(false));
    st.estimated.push(Array(m).fill(false));
    const hub = (st.hub && st.ids.includes(st.hub)) ? st.hub : st.ids[0];
    const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const seen = new Set(st.order.map(([a, b]) => key(a, b)));
    const fresh = [];
    // hub === newId only when the criterion had zero evaluated KPIs (defaults
    // that pre-uncheck everything): a single KPI has no pair to ask yet.
    if (hub !== newId && !seen.has(key(hub, newId))) {
      fresh.push([hub, newId]);
      seen.add(key(hub, newId));
    }
    const tiers = st.tiers || {};
    const cands = st.ids
      .filter(id => id !== newId && id !== hub && !seen.has(key(id, newId)))
      .map(id => ({ id, d: Guided.pairDistance(tiers[id], tiers[newId]) }));
    cands.sort((x, y) => y.d - x.d);
    const target = Guided.targetCount(m, DIVISOR);
    for (const c of cands) {
      if (st.order.length + fresh.length >= target) break;
      fresh.push([c.id, newId]);
    }
    st.order = st.order.concat(fresh);
    st.hub = hub;
    st.target = target;
    st.choice = null;
    st.idx = firstUnansweredIndex(st);
    st.result = null; // honestly incomplete again until the new pairs are answered
    return true;
  }

  // Shrink a criterion state for one removed KPI without clearing the other
  // answers. Keeps every respondent judgment not involving the removed id
  // (re-keyed by position — never by blind index), drops only its pairs,
  // and rebuilds the guided order over the remaining ids. Old LLS estimates
  // are intentionally discarded: they were inferred with the removed KPI in
  // the system, so runCompletion recomputes them from the kept judgments.
  // Returns false when reduction does not apply — caller falls back to
  // resetAnswers. Needs no change when the id was never evaluated (true).
  function reduceForRemovedKpi(st, removedId) {
    if (!st || st.skipped) return false;
    const pos = st.ids.indexOf(removedId);
    if (pos < 0) return true;
    if (st.ids.length - 1 < MIN_EVAL) return false;
    const kept = [];
    for (const p of Object.values(st.answers || {})) {
      const a = st.ids[p.i], b = st.ids[p.j];
      if (a === removedId || b === removedId) continue;
      kept.push({ a, b, value: p.value }); // value is a-over-b by construction
    }
    st.ids = st.ids.filter(id => id !== removedId);
    const m = st.ids.length;
    st.matrix = Array(m).fill(null).map(() => Array(m).fill(1));
    st.user = Array(m).fill(null).map(() => Array(m).fill(false));
    st.estimated = Array(m).fill(null).map(() => Array(m).fill(false));
    st.answers = {};
    for (const { a, b, value } of kept) {
      recordKnown(st, st.ids, a, b, value);
    }
    rebuildOrderKeepAnswers(st);
    st.result = null; // recomputed by the caller when complete again
    return true;
  }

  function pairKey(i, j) {
    return i < j ? `${i}|${j}` : `${j}|${i}`;
  }

  function cur() {
    return criteria[current];
  }

  function curState() {
    const c = cur();
    return c ? state[c.id] : null;
  }

  function indicatorById(id) {
    return indicators.find(k => k.id === id);
  }

  // ---------- exclusion + tiers ----------
  function setExcluded(cid, id, exclude) {
    const st = state[cid];
    if (!st) return;
    const has = st.excluded.includes(id);
    let included;
    if (exclude && !has) {
      if (evalIds(cid).length <= MIN_EVAL) return; // floor: keep at least 2
      st.excluded.push(id);
      included = false;
    } else if (!exclude && has) {
      st.excluded = st.excluded.filter(x => x !== id);
      if (!st.tiers[id]) st.tiers[id] = 'B';
      included = true;
    } else {
      return;
    }
    const ids = evalIds(cid);
    // Preserve tiers of still-evaluated KPIs; default (re-)included to B.
    const next = {};
    ids.forEach(kid => { next[kid] = TIERS.includes(st.tiers[kid]) ? st.tiers[kid] : 'B'; });
    st.tiers = next;
    // Toggling never clears answers: including extends (only fresh pairs
    // asked), excluding shrinks (other judgments kept). Only the explicit
    // restart wipes a criterion.
    if (st.skipped) {
      resetAnswers(st, ids);
    } else if (included) {
      extendForAddedKpi(st, id);
    } else if (reduceForRemovedKpi(st, id)) {
      if (isCriterionComplete(st)) runCompletion(cid);
    } else {
      resetAnswers(st, ids);
    }
    renderAll();
    persistDraft();
  }

  function setTier(cid, id, tier, opts = {}) {
    const st = state[cid];
    if (!st || !TIERS.includes(tier)) return;
    if (!evalIds(cid).includes(id)) return;
    const board = document.getElementById('phase2-tier-board');
    const hadFocus = !!(board && board.contains(document.activeElement));
    st.tiers[id] = tier;
    rebuildOrderKeepAnswers(st);
    renderAll();
    persistDraft();
    if ((opts.focus !== false) && hadFocus && board) {
      const block = board.querySelector(`.tier-block[data-id="${cssEscape(id)}"]`);
      if (block) block.focus();
    }
  }

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // ---------- custom indicators (shared list, auto-N/A elsewhere) ----------
  function indicatorSetId() {
    return customIndicators.length ? `${INDICATOR_SET}-custom` : INDICATOR_SET;
  }

  function renderCustomKpiList() {
    const list = document.getElementById('custom-kpi-list');
    if (!list) return;
    list.innerHTML = customIndicators.map(k =>
      `<span class="custom-chip"><span>${escapeHtml(k.code)} ${escapeHtml(k.name)}</span><button type="button" data-remove-custom-kpi="${escapeHtml(k.id)}" aria-label="Remove ${escapeHtml(k.name)}">×</button></span>`
    ).join('');
  }

  function addCustomIndicator() {
    const input = document.getElementById('input-custom-kpi');
    if (!input) return;
    const name = input.value.trim().slice(0, 120);
    if (!name) return;
    if (customIndicators.length >= MAX_CUSTOM) {
      alert(`Maximum ${MAX_CUSTOM} additional indicators.`);
      return;
    }
    if (indicators.some(k => k.name.toLowerCase() === name.toLowerCase())) {
      alert('This indicator is already in the list.');
      return;
    }
    const c = cur();
    if (!c) return;
    const n = customCounter++;
    const k = { id: `custom_kpi_${n}`, code: `CX.${n}`, name, description: name };
    customIndicators.push(k);
    indicators.push(k);
    Info.registerKpis([k]);
    // Evaluated under the current criterion, pre-excluded (N/A) elsewhere so
    // matrix positions stay aligned across criteria. Adding never clears
    // answers: evaluated tabs are extended (only new pairs asked), excluded
    // tabs just track the new id as N/A. Removal / N/A toggles still restart.
    Object.entries(state).forEach(([cid, st]) => {
      if (cid !== c.id && !st.excluded.includes(k.id)) st.excluded.push(k.id);
      if (cid === c.id) st.tiers[k.id] = 'B';
      if (st.skipped || !evalIds(cid).includes(k.id)) {
        if (st.skipped) resetAnswers(st, evalIds(cid));
        return;
      }
      extendForAddedKpi(st, k.id);
    });
    input.value = '';
    renderCustomKpiList();
    renderAll();
    persistDraft();
  }

  function removeCustomIndicator(id) {
    customIndicators = customIndicators.filter(k => k.id !== id);
    indicators = indicators.filter(k => k.id !== id);
    // Like toggling: evaluated tabs shrink with other answers kept, tabs
    // where it was N/A are left fully untouched. Only explicit restart wipes.
    Object.entries(state).forEach(([cid, st]) => {
      st.excluded = st.excluded.filter(x => x !== id);
      if (st.tiers) delete st.tiers[id];
      if (st.skipped) {
        resetAnswers(st, evalIds(cid));
      } else if (!st.ids.includes(id)) {
        return; // N/A here: fully untouched
      } else if (reduceForRemovedKpi(st, id)) {
        if (isCriterionComplete(st)) runCompletion(cid);
      } else {
        resetAnswers(st, evalIds(cid));
      }
    });
    renderCustomKpiList();
    renderAll();
    persistDraft();
  }

  // ---------- guided per criterion ----------
  function knownPairs(st) {
    return Object.values(st.answers);
  }

  function isCriterionComplete(st) {
    if (!st || !st.order.length) return false;
    if (st.skipped) return true; // "None of the above": N/A counts as done
    return st.order.every(([a, b]) => {
      const i = st.ids.indexOf(a), j = st.ids.indexOf(b);
      if (i < 0 || j < 0) return false;
      return !!st.answers[pairKey(Math.min(i, j), Math.max(i, j))];
    });
  }

  function isAllComplete() {
    return criteria.length > 0 && criteria.every(c => {
      const st = state[c.id];
      return st && (st.skipped || (isCriterionComplete(st) && st.result));
    });
  }

  function recordKnown(st, ids, aId, bId, aOverB) {
    // Canonical placement via Guided.locatePair (single normalization):
    // value lands at matrix[row-of-a][col-of-b] with the mirror reciprocal.
    // E.g. G6.4-over-G1.2 = 7 -> 7 at row G6.4 x col G1.2 (lower triangle),
    // 1/7 at the upper mirror.
    const placed = Guided.locatePair(ids, aId, bId, aOverB);
    if (!placed) return;
    const ui = placed.i, uj = placed.j, v = placed.value;
    st.matrix[ui][uj] = v;
    st.matrix[uj][ui] = 1 / v;
    st.user[ui][uj] = true;
    st.user[uj][ui] = true;
    st.answers[pairKey(ui, uj)] = { i: ui, j: uj, value: v };
  }

  function runCompletion(critId) {
    const st = state[critId];
    const m = evalIds(critId).length;
    const known = knownPairs(st);
    if (!known.length) return false;
    let done;
    try {
      done = AHP.completeIncomplete(known, m);
    } catch (e) {
      console.warn('Phase2 completion failed:', e);
      return false;
    }
    st.matrix = done.matrix;
    st.user = Array(m).fill(null).map(() => Array(m).fill(false));
    known.forEach(p => { st.user[p.i][p.j] = true; st.user[p.j][p.i] = true; });
    st.estimated = done.estimated;
    try {
      st.result = AHP.calculateAll(st.matrix);
    } catch (e) {
      st.result = null;
    }
    return true;
  }

  function answerGuided(aOverB) {
    const c = cur(), st = curState();
    if (!c || !st) return;
    const pair = st.order[st.idx];
    if (!pair) return;
    recordKnown(st, st.ids, pair[0], pair[1], aOverB);
    st.choice = null;
    st.idx += 1;
    if (isCriterionComplete(st)) runCompletion(c.id);
    renderAll();
    persistDraft();
  }

  // ---------- rendering ----------
  function buildTabs() {
    const tabs = document.getElementById('phase2-tabs');
    if (!tabs) return;
    tabs.innerHTML = criteria.map((c, i) => {
      const st = state[c.id];
      const done = st && isCriterionComplete(st);
      const na = st && st.skipped ? ' (N/A)' : '';
      return `<button type="button" data-tab="${i}" class="${i === current ? 'on' : ''} ${done ? 'done' : ''}">${escapeHtml(c.name)}${na}${done && !st.skipped ? ' ✓' : ''}${Info.button(`crit:${c.id}`, c.name)}</button>`;
    }).join('');
  }

  function formatInputDisplay(val) {
    if (val >= 1) return String(Math.round(val));
    return `1/${Math.max(1, Math.round(1 / val))}`;
  }

  function renderAll() {
    buildTabs();
    renderChecklist();
    renderCustomKpiList();
    renderTierBoard();
    renderCriterionPanel();
    renderRanking();
    updateSubmitState();
  }

  function renderChecklist() {
    const box = document.getElementById('phase2-kpi-checklist');
    const c = cur(), st = curState();
    if (!box || !c || !st) return;
    const nEval = evalIds(c.id).length;
    box.innerHTML = indicators.map(k => {
      const checked = !st.excluded.includes(k.id);
      const locked = checked && nEval <= MIN_EVAL; // floor: cannot go below 2
      const dis = locked || st.skipped;
      return `<label class="criteria-check-item" title="${escapeHtml(k.code + ' — ' + k.description)}">` +
        `<input type="checkbox" data-kpi-id="${escapeHtml(k.id)}" ${checked ? 'checked' : ''} ${dis ? 'disabled' : ''}> ` +
        `<span>${escapeHtml(k.name)}${locked ? ' (min 2)' : ''}</span>${Info.button(`kpi:${k.id}`, k.name)}</label>`;
    }).join('');
    const skip = document.getElementById('phase2-skip');
    if (skip) skip.checked = !!st.skipped;
  }

  function renderTierBoard() {
    const c = cur(), st = curState();
    if (!c || !st) return;
    const ids = evalIds(c.id);
    TIERS.forEach(t => {
      const col = document.getElementById(`phase2-tier-col-${t}`);
      if (!col) return;
      const blocks = ids
        .filter(id => (st.tiers[id] || 'B') === t)
        .map(id => {
          const k = indicatorById(id);
          const btns = TIERS.map(x =>
            `<button type="button" data-move="${x}" data-id="${escapeHtml(id)}" class="${x === (st.tiers[id] || 'B') ? 'on' : ''}" aria-label="Move ${escapeHtml(k.name)} to tier ${x}">${x}</button>`
          ).join('');
          return `<div class="tier-block" draggable="true" tabindex="0" data-id="${escapeHtml(id)}" aria-label="${escapeHtml(k.name)}, tier ${st.tiers[id] || 'B'}. Arrow keys or A B C to move."><span class="tier-label">${escapeHtml(k.code)} ${escapeHtml(k.name)}${Info.button(`kpi:${k.id}`, k.name)}</span><span class="tier-btns">${btns}</span></div>`;
        }).join('');
      col.innerHTML = blocks || '<p class="tier-empty">—</p>';
    });
  }

  function renderCriterionPanel() {
    const c = cur(), st = curState();
    const progress = document.getElementById('phase2-progress');
    const barFill = document.getElementById('phase2-bar-fill');
    if (!c || !st) {
      if (progress) progress.textContent = 'No criteria available';
      return;
    }
    const ids = evalIds(c.id);
    const m = st.order.length;
    if (progress) progress.textContent = `Criterion ${current + 1} of ${criteria.length} — evaluating ${ids.length} of ${indicators.length} KPI`;
    if (barFill) barFill.style.width = `${m ? Math.round((Math.min(st.idx, m) / m) * 100) : 0}%`;

    renderGuidedCard();

    renderMatrix();
    renderCriterionCR();
    const prev = document.getElementById('phase2-prev');
    const next = document.getElementById('phase2-next');
    if (prev) prev.disabled = current <= 0;
    if (next) next.disabled = current >= criteria.length - 1;
  }

  // Guided question card only — never touches the matrix table, so it is
  // safe to call while the user is typing in a matrix cell (keeps focus).
  // Also toggles the matrix wrap: the table + its instructions appear only
  // once every guided question of this criterion is answered (or when the
  // criterion is marked N/A — then it renders empty). The CR display and
  // the Prev/Next/Restart navigation below stay visible throughout.
  function renderGuidedCard() {
    const c = cur(), st = curState();
    const card = document.getElementById('phase2-guided-card');
    const done = document.getElementById('phase2-done');
    const note = document.getElementById('phase2-skipped-note');
    const wrap = document.getElementById('phase2-matrix-wrap');
    if (!card || !done || !c || !st) return;
    if (wrap) wrap.classList.toggle('hidden', st.skipped || !isCriterionComplete(st));
    if (st.skipped) {
      card.classList.add('hidden');
      done.classList.add('hidden');
      if (note) {
        note.textContent = SKIPPED_NOTE;
        note.classList.remove('hidden');
      }
      return;
    }
    // Fewer than 2 evaluated KPIs (defaults may leave a criterion with none
    // selected): nothing to compare yet.
    if (evalIds(c.id).length < MIN_EVAL) {
      card.classList.add('hidden');
      done.classList.add('hidden');
      if (note) {
        note.textContent = TOO_FEW_NOTE;
        note.classList.remove('hidden');
      }
      return;
    }
    if (note) note.classList.add('hidden');
    const m = st.order.length;
    if (st.idx >= m) {
      card.classList.add('hidden');
      done.classList.remove('hidden');
    } else {
      done.classList.add('hidden');
      card.classList.remove('hidden');
      const pair = st.order[st.idx];
      const a = indicatorById(pair[0]);
      const b = indicatorById(pair[1]);
      document.getElementById('phase2-qtext').innerHTML =
        `Which KPI better measures <span class="crit-highlight"><strong>${escapeHtml(c.name)}</strong>${Info.button(`crit:${c.id}`, c.name)}</span>: <strong>${escapeHtml(a.name)}</strong> or <strong>${escapeHtml(b.name)}</strong>?`;
      document.getElementById('phase2-suggest').textContent =
        'Recommended scores are highlighted for ensuring consistency (non-binding).';
      const hintEl = document.getElementById('phase2-hint');
      const idx = st.ids;
      const implied = Guided.impliedValue(idx.indexOf(pair[0]), idx.indexOf(pair[1]), knownPairs(st), idx.length);
      hintEl.textContent = implied !== null
        ? `Based on your answers so far, ~${Guided.formatValue(implied)} would preserve consistency. Non-binding — your call.`
        : '';
      document.getElementById('phase2-yes').innerHTML = `<strong>${escapeHtml(a.name)}</strong> better`;
      document.getElementById('phase2-no').innerHTML = `<strong>${escapeHtml(b.name)}</strong> better`;
      renderScale();
    }
  }

  function renderScale() {
    const wrap = document.getElementById('phase2-scale-wrap');
    const scale = document.getElementById('phase2-scale');
    const label = document.getElementById('phase2-scale-label');
    const st = curState();
    if (!wrap || !scale || !st) return;
    scale.innerHTML = '';
    if (!st.choice || st.choice === 'Eq') {
      wrap.classList.add('hidden');
      return;
    }
    const pair = st.order[st.idx];
    if (!pair) { wrap.classList.add('hidden'); return; }
    const winner = st.choice === 'A' ? indicatorById(pair[0]) : indicatorById(pair[1]);
    if (label) label.textContent = `How much better does ${winner.name} measure this criterion? Highlighted = recommended from your tiers (non-binding).`;
    const dist = Guided.pairDistance(st.tiers[pair[0]], st.tiers[pair[1]]);
    const lo = dist === 0 ? 1 : dist === 1 ? 3 : 7;
    const hi = dist === 0 ? 3 : dist === 1 ? 5 : 9;
    for (let v = 2; v <= 9; v++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = String(v);
      btn.dataset.scale = String(v);
      if (v >= lo && v <= hi) {
        btn.classList.add('suggested');
        btn.title = 'Recommended from your tiers (non-binding)';
      }
      scale.appendChild(btn);
    }
    wrap.classList.remove('hidden');
  }

  function renderMatrix() {
    const c = cur(), st = curState();
    const thead = document.querySelector('#phase2-matrix thead tr');
    const tbody = document.querySelector('#phase2-matrix tbody');
    if (!thead || !tbody || !c || !st) return;
    if (st.skipped) {
      thead.innerHTML = '<th class="corner">KPI</th>';
      tbody.innerHTML = '';
      return;
    }
    const ids = evalIds(c.id);
    const m = ids.length;
    thead.innerHTML = '<th class="corner">KPI</th>' +
      ids.map(id => {
        const k = indicatorById(id);
        return `<th title="${escapeHtml(k.code + ' — ' + k.name)}"><span class="vhead-all">${escapeHtml(k.code)} ${escapeHtml(k.name)}</span>${Info.button(`kpi:${k.id}`, k.name)}</th>`;
      }).join('');
    tbody.innerHTML = ids.map((id, i) => {
      const k = indicatorById(id);
      const row = [`<th title="${escapeHtml(k.name)}">${escapeHtml(k.code)} ${escapeHtml(k.name)}${Info.button(`kpi:${k.id}`, k.name)}</th>`];
      for (let j = 0; j < m; j++) {
        if (i === j) {
          row.push('<td class="diagonal">1.00</td>');
        } else if (i < j) {
          // Provenance classes live on the TD (stylesheet selects td.upper.user
          // input). Show values for user answers, plus LLS estimates once the
          // guided set is complete (st.result set by runCompletion).
          const user = !!st.user[i][j];
          const show = !!st.answers[pairKey(i, j)] || !!st.result;
          const txt = show ? formatInputDisplay(st.matrix[i][j]) : '';
          const cls = !show ? '' : (user ? 'user' : 'estimated');
          row.push(`<td class="upper ${cls}"><input type="text" data-row="${i}" data-col="${j}" value="${txt}" placeholder="1–9 or 1/9" autocomplete="off" class="${cls}"></td>`);
        } else {
          const user = !!st.user[i][j];
          const show = user || !!st.result;
          const txt = show ? Number(st.matrix[i][j]).toFixed(2) : '1.00';
          const cls = show ? (user ? 'user' : 'estimated') : '';
          row.push(`<td class="lower ${cls}">${txt}</td>`);
        }
      }
      return `<tr>${row.join('')}</tr>`;
    }).join('');
    tbody.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', onMatrixInput);
      input.addEventListener('blur', onMatrixBlur);
    });
  }

  // Mirror cell in the lower triangle for pair (ui, uj), ui < uj.
  function updateLowerCell(ui, uj) {
    const st = curState();
    if (!st) return;
    const cell = document.querySelector(`#phase2-matrix tbody tr:nth-child(${uj + 1}) td:nth-child(${ui + 2})`);
    if (!cell) return;
    const user = !!st.user[uj][ui];
    const show = user || !!st.result;
    cell.textContent = show ? Number(st.matrix[uj][ui]).toFixed(2) : '1.00';
    cell.classList.remove('user', 'estimated');
    if (show) cell.classList.add(user ? 'user' : 'estimated');
  }

  // Record a manual matrix value WITHOUT rebuilding the table, so the
  // focused input survives every keystroke (fractions like 1/9 need several).
  function applyManualValue(row, col, val) {
    const c = cur(), st = curState();
    if (!c || !st) return;
    // Inputs live in the upper triangle: value entered = matrix[row][col].
    const ui = Math.min(row, col), uj = Math.max(row, col);
    const v = row <= col ? val : 1 / val;
    st.matrix[ui][uj] = v;
    st.matrix[uj][ui] = 1 / v;
    st.user[ui][uj] = true;
    st.user[uj][ui] = true;
    st.answers[pairKey(ui, uj)] = { i: ui, j: uj, value: v };
    updateLowerCell(ui, uj);
  }

  // Light refresh after manual edits: tabs, guided card, CR, ranking and
  // submit state. None of these rebuild the matrix table → focus is kept.
  function refreshAfterManualEdit() {
    buildTabs();
    renderGuidedCard();
    renderCriterionCR();
    renderRanking();
    updateSubmitState();
    persistDraft();
  }

  function onMatrixInput(e) {
    const c = cur(), st = curState();
    if (!c || !st) return;
    const input = e.target;
    const row = parseInt(input.dataset.row, 10);
    const col = parseInt(input.dataset.col, 10);
    const val = AHP.parseInput(input.value);
    if (val !== null && val >= 1 / 9 && val <= 9) {
      input.classList.remove('invalid');
      applyManualValue(row, col, val);
      const td = input.closest('td');
      if (td) {
        td.classList.remove('estimated');
        td.classList.add('user');
      }
      input.classList.remove('estimated');
      input.classList.add('user');
      if (isCriterionComplete(st)) {
        runCompletion(c.id);
        renderAll(); // estimates refilled; focus loss acceptable here
      } else {
        refreshAfterManualEdit();
      }
    } else {
      input.classList.add('invalid');
    }
  }

  function onMatrixBlur(e) {
    const c = cur(), st = curState();
    const input = e.target;
    const val = AHP.parseInput(input.value);
    if (val === null || val < 1 / 9 || val > 9) {
      // Cleared/invalid cell resets to Equal (1), same as Phase 1.
      const row = parseInt(input.dataset.row, 10);
      const col = parseInt(input.dataset.col, 10);
      if (c && st && Number.isInteger(row) && Number.isInteger(col)) {
        applyManualValue(row, col, 1);
        input.value = '';
        const td = input.closest('td');
        if (td) {
          td.classList.remove('estimated');
          td.classList.add('user');
        }
        input.classList.remove('estimated', 'invalid');
        input.classList.add('user');
        if (isCriterionComplete(st)) {
          runCompletion(c.id);
          renderAll();
        } else {
          refreshAfterManualEdit();
        }
      } else {
        input.value = '';
        input.classList.remove('invalid');
      }
    } else {
      input.value = formatInputDisplay(val);
    }
  }

  function renderCriterionCR() {
    const c = cur(), st = curState();
    const vEl = document.getElementById('phase2-cr-value');
    const sEl = document.getElementById('phase2-cr-status');
    const bar = document.getElementById('phase2-cr-bar-fill');
    if (!vEl || !sEl || !bar) return;
    if (st && st.skipped) {
      vEl.textContent = 'CR: —';
      vEl.className = 'cr-value';
      sEl.textContent = 'Marked as not applicable — excluded from the ranking.';
      bar.style.width = '0%';
      bar.className = 'cr-bar-fill';
      return;
    }
    const showBlank = () => {
      vEl.textContent = 'CR: —';
      vEl.className = 'cr-value';
      sEl.textContent = 'Answer the guided questions (or fill the matrix) to see consistency.';
      bar.style.width = '0%';
      bar.className = 'cr-bar-fill';
    };
    if (!st || !st.result) {
      // Live provisional CR from the current (possibly partial) answers.
      // Completes a copy only: estimates never leak into the visible matrix.
      let prov = null;
      if (c && st && knownPairs(st).length) {
        try {
          const m = evalIds(c.id).length;
          const done = AHP.completeIncomplete(knownPairs(st), m);
          prov = AHP.calculateAll(done.matrix);
        } catch (e) { prov = null; }
      }
      if (!prov) { showBlank(); return; }
      vEl.textContent = `CR: ${(prov.CR * 100).toFixed(1)}%`;
      vEl.className = `cr-value ${prov.consistent ? 'acceptable' : 'unacceptable'}`;
      sEl.textContent = prov.consistent
        ? '✓ Acceptable (CR ≤ 10%)'
        : '✗ Exceeds 10% — you can still continue (flagged for analysis)';
      bar.style.width = `${Math.min(100, (prov.CR / 0.2) * 100)}%`;
      bar.className = `cr-bar-fill ${prov.consistent ? '' : 'unacceptable'}`;
      return;
    }
    const cr = st.result.CR;
    vEl.textContent = `CR: ${(cr * 100).toFixed(1)}%`;
    vEl.className = `cr-value ${st.result.consistent ? 'acceptable' : 'unacceptable'}`;
    sEl.textContent = st.result.consistent
      ? '✓ Acceptable (CR ≤ 10%)'
      : '✗ Exceeds 10% — you can still continue (flagged for analysis)';
    bar.style.width = `${Math.min(100, (cr / 0.2) * 100)}%`;
    bar.className = `cr-bar-fill ${st.result.consistent ? '' : 'unacceptable'}`;
  }

  // ---------- global synthesis (NA-aware) ----------
  function scoresPerCriterion() {
    // Full indicator-length arrays with null = NA (excluded under that criterion).
    return criteria.map(c => {
      const st = state[c.id];
      const ids = evalIds(c.id);
      return indicators.map(k => {
        const p = ids.indexOf(k.id);
        if (p < 0 || !st || !st.result) return null;
        return st.result.weights[p];
      });
    });
  }

  function globalScores() {
    if (!criteria.length || !indicators.length) return null;
    // Live from the first completed criterion: incomplete criteria contribute
    // nulls, which the per-KPI renormalization averages out (same NA math).
    const anyDone = criteria.some(c => {
      const st = state[c.id];
      return st && st.result;
    });
    if (!anyDone) return null;
    try {
      return AHP.calculateGlobalPriorities(criteriaWeights, scoresPerCriterion());
    } catch (e) {
      return null;
    }
  }

  function renderRanking() {
    const tbody = document.getElementById('phase2-ranking-tbody');
    const empty = document.getElementById('phase2-ranking-empty');
    const wrap = document.getElementById('phase2-ranking-wrap');
    const crEl = document.getElementById('phase2-plot-cr');
    const g = globalScores();
    if (!tbody) return;
    if (!g) {
      if (empty) {
        empty.classList.remove('hidden');
        empty.textContent = 'Complete at least one criterion to see the ranking.';
      }
      if (wrap) wrap.classList.add('hidden');
      if (chart) { chart.destroy(); chart = null; }
      lastExport = null;
      setDownloadEnabled(false);
      return;
    }
    if (empty) empty.classList.add('hidden');
    if (wrap) wrap.classList.remove('hidden');
    lastExport = null;
    const rows = g.ranking.map(r => ({ ...r, kpi: indicators[r.index] }));
    const q = criteria.length;
    tbody.innerHTML = rows.map(r => r.scored
      ? `<tr><td>${r.rank}</td><td>${escapeHtml(r.kpi.name)} <span class="hint">${escapeHtml(r.kpi.code)}</span></td><td>${(r.score * 100).toFixed(1)}%</td><td>${r.evaluatedIn}/${q}</td></tr>`
      : `<tr><td>—</td><td>${escapeHtml(r.kpi.name)} <span class="hint">${escapeHtml(r.kpi.code)}</span></td><td>NA</td><td>0/${q} (not evaluated)</td></tr>`
    ).join('');
    const bad = criteria.filter(c => state[c.id] && state[c.id].result && !state[c.id].result.consistent).length;
    const crText = bad
      ? `${bad} of ${criteria.length} KPI matrices exceed CR 10% (flagged, submission still allowed).`
      : `All completed KPI matrices are consistent (CR ≤ 10%).`;
    if (crEl) crEl.textContent = crText;
    const canvas = document.getElementById('phase2-plot-canvas');
    if (canvas && typeof window !== 'undefined' && window.Chart) {
      if (chart) { chart.destroy(); chart = null; }
      const scored = rows.filter(r => r.scored);
      // One categorical colour per bar, assigned by global rank (rank 1 ->
      // PALETTE[0]), matching the Phase-1 plot convention.
      const barColors = colorsFor(scored.length);
      lastExport = {
        labels: scored.map(r => `${r.kpi.code} ${r.kpi.name}`),
        values: scored.map(r => Number((r.score * 100).toFixed(1))),
        colors: [...barColors],
        crText
      };
      chart = new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels: scored.map(r => `${r.kpi.code} ${r.kpi.name}`),
          datasets: [{ data: scored.map(r => Number((r.score * 100).toFixed(1))), backgroundColor: barColors, borderColor: barColors, borderWidth: 1, borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x.toFixed(1)}%` } } },
          scales: { x: { beginAtZero: true, ticks: { callback: v => `${v}%` } } }
        }
      });
      setDownloadEnabled(true);
    }
  }

  function setDownloadEnabled(enabled) {
    const btn = document.getElementById('btn-download-phase2-plot');
    if (btn) btn.disabled = !enabled;
  }

  // High-resolution PNG export: re-renders off-screen at 3x (axes, bars,
  // end-of-bar scores, CR footer; transparent background). Falls back to the
  // on-screen canvas snapshot when there is no stored render.
  function downloadRanking(filename = 'kpi-ranking.png') {
    try {
      if (lastExport) {
        const url = exportBarPng(lastExport);
        if (url) {
          triggerDownload(url, filename);
          return true;
        }
      }
      if (!chart) return false;
      triggerDownload(chart.toBase64Image('image/png', 1), filename);
      return true;
    } catch (e) {
      console.warn('Phase-2 PNG download failed:', e);
      return false;
    }
  }

  function updateSubmitState() {
    const btn = document.getElementById('btn-phase2-submit');
    if (!btn) return;
    const doneCount = criteria.filter(c => isCriterionComplete(state[c.id])).length;
    btn.disabled = !isAllComplete();
    btn.textContent = isAllComplete() ? 'Submit indicators grading' : `Submit indicators grading (${doneCount}/${criteria.length} criteria)`;
  }

  // ---------- events (attached once) ----------
  let attached = false;
  function attachOnce() {
    if (attached) return;
    attached = true;
    document.getElementById('phase2-tabs').addEventListener('click', e => {
      // Info buttons live inside the tab pills: let the overlay open without
      // switching tabs (the document-level Info handler serves the modal).
      if (e.target.closest && e.target.closest('button[data-info-key]')) return;
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      current = parseInt(btn.dataset.tab, 10);
      renderAll();
    });
    document.getElementById('phase2-kpi-checklist').addEventListener('change', e => {
      const cb = e.target.closest('input[data-kpi-id]');
      if (!cb || cb.disabled) return;
      const c = cur();
      if (!c) return;
      setExcluded(c.id, cb.dataset.kpiId, !cb.checked);
    });
    const skipBox = document.getElementById('phase2-skip');
    if (skipBox) skipBox.addEventListener('change', () => {
      const c = cur();
      if (!c) return;
      // "None of the above": flag only, answers underneath are preserved.
      state[c.id].skipped = skipBox.checked;
      renderAll();
      persistDraft();
    });
    const customInput = document.getElementById('input-custom-kpi');
    const customAdd = document.getElementById('btn-add-custom-kpi');
    if (customAdd) customAdd.addEventListener('click', addCustomIndicator);
    if (customInput) customInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addCustomIndicator(); }
    });
    const customList = document.getElementById('custom-kpi-list');
    if (customList) customList.addEventListener('click', e => {
      const btn = e.target.closest('button[data-remove-custom-kpi]');
      if (btn) removeCustomIndicator(btn.dataset.removeCustomKpi);
    });
    renderCustomKpiList();
    const board = document.getElementById('phase2-tier-board');
    board.addEventListener('click', e => {
      const btn = e.target.closest('button[data-move][data-id]');
      if (!btn || !TIERS.includes(btn.dataset.move)) return;
      const c = cur();
      if (!c) return;
      if (btn.dataset.move !== (curState().tiers[btn.dataset.id] || 'B')) {
        setTier(c.id, btn.dataset.id, btn.dataset.move);
      }
    });
    board.addEventListener('keydown', e => {
      const block = e.target.closest ? e.target.closest('.tier-block') : null;
      if (!block) return;
      const c = cur();
      if (!c) return;
      const id = block.dataset.id;
      const order = TIERS.indexOf(curState().tiers[id] || 'B');
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (order < TIERS.length - 1) setTier(c.id, id, TIERS[order + 1]);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (order > 0) setTier(c.id, id, TIERS[order - 1]);
      } else if (['a', 'b', 'c', 'A', 'B', 'C'].includes(e.key)) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        setTier(c.id, id, e.key.toUpperCase());
      }
    });
    // Drag-and-drop between tier columns (same interaction as Phase 1).
    // Delegated whole-column drop zones survive re-renders, empty columns included.
    board.addEventListener('dragstart', e => {
      const block = e.target.closest ? e.target.closest('.tier-block') : null;
      if (!block) return;
      try {
        e.dataTransfer.setData('text/plain', block.dataset.id);
      } catch (err) { /* noop */ }
      e.dataTransfer.effectAllowed = 'move';
    });
    board.addEventListener('dragend', () => {
      board.querySelectorAll('.drop-hint').forEach(el => el.classList.remove('drop-hint'));
    });
    board.addEventListener('dragover', e => {
      const col = e.target.closest ? e.target.closest('.tier-col') : null;
      if (!col) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.querySelector('.tier-blocks').classList.add('drop-hint');
    });
    board.addEventListener('dragleave', e => {
      const col = e.target.closest ? e.target.closest('.tier-col') : null;
      if (!col) return;
      if (!col.contains(e.relatedTarget)) {
        col.querySelector('.tier-blocks').classList.remove('drop-hint');
      }
    });
    board.addEventListener('drop', e => {
      const col = e.target.closest ? e.target.closest('.tier-col') : null;
      if (!col) return;
      e.preventDefault();
      col.querySelector('.tier-blocks').classList.remove('drop-hint');
      let id = '';
      try {
        id = e.dataTransfer.getData('text/plain');
      } catch (err) { /* noop */ }
      const c = cur();
      if (id && c) setTier(c.id, id, col.dataset.tier, { focus: false });
    });
    document.getElementById('phase2-yes').addEventListener('click', () => choose('A'));
    document.getElementById('phase2-no').addEventListener('click', () => choose('B'));
    document.getElementById('phase2-equal').addEventListener('click', () => answerGuided(1));
    document.getElementById('phase2-scale').addEventListener('click', e => {
      const btn = e.target.closest('button[data-scale]');
      if (!btn) return;
      const st = curState();
      const v = parseInt(btn.dataset.scale, 10);
      answerGuided(st.choice === 'A' ? v : 1 / v);
    });
    document.getElementById('phase2-back').addEventListener('click', () => {
      const st = curState();
      if (st && st.idx > 0) { st.idx -= 1; st.choice = null; renderAll(); }
    });
    document.getElementById('phase2-restart').addEventListener('click', restartCriterion);
    const restartDone = document.getElementById('phase2-restart-done');
    if (restartDone) restartDone.addEventListener('click', restartCriterion);
    const restartMatrix = document.getElementById('phase2-restart-matrix');
    if (restartMatrix) restartMatrix.addEventListener('click', restartCriterion);
    document.getElementById('phase2-prev').addEventListener('click', () => {
      if (current > 0) { current -= 1; renderAll(); }
    });
    document.getElementById('phase2-next').addEventListener('click', () => {
      if (current < criteria.length - 1) { current += 1; renderAll(); }
    });
    document.getElementById('btn-phase2-submit').addEventListener('click', handleSubmit);
    document.getElementById('btn-phase2-save').addEventListener('click', () => {
      persistDraft(true);
      if (onSaveDraft) onSaveDraft(getDraft());
    });
    const dlBtn = document.getElementById('btn-download-phase2-plot');
    if (dlBtn) dlBtn.addEventListener('click', () => downloadRanking());
  }

  function restartCriterion() {
    const c = cur();
    if (!c) return;
    resetAnswers(state[c.id], evalIds(c.id));
    renderAll();
    persistDraft();
  }

  function choose(dir) {
    const st = curState();
    if (!st) return;
    st.choice = dir;
    renderCriterionPanel();
  }

  function handleSubmit() {
    if (!isAllComplete()) {
      alert('Please complete all criteria (guided questions for each tab) before submitting indicators grading.');
      return;
    }
    if (onSubmit) onSubmit(buildPayload());
  }

  function buildPayload() {
    const g = globalScores();
    const options = {};
    criteria.forEach(c => {
      const st = state[c.id];
      const ids = evalIds(c.id);
      const excluded = indicators.filter(k => !ids.includes(k.id)).map(k => k.id);
      if (!st || st.skipped || !st.result) {
        options[c.id] = {
          skipped: !!(st && st.skipped),
          evaluatedIds: (st && st.skipped) ? [] : [...ids],
          excludedIds: (st && st.skipped) ? indicators.map(k => k.id) : excluded,
          tiers: {},
          matrix: null,
          weights: null,
          cr: null,
          consistent: null,
          pairwise: {
            order: st ? st.order.map(([a, b]) => [a, b]) : [],
            answers: [],
            estimated: []
          }
        };
        return;
      }
      const tiers = {};
      ids.forEach(id => { tiers[id] = st.tiers[id] || 'B'; });
      options[c.id] = {
        skipped: false,
        evaluatedIds: [...ids],
        excludedIds: excluded,
        tiers,
        matrix: st.matrix,
        weights: st.result.weights,
        cr: st.result.CR,
        consistent: st.result.consistent,
        pairwise: {
          order: st.order.map(([a, b]) => [a, b]),
          answers: knownPairs(st).map(p => {
            const oids = st.ids;
            return {
              a: oids[p.i],
              b: oids[p.j],
              value: p.value
            };
          }),
          estimated: st.estimated.map(r => [...r])
        }
      };
    });
    return {
      indicatorSet: indicatorSetId(),
      indicatorIds: indicators.map(k => k.id),
      customIndicators: customIndicators.map(k => ({ id: k.id, code: k.code, name: k.name })),
      criteriaIds: criteria.map(c => c.id),
      criteriaWeights: [...criteriaWeights],
      options,
      globalScores: g.ranking.map(r => ({
        indicatorId: indicators[r.index].id,
        code: indicators[r.index].code,
        score: r.score,
        rank: r.rank,
        scored: r.scored,
        evaluatedIn: r.evaluatedIn,
        weightBase: r.weightBase
      }))
    };
  }

  function getDraft() {
    const dump = {};
    Object.entries(state).forEach(([id, st]) => {
      const oids = st.ids;
      dump[id] = {
        excluded: [...st.excluded],
        tiers: { ...st.tiers },
        skipped: !!st.skipped,
        answers: knownPairs(st).map(p => ({ a: oids[p.i], b: oids[p.j], value: p.value })),
        idx: st.idx
      };
    });
    return {
      indicatorSet: indicatorSetId(),
      customIndicators: customIndicators.map(k => ({ ...k })),
      criteriaIds: criteria.map(c => c.id),
      current,
      state: dump
    };
  }

  function persistDraft(announce = false) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(getDraft()));
    } catch (e) { /* noop */ }
    if (announce) alert('Indicators grading draft saved locally in this browser');
  }

  function loadDraft() {
    try {
      localStorage.removeItem('ahp-phase2-v1'); // legacy shape without tiers/exclusion
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (!d || !d.state) return;
      if (Array.isArray(d.criteriaIds) && d.criteriaIds.join('|') !== criteria.map(c => c.id).join('|')) return;
      // Restore respondent-added indicators first: per-criterion state below
      // (exclusions, tiers, answers) references them by id.
      customIndicators = [];
      customCounter = 1;
      if (Array.isArray(d.customIndicators)) {
        d.customIndicators
          .filter(k => k && typeof k.name === 'string' && k.name.trim())
          .slice(0, MAX_CUSTOM)
          .forEach(k => {
            const name = k.name.trim().slice(0, 120);
            if (indicators.some(x => x.name.toLowerCase() === name.toLowerCase())) return;
            const id = (typeof k.id === 'string' && k.id) ? k.id : `custom_kpi_${customCounter}`;
            if (indicators.some(x => x.id === id)) return;
            const code = (typeof k.code === 'string' && k.code) ? k.code : `CX.${customCounter}`;
            const custom = { id, code, name, description: name };
            customIndicators.push(custom);
            indicators.push(custom);
          });
        customCounter = customIndicators.reduce((m, k) => {
          const n = parseInt(String(k.id).replace('custom_kpi_', ''), 10);
          return isFinite(n) ? Math.max(m, n + 1) : m;
        }, 1);
        if (customIndicators.length) Info.registerKpis(customIndicators);
      }
      Object.entries(d.state).forEach(([id, s]) => {
        if (!state[id] || !Array.isArray(s.excluded)) return;
        const validEx = s.excluded.filter(x => indicators.some(k => k.id === x));
        // NB: 0 evaluated KPIs is a legitimate state (criteria whose defaults
        // leave everything unchecked); the guided card shows the "select at
        // least 2" note until the respondent picks indicators or marks N/A.
        state[id].excluded = validEx;
        if (s.skipped === true) state[id].skipped = true;
        if (s.tiers && typeof s.tiers === 'object') {
          Object.entries(s.tiers).forEach(([kid, t]) => {
            if (TIERS.includes(t) && indicators.some(k => k.id === kid)) state[id].tiers[kid] = t;
          });
        }
        const ids = evalIds(id);
        // Keep tiers only for evaluated KPIs.
        const next = {};
        ids.forEach(kid => { next[kid] = TIERS.includes(state[id].tiers[kid]) ? state[id].tiers[kid] : 'B'; });
        state[id].tiers = next;
        resetAnswers(state[id], ids);
        if (Array.isArray(s.answers)) {
          s.answers.forEach(a => {
            const i = ids.indexOf(a.a), j = ids.indexOf(a.b);
            if (i < 0 || j < 0 || typeof a.value !== 'number') return;
            if (!isFinite(a.value) || a.value < 1 / 9 - 1e-9 || a.value > 9 + 1e-9) return;
            recordKnown(state[id], ids, a.a, a.b, i <= j ? a.value : 1 / a.value);
          });
        }
        if (Number.isInteger(s.idx)) state[id].idx = Math.max(0, Math.min(s.idx, state[id].order.length));
        if (isCriterionComplete(state[id])) runCompletion(id);
      });
      if (Number.isInteger(d.current)) current = Math.max(0, Math.min(d.current, criteria.length - 1));
    } catch (e) { /* noop */ }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem('ahp-phase2-v1');
    } catch (e) { /* noop */ }
  }

  function reset() {
    customIndicators = [];
    customCounter = 1;
    indicators = indicators.filter(k => k && !String(k.id || '').startsWith('custom_kpi_'));
    criteria.forEach(c => { state[c.id] = freshCriterionState(defaultExclusions(c)); });
    current = 0;
    if (chart) { chart.destroy(); chart = null; }
    lastExport = null;
    setDownloadEnabled(false);
    renderAll();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  return {
    init, isAllComplete, buildPayload, reset, clearDraft, downloadRanking,
    DIVISOR, MIN_EVAL,
    __test: { extendForAddedKpi, reduceForRemovedKpi, rebuildOrderKeepAnswers, firstUnansweredIndex, resetAnswers }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Phase2;
}

export { Phase2 };
