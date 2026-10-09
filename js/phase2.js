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

const Phase2 = (() => {
  const DIVISOR = 4;
  const MIN_EVAL = 2;
  const DRAFT_KEY = 'ahp-phase2-v4';
  const TIERS = ['A', 'B', 'C'];

  let indicators = [];
  let criteria = []; // active criteria from Phase 1 [{id,name,...}]
  let criteriaWeights = []; // parallel array, sums to 1
  let current = 0; // index into criteria
  let state = {}; // criterionId -> {excluded,tiers,order,hub,target,answers,idx,choice,matrix,user,estimated,result}
  let onSubmit = null;
  let onSaveDraft = null;
  let chart = null;

  function init(opts) {
    indicators = opts.indicators || [];
    criteria = opts.criteria || [];
    criteriaWeights = opts.criteriaWeights || [];
    Info.setup();
    Info.registerCriteria(criteria);
    Info.registerKpis(indicators);
    Info.register('phase2-na', 'What does N/A mean?', [
      'Marking a KPI as not applicable under a criterion means it cannot be meaningfully compared there — not that it is the worst option.',
      'An N/A KPI simply receives no score under that criterion: its final score is averaged only over the criteria where it was evaluated.'
    ]);
    onSubmit = opts.onSubmit || null;
    onSaveDraft = opts.onSaveDraft || null;
    current = 0;
    state = {};
    criteria.forEach(c => { state[c.id] = freshCriterionState([]); });
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
      order: [], hub: null, target: 0,
      answers: {}, idx: 0, choice: null,
      matrix: [], user: [], estimated: [], result: null
    };
    resetAnswers(st, ids);
    return st;
  }

  function resetAnswers(st, ids) {
    const built = Guided.generateOrder(ids, st.tiers, DIVISOR);
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
    if (exclude && !has) {
      if (evalIds(cid).length <= MIN_EVAL) return; // floor: keep at least 2
      st.excluded.push(id);
    } else if (!exclude && has) {
      st.excluded = st.excluded.filter(x => x !== id);
      if (!st.tiers[id]) st.tiers[id] = 'B';
    } else {
      return;
    }
    const ids = evalIds(cid);
    // Preserve tiers of still-evaluated KPIs; default (re-)included to B.
    const next = {};
    ids.forEach(kid => { next[kid] = TIERS.includes(st.tiers[kid]) ? st.tiers[kid] : 'B'; });
    st.tiers = next;
    resetAnswers(st, ids);
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
    // Tier changes invalidate order/suggestions: restart guided Q&A for this tab.
    resetAnswers(st, evalIds(cid));
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

  // ---------- guided per criterion ----------
  function knownPairs(st) {
    return Object.values(st.answers);
  }

  function isCriterionComplete(st) {
    if (!st || !st.order.length) return false;
    return st.order.every(([a, b]) => {
      const ids = orderIds(st);
      const i = ids.indexOf(a), j = ids.indexOf(b);
      if (i < 0 || j < 0) return false;
      return !!st.answers[pairKey(Math.min(i, j), Math.max(i, j))];
    });
  }

  function orderIds(st) {
    // ids snapshot the order was built from (evaluated at build time)
    const seen = [];
    st.order.forEach(([a, b]) => {
      if (!seen.includes(a)) seen.push(a);
      if (!seen.includes(b)) seen.push(b);
    });
    return seen;
  }

  function isAllComplete() {
    return criteria.length > 0 && criteria.every(c => {
      const st = state[c.id];
      return st && isCriterionComplete(st) && st.result;
    });
  }

  function recordKnown(st, ids, aId, bId, aOverB) {
    const i = ids.indexOf(aId), j = ids.indexOf(bId);
    if (i < 0 || j < 0) return;
    const row = i, col = j;
    const val = i <= j ? aOverB : 1 / aOverB;
    const ui = Math.min(row, col), uj = Math.max(row, col);
    const v = row <= col ? val : 1 / val;
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
    recordKnown(st, orderIds(st), pair[0], pair[1], aOverB);
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
      return `<button type="button" data-tab="${i}" class="${i === current ? 'on' : ''} ${done ? 'done' : ''}">${escapeHtml(c.name)}${done ? ' ✓' : ''}</button>`;
    }).join('');
  }

  function formatInputDisplay(val) {
    if (val >= 1) return String(Math.round(val));
    return `1/${Math.max(1, Math.round(1 / val))}`;
  }

  function renderAll() {
    buildTabs();
    renderChecklist();
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
      return `<label class="criteria-check-item" title="${escapeHtml(k.code + ' — ' + k.description)}">` +
        `<input type="checkbox" data-kpi-id="${escapeHtml(k.id)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}> ` +
        `<span>${escapeHtml(k.name)}${locked ? ' (min 2)' : ''}</span>${Info.button(`kpi:${k.id}`, k.name)}</label>`;
    }).join('');
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
    const title = document.getElementById('phase2-crit-title');
    const progress = document.getElementById('phase2-progress');
    const barFill = document.getElementById('phase2-bar-fill');
    if (!c || !st) {
      if (title) title.textContent = 'No criteria available';
      return;
    }
    const ids = evalIds(c.id);
    if (title) title.innerHTML = `${current + 1}. ${escapeHtml(c.name)} ${Info.button(`crit:${c.id}`, c.name)} — how well does each evaluated KPI measure this criterion?`;
    const m = st.order.length;
    if (progress) progress.textContent = `Criterion ${current + 1} of ${criteria.length} — evaluating ${ids.length} of ${indicators.length} KPIs — question ${Math.min(st.idx + 1, m)} of ${m}${st.hub ? ` — reference: ${nameOf(st.hub)}` : ''}`;
    if (barFill) barFill.style.width = `${m ? Math.round((Math.min(st.idx, m) / m) * 100) : 0}%`;

    renderGuidedCard();

    const legend = document.getElementById('phase2-legend');
    if (legend) {
      legend.innerHTML = ids.map(id => {
        const k = indicatorById(id);
        return `<span class="criteria-legend-item" title="${escapeHtml(k.code + ' — ' + k.description)}"><span class="criteria-legend-num">${escapeHtml(k.code)}</span>${escapeHtml(k.name)}${Info.button(`kpi:${k.id}`, k.name)}</span>`;
      }).join('');
    }
    renderMatrix();
    renderCriterionCR();
    const prev = document.getElementById('phase2-prev');
    const next = document.getElementById('phase2-next');
    if (prev) prev.disabled = current <= 0;
    if (next) next.disabled = current >= criteria.length - 1;
  }

  // Guided question card only — never touches the matrix table, so it is
  // safe to call while the user is typing in a matrix cell (keeps focus).
  function renderGuidedCard() {
    const c = cur(), st = curState();
    const card = document.getElementById('phase2-guided-card');
    const done = document.getElementById('phase2-done');
    if (!card || !done || !c || !st) return;
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
      const range = Guided.suggestedRange(st.tiers[pair[0]] || 'B', st.tiers[pair[1]] || 'B');
      document.getElementById('phase2-qtext').innerHTML =
        `Which KPI better measures <strong>${escapeHtml(c.name)}</strong>: <strong>${escapeHtml(a.name)}</strong> or <strong>${escapeHtml(b.name)}</strong>?`;
      document.getElementById('phase2-suggest').textContent =
        `Suggested range from tiers (${st.tiers[pair[0]] || 'B'} vs ${st.tiers[pair[1]] || 'B'}): ${range}. Equal = 1.`;
      const hintEl = document.getElementById('phase2-hint');
      const idx = orderIds(st);
      const implied = Guided.impliedValue(idx.indexOf(pair[0]), idx.indexOf(pair[1]), knownPairs(st), idx.length);
      hintEl.textContent = implied !== null
        ? `Based on your answers so far, ~${Guided.formatValue(implied)} would preserve consistency. Non-binding — your call.`
        : '';
      document.getElementById('phase2-yes').innerHTML = `<strong>${escapeHtml(a.name)}</strong> better`;
      document.getElementById('phase2-no').innerHTML = `<strong>${escapeHtml(b.name)}</strong> better`;
      renderScale();
    }
  }

  function nameOf(id) {
    const k = indicatorById(id);
    return k ? `${k.name} (${k.code})` : id;
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
    const ids = evalIds(c.id);
    const m = ids.length;
    thead.innerHTML = '<th class="corner">KPI</th>' +
      ids.map(id => {
        const k = indicatorById(id);
        return `<th title="${escapeHtml(k.code + ' — ' + k.name)}">${escapeHtml(k.code)}</th>`;
      }).join('');
    tbody.innerHTML = ids.map((id, i) => {
      const k = indicatorById(id);
      const row = [`<th title="${escapeHtml(k.name)}">${escapeHtml(k.code)} ${escapeHtml(k.name)}</th>`];
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
    const st = curState();
    const vEl = document.getElementById('phase2-cr-value');
    const sEl = document.getElementById('phase2-cr-status');
    const bar = document.getElementById('phase2-cr-bar-fill');
    if (!vEl || !sEl || !bar) return;
    if (!st || !st.result) {
      vEl.textContent = 'CR: —';
      vEl.className = 'cr-value';
      sEl.textContent = 'Answer the guided questions (or fill the matrix) to see consistency.';
      bar.style.width = '0%';
      bar.className = 'cr-bar-fill';
      return;
    }
    const cr = st.result.CR;
    vEl.textContent = `CR: ${cr.toFixed(4)}`;
    vEl.className = `cr-value ${st.result.consistent ? 'acceptable' : 'unacceptable'}`;
    sEl.textContent = st.result.consistent
      ? '✓ Acceptable (CR ≤ 0.10)'
      : '✗ Exceeds 0.10 — you can still continue (flagged for analysis)';
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
    for (const c of criteria) {
      const st = state[c.id];
      if (!st || !st.result) return null;
    }
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
        empty.textContent = 'Complete all criteria to see the final ranking.';
      }
      if (wrap) wrap.classList.add('hidden');
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    if (empty) empty.classList.add('hidden');
    if (wrap) wrap.classList.remove('hidden');
    const rows = g.ranking.map(r => ({ ...r, kpi: indicators[r.index] }));
    const q = criteria.length;
    tbody.innerHTML = rows.map(r => r.scored
      ? `<tr><td>${r.rank}</td><td>${escapeHtml(r.kpi.name)} <span class="hint">${escapeHtml(r.kpi.code)}</span></td><td>${(r.score * 100).toFixed(1)}%</td><td>${r.evaluatedIn}/${q}</td></tr>`
      : `<tr><td>—</td><td>${escapeHtml(r.kpi.name)} <span class="hint">${escapeHtml(r.kpi.code)}</span></td><td>NA</td><td>0/${q} (not evaluated)</td></tr>`
    ).join('');
    const bad = criteria.filter(c => state[c.id] && state[c.id].result && !state[c.id].result.consistent).length;
    if (crEl) crEl.textContent = bad
      ? `${bad} of ${criteria.length} KPI matrices exceed CR 0.10 (flagged, submission still allowed).`
      : `All completed KPI matrices are consistent (CR ≤ 0.10).`;
    const canvas = document.getElementById('phase2-plot-canvas');
    if (canvas && typeof window !== 'undefined' && window.Chart) {
      if (chart) { chart.destroy(); chart = null; }
      const scored = rows.filter(r => r.scored);
      chart = new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels: scored.map(r => `${r.kpi.code} ${r.kpi.name}`),
          datasets: [{ data: scored.map(r => Number((r.score * 100).toFixed(1))), backgroundColor: '#1a5c8a', borderRadius: 4 }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x.toFixed(1)}%` } } },
          scales: { x: { beginAtZero: true, ticks: { callback: v => `${v}%` } } }
        }
      });
    }
  }

  function updateSubmitState() {
    const btn = document.getElementById('btn-phase2-submit');
    if (!btn) return;
    const doneCount = criteria.filter(c => isCriterionComplete(state[c.id])).length;
    btn.disabled = !isAllComplete();
    btn.textContent = isAllComplete() ? 'Submit Phase 2' : `Submit Phase 2 (${doneCount}/${criteria.length} criteria)`;
  }

  // ---------- events (attached once) ----------
  let attached = false;
  function attachOnce() {
    if (attached) return;
    attached = true;
    document.getElementById('phase2-tabs').addEventListener('click', e => {
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
    document.getElementById('phase2-restart').addEventListener('click', () => {
      const c = cur();
      if (!c) return;
      resetAnswers(state[c.id], evalIds(c.id));
      renderAll();
      persistDraft();
    });
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
  }

  function choose(dir) {
    const st = curState();
    if (!st) return;
    st.choice = dir;
    renderCriterionPanel();
  }

  function handleSubmit() {
    if (!isAllComplete()) {
      alert('Please complete all criteria (guided questions for each tab) before submitting Phase 2.');
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
      const tiers = {};
      ids.forEach(id => { tiers[id] = st.tiers[id] || 'B'; });
      options[c.id] = {
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
            const oids = orderIds(st);
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
      indicatorSet: 'real-13-v1',
      indicatorIds: indicators.map(k => k.id),
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
      const oids = orderIds(st);
      dump[id] = {
        excluded: [...st.excluded],
        tiers: { ...st.tiers },
        answers: knownPairs(st).map(p => ({ a: oids[p.i], b: oids[p.j], value: p.value })),
        idx: st.idx
      };
    });
    return {
      indicatorSet: 'real-13-v1',
      criteriaIds: criteria.map(c => c.id),
      current,
      state: dump
    };
  }

  function persistDraft(announce = false) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(getDraft()));
    } catch (e) { /* noop */ }
    if (announce) alert('Phase-2 draft saved locally in this browser');
  }

  function loadDraft() {
    try {
      localStorage.removeItem('ahp-phase2-v1'); // legacy shape without tiers/exclusion
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (!d || !d.state) return;
      if (Array.isArray(d.criteriaIds) && d.criteriaIds.join('|') !== criteria.map(c => c.id).join('|')) return;
      Object.entries(d.state).forEach(([id, s]) => {
        if (!state[id] || !Array.isArray(s.excluded)) return;
        const validEx = s.excluded.filter(x => indicators.some(k => k.id === x));
        if (indicators.length - validEx.length < MIN_EVAL) return;
        state[id].excluded = validEx;
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
    criteria.forEach(c => { state[c.id] = freshCriterionState([]); });
    current = 0;
    if (chart) { chart.destroy(); chart = null; }
    renderAll();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  return {
    init, isAllComplete, buildPayload, reset, clearDraft,
    DIVISOR, MIN_EVAL
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Phase2;
}

export { Phase2 };
