import { CONFIG } from './config.js';
import { AHP } from './ahp-core.js';
import { UI } from './ui.js';
import { Auth } from './auth.js';
import { Storage } from './storage.js';

let criteria = [];
let currentMatrix = [];

async function init() {
  Storage.init(CONFIG);
  Auth.setStorage(Storage);

  try {
    const response = await fetch('data/criteria.json');
    const data = await response.json();
    criteria = data.criteria;
  } catch (e) {
    console.error('Could not load local data/criteria.json:', e);
    document.getElementById('cr-status').textContent = 'Failed to load criteria. Please reload.';
    return;
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

  const accessCode = Auth.getAccessCode ? Auth.getAccessCode() : Auth.getPassword();
  if (!accessCode) {
    UI.showError('Session expired. Please re-enter the access code.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
    return;
  }

  try {
    const result = await Storage.saveSubmission({ ...data, accessCode });
    Auth.clearPassword();
    UI.showSuccess(result.submissionId ? `Response submitted successfully (ID: ${result.submissionId})` : 'Response submitted successfully');
  } catch (error) {
    console.error('Submission error:', error);
    UI.showError(error.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
  }
}

function handleSaveDraft(data) {
  UI.saveDraft(data);
  alert('Draft saved locally in this browser');
}

document.addEventListener('DOMContentLoaded', init);
