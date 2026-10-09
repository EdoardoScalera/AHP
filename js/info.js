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

  function setup() {
    if (wired) return;
    wired = true;
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
