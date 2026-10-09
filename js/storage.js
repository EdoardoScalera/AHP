const Storage = (() => {
  let workerBase = '';
  let verifyPath = '/verify';
  let submitPath = '/submit';

  function init(cfg) {
    if (!cfg || !cfg.WORKER_URL) {
      throw new Error('Worker configuration is missing. Check js/config.js WORKER_URL');
    }
    workerBase = String(cfg.WORKER_URL).replace(/\/+$/, '');
    if (cfg.VERIFY_PATH) verifyPath = cfg.VERIFY_PATH;
    if (cfg.SUBMIT_PATH) submitPath = cfg.SUBMIT_PATH;
    if (workerBase.includes('YOUR-SUBDOMAIN')) {
      console.warn('WORKER_URL still uses placeholder – set your deployed Worker URL in js/config.js');
    }
  }

  async function verifyAccessCode(accessCode) {
    if (!workerBase) {
      throw new Error('Storage not initialized. Check js/config.js');
    }
    let response;
    try {
      response = await fetch(`${workerBase}${verifyPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode })
      });
    } catch (e) {
      throw new Error('Network error: unable to reach submission service');
    }
    if (response.ok) return { ok: true };
    if (response.status === 403) {
      throw new Error('The access code is not valid.');
    }
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Verification failed (${response.status})`);
  }

  async function saveSubmission(data) {
    if (!workerBase) {
      throw new Error('Storage not initialized. Check js/config.js');
    }
    const accessCode = data.accessCode || data.password;
    if (!accessCode) {
      throw new Error('Access code not provided');
    }
    const payload = {
      accessCode,
      phase: 1,
      name: data.name,
      role: data.role,
      pilot: data.pilot,
      country: data.country,
      email: data.email || '',
      renovationUnderConsideration: data.renovationUnderConsideration,
      renovationDetails: data.renovationDetails || '',
      criteria: data.criteria || null,
      tiers: data.tiers || null,
      pairwise: data.pairwise || null,
      matrix: data.matrix,
      weights: data.weights,
      cr: data.cr,
      consistent: data.consistent,
      missingCriteria: data.missingCriteria || '',
      consent: data.consent,
      phasesSelected: data.phasesSelected || null
    };

    let response;
    try {
      response = await fetch(`${workerBase}${submitPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('Network error: unable to reach submission service');
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Submission failed (${response.status})`);
    }
    return { success: true, submissionId: result.submissionId, message: result.message };
  }

  async function savePhase2Submission(data) {
    if (!workerBase) {
      throw new Error('Storage not initialized. Check js/config.js');
    }
    const accessCode = data.accessCode;
    if (!accessCode) {
      throw new Error('Access code not provided');
    }
    // Scenario C links to the Phase-1 submission; scenario B (Phase 2 only)
    // carries a client-generated responseId with phase1Skipped: true.
    if (!data.phase1SubmissionId && !(data.phase1Skipped === true && data.responseId)) {
      throw new Error('Phase-1 submission link is missing. Please complete Phase 1 first.');
    }
    const payload = {
      accessCode,
      phase: 2,
      phase1SubmissionId: data.phase1SubmissionId || null,
      phase1Skipped: data.phase1Skipped === true,
      responseId: data.responseId || null,
      weightsSource: data.weightsSource || null,
      phasesSelected: data.phasesSelected || null,
      name: data.name,
      role: data.role,
      pilot: data.pilot,
      country: data.country,
      email: data.email || '',
      indicatorSet: data.indicatorSet || 'real-13-v1',
      indicatorIds: data.indicatorIds,
      criteriaIds: data.criteriaIds,
      criteriaWeights: data.criteriaWeights,
      options: data.options,
      globalScores: data.globalScores,
      consent: data.consent
    };

    let response;
    try {
      response = await fetch(`${workerBase}${submitPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      throw new Error('Network error: unable to reach submission service');
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || `Phase-2 submission failed (${response.status})`);
    }
    return { success: true, submissionId: result.submissionId, message: result.message };
  }

  return {
    init,
    verifyAccessCode,
    saveSubmission,
    savePhase2Submission
  };
})();

export { Storage };
