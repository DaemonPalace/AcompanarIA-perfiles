/* Utilidades estadísticas: PRNG con semilla, normales correlacionadas (cópula
   gaussiana vía descomposición de Cholesky con regularización), y muestreo
   categórico ponderado. Sin dependencias externas. */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const rand = mulberry32(seed >>> 0);
  let spare = null;
  return {
    uniform: () => rand(),
    normal: () => {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u, v, s;
      do {
        u = rand() * 2 - 1;
        v = rand() * 2 - 1;
        s = u * u + v * v;
      } while (s <= 0 || s >= 1);
      const mul = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * mul;
      return u * mul;
    },
    weightedIndex: (weights) => {
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return Math.floor(rand() * weights.length);
      let r = rand() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return weights.length - 1;
    }
  };
}

/** Cholesky decomposition of a symmetric matrix (array of arrays). Returns lower
 *  triangular L such that L*L^T = M, or throws if not positive definite. */
function choleskyDecompose(M) {
  const n = M.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
      if (i === j) {
        const val = M[i][i] - sum;
        if (val <= 1e-10) throw new Error("not positive definite");
        L[i][j] = Math.sqrt(val);
      } else {
        L[i][j] = (M[i][j] - sum) / L[j][j];
      }
    }
  }
  return L;
}

/** Attempts Cholesky on M; if it fails (matrix not PSD, common after manual edits
 *  to correlations), blends with the identity matrix with increasing ridge until
 *  it succeeds. Returns { L, regularized, epsilon }. */
function robustCholesky(M) {
  const n = M.length;
  const identity = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let eps = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const blended = M.map((row, i) => row.map((v, j) => (1 - eps) * v + eps * identity[i][j]));
    try {
      const L = choleskyDecompose(blended);
      return { L, regularized: eps > 0, epsilon: eps };
    } catch (e) {
      eps = eps === 0 ? 0.02 : Math.min(eps * 1.8, 0.9);
    }
  }
  // Último recurso: matriz identidad (variables independientes).
  return { L: choleskyDecompose(identity), regularized: true, epsilon: 1 };
}

/** Genera un vector de normales estándar correlacionadas según la matriz L (Cholesky). */
function sampleCorrelatedNormals(L, rng) {
  const n = L.length;
  const z = Array.from({ length: n }, () => rng.normal());
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j <= i; j++) s += L[i][j] * z[j];
    out[i] = s;
  }
  return out;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

window.STATS = { makeRng, choleskyDecompose, robustCholesky, sampleCorrelatedNormals, clamp };
