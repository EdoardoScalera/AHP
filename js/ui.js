import { AHP } from './ahp-core.js';
import { Guided } from './guided.js';
import { Plot } from './plot.js';

const UI = (() => {
  const DRAFT_KEY = 'ahp-draft-v3';
  const MIN_N = 3;
  const MAX_N = 9;

  let allCriteria = [];
  let criteria = [];
  let excludedIds = [];
  let customCriteria = [];
  let customCounter = 1;
  let tiers = {};
  const TIERS = ['A', 'B', 'C'];
  let guidedOrder = [];
  let guidedHub = null;
  let guidedAnswers = {};
  let guidedIdx = 0;
  let guidedChoice = null;
  let guidedReviewIdx = -1;
  let userCells = [];
  let estimatedFlags = [];
  let matrix = [];
  let onMatrixChange = null;
  let onSubmit = null;
  let onSaveDraft = null;
  let onCriteriaChange = null;

  function init(criteriaData, callbacks) {
    allCriteria = criteriaData;
    onMatrixChange = callbacks.onMatrixChange;
    onSubmit = callbacks.onSubmit;
    onSaveDraft = callbacks.onSaveDraft;
    onCriteriaChange = callbacks.onCriteriaChange || null;

    buildCriteriaChecklist();
    rebuildFromCriteria(false);
    attachEventListeners();
    loadDraft();
  }

  function getActiveCriteria() {
    return criteria;
  }

  function getCriteriaMeta() {
    const activeIds = criteria.map(c => c.id);
    const hasCustom = customCriteria.length > 0;
    const isDefault7 = activeIds.length === 7 && !hasCustom && excludedIds.length === 0 &&
      activeIds.includes('practical_implementation');
    return {
      activeIds,
      excludedIds: [...excludedIds],
      custom: hasCustom ? { ...customCriteria[0] } : null,
      customCriteria: customCriteria.map(c => ({ ...c })),
      criteriaSet: hasCustom ? 'v3-custom' : (isDefault7 ? 'v3-7' : 'v3-subset')
    };
  }

  function renderCustomList() {
    const list = document.getElementById('custom-criteria-list');
    if (!list) return;
    list.innerHTML = customCriteria.map(c =>
      `<span class="custom-chip"><span>${escapeHtml(c.name)}</span><button type="button" data-remove-custom="${escapeHtml(c.id)}" aria-label="Remove ${escapeHtml(c.name)}">×</button></span>`
    ).join('');
  }

  function addCustomCriterion() {
    const input = document.getElementById('input-custom-criterion');
    if (!input) return;
    const name = input.value.trim().slice(0, 120);
    if (!name) return;
    if (criteria.length >= MAX_N) {
      alert(`Maximum ${MAX_N} active criteria. Uncheck one first to add another.`);
      return;
    }
    if (customCriteria.some(c => c.name.toLowerCase() === name.toLowerCase()) ||
        allCriteria.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      alert('This criterion is already in the list.');
      return;
    }
    customCriteria.push({ id: `custom_${customCounter++}`, name, shortName: name.slice(0, 24), description: name });
    input.value = '';
    renderCustomList();
    rebuildFromCriteria(true);
  }

  function removeCustomCriterion(id) {
    customCriteria = customCriteria.filter(c => c.id !== id);
    renderCustomList();
    rebuildFromCriteria(true);
  }

  function buildCriteriaChecklist() {
    const container = document.getElementById('criteria-checklist');
    if (!container) return;
    container.innerHTML = allCriteria.map(c =>
      `<label class="criteria-check-item"><input type="checkbox" data-criterion-id="${c.id}" checked> <span title="${escapeHtml(c.description)}">${escapeHtml(c.name)}</span></label>`
    ).join('');
  }

  function readCriteriaSelection() {
    const checked = new Set();
    document.querySelectorAll('#criteria-checklist input[type="checkbox"]').forEach(cb => {
      if (cb.checked) checked.add(cb.dataset.criterionId);
    });
    excludedIds = allCriteria.filter(c => !checked.has(c.id)).map(c => c.id);

    criteria = allCriteria.filter(c => checked.has(c.id));
    if (customCriteria.length) criteria = [...criteria, ...customCriteria];

    const countEl = document.getElementById('criteria-count');
    if (countEl) {
      countEl.textContent = `Active criteria: ${criteria.length} (minimum ${MIN_N}, maximum ${MAX_N})` +
        (criteria.length < MIN_N ? ' — please activate at least 3.' : '');
    }
  }

  function rebuildFromCriteria(notify = true) {
    readCriteriaSelection();
    // Preserve tiers for still-active criteria; default new ones to B (mid).
    const next = {};
    criteria.forEach(c => { next[c.id] = tiers[c.id] && TIERS.includes(tiers[c.id]) ? tiers[c.id] : 'B'; });
    tiers = next;
    buildMatrixTable();
    buildCriteriaLegend();
    renderTierBoard();
    updatePairSuggestions();
    Plot.clear();
    startGuided(false);
    const submitBtn = document.getElementById('btn-submit');
    if (submitBtn) submitBtn.disabled = criteria.length < MIN_N;
    if (criteria.length < MIN_N && onMatrixChange) onMatrixChange(null, { reason: 'too-few-criteria', n: criteria.length });
    if (notify && onCriteriaChange) onCriteriaChange(getActiveCriteria(), getCriteriaMeta());
  }

  function tierRank(t) { return t === 'A' ? 0 : t === 'C' ? 2 : 1; }

  function tierRangeLabel(t1, t2) {
    const d = Math.abs(tierRank(t1) - tierRank(t2));
    if (d === 0) return '1–3';
    if (d === 1) return '3–5';
    return '7–9';
  }

  function getTiers() { return { ...tiers }; }

  function setTier(id, tier, opts = {}) {
    if (!TIERS.includes(tier)) return;
    if (!criteria.some(c => c.id === id)) return;
    const board = document.getElementById('tier-board');
    const hadFocus = !!(board && board.contains(document.activeElement));
    tiers[id] = tier;
    renderTierBoard();
    updatePairSuggestions();
    // Tier changes invalidate hub/order: restart guided Q&A (answers cleared).
    guidedAnswers = {};
    guidedIdx = 0;
    guidedChoice = null;
    userCells = criteria.map(() => criteria.map(() => false));
    estimatedFlags = criteria.map(() => criteria.map(() => false));
    buildMatrixTableFresh();
    updateMatrixDisplay();
    Plot.clear();
    if (onMatrixChange) onMatrixChange(null);
    startGuided(false);
    if ((opts.focus !== false) && hadFocus) {
      const block = board.querySelector(`.tier-block[data-id="${cssEscape(id)}"]`);
      if (block) block.focus();
    }
  }

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function moveTier(id, dir) {
    const cur = tiers[id] || 'B';
    const i = TIERS.indexOf(cur);
    const n = Math.min(TIERS.length - 1, Math.max(0, i + dir));
    if (TIERS[n] !== cur) setTier(id, TIERS[n]);
  }

  function renderTierBoard() {
    const board = document.getElementById('tier-board');
    if (!board) return;
    TIERS.forEach(t => {
      const col = document.getElementById(`tier-col-${t}`);
      if (!col) return;
      const blocks = criteria
        .filter(c => (tiers[c.id] || 'B') === t)
        .map((c, idx) => {
          const num = criteria.indexOf(c) + 1;
          const btns = TIERS.map(x =>
            `<button type="button" data-move="${x}" data-id="${escapeHtml(c.id)}" class="${x === (tiers[c.id] || 'B') ? 'on' : ''}" aria-label="Move ${escapeHtml(displayName(c))} to tier ${x}">${x}</button>`
          ).join('');
          return `<div class="tier-block" draggable="true" tabindex="0" data-id="${escapeHtml(c.id)}" aria-label="${escapeHtml(displayName(c))}, tier ${tiers[c.id] || 'B'}. Arrow keys or A B C to move."><span class="tier-label">${num}. ${escapeHtml(displayName(c))}</span><span class="tier-btns">${btns}</span></div>`;
        }).join('');
      col.innerHTML = blocks || '<p class="tier-empty">—</p>';
    });
  }

  function updatePairSuggestions() {
    document.querySelectorAll('#matrix-table input[data-row][data-col]').forEach(input => {
      const i = parseInt(input.dataset.row, 10);
      const j = parseInt(input.dataset.col, 10);
      const a = criteria[i], b = criteria[j];
      if (!a || !b) return;
      const range = tierRangeLabel(tiers[a.id] || 'B', tiers[b.id] || 'B');
      input.placeholder = range;
      input.title = `${displayName(a)} (${tiers[a.id] || 'B'}) vs ${displayName(b)} (${tiers[b.id] || 'B'}) — suggested ${range}`;
    });
  }

  function buildCriteriaLegend() {
    const container = document.getElementById('criteria-legend');
    if (!container) return;
    container.innerHTML = criteria.map((c, i) =>
      `<span class="criteria-legend-item" title="${escapeHtml(c.name)}"><span class="criteria-legend-num">${i + 1}.</span>${escapeHtml(displayName(c))}</span>`
    ).join('');
  }

  function buildMatrixTable() {
    const n = criteria.length;
    matrix = Array(n).fill(null).map(() => Array(n).fill(1));
    userCells = Array(n).fill(null).map(() => Array(n).fill(false));
    estimatedFlags = Array(n).fill(null).map(() => Array(n).fill(false));

    const thead = document.querySelector('#matrix-table thead tr');
    if (thead) {
      thead.innerHTML = '<th class="corner">Criteria</th>' +
        criteria.map((c) => `<th title="${escapeHtml(c.name)}">${escapeHtml(displayName(c))}</th>`).join('');
    }

    const tbody = document.querySelector('#matrix-table tbody');
    if (!tbody) return;
    tbody.innerHTML = criteria.map((c, i) => {
      const row = [`<th title="${escapeHtml(c.name)}">${i + 1}. ${escapeHtml(displayName(c))}</th>`];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          row.push('<td class="diagonal">1.00</td>');
        } else if (i < j) {
          row.push(`<td class="upper"><input type="text" data-row="${i}" data-col="${j}" value="" placeholder="1–9 or 1/9" autocomplete="off"></td>`);
        } else {
          row.push('<td class="lower">1.00</td>');
        }
      }
      return `<tr>${row.join('')}</tr>`;
    }).join('');

    document.querySelectorAll('#matrix-table input').forEach(input => {
      input.addEventListener('input', handleMatrixInput);
      input.addEventListener('blur', handleMatrixBlur);
    });
  }

  function attachEventListeners() {
    document.querySelectorAll('#criteria-checklist input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => rebuildFromCriteria(true));
    });
    const customInput = document.getElementById('input-custom-criterion');
    const addBtn = document.getElementById('btn-add-custom');
    if (addBtn) {
      addBtn.addEventListener('click', addCustomCriterion);
    }
    if (customInput) {
      customInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); addCustomCriterion(); }
      });
    }
    const customList = document.getElementById('custom-criteria-list');
    if (customList) {
      customList.addEventListener('click', e => {
        const btn = e.target.closest('button[data-remove-custom]');
        if (btn) removeCustomCriterion(btn.dataset.removeCustom);
      });
    }
    renderCustomList();

    document.querySelectorAll('input[name="renovation"]').forEach(r => {
      r.addEventListener('change', toggleRenovationDetails);
    });
    toggleRenovationDetails();

    const board = document.getElementById('tier-board');
    if (board) {
      board.addEventListener('click', e => {
        const btn = e.target.closest('button[data-move][data-id]');
        if (btn) setTier(btn.dataset.id, btn.dataset.move);
      });
      // Keyboard: arrows move between tiers, A/B/C keys jump directly.
      board.addEventListener('keydown', e => {
        const block = e.target.closest ? e.target.closest('.tier-block') : null;
        if (!block) return;
        const id = block.dataset.id;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          moveTier(id, 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          moveTier(id, -1);
        } else if (e.key === 'a' || e.key === 'A' || e.key === 'b' || e.key === 'B' || e.key === 'c' || e.key === 'C') {
          const t = e.key.toUpperCase();
          // Ignore when typing in an input; buttons handle Enter/Space natively.
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
          e.preventDefault();
          setTier(id, t);
        }
      });
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
      // Delegated whole-column drop zones (survive re-renders; empty columns included).
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
        // Only clear when truly leaving the column.
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
        if (id) setTier(id, col.dataset.tier, { focus: false });
      });
    }

    document.getElementById('btn-submit').addEventListener('click', handleSubmit);
    document.getElementById('guided-yes').addEventListener('click', () => chooseGuided('A'));
    document.getElementById('guided-no').addEventListener('click', () => chooseGuided('B'));
    document.getElementById('guided-equal').addEventListener('click', () => chooseGuided('Eq'));
    document.getElementById('guided-scale').addEventListener('click', e => {
      const btn = e.target.closest('button[data-scale]');
      if (btn) selectGuidedScale(parseInt(btn.dataset.scale, 10));
    });
    document.getElementById('guided-back').addEventListener('click', guidedBack);
    document.getElementById('guided-review').addEventListener('click', enterGuidedReview);
    document.getElementById('guided-restart').addEventListener('click', guidedRestart);
    document.getElementById('guided-review-prev').addEventListener('click', () => {
      guidedReviewIdx = Math.max(0, guidedReviewIdx - 1);
      renderGuidedReview();
    });
    document.getElementById('guided-review-next').addEventListener('click', () => {
      guidedReviewIdx = Math.min(guidedOrder.length - 1, guidedReviewIdx + 1);
      renderGuidedReview();
    });
    document.getElementById('guided-review-exit').addEventListener('click', exitGuidedReview);
    document.getElementById('btn-save-draft').addEventListener('click', handleSaveDraft);
    document.getElementById('survey-form').addEventListener('submit', e => e.preventDefault());
    document.getElementById('btn-new-response').addEventListener('click', resetForm);
    document.getElementById('btn-retry').addEventListener('click', () => showScreen('survey-screen'));
  }

  function toggleRenovationDetails() {
    const yes = document.getElementById('input-renovation-yes');
    const group = document.getElementById('renovation-details-group');
    if (!group) return;
    group.classList.toggle('hidden', !(yes && yes.checked));
  }

  function handleMatrixInput(e) {
    const row = parseInt(e.target.dataset.row, 10);
    const col = parseInt(e.target.dataset.col, 10);
    const val = AHP.parseInput(e.target.value);

    if (val !== null && val >= 1/9 && val <= 9) {
      e.target.classList.remove('invalid');
      e.target.classList.add('valid');
      updateMatrix(row, col, val);
    } else {
      e.target.classList.remove('valid');
      e.target.classList.add('invalid');
    }
  }

  function handleMatrixBlur(e) {
    const row = parseInt(e.target.dataset.row, 10);
    const col = parseInt(e.target.dataset.col, 10);
    const val = AHP.parseInput(e.target.value);

    if (val === null || val < 1/9 || val > 9) {
      e.target.value = '';
      e.target.classList.remove('valid', 'invalid');
      updateMatrix(row, col, 1);
    } else {
      e.target.value = formatInputDisplay(val);
    }
  }

  function formatInputDisplay(val) {
    if (val >= 1) return String(Math.round(val));
    const den = Math.round(1 / val);
    return `1/${den}`;
  }

  function pairKey(i, j) {
    return i < j ? `${i}|${j}` : `${j}|${i}`;
  }

  function idToIndex(id) {
    return criteria.findIndex(c => c.id === id);
  }

  function guidedKnownPairs() {
    return Object.values(guidedAnswers);
  }

  function guidedIsComplete() {
    if (!guidedOrder.length || criteria.length < MIN_N) return false;
    return guidedOrder.every(([a, b]) => {
      const i = idToIndex(a), j = idToIndex(b);
      if (i < 0 || j < 0) return false;
      return !!guidedAnswers[pairKey(i, j)];
    });
  }

  function recordKnown(row, col, val) {
    matrix[row][col] = val;
    matrix[col][row] = 1 / val;
    userCells[row][col] = true;
    userCells[col][row] = true;
    const ui = Math.min(row, col), uj = Math.max(row, col);
    guidedAnswers[pairKey(ui, uj)] = { i: ui, j: uj, value: matrix[ui][uj] };
  }

  function startGuided(keepAnswers = false) {
    const ids = criteria.map(c => c.id);
    const built = Guided.generateOrder(ids, tiers);
    guidedOrder = built.order;
    guidedHub = built.hub;
    guidedChoice = null;
    guidedReviewIdx = -1;
    if (!keepAnswers) {
      guidedAnswers = {};
      guidedIdx = 0;
    } else {
      guidedIdx = Math.min(guidedIdx, guidedOrder.length);
    }
    renderGuided();
  }

  function runCompletion() {
    const n = criteria.length;
    const known = guidedKnownPairs();
    if (!known.length) return false;
    let done;
    try {
      done = AHP.completeIncomplete(known, n);
    } catch (e) {
      console.warn('Completion failed:', e);
      return false;
    }
    matrix = done.matrix;
    userCells = Array(n).fill(null).map(() => Array(n).fill(false));
    known.forEach(p => { userCells[p.i][p.j] = true; userCells[p.j][p.i] = true; });
    estimatedFlags = done.estimated;
    updateMatrixDisplay();
    renderPlot();
    if (onMatrixChange) onMatrixChange(matrix);
    return true;
  }

  function renderPlot() {
    try {
      const full = AHP.calculateAll(matrix);
      Plot.render(
        criteria.map(displayName),
        full.weights,
        full.CR,
        full.consistent
      );
    } catch (e) {
      console.warn('Plot render failed:', e);
      Plot.clear();
    }
  }

  function updateMatrixDisplay() {
    const n = criteria.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i >= j) continue;
        const input = document.querySelector(`#matrix-table input[data-row="${i}"][data-col="${j}"]`);
        const lowerCell = document.querySelector(`#matrix-table tbody tr:nth-child(${j + 1}) td:nth-child(${i + 2})`);
        const upperTd = input ? input.closest('td') : null;
        const user = !!(userCells[i] && userCells[i][j]);
        const txt = formatInputDisplay(matrix[i][j]);
        if (input) {
          input.value = txt;
          input.classList.remove('valid', 'invalid', 'user', 'estimated');
          input.classList.add(user ? 'user' : 'estimated');
        }
        if (upperTd) {
          upperTd.classList.remove('user', 'estimated');
          upperTd.classList.add(user ? 'user' : 'estimated');
        }
        if (lowerCell) {
          lowerCell.textContent = Number(matrix[j][i]).toFixed(2);
          lowerCell.classList.remove('user', 'estimated');
          lowerCell.classList.add(user ? 'user' : 'estimated');
        }
      }
    }
  }

  function guidedPairAt(idx) {
    const pair = guidedOrder[idx];
    if (!pair) return null;
    const i = idToIndex(pair[0]), j = idToIndex(pair[1]);
    if (i < 0 || j < 0) return null;
    return { a: criteria[i], b: criteria[j], i, j };
  }

  function renderGuided() {
    const section = document.getElementById('guided-section');
    const progress = document.getElementById('guided-progress');
    const barFill = document.getElementById('guided-bar-fill');
    const card = document.getElementById('guided-card');
    const done = document.getElementById('guided-done');
    const pane = document.getElementById('guided-review-pane');
    if (!section || !progress || !card || !done) return;
    if (pane) pane.classList.add('hidden');
    guidedReviewIdx = -1;

    if (criteria.length < MIN_N) {
      progress.textContent = `Activate at least ${MIN_N} criteria to start guided comparisons.`;
      if (barFill) barFill.style.width = '0%';
      card.classList.add('hidden');
      done.classList.add('hidden');
      return;
    }
    if (!guidedOrder.length) startGuided(false);
    const m = guidedOrder.length;
    const pct = m ? Math.round((Math.min(guidedIdx, m) / m) * 100) : 0;
    if (barFill) barFill.style.width = `${pct}%`;

    if (guidedIdx >= m) {
      progress.textContent = `All ${m} guided comparisons answered — review the matrix below.`;
      card.classList.add('hidden');
      done.classList.remove('hidden');
      return;
    }
    done.classList.add('hidden');
    card.classList.remove('hidden');
    progress.textContent = `Question ${guidedIdx + 1} of ${m}${guidedHub ? ` — reference: ${nameOf(guidedHub)}` : ''}`;

    const p = guidedPairAt(guidedIdx);
    if (!p) return;
    const range = Guided.suggestedRange(tiers[p.a.id] || 'B', tiers[p.b.id] || 'B');
    document.getElementById('guided-qtext').innerHTML =
      `Do you find <strong>${escapeHtml(p.a.name)}</strong> more important than <strong>${escapeHtml(p.b.name)}</strong>?`;
    document.getElementById('guided-suggest').textContent =
      `Suggested range from tiers (${tiers[p.a.id] || 'B'} vs ${tiers[p.b.id] || 'B'}): ${range}. Equal importance = 1.`;

    const hintEl = document.getElementById('guided-hint');
    const implied = Guided.impliedValue(p.i, p.j, guidedKnownPairs(), criteria.length);
    if (implied !== null) {
      const band = Guided.suggestedRange(tiers[p.a.id] || 'B', tiers[p.b.id] || 'B');
      hintEl.textContent =
        `Based on your answers so far, ~${Guided.formatValue(implied)} (band ${band}) would preserve consistency. Non-binding — your call.`;
    } else {
      hintEl.textContent = '';
    }

    const yesBtn = document.getElementById('guided-yes');
    const noBtn = document.getElementById('guided-no');
    yesBtn.innerHTML = `<strong>${escapeHtml(displayName(p.a))}</strong> more important`;
    noBtn.innerHTML = `<strong>${escapeHtml(displayName(p.b))}</strong> more important`;
    renderGuidedScale();
  }

  function nameOf(id) {
    const c = criteria.find(x => x.id === id);
    return c ? displayName(c) : id;
  }

  function renderGuidedScale() {
    const wrap = document.getElementById('guided-scale-wrap');
    const label = document.getElementById('guided-scale-label');
    const scale = document.getElementById('guided-scale');
    if (!wrap || !scale) return;
    scale.innerHTML = '';
    if (!guidedChoice || guidedChoice === 'Eq') {
      wrap.classList.add('hidden');
      return;
    }
    const p = guidedPairAt(guidedIdx);
    if (!p) { wrap.classList.add('hidden'); return; }
    const winner = guidedChoice === 'A' ? p.a : p.b;
    label.textContent = `How much more important is ${displayName(winner)}? Highlighted = recommended from your tiers (non-binding). (stored as ${guidedChoice === 'A' ? 'A over B' : 'reciprocal, B over A'})`;
    // Yellow-highlight the tier-recommended magnitudes (non-binding).
    const dist = Guided.pairDistance(tiers[p.a.id], tiers[p.b.id]);
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

  function chooseGuided(dir) {
    if (dir === 'Eq') {
      answerGuided(1);
      return;
    }
    guidedChoice = dir;
    renderGuidedScale();
  }

  function selectGuidedScale(v) {
    const p = guidedPairAt(guidedIdx);
    if (!p || !guidedChoice || guidedChoice === 'Eq') return;
    const val = guidedChoice === 'A' ? v : 1 / v;
    answerGuided(val);
  }

  function answerGuided(aOverB) {
    const p = guidedPairAt(guidedIdx);
    if (!p) return;
    recordKnown(p.i, p.j, aOverB);
    guidedChoice = null;
    guidedIdx += 1;
    if (guidedIsComplete()) {
      runCompletion();
    } else {
      updateMatrixDisplay();
      Plot.clear();
      if (onMatrixChange) onMatrixChange(null);
    }
    renderGuided();
  }

  function guidedBack() {
    if (guidedIdx <= 0) return;
    guidedIdx -= 1;
    guidedChoice = null;
    renderGuided();
  }

  function guidedRestart() {
    guidedAnswers = {};
    guidedIdx = 0;
    guidedChoice = null;
    userCells = criteria.map(() => criteria.map(() => false));
    estimatedFlags = criteria.map(() => criteria.map(() => false));
    buildMatrixTableFresh();
    updateMatrixDisplay();
    Plot.clear();
    if (onMatrixChange) onMatrixChange(null);
    renderGuided();
  }

  function enterGuidedReview() {
    if (!guidedIsComplete()) return;
    guidedReviewIdx = 0;
    document.getElementById('guided-card').classList.add('hidden');
    document.getElementById('guided-done').classList.add('hidden');
    document.getElementById('guided-review-pane').classList.remove('hidden');
    renderGuidedReview();
  }

  function renderGuidedReview() {
    const text = document.getElementById('guided-review-text');
    if (!text) return;
    const m = guidedOrder.length;
    const k = Math.max(0, Math.min(guidedReviewIdx, m - 1));
    guidedReviewIdx = k;
    const [aId, bId] = guidedOrder[k];
    const i = idToIndex(aId), j = idToIndex(bId);
    const a = criteria[i], b = criteria[j];
    const ans = guidedAnswers[pairKey(i, j)];
    const v = ans ? (i <= j ? ans.value : 1 / ans.value) : 1;
    let verdict;
    if (Math.abs(v - 1) < 1e-9) {
      verdict = 'Equal importance (1)';
    } else if (v > 1) {
      verdict = `${displayName(a)} more important — ${Guided.formatValue(v)}`;
    } else {
      verdict = `${displayName(b)} more important — ${Guided.formatValue(1 / v)}`;
    }
    text.innerHTML =
      `<strong>Question ${k + 1} of ${m}:</strong> ${escapeHtml(a.name)} vs ${escapeHtml(b.name)}<br>Your answer: <strong>${escapeHtml(verdict)}</strong>`;
    document.getElementById('guided-review-prev').disabled = k <= 0;
    document.getElementById('guided-review-next').disabled = k >= m - 1;
  }

  function exitGuidedReview() {
    guidedReviewIdx = -1;
    renderGuided();
  }

  function buildMatrixTableFresh() {
    const n = criteria.length;
    matrix = Array(n).fill(null).map(() => Array(n).fill(1));
  }

  function updateMatrix(row, col, val) {
    recordKnown(row, col, val);
    if (guidedIsComplete()) {
      runCompletion();
    } else {
      updateMatrixDisplay();
      Plot.clear();
      if (onMatrixChange) {
        onMatrixChange(null);
      }
    }
    renderGuided();
  }

  function updateCRDisplay(result) {
    const crValue = document.getElementById('cr-value');
    const crStatus = document.getElementById('cr-status');
    const crBarFill = document.getElementById('cr-bar-fill');
    const submitBtn = document.getElementById('btn-submit');
    if (!crValue || !crStatus || !crBarFill || !submitBtn) return;

    if (result === null) {
      crValue.textContent = 'CR: —';
      crValue.className = 'cr-value';
      if (criteria.length < MIN_N) {
        crStatus.textContent = `Activate at least ${MIN_N} criteria to compute consistency.`;
        submitBtn.disabled = true;
      } else {
        crStatus.textContent = 'Complete the matrix to see consistency ratio';
      }
      crBarFill.style.width = '0%';
      crBarFill.className = 'cr-bar-fill';
      return;
    }

    const cr = result.CR;
    const percent = Math.min(100, (cr / 0.2) * 100);

    crValue.textContent = `CR: ${cr.toFixed(4)}`;
    crValue.className = `cr-value ${result.consistent ? 'acceptable' : 'unacceptable'}`;
    // Warn-but-allow: never disable submit for CR>0.10 (frozen decision).
    crStatus.textContent = result.consistent
      ? '✓ Consistency is acceptable (CR ≤ 0.10)'
      : '✗ CR exceeds 0.10 — consider revising, but you can still submit (flagged for analysis)';
    crBarFill.style.width = `${percent}%`;
    crBarFill.className = `cr-bar-fill ${result.consistent ? '' : 'unacceptable'}`;
    submitBtn.disabled = criteria.length < MIN_N;
  }

  function handleSubmit() {
    if (criteria.length < MIN_N) {
      alert(`Please activate at least ${MIN_N} criteria.`);
      return;
    }
    if (!guidedIsComplete()) {
      const answered = Object.keys(guidedAnswers).length;
      alert(`Please answer all guided comparisons (${answered} of ${guidedOrder.length}). Manual matrix entries count too.`);
      return;
    }
    const identity = getIdentity();
    if (!validateIdentity(identity)) return;

    const missingEl = document.getElementById('input-missing');
    const missingCriteria = missingEl ? missingEl.value.trim() : '';
    const result = AHP.calculateAll(matrix);
    const meta = getCriteriaMeta();

    if (onSubmit) {
      onSubmit({
        ...identity,
        criteria: meta,
        tiers: getTiers(),
        pairwise: getPairwisePayload(),
        matrix,
        weights: result.weights,
        cr: result.CR,
        consistent: result.consistent,
        missingCriteria
      });
    }
  }

  function getPairwisePayload() {
    return {
      order: guidedOrder.map(([a, b]) => [a, b]),
      answers: guidedKnownPairs().map(p => ({
        a: criteria[p.i] ? criteria[p.i].id : null,
        b: criteria[p.j] ? criteria[p.j].id : null,
        value: p.value
      })).filter(a => a.a && a.b),
      estimated: estimatedFlags.map(row => [...row])
    };
  }

  function handleSaveDraft() {
    const identity = getIdentity();
    const missingEl = document.getElementById('input-missing');
    const missingCriteria = missingEl ? missingEl.value.trim() : '';

    if (onSaveDraft) {
      onSaveDraft({
        identity,
        criteria: getCriteriaMeta(),
        tiers: getTiers(),
        guided: {
          answers: guidedKnownPairs(),
          idx: guidedIdx
        },
        matrix,
        missingCriteria
      });
    }
  }

  function getIdentity() {
    const consentEl = document.getElementById('input-consent');
    const yesEl = document.getElementById('input-renovation-yes');
    const noEl = document.getElementById('input-renovation-no');
    const detailsEl = document.getElementById('input-renovation-details');
    let renovationUnderConsideration = null;
    if (yesEl && yesEl.checked) renovationUnderConsideration = true;
    else if (noEl && noEl.checked) renovationUnderConsideration = false;
    return {
      name: document.getElementById('input-name').value.trim(),
      role: document.getElementById('input-role').value.trim(),
      pilot: document.getElementById('input-pilot').value.trim(),
      country: document.getElementById('input-country').value.trim(),
      email: document.getElementById('input-email') ? document.getElementById('input-email').value.trim() : '',
      consent: consentEl ? consentEl.checked : false,
      renovationUnderConsideration,
      renovationDetails: detailsEl ? detailsEl.value.trim().slice(0, 2000) : ''
    };
  }

  function validateIdentity(identity) {
    const required = ['name', 'role', 'pilot', 'country'];
    for (const field of required) {
      if (!identity[field]) {
        alert(`Please fill in: ${field.charAt(0).toUpperCase() + field.slice(1)}`);
        document.getElementById(`input-${field}`).focus();
        return false;
      }
    }
    if (identity.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email)) {
      alert('Please provide a valid email address or leave it empty.');
      document.getElementById('input-email').focus();
      return false;
    }
    if (identity.renovationUnderConsideration === null) {
      alert('Please answer: Is a renovation under consideration?');
      document.getElementById('input-renovation-yes').focus();
      return false;
    }
    if (identity.renovationDetails && identity.renovationDetails.length > 2000) {
      alert('Renovation details are too long (max 2000 characters).');
      document.getElementById('input-renovation-details').focus();
      return false;
    }
    if (!identity.consent) {
      alert('Please tick the consent box to allow storing your response in the private repository.');
      document.getElementById('input-consent').focus();
      return false;
    }
    return true;
  }

  function loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (!draft) return;
      if (draft.identity) {
        const simple = ['name', 'role', 'pilot', 'country', 'email'];
        simple.forEach(k => {
          const el = document.getElementById(`input-${k}`);
          if (el && draft.identity[k]) el.value = draft.identity[k];
        });
        if (draft.identity.consent) {
          const el = document.getElementById('input-consent');
          if (el) el.checked = true;
        }
        if (draft.identity.renovationUnderConsideration === true) {
          document.getElementById('input-renovation-yes').checked = true;
        } else if (draft.identity.renovationUnderConsideration === false) {
          document.getElementById('input-renovation-no').checked = true;
        }
        if (draft.identity.renovationDetails) {
          document.getElementById('input-renovation-details').value = draft.identity.renovationDetails;
        }
        toggleRenovationDetails();
      }
      if (draft.criteria) {
        const active = new Set(draft.criteria.activeIds || []);
        document.querySelectorAll('#criteria-checklist input[type="checkbox"]').forEach(cb => {
          cb.checked = active.has(cb.dataset.criterionId);
        });
        if (Array.isArray(draft.criteria.customCriteria) && draft.criteria.customCriteria.length) {
          customCriteria = draft.criteria.customCriteria
            .filter(c => c && typeof c.name === 'string' && c.name.trim())
            .slice(0, MAX_N)
            .map(c => ({
              id: typeof c.id === 'string' && c.id ? c.id : `custom_${customCounter++}`,
              name: c.name.trim().slice(0, 120),
              shortName: (c.shortName || c.name).trim().slice(0, 24),
              description: (c.description || c.name).trim().slice(0, 500)
            }));
          customCounter = customCriteria.reduce((m, c) => {
            const n = parseInt(String(c.id).replace('custom_', ''), 10);
            return isFinite(n) ? Math.max(m, n + 1) : m;
          }, customCounter);
        } else if (draft.criteria.custom && draft.criteria.custom.name) {
          customCriteria = [{
            id: 'custom_1',
            name: String(draft.criteria.custom.name).trim().slice(0, 120),
            shortName: String(draft.criteria.custom.name).trim().slice(0, 24),
            description: String(draft.criteria.custom.name).trim().slice(0, 500)
          }];
          customCounter = 2;
        }
        renderCustomList();
        rebuildFromCriteria(false);
      }
      if (draft.tiers && typeof draft.tiers === 'object') {
        Object.entries(draft.tiers).forEach(([id, t]) => {
          if (TIERS.includes(t) && criteria.some(c => c.id === id)) tiers[id] = t;
        });
        renderTierBoard();
        updatePairSuggestions();
      }
      if (draft.guided && Array.isArray(draft.guided.answers)) {
        guidedAnswers = {};
        draft.guided.answers.forEach(p => {
          if (!p || !Number.isInteger(p.i) || !Number.isInteger(p.j) || typeof p.value !== 'number') return;
          if (p.i < 0 || p.j < 0 || p.i >= matrix.length || p.j >= matrix.length || p.i === p.j) return;
          if (!isFinite(p.value) || p.value < 1 / 9 - 1e-9 || p.value > 9 + 1e-9) return;
          const ui = Math.min(p.i, p.j), uj = Math.max(p.i, p.j);
          const v = p.i === ui ? p.value : 1 / p.value;
          guidedAnswers[pairKey(ui, uj)] = { i: ui, j: uj, value: v };
        });
        if (Number.isInteger(draft.guided.idx)) {
          guidedIdx = Math.max(0, Math.min(draft.guided.idx, guidedOrder.length));
        }
      }
      if (draft.matrix && draft.matrix.length === matrix.length) {
        draft.matrix.forEach((row, i) => {
          if (!Array.isArray(row)) return;
          row.forEach((val, j) => {
            if (i < j && typeof val === 'number' && isFinite(val) && val !== 1 &&
                val >= 1 / 9 - 1e-9 && val <= 9 + 1e-9) {
              matrix[i][j] = val;
              matrix[j][i] = 1 / val;
              userCells[i][j] = true;
              userCells[j][i] = true;
              guidedAnswers[pairKey(i, j)] = { i, j, value: val };
            }
          });
        });
      }
      if (guidedIsComplete()) {
        runCompletion();
      } else {
        updateMatrixDisplay();
        Plot.clear();
        if (onMatrixChange) onMatrixChange(null);
      }
      renderGuided();
      if (draft.missingCriteria) {
        const missingEl = document.getElementById('input-missing');
        if (missingEl) missingEl.value = draft.missingCriteria;
      }
    } catch (e) {
      console.warn('Failed to load draft:', e);
    }
  }

  function saveDraft(data) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save draft:', e);
    }
  }

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
    const el = document.getElementById(screenId);
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('active');
  }

  function showSuccess(detail) {
    document.getElementById('success-detail').textContent = detail;
    showScreen('success-screen');
    localStorage.removeItem(DRAFT_KEY);
  }

  function showError(message) {
    document.getElementById('error-message').textContent = message;
    showScreen('error-screen');
  }

  function resetForm() {
    document.getElementById('survey-form').reset();
    document.querySelectorAll('#criteria-checklist input[type="checkbox"]').forEach(cb => { cb.checked = true; });
    customCriteria = [];
    customCounter = 1;
    renderCustomList();
    tiers = {};
    toggleRenovationDetails();
    rebuildFromCriteria(false);
    updateCRDisplay(null);
    if (onMatrixChange && matrix.length >= MIN_N) {
      try {
        const { AHP: Ahp } = { AHP };
        void Ahp;
      } catch (e) { /* noop */ }
    }
    showScreen('survey-screen');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // Full display name everywhere; truncate only long free-text customs (full in tooltip).
  function displayName(c) {
    if (c.id && c.id.indexOf('custom_') === 0 && c.name.length > 60) {
      return `${c.name.slice(0, 60)}…`;
    }
    return c.name;
  }

  return {
    init,
    updateCRDisplay,
    showScreen,
    showSuccess,
    showError,
    saveDraft,
    getActiveCriteria,
    getCriteriaMeta,
    getTiers,
    setTier
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UI;
}

export { UI };
