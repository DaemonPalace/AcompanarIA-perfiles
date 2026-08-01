/* Motor de generación de perfiles sintéticos.
   Orden de generación por perfil:
   1. Variables categóricas independientes (muestreo ponderado).
   2. Vector de normales estándar correlacionadas (cópula gaussiana) para las
      variables numéricas latentes habilitadas.
   3. Reglas de influencia: las categorías elegidas en (1) desplazan (en
      desviaciones estándar) las normales de (2) antes de escalarlas a su rango.
   4. Variables derivadas: bins (cortes clínicos) o fórmulas (ideación suicida,
      estado de ánimo) calculadas a partir de los valores numéricos finales.
*/

function keyPair(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

function getCorrelation(state, a, b) {
  if (a === b) return 1;
  const k = keyPair(a, b);
  return state.correlations[k] || 0;
}

function buildCorrelationMatrix(state, ids) {
  return ids.map((a) => ids.map((b) => getCorrelation(state, a, b)));
}

function sampleCategorical(state, id, rng) {
  const v = state.categorical[id];
  const weights = v.options.map((o) => Math.max(0, Number(o.weight) || 0));
  const idx = rng.weightedIndex(weights);
  return v.options[idx].label;
}

function deriveFromBins(value, bins) {
  const sorted = [...bins].sort((a, b) => a.max - b.max);
  for (const b of sorted) if (value <= b.max) return b.label;
  return sorted[sorted.length - 1].label;
}

function logistic(x) { return 1 / (1 + Math.exp(-x)); }

/** Fórmulas especiales para variables derivadas que no son un simple binning de
 *  una sola variable numérica. */
function evalFormula(name, numericVals, rng) {
  if (name === "estado_animo") {
    const angustia = numericVals.angustia ?? 5;
    const soledad = numericVals.soledad ?? 5;
    const avg = (angustia + soledad) / 2;
    if (avg <= 2) return "Muy bien";
    if (avg <= 4) return "Bien";
    if (avg <= 6) return "Regular";
    if (avg <= 8) return "Mal";
    return "Muy mal";
  }
  if (name === "ideacion_suicida") {
    const g = numericVals.gravedad_depresion ?? 10; // 0-27
    const angustia = numericVals.angustia ?? 5; // 0-10
    const soledad = numericVals.soledad ?? 5; // 0-10
    const sentido = numericVals.sentido_vida ?? 5; // 0-10, mayor = mejor
    // Combinación logística: severidad depresiva + angustia + soledad - sentido de vida,
    // calibrada para una tasa base baja en perfiles leves y creciente en perfiles graves.
    const z = -4.2 + (g / 27) * 4.5 + (angustia / 10) * 1.8 + (soledad / 10) * 1.2 - (sentido / 10) * 1.5;
    const p = logistic(z);
    return rng.uniform() < p ? "Presente" : "Ausente";
  }
  return "N/D";
}

function generateProfiles(state, n, seed) {
  const rng = STATS.makeRng(seed >>> 0);

  const numericIds = state.numericOrder.filter((id) => state.numeric[id] && state.numeric[id].enabled);
  const catIds = state.categoricalOrder.filter((id) => state.categorical[id] && state.categorical[id].enabled);
  const derivedIds = state.derivedOrder.filter((id) => state.derived[id] && state.derived[id].enabled);

  const corrMatrix = buildCorrelationMatrix(state, numericIds);
  const { L, regularized, epsilon } = STATS.robustCholesky(corrMatrix);

  // Índice rápido de reglas de influencia activas, agrupadas por variable categórica.
  const rulesByCat = {};
  for (const rule of state.influenceRules) {
    if (!catIds.includes(rule.catVar)) continue;
    if (!numericIds.includes(rule.targetNumeric)) continue;
    (rulesByCat[rule.catVar] = rulesByCat[rule.catVar] || []).push(rule);
  }

  const profiles = [];
  for (let i = 0; i < n; i++) {
    const profile = { id: `SYN-${String(i + 1).padStart(4, "0")}` };
    const catValues = {};

    for (const id of catIds) {
      const val = sampleCategorical(state, id, rng);
      catValues[id] = val;
      profile[state.categorical[id].label] = val;
    }

    const z = STATS.sampleCorrelatedNormals(L, rng);
    const offsets = new Array(numericIds.length).fill(0);
    for (const catId of Object.keys(rulesByCat)) {
      const chosen = catValues[catId];
      for (const rule of rulesByCat[catId]) {
        if (rule.catOption === chosen) {
          const idx = numericIds.indexOf(rule.targetNumeric);
          if (idx >= 0) offsets[idx] += Number(rule.effect) || 0;
        }
      }
    }

    const numericVals = {};
    numericIds.forEach((id, idx) => {
      const def = state.numeric[id];
      const raw = def.mean + (z[idx] + offsets[idx]) * def.sd;
      const value = STATS.clamp(raw, def.min, def.max);
      numericVals[id] = value;
      profile[def.label] = Math.round(value * 100) / 100;
    });

    for (const id of derivedIds) {
      const def = state.derived[id];
      let val;
      if (def.kind === "bins") {
        const source = numericVals[def.sourceNumeric];
        val = source === undefined ? "N/D" : deriveFromBins(source, def.bins);
      } else {
        val = evalFormula(def.formula, numericVals, rng);
      }
      profile[def.label] = val;
    }

    profiles.push(profile);
  }

  return { profiles, numericIds, catIds, derivedIds, corrMatrix, regularized, epsilon };
}

window.GENERATOR = { generateProfiles, buildCorrelationMatrix, getCorrelation, keyPair, deriveFromBins, evalFormula };
