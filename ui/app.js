"use strict";

/* ---------------------------------------------------------------------- *
 * Fixture — demo graph, used whenever GET /api/schema fails (file://,
 * server not running, schema/graph_model.json not written yet). Lets the
 * canvas, drag, highlight, pairwise popup, and inspector all be exercised
 * standalone.
 * ---------------------------------------------------------------------- */
const FIXTURE_GRAPH = {
  metadata: { model_name: "Demo Fixture", version: "0.0.1", last_modified: "2026-08-10" },
  nodes: [
    {
      id: "tumor_stage", label: "Estadio Tumoral", category: "oncology",
      desc: "Estadio TNM/clínico del tumor primario en el momento de ingreso a paliativos.",
      type: "categorical", categories: ["I", "II", "III", "IV"], probabilities: [0.2, 0.3, 0.3, 0.2]
    },
    {
      id: "pain_scale", label: "Severidad del Dolor", category: "symptom",
      desc: "Intensidad del dolor autorreportada en escala numérica 0-10 (ESAS).",
      type: "ordinal", range: [0, 10], baseline_mean: 3.0, baseline_std: 1.5
    },
    {
      id: "opioid_daily_mme", label: "Dosis Diaria de Opioide (MME)", category: "medication",
      desc: "Dosis diaria total de opioide, en miligramos equivalentes de morfina.",
      type: "continuous", range: [0, 300], baseline_mean: 20, baseline_std: 15
    },
    {
      id: "anxiety_level", label: "Nivel de Ansiedad", category: "psychological",
      desc: "Ansiedad autorreportada en escala 0-10 (ESAS).",
      type: "ordinal", range: [0, 10], baseline_mean: 4, baseline_std: 2
    },
    {
      id: "nausea", label: "Náusea", category: "side_effect",
      desc: "Presencia de náusea clínicamente significativa en las últimas 24h.",
      type: "binary", categories: ["yes", "no"], probabilities: [0.3, 0.7]
    }
  ],
  edges: [
    {
      id: "e_tumor_pain", source: "tumor_stage", target: "pain_scale",
      relationType: "causal", strength: "moderate", weight: 5,
      formula: "target += 5 if source in ('III','IV') else 0",
      desc: "Estadios avanzados (III-IV) se asocian a mayor dolor basal.",
      ref: "fixture demo"
    },
    {
      id: "e_pain_opioid", source: "pain_scale", target: "opioid_daily_mme",
      relationType: "causal", strength: "strong", weight: 15.0,
      formula: "target += source * weight",
      desc: "A mayor dolor reportado, mayor titulación de dosis de opioide.",
      ref: "fixture demo"
    },
    {
      id: "e_anxiety_opioid", source: "anxiety_level", target: "opioid_daily_mme",
      relationType: "inhibitory", strength: "weak", weight: 3.0,
      formula: "target -= source * weight",
      desc: "Ansiedad alta induce prescripción más cautelosa (reduce dosis efectiva).",
      ref: "fixture demo"
    },
    {
      id: "e_opioid_nausea", source: "opioid_daily_mme", target: "nausea",
      relationType: "compound", strength: "moderate", weight: 40,
      formula: "target = ('yes' if source > weight else 'no')",
      desc: "Dosis de opioide por encima del umbral se combina con otros factores para producir náusea.",
      ref: "fixture demo"
    },
    {
      id: "e_pain_anxiety", source: "pain_scale", target: "anxiety_level",
      relationType: "correlated", strength: "moderate", weight: 0.4,
      formula: "",
      desc: "Dolor y ansiedad co-ocurren sin relación causal establecida en este modelo.",
      ref: "fixture demo"
    }
  ]
};

// Spec names 6 categories, but the engine/schema don't constrain the value
// at all (freeform string) — a real schema may carry more/other category
// names. Colors are assigned dynamically (see categoryColor()) to whatever
// distinct categories are actually present, so any valid schema renders
// sensibly instead of collapsing unknown categories into one fallback hue.
const CATEGORY_PALETTE_SLOTS = 8;
const NODE_TYPES = ["continuous", "ordinal", "categorical", "binary"];
const RELATION_TYPES = ["causal", "correlated", "inhibitory", "compound"];
const STRENGTHS = ["weak", "moderate", "strong"];

/* ---------------------------------------------------------------------- *
 * State
 * ---------------------------------------------------------------------- */
const state = {
  metadata: null,
  nodes: [],   // schema fields + runtime x/y/vx/vy/fx/fy attached by d3
  edges: [],   // schema fields; source/target ALWAYS plain string ids here
  selectedNodeId: null,
  selectedEdgeId: null,
  compareIds: []
};

let simulation = null;
let svg, gEdges, gNodes, zoomLayer;
let suppressClick = false;

/* ---------------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------------- */
window.addEventListener("DOMContentLoaded", init);

async function init() {
  buildStaticSvgDefs();
  wireToolbar();
  const svgEl = document.getElementById("graph-svg");
  svg = d3.select(svgEl);
  zoomLayer = svg.append("g").attr("class", "zoom-layer");
  gEdges = zoomLayer.append("g").attr("class", "edges-layer");
  gNodes = zoomLayer.append("g").attr("class", "nodes-layer");

  svg.call(
    d3.zoom().scaleExtent([0.3, 2.5]).on("zoom", (ev) => {
      zoomLayer.attr("transform", ev.transform);
    })
  ).on("dblclick.zoom", null);

  svg.on("click", (ev) => {
    if (ev.target === svgEl) onBackgroundClick();
  });

  await loadInitialSchema();
  renderLegend();
}

async function loadInitialSchema() {
  try {
    const res = await fetch("/api/schema");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    loadGraph(data);
    return;
  } catch (err) {
    showBanner(
      "No se pudo cargar /api/schema (" + err.message + "). Mostrando grafo de demostración. " +
      "Ejecuta `python3 server.py` desde la raíz del repo y abre http://localhost:8765 para usar el esquema real.",
      "warn"
    );
    loadGraph(FIXTURE_GRAPH);
  }
}

/* ---------------------------------------------------------------------- *
 * Banner
 * ---------------------------------------------------------------------- */
function showBanner(msg, kind) {
  const el = document.getElementById("banner");
  const txt = document.getElementById("banner-text");
  txt.textContent = msg;
  el.className = "banner " + (kind || "info");
  el.hidden = false;
}
function hideBanner() {
  document.getElementById("banner").hidden = true;
}
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("banner-close").addEventListener("click", hideBanner);
});

/* ---------------------------------------------------------------------- *
 * Graph loading — normalizes an arbitrary graph_model.json into state,
 * (re)builds the force simulation and the SVG selections.
 * ---------------------------------------------------------------------- */
function loadGraph(data) {
  const w = document.getElementById("canvas-wrap").clientWidth || 800;
  const h = document.getElementById("canvas-wrap").clientHeight || 600;

  state.metadata = data.metadata || { model_name: "Untitled", version: "0.0.0", last_modified: today() };
  state.nodes = (data.nodes || []).map((n, i) => {
    const angle = (i / Math.max(1, (data.nodes || []).length)) * Math.PI * 2;
    return Object.assign(
      { x: w / 2 + Math.cos(angle) * 120, y: h / 2 + Math.sin(angle) * 120 },
      n
    );
  });
  state.edges = (data.edges || []).map((e) => Object.assign({}, e, {
    source: typeof e.source === "object" ? e.source.id : e.source,
    target: typeof e.target === "object" ? e.target.id : e.target
  }));
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  state.compareIds = [];
  closeInspector();
  closeComparePopup();

  buildSimulation(w, h);
  renderAll();
  renderLegend();
}

function buildSimulation(w, h) {
  if (simulation) simulation.stop();

  // Separate copy for d3-force: forceLink mutates .source/.target into node
  // object refs, so we never hand it state.edges directly (that array must
  // stay export-safe with plain string ids at all times).
  const simEdges = state.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }));

  simulation = d3.forceSimulation(state.nodes)
    .force("link", d3.forceLink(simEdges).id((d) => d.id).distance(150).strength(0.5))
    .force("charge", d3.forceManyBody().strength(-380))
    .force("center", d3.forceCenter(w / 2, h / 2))
    .force("collide", d3.forceCollide((d) => nodeRadius(d) + 14))
    .on("tick", onTick);

  simulation.__simEdges = simEdges;
}

/* ---------------------------------------------------------------------- *
 * Visual helpers
 * ---------------------------------------------------------------------- */
function nodeRadius(node) {
  if (node.type === "continuous" || node.type === "ordinal") {
    const range = Array.isArray(node.range) ? node.range : [0, 1];
    const span = (range[1] - range[0]) || 1;
    const std = typeof node.baseline_std === "number" ? node.baseline_std : 0;
    const frac = Math.max(0, Math.min(1, std / span));
    return 16 + frac * 54;
  }
  return 26;
}

function relClass(rel) {
  return "rel-" + (RELATION_TYPES.includes(rel) ? rel : "causal");
}
function relHasArrow(rel) {
  return rel === "causal" || rel === "inhibitory" || rel === "compound";
}
function relMarker(rel) {
  if (!relHasArrow(rel)) return null;
  return rel === "inhibitory" ? "url(#arrow-critical)" : "url(#arrow-ink)";
}

function distinctCategories() {
  const seen = new Set();
  state.nodes.forEach((n) => { if (n.category) seen.add(n.category); });
  return Array.from(seen).sort();
}
function categoryColor(cat) {
  const cats = distinctCategories();
  const idx = cats.indexOf(cat);
  if (idx < 0 || idx >= CATEGORY_PALETTE_SLOTS) return "var(--muted)";
  return "var(--cat-slot-" + idx + ")";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getNode(id) { return state.nodes.find((n) => n.id === id); }
function getEdge(id) { return state.edges.find((e) => e.id === id); }
function findEdgeBetween(a, b) {
  return state.edges.find(
    (e) => (e.source === a && e.target === b) || (e.source === b && e.target === a)
  );
}

/* ---------------------------------------------------------------------- *
 * SVG defs (arrowheads) — built once.
 * ---------------------------------------------------------------------- */
function buildStaticSvgDefs() {
  const svgEl = document.getElementById("graph-svg");
  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML =
    '<marker id="arrow-ink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M0,0 L10,5 L0,10 Z" class="arrowhead-ink"></path></marker>' +
    '<marker id="arrow-critical" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
    '<path d="M0,0 L10,5 L0,10 Z" class="arrowhead-critical"></path></marker>';
  svgEl.appendChild(defs);
}

/* ---------------------------------------------------------------------- *
 * Full D3 join (nodes + edges). Called on load/import. Property-only edits
 * (inspector) use the lighter updateNodeVisual/updateEdgeVisual instead.
 * ---------------------------------------------------------------------- */
function renderAll() {
  const edgeSel = gEdges.selectAll(".edge-group").data(state.edges, (d) => d.id);
  edgeSel.exit().remove();
  const edgeEnter = edgeSel.enter().append("g").attr("class", "edge-group");
  edgeEnter.append("line").attr("class", "edge-hit");
  edgeEnter.append("line").attr("class", "edge-line");
  edgeEnter.on("click", (ev, d) => onEdgeClick(ev, d));
  const edgeMerged = edgeEnter.merge(edgeSel);
  edgeMerged.each(function (d) { applyEdgeStyle(d3.select(this), d); });

  const nodeSel = gNodes.selectAll(".node-group").data(state.nodes, (d) => d.id);
  nodeSel.exit().remove();
  const nodeEnter = nodeSel.enter().append("g").attr("class", "node-group");
  nodeEnter.append("circle").attr("class", "node-bubble");
  nodeEnter.append("text").attr("class", "node-label");
  nodeEnter.on("click", (ev, d) => onNodeClick(ev, d));
  nodeEnter.call(
    d3.drag()
      .on("start", dragStarted)
      .on("drag", dragged)
      .on("end", dragEnded)
  );
  const nodeMerged = nodeEnter.merge(nodeSel);
  nodeMerged.each(function (d) { applyNodeStyle(d3.select(this), d); });

  onTick();
  applyDimming();
  updateSelectionClasses();
}

function applyNodeStyle(sel, d) {
  const r = nodeRadius(d);
  sel.select("circle.node-bubble").attr("r", r).attr("fill", categoryColor(d.category));
  const labelText = truncate(d.label || d.id, r < 24 ? 10 : 16);
  sel.select("text.node-label").attr("dy", r + 13).text(labelText);
}

function applyEdgeStyle(sel, d) {
  sel.attr("class", "edge-group " + relClass(d.relationType));
  sel.select("line.edge-line").attr("marker-end", relMarker(d.relationType));
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function onTick() {
  const simEdges = simulation.__simEdges;
  gEdges.selectAll(".edge-group").each(function (d) {
    const se = simEdges.find((x) => x.id === d.id);
    if (!se || typeof se.source !== "object" || typeof se.target !== "object") return;
    const sx = se.source.x, sy = se.source.y, tx = se.target.x, ty = se.target.y;
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const tr = nodeRadius(se.target) + (relHasArrow(d.relationType) ? 6 : 2);
    const sr = nodeRadius(se.source) + 2;
    const ex = tx - (dx / dist) * tr, ey = ty - (dy / dist) * tr;
    const sxo = sx + (dx / dist) * sr, syo = sy + (dy / dist) * sr;
    const sel = d3.select(this);
    sel.select(".edge-hit").attr("x1", sxo).attr("y1", syo).attr("x2", ex).attr("y2", ey);
    sel.select(".edge-line").attr("x1", sxo).attr("y1", syo).attr("x2", ex).attr("y2", ey);
  });
  gNodes.selectAll(".node-group").attr("transform", (d) => `translate(${d.x},${d.y})`);
}

/* ---------------------------------------------------------------------- *
 * Targeted visual refresh after an inspector edit (no full rebuild —
 * keeps positions/simulation untouched).
 * ---------------------------------------------------------------------- */
function updateNodeVisual(id) {
  const d = getNode(id);
  gNodes.selectAll(".node-group").filter((n) => n.id === id).each(function () {
    applyNodeStyle(d3.select(this), d);
  });
}
function updateEdgeVisual(id) {
  const d = getEdge(id);
  gEdges.selectAll(".edge-group").filter((e) => e.id === id).each(function () {
    applyEdgeStyle(d3.select(this), d);
  });
  onTick();
}

/* ---------------------------------------------------------------------- *
 * Drag
 * ---------------------------------------------------------------------- */
let dragStartXY = null;
function dragStarted(event, d) {
  if (!event.active) simulation.alphaTarget(0.3).restart();
  dragStartXY = [event.x, event.y];
  d.fx = d.x; d.fy = d.y;
}
function dragged(event, d) {
  d.fx = event.x; d.fy = event.y;
}
function dragEnded(event, d) {
  if (!event.active) simulation.alphaTarget(0);
  const moved = dragStartXY && Math.hypot(event.x - dragStartXY[0], event.y - dragStartXY[1]) > 4;
  if (moved) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  // keep fx/fy fixed — user-placed nodes stay put ("drag-to-reposition")
}

/* ---------------------------------------------------------------------- *
 * Selection / highlighting / pairwise
 * ---------------------------------------------------------------------- */
function onNodeClick(event, d) {
  event.stopPropagation();
  if (suppressClick) return;
  const modified = event.shiftKey || event.ctrlKey || event.metaKey;
  if (modified && state.selectedNodeId && state.selectedNodeId !== d.id) {
    openComparePopup(state.selectedNodeId, d.id);
    return;
  }
  selectNode(d.id);
}

function onEdgeClick(event, d) {
  event.stopPropagation();
  if (suppressClick) return;
  state.selectedEdgeId = d.id;
  state.selectedNodeId = null;
  state.compareIds = [];
  closeComparePopup();
  applyDimming();
  updateSelectionClasses();
  openEdgeInspector(d.id);
}

function onBackgroundClick() {
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  state.compareIds = [];
  closeComparePopup();
  applyDimming();
  updateSelectionClasses();
  closeInspector();
}

function selectNode(id) {
  state.selectedNodeId = id;
  state.selectedEdgeId = null;
  state.compareIds = [];
  closeComparePopup();
  applyDimming();
  updateSelectionClasses();
  openNodeInspector(id);
}

function connectedNodeIds(id) {
  const s = new Set([id]);
  state.edges.forEach((e) => {
    if (e.source === id) s.add(e.target);
    if (e.target === id) s.add(e.source);
  });
  return s;
}

function applyDimming() {
  let activeNodes = null, activeEdges = null;

  if (state.selectedNodeId) {
    activeNodes = connectedNodeIds(state.selectedNodeId);
    activeEdges = new Set(
      state.edges.filter((e) => e.source === state.selectedNodeId || e.target === state.selectedNodeId).map((e) => e.id)
    );
  } else if (state.selectedEdgeId) {
    const e = getEdge(state.selectedEdgeId);
    if (e) {
      activeNodes = new Set([e.source, e.target]);
      activeEdges = new Set([e.id]);
    }
  } else if (state.compareIds.length === 2) {
    activeNodes = new Set(state.compareIds);
    const e = findEdgeBetween(state.compareIds[0], state.compareIds[1]);
    activeEdges = new Set(e ? [e.id] : []);
  }

  gNodes.selectAll(".node-group").classed("dimmed", (d) => (activeNodes ? !activeNodes.has(d.id) : false));
  gEdges.selectAll(".edge-group").classed("dimmed", (d) => (activeEdges ? !activeEdges.has(d.id) : false));
}

function updateSelectionClasses() {
  gNodes.selectAll(".node-group")
    .classed("selected", (d) => d.id === state.selectedNodeId)
    .classed("compare-a", (d) => state.compareIds[0] === d.id)
    .classed("compare-b", (d) => state.compareIds[1] === d.id);
  gEdges.selectAll(".edge-group").classed("selected", (d) => d.id === state.selectedEdgeId);
}

/* ---------------------------------------------------------------------- *
 * Legend
 * ---------------------------------------------------------------------- */
function renderLegend() {
  const el = document.getElementById("legend");
  const cats = distinctCategories().map(
    (c) => `<div class="legend-row"><span class="swatch" style="background:${categoryColor(c)}"></span>${escapeHtml(c)}</div>`
  ).join("");
  el.innerHTML =
    `<h4>Categorías</h4><div class="legend-cats">${cats}</div>` +
    `<h4>Relaciones</h4>` +
    `<div class="legend-row"><span class="line-sample"></span>Causal (→)</div>` +
    `<div class="legend-row"><span class="line-sample correlated"></span>Correlacionada</div>` +
    `<div class="legend-row"><span class="line-sample inhibitory"></span>Inhibitoria (→)</div>` +
    `<div class="legend-row"><span class="line-sample compound"></span>Compuesta (→)</div>`;
}

/* ---------------------------------------------------------------------- *
 * Inspector panel — node editing
 * ---------------------------------------------------------------------- */
function closeInspector() {
  const el = document.getElementById("inspector");
  el.hidden = true;
  el.innerHTML = "";
}

function openNodeInspector(id) {
  const node = getNode(id);
  if (!node) return;
  const el = document.getElementById("inspector");
  el.hidden = false;

  const isRange = node.type === "continuous" || node.type === "ordinal";
  const range = Array.isArray(node.range) ? node.range : [0, 10];

  el.innerHTML = `
    <button class="icon-btn close-insp" id="insp-close">&times;</button>
    <h3>Nodo</h3>
    <p class="insp-sub">${escapeHtml(node.id)}</p>

    <div class="field-row"><label>Etiqueta</label><input type="text" id="f-label" value="${escapeAttr(node.label || "")}"></div>
    <div class="field-pair">
      <div class="field-row"><label>Categoría</label>
        <input type="text" id="f-category" list="category-datalist" value="${escapeAttr(node.category || "")}">
        <datalist id="category-datalist">${distinctCategories().map((c) => `<option value="${escapeAttr(c)}">`).join("")}</datalist>
      </div>
      <div class="field-row"><label>Tipo</label>
        <select id="f-type">${NODE_TYPES.map((t) => `<option value="${t}" ${t === node.type ? "selected" : ""}>${t}</option>`).join("")}</select>
      </div>
    </div>
    <div class="field-row"><label>Descripción clínica</label><textarea id="f-desc">${escapeHtml(node.desc || "")}</textarea></div>

    <div id="type-fields"></div>
  `;

  renderTypeFields(node, isRange, range);

  document.getElementById("insp-close").addEventListener("click", onBackgroundClick);
  bind("#f-label", "input", (v) => { node.label = v; updateNodeVisual(id); });
  bind("#f-category", "input", (v) => { node.category = v; updateNodeVisual(id); renderLegend(); });
  bind("#f-desc", "input", (v) => { node.desc = v; });
  bind("#f-type", "change", (v) => {
    node.type = v;
    if ((v === "continuous" || v === "ordinal")) {
      if (!Array.isArray(node.range)) node.range = [0, 10];
      if (typeof node.baseline_mean !== "number") node.baseline_mean = (node.range[0] + node.range[1]) / 2;
      if (typeof node.baseline_std !== "number") node.baseline_std = 1;
    } else {
      if (!Array.isArray(node.categories) || !node.categories.length) node.categories = ["A", "B"];
      if (!Array.isArray(node.probabilities) || node.probabilities.length !== node.categories.length) {
        const p = 1 / node.categories.length;
        node.probabilities = node.categories.map(() => p);
      }
    }
    updateNodeVisual(id);
    renderTypeFields(node, node.type === "continuous" || node.type === "ordinal", Array.isArray(node.range) ? node.range : [0, 10]);
  });
}

function renderTypeFields(node, isRange, range) {
  const host = document.getElementById("type-fields");
  if (isRange) {
    host.innerHTML = `
      <div class="field-pair">
        <div class="field-row"><label>Rango mín.</label><input type="number" id="f-rmin" value="${range[0]}"></div>
        <div class="field-row"><label>Rango máx.</label><input type="number" id="f-rmax" value="${range[1]}"></div>
      </div>
      <div class="field-pair">
        <div class="field-row"><label>Media basal</label><input type="number" step="any" id="f-mean" value="${node.baseline_mean ?? 0}"></div>
        <div class="field-row"><label>Desv. estándar basal</label><input type="number" step="any" id="f-std" value="${node.baseline_std ?? 0}"></div>
      </div>
    `;
    bind("#f-rmin", "input", (v) => { node.range = [Number(v), node.range[1]]; updateNodeVisual(node.id); }, true);
    bind("#f-rmax", "input", (v) => { node.range = [node.range[0], Number(v)]; updateNodeVisual(node.id); }, true);
    bind("#f-mean", "input", (v) => { node.baseline_mean = Number(v); }, true);
    bind("#f-std", "input", (v) => { node.baseline_std = Number(v); updateNodeVisual(node.id); }, true);
  } else {
    const cats = Array.isArray(node.categories) ? node.categories : [];
    const probs = Array.isArray(node.probabilities) ? node.probabilities : [];
    host.innerHTML =
      `<div class="section-title">Categorías / probabilidades</div>` +
      `<div id="cat-rows">` +
      cats.map((c, i) => catRowHtml(c, probs[i], i)).join("") +
      `</div>` +
      `<button class="secondary-btn" id="f-cat-add" type="button">+ categoría</button>`;

    cats.forEach((_, i) => {
      bind(`#cat-name-${i}`, "input", (v) => { node.categories[i] = v; });
      bind(`#cat-prob-${i}`, "input", (v) => { node.probabilities[i] = Number(v); }, true);
      const rm = document.getElementById(`cat-rm-${i}`);
      if (rm) rm.addEventListener("click", () => {
        if (node.categories.length <= 1) return;
        node.categories.splice(i, 1);
        node.probabilities.splice(i, 1);
        renderTypeFields(node, false, range);
      });
    });
    document.getElementById("f-cat-add").addEventListener("click", () => {
      node.categories.push("Nueva");
      node.probabilities.push(0);
      renderTypeFields(node, false, range);
    });
  }
}

function catRowHtml(cat, prob, i) {
  return `<div class="cat-row">
    <input type="text" id="cat-name-${i}" value="${escapeAttr(cat)}">
    <input type="number" step="any" id="cat-prob-${i}" value="${prob ?? 0}">
    <button class="icon-btn tiny" id="cat-rm-${i}" type="button">&times;</button>
  </div>`;
}

/* ---------------------------------------------------------------------- *
 * Inspector panel — edge editing (also reused inside compare popup)
 * ---------------------------------------------------------------------- */
function openEdgeInspector(id) {
  const edge = getEdge(id);
  if (!edge) return;
  const el = document.getElementById("inspector");
  el.hidden = false;
  const srcNode = getNode(edge.source), tgtNode = getNode(edge.target);

  el.innerHTML = `
    <button class="icon-btn close-insp" id="insp-close">&times;</button>
    <h3>Relación</h3>
    <p class="insp-sub">${escapeHtml(edge.id)}</p>
    <div class="field-row"><label>Origen → Destino</label>
      <div style="font-size:12.5px">${escapeHtml(srcNode ? srcNode.label : edge.source)} → ${escapeHtml(tgtNode ? tgtNode.label : edge.target)}</div>
    </div>
    <div id="edge-fields-host"></div>
  `;
  document.getElementById("edge-fields-host").innerHTML = edgeFieldsHtml(edge, "e1");
  bindEdgeFieldListeners(edge, "e1", () => updateEdgeVisual(id));
  document.getElementById("insp-close").addEventListener("click", onBackgroundClick);
}

function edgeFieldsHtml(edge, ns) {
  return `
    <div class="field-pair">
      <div class="field-row"><label>Tipo de relación</label>
        <select id="${ns}-rel">${RELATION_TYPES.map((r) => `<option value="${r}" ${r === edge.relationType ? "selected" : ""}>${r}</option>`).join("")}</select>
      </div>
      <div class="field-row"><label>Fuerza</label>
        <select id="${ns}-strength">${STRENGTHS.map((s) => `<option value="${s}" ${s === edge.strength ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
    </div>
    <div class="field-row"><label>Peso (weight)</label><input type="number" step="any" id="${ns}-weight" value="${edge.weight ?? 0}"></div>
    <div class="field-row"><label>Fórmula</label><input type="text" id="${ns}-formula" value="${escapeAttr(edge.formula || "")}" placeholder="target += source * weight"></div>
    <div class="field-row"><label>Descripción</label><textarea id="${ns}-desc">${escapeHtml(edge.desc || "")}</textarea></div>
    <div class="field-row"><label>Referencia</label><input type="text" id="${ns}-ref" value="${escapeAttr(edge.ref || "")}"></div>
  `;
}

function bindEdgeFieldListeners(edge, ns, onVisualChange) {
  bind(`#${ns}-rel`, "change", (v) => { edge.relationType = v; onVisualChange(); });
  bind(`#${ns}-strength`, "change", (v) => { edge.strength = v; });
  bind(`#${ns}-weight`, "input", (v) => { edge.weight = Number(v); }, true);
  bind(`#${ns}-formula`, "input", (v) => { edge.formula = v; });
  bind(`#${ns}-desc`, "input", (v) => { edge.desc = v; });
  bind(`#${ns}-ref`, "input", (v) => { edge.ref = v; });
}

/* ---------------------------------------------------------------------- *
 * Pairwise compare popup
 * ---------------------------------------------------------------------- */
function openComparePopup(idA, idB) {
  state.compareIds = [idA, idB];
  state.selectedNodeId = null;
  state.selectedEdgeId = null;
  applyDimming();
  updateSelectionClasses();

  const a = getNode(idA), b = getNode(idB);
  const edge = findEdgeBetween(idA, idB);
  const popup = document.getElementById("compare-popup");
  popup.hidden = false;

  const edgeBlock = edge
    ? `<div class="section-title">Relación (${escapeHtml(edge.source)} → ${escapeHtml(edge.target)})</div>${edgeFieldsHtml(edge, "c1")}`
    : `<div class="section-title">Relación</div><p class="compare-edge-empty">No hay relación directa definida entre estos dos nodos.</p>`;

  popup.innerHTML = `
    <div class="compare-card">
      <h3>Inspección pareada <button class="icon-btn" id="cmp-close">&times;</button></h3>
      <div class="compare-nodes">
        <div class="compare-node">
          <div class="cn-title"><span class="chip" style="background:${categoryColor(a.category)}"></span>${escapeHtml(a.label)}</div>
          <div class="cn-desc">${escapeHtml(a.desc || "")}</div>
        </div>
        <div class="compare-node">
          <div class="cn-title"><span class="chip" style="background:${categoryColor(b.category)}"></span>${escapeHtml(b.label)}</div>
          <div class="cn-desc">${escapeHtml(b.desc || "")}</div>
        </div>
      </div>
      ${edgeBlock}
    </div>
  `;
  document.getElementById("cmp-close").addEventListener("click", onBackgroundClick);
  popup.addEventListener("click", (ev) => { if (ev.target === popup) onBackgroundClick(); });
  if (edge) bindEdgeFieldListeners(edge, "c1", () => updateEdgeVisual(edge.id));
}

function closeComparePopup() {
  const popup = document.getElementById("compare-popup");
  popup.hidden = true;
  popup.innerHTML = "";
}

/* ---------------------------------------------------------------------- *
 * Small binding / escaping helpers
 * ---------------------------------------------------------------------- */
function bind(sel, evt, fn, numeric) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.addEventListener(evt, () => {
    const v = numeric ? el.value : el.value;
    fn(v);
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* ---------------------------------------------------------------------- *
 * Import / Export
 * ---------------------------------------------------------------------- */
function exportSchema() {
  return {
    metadata: Object.assign({}, state.metadata, { last_modified: today() }),
    nodes: state.nodes.map(exportNode),
    edges: state.edges.map(exportEdge)
  };
}

function exportNode(n) {
  const out = { id: n.id, label: n.label, category: n.category, desc: n.desc, type: n.type };
  if (n.type === "continuous" || n.type === "ordinal") {
    out.range = n.range;
    out.baseline_mean = n.baseline_mean;
    out.baseline_std = n.baseline_std;
  } else {
    out.categories = n.categories;
    out.probabilities = n.probabilities;
  }
  return out;
}

function exportEdge(e) {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    relationType: e.relationType,
    strength: e.strength,
    weight: e.weight,
    formula: e.formula,
    desc: e.desc,
    ref: e.ref
  };
}

function wireToolbar() {
  document.getElementById("btn-export").addEventListener("click", () => {
    const data = exportSchema();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "graph_model.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("file-import").click();
  });
  document.getElementById("file-import").addEventListener("change", (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
          throw new Error("el archivo no tiene forma de graph_model.json (faltan 'nodes'/'edges')");
        }
        loadGraph(data);
        showBanner("Esquema importado: " + (data.metadata && data.metadata.model_name || file.name), "info");
      } catch (err) {
        showBanner("Error al importar JSON: " + err.message, "error");
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  });

  document.getElementById("btn-generate").addEventListener("click", generateDataset);
}

/* ---------------------------------------------------------------------- *
 * Generate dataset
 * ---------------------------------------------------------------------- */
async function generateDataset() {
  const btn = document.getElementById("btn-generate");
  const n = Number(document.getElementById("gen-n").value) || 500;
  const seedRaw = document.getElementById("gen-seed").value;
  const seed = seedRaw === "" ? null : Number(seedRaw);

  btn.disabled = true;
  btn.textContent = "Generando…";
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: exportSchema(), n, seed, format: "csv" })
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) { /* noop */ }
      throw new Error(msg);
    }
    const csvText = await res.text();
    const blob = new Blob([csvText], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "synthetic_profiles.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showBanner(`Dataset generado (${n} perfiles) y descargado.`, "info");
  } catch (err) {
    showBanner("Error al generar dataset: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Generar dataset";
  }
}

/* ---------------------------------------------------------------------- *
 * Resize
 * ---------------------------------------------------------------------- */
window.addEventListener("resize", () => {
  if (!simulation) return;
  const w = document.getElementById("canvas-wrap").clientWidth || 800;
  const h = document.getElementById("canvas-wrap").clientHeight || 600;
  simulation.force("center", d3.forceCenter(w / 2, h / 2));
  simulation.alpha(0.3).restart();
});
