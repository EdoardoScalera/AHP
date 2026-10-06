// P4 results plot (Chart.js CDN with table fallback; view-only, never blocks submit).
const Plot = (() => {
  let chart = null;

  function available() {
    return typeof window !== 'undefined' && typeof window.Chart !== 'undefined';
  }

  function sortedRows(labels, weights) {
    return labels
      .map((label, i) => ({ label, weight: weights[i] }))
      .sort((a, b) => b.weight - a.weight);
  }

  function renderTable(labels, weights) {
    const tbody = document.getElementById('plot-tbody');
    if (!tbody) return;
    tbody.innerHTML = sortedRows(labels, weights).map(r =>
      `<tr><td>${escapeHtml(r.label)}</td><td>${(r.weight * 100).toFixed(1)}%</td></tr>`
    ).join('');
  }

  function render(labels, weights, cr, consistent) {
    const empty = document.getElementById('plot-empty');
    const wrap = document.getElementById('plot-wrap');
    if (!wrap) return;
    if (empty) empty.classList.add('hidden');
    wrap.classList.remove('hidden');

    renderTable(labels, weights);

    const crEl = document.getElementById('plot-cr');
    if (crEl && typeof cr === 'number') {
      crEl.textContent = `Consistency ratio: ${cr.toFixed(4)} ${consistent ? '(acceptable)' : '(exceeds 0.10 — flagged for analysis)'}`;
    }

    if (!available()) return;
    const canvas = document.getElementById('plot-canvas');
    if (!canvas) return;
    const rows = sortedRows(labels, weights);
    if (chart) {
      chart.destroy();
      chart = null;
    }
    chart = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.label),
        datasets: [{
          data: rows.map(r => Number((r.weight * 100).toFixed(1))),
          backgroundColor: '#1a5c8a',
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.parsed.x.toFixed(1)}%`
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { callback: v => `${v}%` }
          }
        }
      }
    });
  }

  function clear() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    const empty = document.getElementById('plot-empty');
    const wrap = document.getElementById('plot-wrap');
    if (empty) empty.classList.remove('hidden');
    if (wrap) wrap.classList.add('hidden');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  return { available, render, clear };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Plot;
}

export { Plot };
