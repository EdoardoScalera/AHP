import { CONFIG } from './config.js';
import { AHP } from './ahp-core.js';
import { UI } from './ui.js';
import { Auth } from './auth.js';
import { Storage } from './storage.js';
import { Phase2 } from './phase2.js';

let criteria = []; // active Phase-1 criteria (scenario A/C)
let allDefaultCriteria = []; // full defaults from criteria.json (scenario B)
let currentMatrix = [];
let currentResult = null;
// Respondent info + phase selection from the start screen.
let startIdentity = null; // {name,role,pilot,country,email,...}
let selection = { phase1: true, phase2: true };
// Phase-2 link: filled after Phase-1 submit (scenario C).
let phase1Link = null; // { submissionId, activeCriteria, weights }
// Standalone Phase-2 response id (scenario B, no Phase-1 submission).
let standaloneResponseId = null;

async function init() {
  Storage.init(CONFIG);
  Auth.setStorage(Storage);

  try {
    const response = await fetch('data/criteria.json');
    const data = await response.json();
    allDefaultCriteria = data.criteria;
    criteria = data.criteria;
  } catch (e) {
    console.error('Could not load local data/criteria.json:', e);
    document.getElementById('cr-status').textContent = 'Failed to load criteria. Please reload.';
    return;
  }

  UI.init(criteria, {
    onMatrixChange: handleMatrixChange,
    onSubmit: handleSubmit,
    onSaveDraft: handleSaveDraft,
    onCriteriaChange: handleCriteriaChange
  });

  wireStart();
  wireTransition();

  Auth.init(CONFIG, () => {
    UI.showScreen('start-screen');
  });
}

function handleCriteriaChange(activeCriteria, meta) {
  criteria = activeCriteria;
  currentMatrix = [];
  currentResult = null;
  UI.updateCRDisplay(null);
}

function handleMatrixChange(matrix) {
  if (!matrix) {
    UI.updateCRDisplay(null);
    currentResult = null;
    return;
  }
  currentMatrix = matrix;
  try {
    const result = AHP.calculateAll(matrix);
    currentResult = result;
    UI.updateCRDisplay(result);
  } catch (e) {
    currentResult = null;
    UI.updateCRDisplay(null);
  }
}

// ---------- start screen: identity + phase selection ----------
function wireStart() {
  const btn = document.getElementById('btn-start');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const identity = UI.getIdentity();
    if (!UI.validateIdentity(identity)) return;
    const sel = UI.getSelection();
    if (!sel.phase1 && !sel.phase2) {
      const err = document.getElementById('start-error');
      if (err) err.classList.remove('hidden');
      return;
    }
    const err = document.getElementById('start-error');
    if (err) err.classList.add('hidden');
    UI.saveStart();
    startIdentity = identity;
    selection = sel;
    phase1Link = null;
    standaloneResponseId = null;

    if (sel.phase1) {
      // Scenarios A + C: Phase 1 first.
      UI.showScreen('survey-screen');
    } else {
      // Scenario B: Phase 2 only, over all default criteria.
      await startPhase2Standalone();
    }
  });
  document.getElementById('start-form').addEventListener('submit', e => e.preventDefault());
}

async function loadIndicators() {
  const res = await fetch('data/indicators.json');
  const data = await res.json();
  const list = data.indicators || [];
  if (list.length < 2) throw new Error('indicators.json must list at least 2 KPIs');
  return list;
}

async function startPhase2Standalone() {
  try {
    const indicatorsList = await loadIndicators();
    const weights = allDefaultCriteria.map(() => 1 / allDefaultCriteria.length);
    standaloneResponseId = crypto.randomUUID();
    Phase2.init({
      indicators: indicatorsList,
      criteria: allDefaultCriteria.map(c => ({ ...c })),
      criteriaWeights: weights,
      onSubmit: handlePhase2Submit,
      onSaveDraft: () => {}
    });
    UI.showScreen('phase2-screen');
  } catch (e) {
    console.error('Phase2 init failed:', e);
    alert('Could not load indicators: ' + e.message);
  }
}

// ---------- Phase 1 submit ----------
function phasesSelectedList() {
  const out = [];
  if (selection.phase1) out.push(1);
  if (selection.phase2) out.push(2);
  return out;
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
    const result = await Storage.saveSubmission({ ...data, accessCode, phasesSelected: phasesSelectedList() });
    // Keep access code for optional Phase 2 (do NOT clear yet).
    phase1Link = {
      submissionId: result.submissionId || null,
      activeCriteria: UI.getActiveCriteria ? UI.getActiveCriteria().map(c => ({ ...c })) : [...criteria],
      weights: [...data.weights]
    };
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
    if (selection.phase2) {
      // Scenario C: transition screen, then Phase 2 on Phase-1 criteria.
      const detail = document.getElementById('phase2-invite-detail');
      if (detail) {
        detail.textContent = 'Phase-1 response saved. Continue when ready — your answers are kept in this browser.';
      }
      UI.showScreen('phase2-invite-screen');
    } else {
      // Scenario A: done after Phase 1.
      Auth.clearPassword();
      UI.showSuccess('Phase-1 response submitted. Thank you!');
    }
  } catch (error) {
    console.error('Submission error:', error);
    UI.showError(error.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
  }
}

// ---------- transition screen (scenario C only) ----------
function wireTransition() {
  const finish = document.getElementById('btn-phase2-finish');
  const proceed = document.getElementById('btn-phase2-proceed');
  if (finish) {
    finish.addEventListener('click', () => {
      Auth.clearPassword();
      UI.showSuccess('Phase-1 response submitted. Thank you!');
      phase1Link = null;
    });
  }
  if (proceed) {
    proceed.addEventListener('click', async () => {
      if (!phase1Link) {
        alert('Phase-1 link missing. Please submit Phase 1 first.');
        UI.showScreen('survey-screen');
        return;
      }
      proceed.disabled = true;
      proceed.textContent = 'Loading indicators...';
      try {
        const indicatorsList = await loadIndicators();
        Phase2.init({
          indicators: indicatorsList,
          criteria: phase1Link.activeCriteria,
          criteriaWeights: phase1Link.weights,
          onSubmit: handlePhase2Submit,
          onSaveDraft: () => {}
        });
        UI.showScreen('phase2-screen');
      } catch (e) {
        console.error('Phase2 init failed:', e);
        alert('Could not load indicators: ' + e.message);
      }
      proceed.disabled = false;
      proceed.textContent = 'Proceed to Phase 2';
    });
  }
}

// ---------- Phase 2 submit (scenarios B + C) ----------
async function handlePhase2Submit(phase2payload) {
  const btn = document.getElementById('btn-phase2-submit');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Submitting Phase 2...';

  const accessCode = Auth.getAccessCode ? Auth.getAccessCode() : Auth.getPassword();
  if (!accessCode || !startIdentity) {
    alert('Session expired. Please start again from login.');
    btn.disabled = false;
    btn.textContent = prev;
    return;
  }

  const base = {
    ...phase2payload,
    accessCode,
    name: startIdentity.name,
    role: startIdentity.role,
    pilot: startIdentity.pilot,
    country: startIdentity.country,
    email: startIdentity.email || '',
    consent: true,
    phasesSelected: phasesSelectedList()
  };
  if (phase1Link && phase1Link.submissionId) {
    // Scenario C: link to the Phase-1 submission (shared response ID).
    base.phase1SubmissionId = phase1Link.submissionId;
    base.weightsSource = 'phase1';
  } else {
    // Scenario B: standalone response with a client-generated ID.
    base.phase1Skipped = true;
    base.responseId = standaloneResponseId;
    base.weightsSource = 'equal-default';
  }

  try {
    await Storage.savePhase2Submission(base);
    Phase2.clearDraft();
    Auth.clearPassword();
    phase1Link = null;
    standaloneResponseId = null;
    UI.showSuccess('Phase-2 response submitted. Thank you!');
  } catch (error) {
    console.error('Phase-2 submission error:', error);
    alert(error.message);
    btn.disabled = false;
    btn.textContent = prev;
    return;
  }
  btn.textContent = prev;
}

function handleSaveDraft(data) {
  UI.saveDraft(data);
  alert('Draft saved locally in this browser');
}

document.addEventListener('DOMContentLoaded', init);
