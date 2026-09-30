import { AHP } from './ahp-core.js';

const UI = (() => {
  let criteria = [];
  let matrix = [];
  let onMatrixChange = null;
  let onSubmit = null;
  let onSaveDraft = null;

  function init(criteriaData, callbacks) {
    criteria = criteriaData;
    onMatrixChange = callbacks.onMatrixChange;
    onSubmit = callbacks.onSubmit;
    onSaveDraft = callbacks.onSaveDraft;

    buildMatrixTable();
    buildCriteriaLegend();
    attachEventListeners();
    loadDraft();
  }

  function buildCriteriaLegend() {
    const container = document.getElementById('criteria-legend');
    container.innerHTML = criteria.map((c, i) =>
      `<span class="criteria-legend-item"><span class="criteria-legend-num">${i + 1}.</span>${c.shortName}</span>`
    ).join('');
  }

  function buildMatrixTable() {
    const n = criteria.length;
    matrix = Array(n).fill(null).map(() => Array(n).fill(1));

    const thead = document.querySelector('#matrix-table thead tr');
    thead.innerHTML = '<th class="corner">Criteria</th>' +
      criteria.map((c, i) => `<th title="${c.name}">${i + 1}</th>`).join('');

    const tbody = document.querySelector('#matrix-table tbody');
    tbody.innerHTML = criteria.map((c, i) => {
      const row = [`<th title="${c.name}">${i + 1}. ${c.shortName}</th>`];
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
  }

  function attachEventListeners() {
    document.querySelectorAll('#matrix-table input').forEach(input => {
      input.addEventListener('input', handleMatrixInput);
      input.addEventListener('blur', handleMatrixBlur);
    });

    document.getElementById('btn-submit').addEventListener('click', handleSubmit);
    document.getElementById('btn-save-draft').addEventListener('click', handleSaveDraft);
    document.getElementById('survey-form').addEventListener('submit', e => e.preventDefault());
    document.getElementById('btn-new-response').addEventListener('click', resetForm);
    document.getElementById('btn-retry').addEventListener('click', () => showScreen('survey-screen'));
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

    if (result === null) {
      crValue.textContent = 'CR: —';
      crValue.className = 'cr-value';
      crStatus.textContent = 'Complete the matrix to see consistency ratio';
      crBarFill.style.width = '0%';
      crBarFill.className = 'cr-bar-fill';
      submitBtn.disabled = true;
      return;
    }

    const cr = result.CR;
    const percent = Math.min(100, (cr / 0.2) * 100);

    crValue.textContent = `CR: ${cr.toFixed(4)}`;
    crValue.className = `cr-value ${result.consistent ? 'acceptable' : 'unacceptable'}`;
    crStatus.textContent = result.consistent
      ? '✓ Consistency is acceptable (CR ≤ 0.10)'
      : '✗ Consistency ratio exceeds 0.10 — please revise judgments';
    crBarFill.style.width = `${percent}%`;
    crBarFill.className = `cr-bar-fill ${result.consistent ? '' : 'unacceptable'}`;
    submitBtn.disabled = !result.consistent;
  }

  function handleSubmit() {
    const identity = getIdentity();
    if (!validateIdentity(identity)) return;

    const missingCriteria = document.getElementById('input-missing').value.trim();
    const result = AHP.calculateAll(matrix);

    if (onSubmit) {
      onSubmit({
        ...identity,
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
    const missingCriteria = document.getElementById('input-missing').value.trim();

    if (onSaveDraft) {
      onSaveDraft({
        identity,
        matrix,
        missingCriteria
      });
    }
  }

  function getIdentity() {
    return {
      name: document.getElementById('input-name').value.trim(),
      role: document.getElementById('input-role').value.trim(),
      pilot: document.getElementById('input-pilot').value.trim(),
      country: document.getElementById('input-country').value.trim()
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
    return true;
  }

  function loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem('ahp-draft'));
      if (draft) {
        if (draft.identity) {
          Object.entries(draft.identity).forEach(([k, v]) => {
            const el = document.getElementById(`input-${k}`);
            if (el) el.value = v;
          });
        }
        if (draft.matrix) {
          draft.matrix.forEach((row, i) => {
            row.forEach((val, j) => {
              if (i < j && val !== 1) {
                matrix[i][j] = val;
                matrix[j][i] = 1 / val;
                const input = document.querySelector(`#matrix-table input[data-row="${i}"][data-col="${j}"]`);
                const lowerCell = document.querySelector(`#matrix-table tbody tr:nth-child(${j + 1}) td:nth-child(${i + 2})`);
                if (input) input.value = formatInputDisplay(val);
                if (lowerCell) lowerCell.textContent = val.toFixed(2);
              }
            });
          });
        }
        if (draft.missingCriteria) {
          document.getElementById('input-missing').value = draft.missingCriteria;
        }
      }
    } catch (e) {
      console.warn('Failed to load draft:', e);
    }
  }

  function saveDraft(data) {
    try {
      localStorage.setItem('ahp-draft', JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save draft:', e);
    }
  }

  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  }

  function showSuccess(detail) {
    document.getElementById('success-detail').textContent = detail;
    showScreen('success-screen');
    localStorage.removeItem('ahp-draft');
  }

  function showError(message) {
    document.getElementById('error-message').textContent = message;
    showScreen('error-screen');
  }

  function resetForm() {
    document.getElementById('survey-form').reset();
    const n = criteria.length;
    matrix = Array(n).fill(null).map(() => Array(n).fill(1));
    document.querySelectorAll('#matrix-table input').forEach(input => {
      input.value = '';
      input.classList.remove('valid', 'invalid');
    });
    document.querySelectorAll('#matrix-table tbody td.lower').forEach(td => {
      td.textContent = '1.00';
    });
    updateCRDisplay(null);
    showScreen('survey-screen');
  }

  return {
    init,
    updateCRDisplay,
    showScreen,
    showSuccess,
    showError,
    saveDraft
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UI;
}

export { UI };