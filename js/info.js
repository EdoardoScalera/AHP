// Shared (i) info overlay: registry + modal + delegated click handling.
// Content is plain text (rendered via textContent); call sites only pass a key.
const Info = (() => {
  const registry = new Map();
  let wired = false;

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function register(key, title, lines) {
    registry.set(key, { title, lines: (lines || []).filter(l => l != null && String(l).trim() !== '') });
  }

  function registerCriteria(list) {
    (list || []).forEach(c => {
      if (!c || !c.id) return;
      register(`crit:${c.id}`, c.name || c.id, [c.info || c.description || c.name || c.id]);
    });
  }

  function registerKpis(list) {
    (list || []).forEach(k => {
      if (!k || !k.id) return;
      const lines = [k.info || k.description || k.name || k.id];
      if (k.direction === 'higher') lines.push('Higher values are better.');
      else if (k.direction === 'lower') lines.push('Lower values are better.');
      register(`kpi:${k.id}`, `${k.code ? `${k.code} — ` : ''}${k.name || k.id}`, lines);
    });
  }

  function button(key, label) {
    return `<button type="button" class="info-btn" data-info-key="${escapeHtml(key)}" aria-label="More information about ${escapeHtml(label)}" title="More information">i</button>`;
  }

  function open(key) {
    const entry = registry.get(key);
    if (!entry) return;
    const modal = document.getElementById('info-modal');
    const title = document.getElementById('info-modal-title');
    const body = document.getElementById('info-modal-body');
    if (!modal || !title || !body) return;
    title.textContent = entry.title;
    body.innerHTML = '';
    entry.lines.forEach(line => {
      const p = document.createElement('p');
      p.textContent = line;
      body.appendChild(p);
    });
    modal.classList.remove('hidden');
    const close = document.getElementById('info-modal-close');
    if (close) close.focus();
  }

  function close() {
    const modal = document.getElementById('info-modal');
    if (modal) modal.classList.add('hidden');
  }

  // Shared static modals (matrix + consistency ratio), registered once on
  // setup so they are available in every scenario (Phase 1 and Phase 2).
  function registerShared() {
    register('matrix-info', 'About the comparison matrix', [
      'Each cell asks how many times more important the row item is compared to the column item.',
      'Enter a value from 1 to 9 (1 = equal, 3 = moderate, 5 = strong, 7 = very strong, 9 = extreme importance), or a fraction such as 1/3 when the column item is more important.',
      'An item compared with itself is always 1.',
      'The matrix is reciprocal: if A over B is 3, then B over A is automatically 1/3. Only the upper half is filled in — the lower half mirrors it.'
    ]);
    register('cr-info', 'About the Consistency Ratio (CR)', [
      'The Consistency Ratio checks whether your comparisons agree with each other: if A is more important than B, and B more important than C, then A should also come out stronger than C.',
      'CR = CI / RI: the consistency index (CI) measures the disagreement among your comparisons, and the Random Index (RI) is a reference value for random comparisons of the same size (Saaty\u2019s Random Index).',
      'CR \u2264 10% is considered acceptable.',
      'Above 10%, consider revising your judgments to improve quality \u2014 you can still submit (your responses are flagged for analysis).'
    ]);
  }

  function setup() {
    if (wired) return;
    wired = true;
    registerShared();
    document.addEventListener('click', e => {
      const btn = e.target.closest ? e.target.closest('button[data-info-key]') : null;
      if (btn) {
        e.preventDefault();
        open(btn.dataset.infoKey);
        return;
      }
      if (e.target && e.target.id === 'info-modal') close();
      const closeBtn = e.target.closest ? e.target.closest('#info-modal-close') : null;
      if (closeBtn) close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
  }

  return { register, registerCriteria, registerKpis, button, open, close, setup };
})();

export { Info };
