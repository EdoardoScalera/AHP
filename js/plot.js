// P4 results plot (Chart.js CDN with table fallback; view-only, never blocks submit).
import { colorsFor } from './palette.js';
import { exportBarPng, triggerDownload } from './plot-export.js';

const Plot = (() => {
  let chart = null;
  let lastExport = null; // { labels, values, colors, crText } for 3x PNG export

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
    lastExport = null;

    const crEl = document.getElementById('plot-cr');
    let crText = '';
    if (crEl && typeof cr === 'number') {
      crText = `Consistency ratio: ${(cr * 100).toFixed(1)}% ${consistent ? '(acceptable)' : '(exceeds 10% — flagged for analysis)'}`;
      crEl.textContent = crText;
    }

    if (!available()) return;
    const canvas = document.getElementById('plot-canvas');
    if (!canvas) return;
    const rows = sortedRows(labels, weights);
    if (chart) {
      chart.destroy();
      chart = null;
    }
    // One categorical colour per bar, assigned by sorted rank (rank 1 ->
    // PALETTE[0]). Custom criteria are included in `rows` like any other
    // criterion, so they simply take the colour of their rank position.
    const barColors = colorsFor(rows.length);
    lastExport = {
      labels: rows.map(r => r.label),
      values: rows.map(r => Number((r.weight * 100).toFixed(1))),
      colors: [...barColors],
      crText
    };
    chart = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: rows.map(r => r.label),
        datasets: [{
          data: rows.map(r => Number((r.weight * 100).toFixed(1))),
          backgroundColor: barColors,
          borderColor: barColors,
          borderWidth: 1,
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
    setDownloadEnabled(true);
  }

  function setDownloadEnabled(enabled) {
    const btn = document.getElementById('btn-download-plot');
    if (btn) btn.disabled = !enabled;
  }

  // High-resolution PNG export: re-renders off-screen at 3x (axes, bars,
  // end-of-bar scores, CR footer; transparent background). Falls back to the
  // on-screen canvas snapshot when there is no stored render.
  function download(filename = 'criteria-priorities.png') {
    try {
      if (lastExport) {
        const url = exportBarPng(lastExport);
        if (url) {
          triggerDownload(url, filename);
          return true;
        }
      }
      if (!chart) return false;
      triggerDownload(chart.toBase64Image('image/png', 1), filename);
      return true;
    } catch (e) {
      console.warn('Plot PNG download failed:', e);
      return false;
    }
  }

  function clear() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
    lastExport = null;
    setDownloadEnabled(false);
    const empty = document.getElementById('plot-empty');
    const wrap = document.getElementById('plot-wrap');
    if (empty) empty.classList.remove('hidden');
    if (wrap) wrap.classList.add('hidden');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  return { available, render, clear, download };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Plot;
}

export { Plot };
