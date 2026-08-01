/* Wiring de la interfaz: estado mutable + render de las 4 pestañas + persistencia. */

const STORAGE_KEY = "acompanar-synthetic-state-v1";
let state = loadState();
let lastResult = null; // último resultado de generación (para export)
let previewResult = null; // muestra pequeña para gráficos en vivo

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return SCHEMA_BUILDER.buildDefaultState();
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function resetState() {
  if (!confirm("¿Restaurar todos los valores por defecto? Se perderán tus ediciones.")) return;
  state = SCHEMA_BUILDER.buildDefaultState();
  saveState();
  renderActiveTab();
}

function dimLabel(id) {
  const d = state.dimensions.find((x) => x.id === id);
  return d ? d.label : id;
}

function enabledNumeric() { return state.numericOrder.filter((id) => state.numeric[id] && state.numeric[id].enabled); }
function enabledCategorical() { return state.categoricalOrder.filter((id) => state.categorical[id] && state.categorical[id].enabled); }
function enabledDerived() { return state.derivedOrder.filter((id) => state.derived[id] && state.derived[id].enabled); }

/* ---------------------------- TABS ---------------------------- */

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.querySelector(`.panel[data-panel="${btn.dataset.tab}"]`).classList.add("active");
      renderActiveTab();
    });
  });
}

function activeTabName() {
  const btn = document.querySelector(".tab-btn.active");
  return btn ? btn.dataset.tab : "variables";
}

function renderActiveTab() {
  const tab = activeTabName();
  if (tab === "variables") renderVariablesTab();
  if (tab === "correlaciones") renderCorrelacionesTab();
  if (tab === "efectos") renderEfectosTab();
  if (tab === "generar") renderGenerarTab();
}

/* ------------------------ VARIABLES TAB ------------------------ */

function renderVariablesTab() {
  const root = document.getElementById("variables-root");
  const countNum = enabledNumeric().length, countCat = enabledCategorical().length, countDer = enabledDerived().length;
  let html = `<p class="hint">Variables activas: <strong>${countNum}</strong> numéricas · <strong>${countCat}</strong> categóricas · <strong>${countDer}</strong> derivadas. Desmarca para excluir de la generación sin perder la configuración, o usa 🗑 para eliminar definitivamente.</p>`;

  for (const dim of state.dimensions) {
    html += `<section class="dim-block"><h3>${dim.label}</h3><div class="var-rows">`;

    for (const id of state.numericOrder) {
      const v = state.numeric[id];
      if (v.dim !== dim.id) continue;
      html += `
      <div class="var-row ${v.enabled ? "" : "disabled"}">
        <label class="var-toggle"><input type="checkbox" data-action="toggle" data-kind="numeric" data-id="${id}" ${v.enabled ? "checked" : ""}></label>
        <div class="var-body">
          <div class="var-title"><strong>${v.label}</strong> <span class="badge">numérica · ${v.unit}</span></div>
          <div class="var-controls">
            <label>Media <input type="number" step="0.1" data-field="mean" data-kind="numeric" data-id="${id}" value="${v.mean}"></label>
            <label>DE <input type="number" step="0.1" min="0" data-field="sd" data-kind="numeric" data-id="${id}" value="${v.sd}"></label>
            <label>Mín <input type="number" step="0.1" data-field="min" data-kind="numeric" data-id="${id}" value="${v.min}"></label>
            <label>Máx <input type="number" step="0.1" data-field="max" data-kind="numeric" data-id="${id}" value="${v.max}"></label>
          </div>
          <div class="var-source">${v.source}</div>
        </div>
        <button class="icon-btn" title="Eliminar variable" data-action="remove" data-kind="numeric" data-id="${id}">🗑</button>
      </div>`;
    }

    for (const id of state.categoricalOrder) {
      const v = state.categorical[id];
      if (v.dim !== dim.id) continue;
      html += `
      <div class="var-row ${v.enabled ? "" : "disabled"}">
        <label class="var-toggle"><input type="checkbox" data-action="toggle" data-kind="categorical" data-id="${id}" ${v.enabled ? "checked" : ""}></label>
        <div class="var-body">
          <div class="var-title"><strong>${v.label}</strong> <span class="badge">categórica</span></div>
          <div class="option-list">
            ${v.options.map((o, i) => `
              <span class="option-chip">
                <input type="text" data-field="opt-label" data-kind="categorical" data-id="${id}" data-idx="${i}" value="${escapeAttr(o.label)}">
                <input type="number" min="0" data-field="opt-weight" data-kind="categorical" data-id="${id}" data-idx="${i}" value="${o.weight}">
                <button class="icon-btn tiny" data-action="remove-option" data-id="${id}" data-idx="${i}" title="Quitar opción">✕</button>
              </span>`).join("")}
            <button class="icon-btn tiny" data-action="add-option" data-id="${id}" title="Agregar opción">+ opción</button>
          </div>
          <div class="var-source">${v.source}</div>
        </div>
        <button class="icon-btn" title="Eliminar variable" data-action="remove" data-kind="categorical" data-id="${id}">🗑</button>
      </div>`;
    }

    for (const id of state.derivedOrder) {
      const v = state.derived[id];
      if (v.dim !== dim.id) continue;
      const binsHtml = v.kind === "bins" ? `
        <div class="option-list">
          ${v.bins.map((b, i) => `
            <span class="option-chip">
              <input type="number" step="0.1" data-field="bin-max" data-id="${id}" data-idx="${i}" value="${b.max}" style="width:64px">
              <input type="text" data-field="bin-label" data-id="${id}" data-idx="${i}" value="${escapeAttr(b.label)}">
              <button class="icon-btn tiny" data-action="remove-bin" data-id="${id}" data-idx="${i}" title="Quitar corte">✕</button>
            </span>`).join("")}
          <button class="icon-btn tiny" data-action="add-bin" data-id="${id}" title="Agregar corte">+ corte</button>
        </div>
        <div class="var-source">Derivada de: ${state.numeric[v.sourceNumeric] ? state.numeric[v.sourceNumeric].label : v.sourceNumeric}</div>`
        : `<div class="var-source">Derivada por fórmula (ver documentación del generador)</div>`;
      html += `
      <div class="var-row ${v.enabled ? "" : "disabled"}">
        <label class="var-toggle"><input type="checkbox" data-action="toggle" data-kind="derived" data-id="${id}" ${v.enabled ? "checked" : ""}></label>
        <div class="var-body">
          <div class="var-title"><strong>${v.label}</strong> <span class="badge">derivada · ${v.kind}</span></div>
          ${binsHtml}
          <div class="var-source">${v.source}</div>
        </div>
        <button class="icon-btn" title="Eliminar variable" data-action="remove" data-kind="derived" data-id="${id}">🗑</button>
      </div>`;
    }

    html += `</div></section>`;
  }

  html += `
  <section class="dim-block add-block">
    <h3>Agregar nueva variable</h3>
    <div class="add-form">
      <label>Dimensión
        <select id="new-var-dim">${state.dimensions.map((d) => `<option value="${d.id}">${d.label}</option>`).join("")}</select>
      </label>
      <label>Tipo
        <select id="new-var-kind">
          <option value="numeric">Numérica (continua)</option>
          <option value="categorical">Categórica</option>
        </select>
      </label>
      <label>Nombre
        <input type="text" id="new-var-label" placeholder="Ej. Apoyo espiritual percibido">
      </label>
      <div id="new-var-numeric-fields" class="inline-fields">
        <label>Mín <input type="number" id="new-var-min" value="0" step="0.1"></label>
        <label>Máx <input type="number" id="new-var-max" value="10" step="0.1"></label>
        <label>Media <input type="number" id="new-var-mean" value="5" step="0.1"></label>
        <label>DE <input type="number" id="new-var-sd" value="2" step="0.1"></label>
      </div>
      <div id="new-var-cat-fields" class="inline-fields" style="display:none">
        <label>Opciones (formato "Etiqueta:peso, Etiqueta:peso")
          <input type="text" id="new-var-options" placeholder="Sí:50, No:50">
        </label>
      </div>
      <button class="primary-btn" data-action="add-var">Agregar variable</button>
    </div>
  </section>`;

  root.innerHTML = html;

  document.getElementById("new-var-kind").addEventListener("change", (e) => {
    const isNum = e.target.value === "numeric";
    document.getElementById("new-var-numeric-fields").style.display = isNum ? "flex" : "none";
    document.getElementById("new-var-cat-fields").style.display = isNum ? "none" : "flex";
  });
}

function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

function slugify(label) {
  const base = label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "var";
  let id = base, n = 1;
  while (state.numeric[id] || state.categorical[id] || state.derived[id]) { id = `${base}_${n++}`; }
  return id;
}

function handleVariablesRootEvents(e) {
  const t = e.target;

  if (e.type === "click") {
    const actionEl = t.closest("[data-action]");
    if (actionEl) {
      const action = actionEl.dataset.action;
      const kind = actionEl.dataset.kind, id = actionEl.dataset.id, idx = actionEl.dataset.idx;

      if (action === "remove") {
        if (!confirm("¿Eliminar esta variable definitivamente?")) return;
        if (kind === "numeric") {
          delete state.numeric[id];
          state.numericOrder = state.numericOrder.filter((x) => x !== id);
          state.influenceRules = state.influenceRules.filter((r) => r.targetNumeric !== id);
          Object.keys(state.correlations).forEach((k) => { if (k.split("|").includes(id)) delete state.correlations[k]; });
        } else if (kind === "categorical") {
          delete state.categorical[id];
          state.categoricalOrder = state.categoricalOrder.filter((x) => x !== id);
          state.influenceRules = state.influenceRules.filter((r) => r.catVar !== id);
        } else if (kind === "derived") {
          delete state.derived[id];
          state.derivedOrder = state.derivedOrder.filter((x) => x !== id);
        }
        saveState(); renderVariablesTab(); return;
      }

      if (action === "add-option") {
        state.categorical[id].options.push({ label: "Nueva opción", weight: 10 });
        saveState(); renderVariablesTab(); return;
      }
      if (action === "remove-option") {
        state.categorical[id].options.splice(Number(idx), 1);
        saveState(); renderVariablesTab(); return;
      }
      if (action === "add-bin") {
        const v = state.derived[id];
        v.bins.push({ max: v.bins.length ? v.bins[v.bins.length - 1].max + 1 : 1, label: "Nuevo corte" });
        saveState(); renderVariablesTab(); return;
      }
      if (action === "remove-bin") {
        state.derived[id].bins.splice(Number(idx), 1);
        saveState(); renderVariablesTab(); return;
      }
      if (action === "add-var") {
        const dim = document.getElementById("new-var-dim").value;
        const kindSel = document.getElementById("new-var-kind").value;
        const label = document.getElementById("new-var-label").value.trim();
        if (!label) { alert("Ingresa un nombre para la variable."); return; }
        const newId = slugify(label);
        if (kindSel === "numeric") {
          const min = Number(document.getElementById("new-var-min").value);
          const max = Number(document.getElementById("new-var-max").value);
          const mean = Number(document.getElementById("new-var-mean").value);
          const sd = Number(document.getElementById("new-var-sd").value);
          state.numeric[newId] = { id: newId, label, dim, unit: `${min}-${max}`, min, max, mean, sd, enabled: true, source: "Variable personalizada" };
          state.numericOrder.push(newId);
        } else {
          const raw = document.getElementById("new-var-options").value.trim();
          const options = raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
            const [lab, w] = s.split(":").map((x) => x.trim());
            return { label: lab || s, weight: Number(w) || 10 };
          });
          if (!options.length) { alert('Ingresa al menos una opción, formato "Etiqueta:peso".'); return; }
          state.categorical[newId] = { id: newId, label, dim, enabled: true, source: "Variable personalizada", options };
          state.categoricalOrder.push(newId);
        }
        saveState(); renderVariablesTab(); return;
      }
    }
  }

  if (e.type === "change" || e.type === "input") {
    const field = t.dataset.field, kind = t.dataset.kind, id = t.dataset.id, idx = t.dataset.idx;
    if (t.dataset.action === "toggle") {
      state[kind][id].enabled = t.checked;
      saveState(); return;
    }
    if (!field) return;
    if (kind === "numeric" && ["mean", "sd", "min", "max"].includes(field)) {
      state.numeric[id][field] = Number(t.value);
      saveState(); return;
    }
    if (field === "opt-label") { state.categorical[id].options[idx].label = t.value; saveState(); return; }
    if (field === "opt-weight") { state.categorical[id].options[idx].weight = Number(t.value); saveState(); return; }
    if (field === "bin-max") { state.derived[id].bins[idx].max = Number(t.value); saveState(); return; }
    if (field === "bin-label") { state.derived[id].bins[idx].label = t.value; saveState(); return; }
  }
}

/* --------------------------- CORRELACIONES TAB --------------------------- */

let selectedPair = null;

function renderCorrelacionesTab() {
  const ids = enabledNumeric();
  const labels = ids.map((id) => state.numeric[id].label);
  const matrix = GENERATOR.buildCorrelationMatrix(state, ids);
  const canvas = document.getElementById("corr-heatmap");
  const size = Math.max(420, labels.length * 34 + 140);
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";

  VIZ.drawHeatmap(canvas, matrix, labels, {
    metaLookup: (a, b) => {
      const ia = labels.indexOf(a), ib = labels.indexOf(b);
      const idA = ids[ia], idB = ids[ib];
      return state.correlationMeta[GENERATOR.keyPair(idA, idB)] || "";
    },
    onCellClick: (i, j) => {
      if (ids[i] === ids[j]) return;
      selectedPair = [ids[i], ids[j]];
      renderPairEditor();
    }
  });

  renderPairEditor();
  renderInfluenceRules();
}

function renderPairEditor() {
  const box = document.getElementById("pair-editor");
  if (!selectedPair) {
    box.innerHTML = `<p class="hint">Haz clic en una celda del mapa de calor para editar esa correlación.</p>`;
    return;
  }
  const [a, b] = selectedPair;
  if (!state.numeric[a] || !state.numeric[b]) { selectedPair = null; return renderPairEditor(); }
  const key = GENERATOR.keyPair(a, b);
  const val = state.correlations[key] || 0;
  const meta = state.correlationMeta[key] || "Sin fuente registrada (ajuste manual)";
  box.innerHTML = `
    <h4>${state.numeric[a].label} × ${state.numeric[b].label}</h4>
    <label class="slider-row">
      <input type="range" id="pair-slider" min="-1" max="1" step="0.01" value="${val}">
      <input type="number" id="pair-number" min="-1" max="1" step="0.01" value="${val}">
    </label>
    <p class="var-source">${meta}</p>
    <button class="icon-btn" data-action="clear-pair">Restablecer a 0</button>`;

  const slider = document.getElementById("pair-slider");
  const number = document.getElementById("pair-number");
  const apply = (v) => {
    const clamped = Math.max(-1, Math.min(1, v));
    state.correlations[key] = clamped;
    state.correlationMeta[key] = state.correlationMeta[key] || "Ajuste manual del usuario";
    saveState();
    renderCorrelacionesTab();
  };
  slider.addEventListener("input", () => { number.value = slider.value; });
  slider.addEventListener("change", () => apply(Number(slider.value)));
  number.addEventListener("change", () => apply(Number(number.value)));
  box.querySelector('[data-action="clear-pair"]').addEventListener("click", () => {
    delete state.correlations[key];
    delete state.correlationMeta[key];
    saveState();
    renderCorrelacionesTab();
  });
}

function renderInfluenceRules() {
  const box = document.getElementById("influence-rules");
  const catIds = enabledCategorical();
  const numIds = enabledNumeric();

  let rowsHtml = state.influenceRules.map((r) => `
    <tr>
      <td>${state.categorical[r.catVar] ? state.categorical[r.catVar].label : r.catVar}</td>
      <td>${r.catOption}</td>
      <td>${state.numeric[r.targetNumeric] ? state.numeric[r.targetNumeric].label : r.targetNumeric}</td>
      <td><input type="number" step="0.05" value="${r.effect}" data-rule-id="${r.id}" data-rule-field="effect" style="width:70px"></td>
      <td class="var-source">${r.source}</td>
      <td><button class="icon-btn tiny" data-action="remove-rule" data-rule-id="${r.id}">✕</button></td>
    </tr>`).join("");

  box.innerHTML = `
    <table class="rules-table">
      <thead><tr><th>Si la variable</th><th>es</th><th>desplaza a</th><th>en (DE)</th><th>fuente</th><th></th></tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="6" class="hint">Sin reglas de influencia activas.</td></tr>`}</tbody>
    </table>
    <div class="add-form">
      <select id="rule-catvar">${catIds.map((id) => `<option value="${id}">${state.categorical[id].label}</option>`).join("")}</select>
      <select id="rule-catoption"></select>
      <select id="rule-target">${numIds.map((id) => `<option value="${id}">${state.numeric[id].label}</option>`).join("")}</select>
      <input type="number" id="rule-effect" step="0.05" value="0.3" style="width:70px" title="Efecto en desviaciones estándar">
      <input type="text" id="rule-source" placeholder="Fuente / justificación" style="min-width:160px">
      <button class="primary-btn" data-action="add-rule">Agregar regla</button>
    </div>`;

  const catSel = document.getElementById("rule-catvar");
  const optSel = document.getElementById("rule-catoption");
  const fillOptions = () => {
    const v = state.categorical[catSel.value];
    optSel.innerHTML = v ? v.options.map((o) => `<option value="${escapeAttr(o.label)}">${o.label}</option>`).join("") : "";
  };
  if (catSel.options.length) { fillOptions(); catSel.addEventListener("change", fillOptions); }

  box.querySelectorAll('[data-rule-field="effect"]').forEach((inp) => {
    inp.addEventListener("change", () => {
      const rule = state.influenceRules.find((r) => r.id === inp.dataset.ruleId);
      if (rule) { rule.effect = Number(inp.value); saveState(); }
    });
  });
  box.querySelectorAll('[data-action="remove-rule"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      state.influenceRules = state.influenceRules.filter((r) => r.id !== btn.dataset.ruleId);
      saveState(); renderInfluenceRules();
    });
  });
  const addBtn = box.querySelector('[data-action="add-rule"]');
  if (addBtn) addBtn.addEventListener("click", () => {
    if (!catSel.value || !optSel.value) { alert("No hay variables categóricas disponibles para crear una regla."); return; }
    state.influenceRules.push({
      id: `r_${Date.now()}`,
      catVar: catSel.value,
      catOption: optSel.value,
      targetNumeric: document.getElementById("rule-target").value,
      effect: Number(document.getElementById("rule-effect").value) || 0,
      source: document.getElementById("rule-source").value || "Ajuste manual del usuario"
    });
    saveState(); renderInfluenceRules();
  });
}

/* ----------------------------- EFECTOS TAB ----------------------------- */

function regeneratePreview() {
  previewResult = GENERATOR.generateProfiles(state, 400, 12345);
  return previewResult;
}

function renderEfectosTab() {
  regeneratePreview();
  const { profiles } = previewResult;
  const numIds = enabledNumeric();
  const catIds = enabledCategorical();
  const derIds = enabledDerived();

  const grid = document.getElementById("hist-grid");
  grid.innerHTML = numIds.map((id) => `
    <div class="chart-card">
      <div class="chart-title">${state.numeric[id].label}</div>
      <canvas class="hist-canvas" data-var="${id}"></canvas>
    </div>`).join("") + [...catIds, ...derIds].map((id) => {
    const def = state.categorical[id] || state.derived[id];
    return `<div class="chart-card"><div class="chart-title">${def.label}</div><canvas class="bar-canvas" data-var="${id}" data-src="${state.categorical[id] ? "cat" : "der"}"></canvas></div>`;
  }).join("");

  requestAnimationFrame(() => {
    numIds.forEach((id) => {
      const c = grid.querySelector(`canvas.hist-canvas[data-var="${id}"]`);
      const vals = profiles.map((p) => p[state.numeric[id].label]);
      VIZ.drawHistogram(c, vals, { min: state.numeric[id].min, max: state.numeric[id].max });
    });
    catIds.forEach((id) => {
      const c = grid.querySelector(`canvas.bar-canvas[data-var="${id}"]`);
      const def = state.categorical[id];
      const label = def.label;
      const counts = {};
      def.options.forEach((o) => (counts[o.label] = 0));
      profiles.forEach((p) => { counts[p[label]] = (counts[p[label]] || 0) + 1; });
      const cats = Object.keys(counts);
      VIZ.drawBarChart(c, cats, cats.map((k) => counts[k]));
    });
    derIds.forEach((id) => {
      const c = grid.querySelector(`canvas.bar-canvas[data-var="${id}"]`);
      const def = state.derived[id];
      const label = def.label;
      const counts = {};
      profiles.forEach((p) => { counts[p[label]] = (counts[p[label]] || 0) + 1; });
      const cats = Object.keys(counts);
      VIZ.drawBarChart(c, cats, cats.map((k) => counts[k]));
    });
  });

  const xSel = document.getElementById("scatter-x");
  const ySel = document.getElementById("scatter-y");
  const gSel = document.getElementById("scatter-group");
  const opts = numIds.map((id) => `<option value="${id}">${state.numeric[id].label}</option>`).join("");
  xSel.innerHTML = opts; ySel.innerHTML = opts;
  gSel.innerHTML = `<option value="">(ninguna)</option>` + [...catIds, ...derIds].map((id) => {
    const def = state.categorical[id] || state.derived[id];
    return `<option value="${id}">${def.label}</option>`;
  }).join("");
  if (numIds.length > 1) ySel.selectedIndex = 1;

  const drawScatterNow = () => {
    const xId = xSel.value, yId = ySel.value, gId = gSel.value;
    if (!xId || !yId) return;
    const xs = profiles.map((p) => p[state.numeric[xId].label]);
    const ys = profiles.map((p) => p[state.numeric[yId].label]);
    let groups = null;
    if (gId) {
      const def = state.categorical[gId] || state.derived[gId];
      groups = profiles.map((p) => p[def.label]);
    }
    VIZ.drawScatter(document.getElementById("scatter-canvas"), xs, ys, groups, {
      xMin: state.numeric[xId].min, xMax: state.numeric[xId].max,
      yMin: state.numeric[yId].min, yMax: state.numeric[yId].max,
      xLabel: state.numeric[xId].label, yLabel: state.numeric[yId].label
    });
  };
  xSel.onchange = drawScatterNow; ySel.onchange = drawScatterNow; gSel.onchange = drawScatterNow;
  drawScatterNow();
}

/* ----------------------------- GENERAR TAB ----------------------------- */

function renderGenerarTab() {
  const box = document.getElementById("generar-output");
  if (!lastResult) { box.innerHTML = `<p class="hint">Configura la cantidad de perfiles y presiona "Generar dataset".</p>`; return; }
  const { profiles, regularized } = lastResult;
  const cols = Object.keys(profiles[0]);
  const previewRows = profiles.slice(0, 15);
  box.innerHTML = `
    ${regularized ? `<p class="warn">⚠ La matriz de correlaciones no era válida como está (combinación de valores editados inconsistente); se aplicó una regularización automática para poder generar los datos. Ajusta las correlaciones si el resultado no se ve como esperas.</p>` : ""}
    <p class="hint">${profiles.length} perfiles generados · ${cols.length} columnas. Vista previa (primeras 15 filas):</p>
    <div class="table-scroll">
      <table class="preview-table">
        <thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead>
        <tbody>${previewRows.map((p) => `<tr>${cols.map((c) => `<td>${p[c]}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>`;
}

function initGenerarTab() {
  document.getElementById("gen-count").value = 50;
  document.getElementById("btn-generate").addEventListener("click", () => {
    const n = Math.max(1, Math.min(2000, Number(document.getElementById("gen-count").value) || 50));
    const seedInput = document.getElementById("gen-seed").value.trim();
    const seed = seedInput ? hashSeed(seedInput) : Math.floor(Math.random() * 1e9);
    document.getElementById("gen-seed").value = String(seed);
    lastResult = GENERATOR.generateProfiles(state, n, seed);
    renderGenerarTab();
    document.getElementById("download-buttons").style.display = "flex";
  });
  document.getElementById("btn-download-csv").addEventListener("click", () => {
    if (!lastResult) return;
    EXPORTS.triggerDownload("perfiles_sinteticos_acompanar.csv", EXPORTS.profilesToCSV(lastResult.profiles), "text/csv;charset=utf-8");
  });
  document.getElementById("btn-download-json").addEventListener("click", () => {
    if (!lastResult) return;
    EXPORTS.triggerDownload("perfiles_sinteticos_acompanar.json", EXPORTS.profilesToJSON(lastResult.profiles), "application/json");
  });
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = Math.imul(31, h) + str.charCodeAt(i) | 0; }
  return Math.abs(h);
}

/* --------------------------------- INIT --------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  initTabs();
  document.getElementById("variables-root").addEventListener("click", handleVariablesRootEvents);
  document.getElementById("variables-root").addEventListener("change", handleVariablesRootEvents);
  document.getElementById("btn-reset-defaults").addEventListener("click", resetState);
  document.getElementById("btn-regen-preview").addEventListener("click", renderEfectosTab);
  initGenerarTab();
  renderActiveTab();
});
