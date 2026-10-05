import { AHP } from './ahp-core.js';

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

  function setTier(id, tier) {
    if (!TIERS.includes(tier)) return;
    if (!criteria.some(c => c.id === id)) return;
    tiers[id] = tier;
    renderTierBoard();
    updatePairSuggestions();
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
            `<button type="button" data-move="${x}" data-id="${escapeHtml(c.id)}" class="${x === (tiers[c.id] || 'B') ? 'on' : ''}" aria-label="Move ${escapeHtml(c.shortName)} to tier ${x}">${x}</button>`
          ).join('');
          return `<div class="tier-block" draggable="true" data-id="${escapeHtml(c.id)}"><span class="tier-label">${num}. ${escapeHtml(c.shortName)}</span><span class="tier-btns">${btns}</span></div>`;
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
      input.title = `${a.shortName} (${tiers[a.id] || 'B'}) vs ${b.shortName} (${tiers[b.id] || 'B'}) — suggested ${range}`;
    });
  }

  function buildCriteriaLegend() {
    const container = document.getElementById('criteria-legend');
    if (!container) return;
    container.innerHTML = criteria.map((c, i) =>
      `<span class="criteria-legend-item" title="${escapeHtml(c.description || c.name)}"><span class="criteria-legend-num">${i + 1}.</span>${escapeHtml(c.shortName)}</span>`
    ).join('');
  }

  function buildMatrixTable() {
    const n = criteria.length;
    matrix = Array(n).fill(null).map(() => Array(n).fill(1));

    const thead = document.querySelector('#matrix-table thead tr');
    if (thead) {
      thead.innerHTML = '<th class="corner">Criteria</th>' +
        criteria.map((c, i) => `<th title="${escapeHtml(c.name)}">${i + 1}</th>`).join('');
    }

    const tbody = document.querySelector('#matrix-table tbody');
    if (!tbody) return;
    tbody.innerHTML = criteria.map((c, i) => {
      const row = [`<th title="${escapeHtml(c.name)}">${i + 1}. ${escapeHtml(c.shortName)}</th>`];
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
      board.addEventListener('dragstart', e => {
        const block = e.target.closest('.tier-block');
        if (!block) return;
        e.dataTransfer.setData('text/plain', block.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      board.querySelectorAll('.tier-blocks').forEach(col => {
        col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop-hint'); });
        col.addEventListener('dragleave', () => col.classList.remove('drop-hint'));
        col.addEventListener('drop', e => {
          e.preventDefault();
          col.classList.remove('drop-hint');
          const id = e.dataTransfer.getData('text/plain');
          const tierBox = col.closest('.tier-col');
          if (id && tierBox) setTier(id, tierBox.dataset.tier);
        });
      });
    }

    document.getElementById('btn-submit').addEventListener('click', handleSubmit);
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

  function updateMatrix(row, col, val) {
    matrix[row][col] = val;
    matrix[col][row] = 1 / val;

    const lowerCell = document.querySelector(`#matrix-table tbody tr:nth-child(${col + 1}) td:nth-child(${row + 2})`);
    if (lowerCell) {
      lowerCell.textContent = val.toFixed(2);
    }

    if (onMatrixChange) {
      onMatrixChange(matrix);
    }
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
        matrix,
        weights: result.weights,
        cr: result.CR,
        consistent: result.consistent,
        missingCriteria
      });
    }
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
      if (draft.matrix && draft.matrix.length === matrix.length) {
        draft.matrix.forEach((row, i) => {
          row.forEach((val, j) => {
            if (i < j && val !== 1) {
              matrix[i][j] = val;
              matrix[j][i] = 1 / val;
              const input = document.querySelector(`#matrix-table input[data-row="${i}"][data-col="${j}"]`);
              const lowerCell = document.querySelector(`#matrix-table tbody tr:nth-child(${j + 1}) td:nth-child(${i + 2})`);
              if (input) input.value = formatInputDisplay(val);
              if (lowerCell) lowerCell.textContent = Number(val).toFixed(2);
            }
          });
        });
        if (onMatrixChange) onMatrixChange(matrix);
      }
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
