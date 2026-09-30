import { CONFIG } from './config.js';
import { AHP } from './ahp-core.js';
import { UI } from './ui.js';
import { Auth } from './auth.js';
import { Storage } from './storage.js';

let criteria = [];
let currentMatrix = [];

async function init() {
  Storage.init(CONFIG);

  try {
    const fetchedCriteria = await Storage.fetchCriteria();
    if (fetchedCriteria && fetchedCriteria.criteria) {
      criteria = fetchedCriteria.criteria;
    } else {
      const response = await fetch('data/criteria.json');
      const data = await response.json();
      criteria = data.criteria;
    }
  } catch (e) {
    console.warn('Using local criteria.json:', e);
    const response = await fetch('data/criteria.json');
    const data = await response.json();
    criteria = data.criteria;
  }

  UI.init(criteria, {
    onMatrixChange: handleMatrixChange,
    onSubmit: handleSubmit,
    onSaveDraft: handleSaveDraft
  });

  Auth.init(CONFIG, () => {
    UI.showScreen('survey-screen');
  });
}

function handleMatrixChange(matrix) {
  currentMatrix = matrix;
  try {
    const result = AHP.calculateAll(matrix);
    UI.updateCRDisplay(result);
  } catch (e) {
    UI.updateCRDisplay(null);
  }
}

async function handleSubmit(data) {
  const submitBtn = document.getElementById('btn-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    await Storage.saveSubmission(data);
    UI.showSuccess(`Response saved as ${data.name} (${data.role})`);
  } catch (error) {
    console.error('Submission error:', error);
    UI.showError(error.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
  }
}

function handleSaveDraft(data) {
  UI.saveDraft(data);
  alert('Draft saved locally');
}

document.addEventListener('DOMContentLoaded', init);