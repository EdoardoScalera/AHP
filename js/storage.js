const Storage = (() => {
  let workerBase = '';
  let submitPath = '/submit';

  function init(cfg) {
    if (!cfg || !cfg.WORKER_URL) {
      throw new Error('Worker configuration is missing. Check js/config.js WORKER_URL');
    }
    workerBase = String(cfg.WORKER_URL).replace(/\/+$/, '');
    if (cfg.SUBMIT_PATH) submitPath = cfg.SUBMIT_PATH;
    if (workerBase.includes('YOUR-SUBDOMAIN')) {
      console.warn('WORKER_URL still uses placeholder – set your deployed Worker URL in js/config.js');
    }
  }

  async function saveSubmission(data) {
    if (!workerBase) {
      throw new Error('Storage not initialized. Check js/config.js');
    }
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const turnstileToken = data.turnstileToken || '';
    if (!turnstileToken && !isLocalHost) {
      throw new Error('Turnstile verification is required. Please complete the challenge above.');
    }
    const payload = {
      turnstileToken,
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
      comments: data.comments || {},
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
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const turnstileToken = data.turnstileToken || '';
    if (!turnstileToken && !isLocalHost) {
      throw new Error('Turnstile verification is required. Please complete the challenge above.');
    }
    if (!data.phase1SubmissionId && !(data.phase1Skipped === true && data.responseId)) {
      throw new Error('Criteria priorities link is missing. Please complete that part first.');
    }
    const payload = {
      turnstileToken,
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
      indicatorSet: data.indicatorSet || 'real-14-v3',
      indicatorIds: data.indicatorIds,
      customIndicators: Array.isArray(data.customIndicators) ? data.customIndicators : [],
      criteriaIds: data.criteriaIds,
      criteriaWeights: data.criteriaWeights,
      options: data.options,
      globalScores: data.globalScores,
      comments: data.comments || {},
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
      throw new Error(result.error || `Indicators grading submission failed (${response.status})`);
    }
    return { success: true, submissionId: result.submissionId, message: result.message };
  }

  return {
    init,
    saveSubmission,
    savePhase2Submission
  };
})();

export { Storage };
