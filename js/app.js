import { CONFIG } from './config.js';
import { AHP } from './ahp-core.js';
import { UI } from './ui.js';
import { Auth } from './auth.js';
import { Storage } from './storage.js';
import { Phase2 } from './phase2.js';
import { Comments } from './comments.js';

let criteria = []; // active Phase-1 criteria (scenario A/C)
let allDefaultCriteria = []; // full defaults from criteria.json (scenario B)
let currentMatrix = [];
let currentResult = null;
// Respondent info + phase selection from the start screen.
let startIdentity = null; // {name,role,roleOther,pilot,country,email,...}
let selection = { phase1: true, phase2: true };
// Phase-2 link: filled after Phase-1 submit (scenario C).
let phase1Link = null; // { submissionId, activeCriteria, weights }
// Phase-1 data saved locally via the "Save draft and proceed to Phase 2"
// draft path (submitted to the Worker together with Phase 2).
let phase1DraftData = null;
// Standalone Phase-2 response id (scenario B, no Phase-1 submission) — deprecated.
let standaloneResponseId = null;

async function init() {
  Storage.init(CONFIG);
  Auth.setStorage(Storage);

  // Restore Phase 1 draft from localStorage (survives page reload).
  try {
    const saved = localStorage.getItem('ahp-phase1-draft-v1');
    if (saved) {
      phase1DraftData = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to restore phase 1 draft:', e);
  }

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
    onSaveDraftProceed: handleSaveDraftProceed,
    onCriteriaChange: handleCriteriaChange
  });

  Comments.init();

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
      // Phase 1 is mandatory (scenario B / Phase-2-only deprecated).
      UI.showScreen('survey-screen');
    } else {
      // Should not happen: phase 1 checkbox is always checked/disabled.
      const err = document.getElementById('start-error');
      if (err) err.classList.remove('hidden');
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

// ---------- Phase 1 submit (app-level: server storage + phase-2 link) ----------
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
    // Phase 1 submitted to server — clear local draft.
    localStorage.removeItem('ahp-phase1-draft-v1');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
    if (selection.phase2) {
      // Scenario C: transition screen, then Phase 2 on Phase-1 criteria.
      const detail = document.getElementById('phase2-invite-detail');
      if (detail) {
        detail.textContent = 'Criteria priorities saved. Continue when ready.';
      }
      UI.showScreen('phase2-invite-screen');
    } else {
      // Scenario A: done after Phase 1.
      Auth.clearPassword();
      UI.showSuccess('Criteria priorities submitted. Thank you!');
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
      UI.showSuccess('Criteria priorities submitted. Thank you!');
      phase1Link = null;
    });
  }
  if (proceed) {
    proceed.addEventListener('click', async () => {
      if (!phase1Link) {
        alert('Criteria priorities data missing. Please submit that part first.');
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
      proceed.textContent = 'Proceed to Indicators grading';
    });
  }
}

// ---------- Phase 2 submit (scenarios B + C) ----------
async function handlePhase2Submit(phase2payload) {
  const btn = document.getElementById('btn-phase2-submit');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Submitting indicators grading...';

  const accessCode = Auth.getAccessCode ? Auth.getAccessCode() : Auth.getPassword();
  if (!accessCode || !startIdentity) {
    alert('Session expired. Please start again from login.');
    btn.disabled = false;
    btn.textContent = prev;
    return;
  }

  // Unfinished survey check: warn if any part (Phase 1 or Phase 2) is incomplete.
  if (!Phase2.isAllComplete()) {
    const firstMissing = Phase2.firstIncompleteIndex();
    const missingText = firstMissing != null
      ? ` — incomplete criterion: ${criteria[firstMissing].name}`
      : '';
    const goMissing = confirm(
      'Are you sure you want to submit an unfinished survey? Default or estimated values will be used to complete your survey.' +
      missingText +
      '\n\nPress OK to submit now, or Cancel to go to the missing section.'
    );
    if (!goMissing && firstMissing != null) {
      // Go to the first incomplete criterion tab.
      Phase2.goToCriterion(firstMissing);
      UI.showScreen('phase2-screen');
      return;
    }
  }

  const base = {
    ...phase2payload,
    accessCode,
    comments: Comments.getAll('p2'),
    name: startIdentity.name,
    role: startIdentity.role,
    roleOther: startIdentity.roleOther || '',
    pilot: startIdentity.pilot,
    country: startIdentity.country,
    email: startIdentity.email || '',
    consent: true,
    phasesSelected: phasesSelectedList()
  };

  // Draft path: submit Phase 1 first (Worker needs phase1SubmissionId to validate Phase 2).
  if (phase1DraftData && !phase1Link) {
    try {
      const phase1Result = await Storage.saveSubmission(phase1DraftData);
      phase1Link = {
        submissionId: phase1Result.submissionId || null,
        activeCriteria: criteria.map(c => ({ ...c })),
        weights: [...phase1DraftData.weights]
      };
      phase1DraftData = null;
    } catch (error) {
      console.error('Phase-1 pre-submission error:', error);
      alert('Failed to submit Phase 1: ' + error.message);
      btn.disabled = false;
      btn.textContent = prev;
      return;
    }
  }

  if (phase1Link && phase1Link.submissionId) {
    // Scenario C: link to the Phase-1 submission (shared response ID).
    base.phase1SubmissionId = phase1Link.submissionId;
    base.weightsSource = 'phase1';
  } else {
    // Scenario B (deprecated): standalone response.
    base.phase1Skipped = true;
    base.responseId = standaloneResponseId;
    base.weightsSource = 'equal-default';
  }

  try {
    await Storage.savePhase2Submission(base);
    Phase2.clearDraft();
    localStorage.removeItem('ahp-phase1-draft-v1');
    Auth.clearPassword();
    phase1Link = null;
    standaloneResponseId = null;
    UI.showSuccess('Indicators grading submitted. Thank you!');
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
  // Persist full Phase 1 payload for reload safety (unified draft pattern).
  const accessCode = Auth.getAccessCode ? Auth.getAccessCode() : Auth.getPassword();
  const draft = {
    ...data,
    accessCode,
    phasesSelected: phasesSelectedList()
  };
  try {
    localStorage.setItem('ahp-phase1-draft-v1', JSON.stringify(draft));
  } catch (e) {
    console.warn('Failed to save phase 1 draft:', e);
  }
  alert('Draft saved locally in this browser');
}

// ---------- "Save draft and proceed to Phase 2" (draft path) ----------
// Saves Phase 1 data locally (no Worker submission yet) and moves to Phase 2.
// Phase 1 is submitted to the Worker first during the final Phase 2 submit.
async function handleSaveDraftProceed(data) {
  const accessCode = Auth.getAccessCode ? Auth.getAccessCode() : Auth.getPassword();
  phase1DraftData = {
    ...data,
    accessCode,
    phasesSelected: phasesSelectedList()
  };
  // Persist for reload safety.
  try {
    localStorage.setItem('ahp-phase1-draft-v1', JSON.stringify(phase1DraftData));
  } catch (e) {
    console.warn('Failed to save phase 1 draft:', e);
  }
  try {
    const indicatorsList = await loadIndicators();
    Phase2.init({
      indicators: indicatorsList,
      criteria: criteria.map(c => ({ ...c })),
      criteriaWeights: [...data.weights],
      onSubmit: handlePhase2Submit,
      onSaveDraft: () => {}
    });
    UI.showScreen('phase2-screen');
  } catch (e) {
    console.error('Phase2 init failed:', e);
    alert('Could not load indicators: ' + e.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
