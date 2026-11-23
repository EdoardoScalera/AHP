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
// Turnstile widget id (for reset after submission).
let turnstileWidgetId = null;
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
    onReturnToStart: returnToStartInfo,
    onCriteriaChange: handleCriteriaChange
  });

  Comments.init();

  wireStart();
  wireTransition();
  wireSplash();
  wirePhase2Return();

  Auth.init(CONFIG, () => {
    UI.showScreen('splash-screen');
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
    updatePhase1ActionButtons(sel.phase2);

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

function updatePhase1ActionButtons(phase2Selected) {
  const submit = document.getElementById('btn-submit');
  const proceed = document.getElementById('btn-save-draft-proceed');
  if (phase2Selected) {
    if (submit) submit.classList.add('hidden');
    if (proceed) {
      proceed.classList.remove('hidden');
      proceed.classList.remove('btn-secondary');
      proceed.classList.add('btn-primary');
    }
  } else {
    if (submit) submit.classList.remove('hidden');
    if (proceed) {
      proceed.classList.add('hidden');
      proceed.classList.remove('btn-primary');
      proceed.classList.add('btn-secondary');
    }
  }
}

function setPhase2ReturnVisibility() {
  const btn = document.getElementById('btn-phase2-return');
  if (!btn) return;
  // Visible only when the respondent reached Phase 2 via "Save choices and
  // proceed" (Phase 1 draft kept locally, not yet submitted to the Worker).
  btn.classList.toggle('hidden', !(phase1DraftData && !phase1Link));
}

function returnToPhase1() {
  UI.showScreen('survey-screen');
  UI.loadDraft();
  const el = document.getElementById('criteria-section');
  if (el) {
    const headerOffset = 90;
    const elTop = el.getBoundingClientRect().top + window.pageYOffset;
    window.scrollTo({ top: elTop - headerOffset, behavior: 'smooth' });
  }
}

function returnToStartInfo() {
  UI.showScreen('start-screen');
}

function wireSplash() {
  const btn = document.getElementById('btn-splash-start');
  if (btn) {
    btn.addEventListener('click', () => {
      UI.showScreen('start-screen');
    });
  }
}

function wirePhase2Return() {
  const btn = document.getElementById('btn-phase2-return');
  if (btn) {
    btn.addEventListener('click', returnToPhase1);
  }
}

async function handleSubmit(data) {
  const submitBtn = document.getElementById('btn-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const turnstileToken = isLocalHost ? '' : await getTurnstileToken();
  console.log('Turnstile token length:', turnstileToken.length, 'widgetId:', turnstileWidgetId);
  if (!turnstileToken && !isLocalHost) {
    UI.showError('Please complete the verification challenge above before submitting.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit';
    return;
  }

  try {
    const result = await Storage.saveSubmission({ ...data, turnstileToken, phasesSelected: phasesSelectedList() });
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
    if (turnstileWidgetId) {
      window.turnstile.reset(turnstileWidgetId);
    }
    if (selection.phase2) {
      // Scenario C: transition screen, then Phase 2 on Phase-1 criteria.
      const detail = document.getElementById('phase2-invite-detail');
      if (detail) {
        detail.textContent = 'Criteria priorities saved. Continue when ready.';
      }
      UI.showScreen('phase2-invite-screen');
    } else {
      // Scenario A: done after Phase 1.
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

  if (!startIdentity) {
    alert('Session expired. Please start again from the beginning.');
    btn.disabled = false;
    btn.textContent = prev;
    return;
  }

  const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const turnstileToken = isLocalHost ? '' : await getTurnstileToken();
  if (!turnstileToken && !isLocalHost) {
    UI.showError('Please complete the verification challenge above before submitting.');
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
    turnstileToken,
    comments: Comments.getAll('p2'),
    name: startIdentity.name,
    role: startIdentity.role,
    roleOther: startIdentity.roleOther || '',
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
    if (turnstileWidgetId) {
      window.turnstile.reset(turnstileWidgetId);
    }
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
  const draft = {
    ...data,
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
  phase1DraftData = {
    ...data,
    phasesSelected: phasesSelectedList()
  };
  // Persist for reload safety and keep the unified draft current so returning
  // to Phase 1 can restore the respondent's choices.
  UI.saveDraft(data);
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
    window.scrollTo({ top:0, behavior: 'smooth' })
    setPhase2ReturnVisibility();
  } catch (e) {
    console.error('Phase2 init failed:', e);
    alert('Could not load indicators: ' + e.message);
  }
}

// ---------- Turnstile helpers ----------
async function getTurnstileToken() {
  if (!window.turnstile || !turnstileWidgetId) return '';
  return window.turnstile.getResponse(turnstileWidgetId) || '';
}

// Verification overlay shown while Turnstile loads / user completes the challenge.
let turnstileOverlay = null;

function showTurnstileOverlay() {
  if (turnstileOverlay) return;
  const overlay = document.createElement('div');
  overlay.id = 'turnstile-overlay';
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.zIndex = '10000';
  overlay.style.background = '#ffffff';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.textAlign = 'center';
  overlay.style.padding = '2rem';
  overlay.style.fontFamily = 'system-ui, -apple-system, sans-serif';

  const title = document.createElement('h2');
  title.textContent = 'Verification required';
  title.style.margin = '0 0 1rem 0';
  title.style.fontSize = '1.25rem';
  title.style.color = '#111827';

  const msg = document.createElement('p');
  msg.textContent = 'Please complete the Cloudflare verification challenge below before accessing the survey.';
  msg.style.margin = '0 0 1.5rem 0';
  msg.style.color = '#4b5563';
  msg.style.maxWidth = '400px';
  msg.style.lineHeight = '1.5';

  const container = document.createElement('div');
  container.id = 'turnstile-container';
  container.style.margin = '0 auto';

  const error = document.createElement('p');
  error.id = 'turnstile-error';
  error.style.margin = '1.5rem 0 0 0';
  error.style.color = '#dc2626';
  error.style.fontSize = '0.9rem';
  error.style.maxWidth = '400px';
  error.style.display = 'none';

  overlay.appendChild(title);
  overlay.appendChild(msg);
  overlay.appendChild(container);
  overlay.appendChild(error);
  document.body.appendChild(overlay);
  turnstileOverlay = overlay;
}

function hideTurnstileOverlay() {
  if (turnstileOverlay) {
    turnstileOverlay.remove();
    turnstileOverlay = null;
  }
}

function showTurnstileError(msg) {
  const error = document.getElementById('turnstile-error');
  if (error) {
    error.textContent = msg;
    error.style.display = 'block';
  }
}

function initTurnstile() {
  return new Promise((resolve) => {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // On localhost, Turnstile is bypassed entirely — no widget, no CSP errors
    if (isLocalHost) {
      turnstileWidgetId = null;
      console.log('Turnstile bypassed on localhost');
      resolve();
      return;
    }

    // Production: show the verification overlay and inject the Turnstile widget.
    // The user must complete the challenge before the survey is accessible.
    showTurnstileOverlay();

    const container = document.getElementById('turnstile-container');

    // Poll for Turnstile to load. No silent timeout — we wait until the
    // script is available or the page is refreshed. If Cloudflare's CSP blocks
    // the widget, an error is shown instead of silently proceeding without verification.
    let attempts = 0;
    const maxAttempts = 600; // ~60 seconds at 100ms intervals
    const check = () => {
      attempts++;
      if (!window.turnstile) {
        if (attempts >= maxAttempts) {
          showTurnstileError('Cloudflare Turnstile failed to load. Please refresh the page and try again.');
          resolve();
          return;
        }
        setTimeout(check, 100);
        return;
      }

      // Turnstile is loaded — render the widget programmatically with a callback
      // that fires when the user completes the challenge. Only then do we dismiss
      // the overlay and unlock the survey.
      try {
        turnstileWidgetId = window.turnstile.render(container, {
          sitekey: CONFIG.TURNSTILE_SITEKEY || '',
          action: 'submit',
          callback: (token) => {
            console.log('Turnstile challenge completed, token length:', token.length);
            hideTurnstileOverlay();
            resolve();
          },
          'error-callback': () => {
            console.error('Turnstile challenge errored');
            showTurnstileError('Turnstile verification failed. Please refresh the page and try again.');
          },
        });
        console.log('Turnstile widget rendered, widgetId:', turnstileWidgetId);
      } catch (e) {
        console.error('Turnstile render failed:', e);
        showTurnstileError('Turnstile verification failed to initialize. Please refresh the page.');
        resolve();
      }
    };
    check();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  // Turnstile verification must complete before the survey UI is accessible.
  await initTurnstile();
  init();
});
