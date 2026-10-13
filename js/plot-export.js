// Shared high-resolution PNG export for result plots (Phase 1 + Phase 2).
// The on-screen charts are small responsive canvases (~900x300 CSS px at
// devicePixelRatio 1-2), so snapshotting them via toBase64Image() yields a
// blurry PNG when enlarged. Instead we re-render the same data off-screen at
// 3x into a temporary canvas (transparent background), then export that.
// Exported image contains: axes, bars, exact score label at each bar end,
// and the CR footer line (verbatim on-page wording). No chart title.
const EXPORT_SCALE = 3;
const EXPORT_WIDTH = 900; // CSS px -> ~2700 backing px at 3x

function exportHeight(n) {
  // Taller canvas for many bars (Phase 2: up to 14 KPIs) so bars stay legible.
  return Math.min(1000, Math.max(420, 140 + n * 48));
}

// Exact score at the end of each bar, e.g. "23.4%".
function dataLabelsPlugin(values) {
  return {
    id: 'export-data-labels',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      if (!meta) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = '#212121';
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      meta.data.forEach((bar, i) => {
        if (!bar || typeof values[i] !== 'number') return;
        ctx.fillText(`${values[i].toFixed(1)}%`, bar.x + 6, bar.y);
      });
      ctx.restore();
    }
  };
}

// CR footer line (verbatim on-page wording), bottom-left below the axes.
function crFooterPlugin(crText) {
  return {
    id: 'export-cr-footer',
    afterDraw(chart) {
      if (!crText) return;
      const area = chart.chartArea;
      if (!area) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = '#666666';
      ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText(crText, area.left, area.bottom + 24);
      ctx.restore();
    }
  };
}

function exportBarPng({ labels, values, colors, crText }) {
  if (!Array.isArray(labels) || !labels.length) return null;
  if (typeof window === 'undefined' || !window.Chart || typeof document === 'undefined') return null;
  const n = labels.length;
  const cssWidth = EXPORT_WIDTH;
  const cssHeight = exportHeight(n);
  const maxV = Math.max(...values, 1);

  const canvas = document.createElement('canvas');
  canvas.width = cssWidth * EXPORT_SCALE;
  canvas.height = cssHeight * EXPORT_SCALE;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  // Off-screen but attached: Chart.js needs layout against a sized box.
  canvas.style.position = 'fixed';
  canvas.style.left = '-10000px';
  canvas.style.top = '0';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  let url = null;
  try {
    const tmp = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: [...labels],
        datasets: [{
          data: [...values],
          backgroundColor: [...colors],
          borderColor: [...colors],
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        animation: false,
        devicePixelRatio: EXPORT_SCALE,
        layout: { padding: { top: 8, right: 64, bottom: 36, left: 8 } },
        plugins: {
          legend: { display: false },
          title: { display: false },
          tooltip: { enabled: false }
        },
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: maxV * 1.22,
            ticks: { callback: v => `${v}%` }
          },
          y: {
            ticks: { autoSkip: false }
          }
        }
      },
      plugins: [dataLabelsPlugin(values), crFooterPlugin(crText)]
    });
    url = tmp.toBase64Image('image/png', 1);
    tmp.destroy();
  } finally {
    canvas.remove();
  }
  return url;
}

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { exportBarPng, triggerDownload, EXPORT_SCALE };
}

export { exportBarPng, triggerDownload, EXPORT_SCALE };
