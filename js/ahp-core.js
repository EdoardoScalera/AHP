const AHP = (() => {
  const RI_VALUES = {
    1: 0,
    2: 0,
    3: 0.58,
    4: 0.9,
    5: 1.12,
    6: 1.24,
    7: 1.32,
    8: 1.41,
    9: 1.45,
    10: 1.49
  };

  function getRI(n) {
    return RI_VALUES[n] ?? 1.49;
  }

  function validateMatrix(matrix) {
    if (!Array.isArray(matrix) || matrix.length === 0) {
      return { valid: false, error: 'Matrix must be a non-empty array' };
    }
    const n = matrix.length;
    for (let i = 0; i < n; i++) {
      if (!Array.isArray(matrix[i]) || matrix[i].length !== n) {
        return { valid: false, error: `Row ${i} must have ${n} elements` };
      }
      for (let j = 0; j < n; j++) {
        const val = matrix[i][j];
        if (typeof val !== 'number' || !isFinite(val) || val <= 0) {
          return { valid: false, error: `Matrix[${i}][${j}] must be a positive number` };
        }
        if (i === j && Math.abs(val - 1) > 1e-10) {
          return { valid: false, error: `Diagonal element [${i}][${i}] must be 1` };
        }
        if (i !== j && Math.abs(matrix[i][j] - 1 / matrix[j][i]) > 1e-10) {
          return { valid: false, error: `Reciprocal property violated at [${i}][${j}] and [${j}][${i}]` };
        }
      }
    }
    return { valid: true };
  }

  function normalizeMatrix(matrix) {
    const n = matrix.length;
    const colSums = new Array(n).fill(0);

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        colSums[j] += matrix[i][j];
      }
    }

    const normalized = new Array(n);
    for (let i = 0; i < n; i++) {
      normalized[i] = new Array(n);
      for (let j = 0; j < n; j++) {
        normalized[i][j] = matrix[i][j] / colSums[j];
      }
    }
    return normalized;
  }

  function calculateWeights(matrix) {
    const validation = validateMatrix(matrix);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const normalized = normalizeMatrix(matrix);
    const n = matrix.length;
    const weights = new Array(n);

    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += normalized[i][j];
      }
      weights[i] = sum / n;
    }

    return weights;
  }

  function calculateLambdaMax(matrix, weights) {
    const n = matrix.length;
    let sum = 0;

    for (let i = 0; i < n; i++) {
      let aw_i = 0;
      for (let j = 0; j < n; j++) {
        aw_i += matrix[i][j] * weights[j];
      }
      sum += aw_i / weights[i];
    }

    return sum / n;
  }

  function calculateCI(lambdaMax, n) {
    if (n <= 1) return 0;
    return (lambdaMax - n) / (n - 1);
  }

  function calculateCR(ci, n) {
    const ri = getRI(n);
    if (ri === 0) return 0;
    return ci / ri;
  }

  function calculateAll(matrix) {
    const validation = validateMatrix(matrix);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const weights = calculateWeights(matrix);
    const lambdaMax = calculateLambdaMax(matrix, weights);
    const ci = calculateCI(lambdaMax, matrix.length);
    const cr = calculateCR(ci, matrix.length);
    const consistent = cr <= 0.10;

    return {
      weights,
      lambdaMax,
      CI: ci,
      CR: cr,
      consistent
    };
  }

  function parseInput(value) {
    const str = String(value).trim();
    if (!str) return null;

    if (str.includes('/')) {
      const [num, den] = str.split('/').map(s => parseFloat(s.trim()));
      if (isNaN(num) || isNaN(den) || den === 0) return null;
      return num / den;
    }

    const num = parseFloat(str);
    if (isNaN(num)) return null;
    return num;
  }

  function formatWeight(w) {
    return (w * 100).toFixed(1) + '%';
  }

  // Incomplete-matrix completion via logarithmic least squares (P3).
  // knownPairs: [{i, j, value}] with value = a_ij (i over j), 1/9..9.
  // Returns { matrix (n×n completed), weights, estimated (n×n bool, true if inferred) }.
  function solveLinear(A, b) {
    const n = A.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      }
      if (Math.abs(M[pivot][col]) < 1e-12) {
        throw new Error('Singular system');
      }
      [M[col], M[pivot]] = [M[pivot], M[col]];
      const div = M[col][col];
      for (let k = col; k <= n; k++) M[col][k] /= div;
      for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const factor = M[r][col];
        if (factor !== 0) {
          for (let k = col; k <= n; k++) M[r][k] -= factor * M[col][k];
        }
      }
    }
    return M.map(row => row[n]);
  }

  function completeIncomplete(knownPairs, n) {
    const direct = Array(n).fill(null).map(() => Array(n).fill(false));
    const edges = [];
    (knownPairs || []).forEach(p => {
      if (!p || typeof p.i !== 'number' || typeof p.j !== 'number' || typeof p.value !== 'number') return;
      if (p.i < 0 || p.j < 0 || p.i >= n || p.j >= n || p.i === p.j) return;
      if (!isFinite(p.value) || p.value < 1 / 9 - 1e-9 || p.value > 9 + 1e-9) return;
      if (direct[p.i][p.j]) return;
      direct[p.i][p.j] = true;
      direct[p.j][p.i] = true;
      edges.push({ i: p.i, j: p.j, v: p.value });
    });

    // Ensure connectivity: bridge disconnected components with neutral 1.0 links (still flagged estimated).
    const adj = Array(n).fill(null).map(() => []);
    edges.forEach(e => { adj[e.i].push(e.j); adj[e.j].push(e.i); });
    const comp = Array(n).fill(-1);
    let nComp = 0;
    for (let s = 0; s < n; s++) {
      if (comp[s] !== -1) continue;
      const stack = [s];
      comp[s] = nComp;
      while (stack.length) {
        const u = stack.pop();
        adj[u].forEach(v => { if (comp[v] === -1) { comp[v] = nComp; stack.push(v); } });
      }
      nComp++;
    }
    const bridge = [];
    for (let c = 1; c < nComp; c++) {
      const a = comp.indexOf(c - 1);
      const b = comp.indexOf(c);
      bridge.push({ i: a, j: b, v: 1 });
      adj[a].push(b);
      adj[b].push(a);
    }
    const all = edges.concat(bridge);

    // LLS normal equations on log-ratios, anchored at y_0 = 0.
    const idx = [];
    for (let k = 1; k < n; k++) idx.push(k);
    const m = n - 1;
    const L = Array(m).fill(null).map(() => Array(m).fill(0));
    const rhs = Array(m).fill(0);
    all.forEach(e => {
      if (e.i > 0) {
        L[e.i - 1][e.i - 1] += 1;
        rhs[e.i - 1] += Math.log(e.v);
      }
      if (e.j > 0) {
        L[e.j - 1][e.j - 1] += 1;
        rhs[e.j - 1] -= Math.log(e.v);
      }
      if (e.i > 0 && e.j > 0) {
        L[e.i - 1][e.j - 1] -= 1;
        L[e.j - 1][e.i - 1] -= 1;
      }
    });
    const y = [0];
    if (m > 0) {
      const sol = solveLinear(L, rhs);
      sol.forEach(v => y.push(v));
    }

    const matrix = Array(n).fill(null).map(() => Array(n).fill(1));
    const estimated = Array(n).fill(null).map(() => Array(n).fill(false));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        matrix[i][j] = Math.exp(y[i] - y[j]);
        estimated[i][j] = !direct[i][j];
      }
    }
    // Restore exact user values (avoid exp/log rounding drift).
    edges.forEach(e => {
      matrix[e.i][e.j] = e.v;
      matrix[e.j][e.i] = 1 / e.v;
    });

    const exps = y.map(v => Math.exp(v));
    const sum = exps.reduce((a, b) => a + b, 0);
    const weights = exps.map(v => v / sum);
    return { matrix, weights, estimated };
  }

  return {
    calculateWeights,
    normalizeMatrix,
    calculateLambdaMax,
    getRI,
    validateMatrix,
    calculateAll,
    parseInput,
    formatWeight,
    solveLinear,
    completeIncomplete
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AHP;
}

export { AHP };