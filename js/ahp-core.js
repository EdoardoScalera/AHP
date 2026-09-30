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

  return {
    calculateWeights,
    normalizeMatrix,
    calculateLambdaMax,
    getRI,
    validateMatrix,
    calculateAll,
    parseInput,
    formatWeight
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AHP;
}

export { AHP };