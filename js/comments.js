// Contextual + general comments (Phase 1 + Phase 2).
// One shared slide-in panel serves every survey section: each card header
// carries a message-icon button (data-comment-phase/key) and each phase has
// a "General comments" entry. Texts live-save to per-phase localStorage keys
// (separate from the answer drafts) and ride the submission payloads via
// ui.js / app.js (storage.js allowlists `comments`). Empty texts are omitted.
const Comments = (() => {
  const MAX_LEN = 2000;
  const STORE = { p1: 'ahp-comments-p1-v1', p2: 'ahp-comments-p2-v1' };
  const TITLES = {
    'p1-criteria': 'Decision Criteria',
    'p1-tiers': 'Priority levels',
    'p1-guided': 'Guided Comparisons',
    'p1-matrix': 'Pairwise Comparison Matrix',
    'p1-cr': 'Consistency Check',
    'p1-plot': 'Your Priorities',
    'p1-general': 'General comments',
    'p2-indicators': 'Performance indicators',
    'p2-tiers': 'Priority levels',
    'p2-guided': 'Guided Comparisons',
    'p2-matrix': 'Pairwise Comparison Matrix',
    'p2-ranking': 'Final KPI Ranking',
    'p2-general': 'General comments'
  };

  let state = { p1: {}, p2: {} };
  let ctx = null; // { phase, key }
  let lastTrigger = null;
  let saveTimer = null;
  let wired = false;

  function phaseOf(key) {
    return String(key || '').startsWith('p2-') ? 'p2' : 'p1';
  }

  function titleOf(key) {
    const phase = phaseOf(key) === 'p1' ? 'Phase 1' : 'Phase 2';
    return `${phase} · ${TITLES[key] || key}`;
  }

  function getText(phase, key) {
    const bag = state[phase] || {};
    return typeof bag[key] === 'string' ? bag[key] : '';
  }

  // Non-empty texts only, trimmed and capped — keeps payloads clean.
  function getAll(phase) {
    const out = {};
    Object.entries(state[phase] || {}).forEach(([k, v]) => {
      const t = String(v == null ? '' : v).trim().slice(0, MAX_LEN);
      if (t) out[k] = t;
    });
    return out;
  }

  function persist(phase) {
    try {
      localStorage.setItem(STORE[phase], JSON.stringify(state[phase] || {}));
    } catch (e) { /* noop */ }
  }

  function persistSoon(phase) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(phase), 300);
  }

  function load() {
    ['p1', 'p2'].forEach(phase => {
      try {
        const d = JSON.parse(localStorage.getItem(STORE[phase]));
        if (!d || typeof d !== 'object') return;
        Object.entries(d).forEach(([k, v]) => {
          if (typeof k === 'string' && typeof v === 'string' && v) {
            state[phase][k] = v.slice(0, MAX_LEN);
          }
        });
      } catch (e) { /* noop */ }
    });
    refreshBadges();
  }

  function clear(phase) {
    state[phase] = {};
    try {
      localStorage.removeItem(STORE[phase]);
    } catch (e) { /* noop */ }
    refreshBadges();
  }

  function setText(phase, key, text) {
    if (!state[phase]) state[phase] = {};
    state[phase][key] = String(text == null ? '' : text).slice(0, MAX_LEN);
    refreshBadges();
    persistSoon(phase);
  }

  function refreshBadges() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('button[data-comment-phase][data-comment-key]').forEach(btn => {
      const has = !!getText(btn.dataset.commentPhase, btn.dataset.commentKey).trim();
      btn.classList.toggle('has-comment', has);
    });
  }

  function panel() {
    return document.getElementById('comment-panel');
  }

  function scrim() {
    return document.getElementById('comment-scrim');
  }

  function open(phase, key, trigger) {
    const p = panel();
    if (!p) return;
    ctx = { phase, key };
    lastTrigger = trigger || null;
    document.getElementById('comment-title').textContent = titleOf(key);
    const ta = document.getElementById('comment-text');
    ta.value = getText(phase, key);
    updateCount();
    p.classList.remove('hidden');
    requestAnimationFrame(() => p.classList.add('open'));
    const s = scrim();
    if (s) s.classList.remove('hidden');
    ta.focus();
  }

  function close(restoreFocus = true) {
    const p = panel();
    if (!p) return;
    if (ctx) persist(ctx.phase);
    p.classList.remove('open');
    p.classList.add('hidden');
    const s = scrim();
    if (s) s.classList.add('hidden');
    if (restoreFocus && lastTrigger && document.contains(lastTrigger)) lastTrigger.focus();
    ctx = null;
    lastTrigger = null;
  }

  function updateCount() {
    const ta = document.getElementById('comment-text');
    const count = document.getElementById('comment-count');
    if (ta && count) count.textContent = `${ta.value.length}/${MAX_LEN}`;
  }

  function init() {
    load();
    if (wired) return;
    wired = true;
    document.addEventListener('click', e => {
      const btn = e.target.closest ? e.target.closest('button[data-comment-phase][data-comment-key]') : null;
      if (btn) {
        e.preventDefault();
        open(btn.dataset.commentPhase, btn.dataset.commentKey, btn);
        return;
      }
      if (e.target.closest && e.target.closest('#comment-close')) { close(); return; }
      if (e.target.closest && e.target.closest('#comment-save')) { close(); return; }
      if (e.target.closest && e.target.closest('#comment-clear')) {
        const ta = document.getElementById('comment-text');
        if (ta && ctx) {
          ta.value = '';
          setText(ctx.phase, ctx.key, '');
          updateCount();
          ta.focus();
        }
        return;
      }
      if (e.target && e.target.id === 'comment-scrim') { close(); return; }
    });
    document.addEventListener('input', e => {
      if (e.target && e.target.id === 'comment-text' && ctx) {
        setText(ctx.phase, ctx.key, e.target.value);
        updateCount();
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && ctx) close();
    });
  }

  return { init, open, close, getText, getAll, setText, clear, refreshBadges, MAX_LEN };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Comments;
}

export { Comments };
