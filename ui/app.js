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
const SYNC_DEBOUNCE_MS = 800;

/* ---------------------------------------------------------------------- *
 * State — the ONE in-memory graph shared by all 4 tabs. Every tab reads
 * and mutates this object directly; nothing is copied per-tab, so
 * switching tabs never loses in-progress edits.
 * ---------------------------------------------------------------------- */
const state = {
  metadata: null,
  nodes: [],   // schema fields + runtime x/y/vx/vy/fx/fy attached by d3
  edges: [],   // schema fields; source/target ALWAYS plain string ids here
  selectedNodeIds: new Set(),  // 0 = none, 1 = single-select (1-hop), 2+ = multi-select (union)
  selectedEdgeId: null,
  searchText: "",
  activeCategories: new Set()  // empty = no category restriction
};

let simulation = null;
let svg, gEdges, gNodes, zoomLayer;
let suppressClick = false;
let activeTab = "graph";
let syncTimer = null;
let analysisStale = true;

/* ---------------------------------------------------------------------- *
 * Boot
 * ---------------------------------------------------------------------- */
window.addEventListener("DOMContentLoaded", init);

async function init() {
  buildStaticSvgDefs();
  wireToolbar();
  wireFilterBar();
  wireTabs();
  wireModals();
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
  refreshTables();
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
  state.selectedNodeIds = new Set();
  state.selectedEdgeId = null;
  state.searchText = "";
  state.activeCategories = new Set();
  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.value = "";
  closeInspector();
  closeComparePopup();
  analysisStale = true;

  buildSimulation(w, h);
  renderAll();
  renderLegend();
  refreshTables();
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

function rebuildGraph() {
  const w = document.getElementById("canvas-wrap").clientWidth || 800;
  const h = document.getElementById("canvas-wrap").clientHeight || 600;
  buildSimulation(w, h);
  renderAll();
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
 * Search / category filter — shared by Visual Graph dimming and the
 * Variables/Correlations table row filtering.
 * ---------------------------------------------------------------------- */
function filterActive() {
  return state.searchText.trim() !== "" || state.activeCategories.size > 0;
}
function nodeMatchesFilter(n) {
  if (!n) return false;
  const text = state.searchText.trim().toLowerCase();
  const textMatch = !text ||
    (n.id || "").toLowerCase().includes(text) ||
    (n.label || "").toLowerCase().includes(text) ||
    (n.desc || "").toLowerCase().includes(text);
  const catMatch = state.activeCategories.size === 0 || state.activeCategories.has(n.category);
  return textMatch && catMatch;
}
function edgeMatchesFilter(e) {
  const s = getNode(e.source), t = getNode(e.target);
  return nodeMatchesFilter(s) || nodeMatchesFilter(t);
}

function onFilterChanged() {
  applyDimming();
  renderVariablesTable();
  renderCorrelationsTable();
}

function wireFilterBar() {
  document.getElementById("search-input").addEventListener("input", (ev) => {
    state.searchText = ev.target.value;
    onFilterChanged();
  });
  document.getElementById("btn-clear-filter").addEventListener("click", () => {
    state.searchText = "";
    state.activeCategories = new Set();
    document.getElementById("search-input").value = "";
    renderCategoryChips();
    onFilterChanged();
  });
}

function renderCategoryChips() {
  const host = document.getElementById("category-filter");
  if (!host) return;
  const cats = distinctCategories();
  host.innerHTML = cats.map((c) =>
    `<button type="button" class="cat-chip ${state.activeCategories.has(c) ? "active" : ""}" data-cat="${escapeAttr(c)}" style="--chip-color:${categoryColor(c)}">${escapeHtml(c)}</button>`
  ).join("");
  host.querySelectorAll(".cat-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const c = btn.dataset.cat;
      if (state.activeCategories.has(c)) state.activeCategories.delete(c);
      else state.activeCategories.add(c);
      renderCategoryChips();
      onFilterChanged();
    });
  });
}

function refreshCategoryDatalist() {
  const dl = document.getElementById("category-datalist");
  if (!dl) return;
  dl.innerHTML = distinctCategories().map((c) => `<option value="${escapeAttr(c)}">`).join("");
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
 * Full D3 join (nodes + edges). Called on load/import/add/delete. Property-
 * only edits (inspector) use the lighter updateNodeVisual/updateEdgeVisual
 * instead.
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
 *
 * state.selectedNodeIds is the single source of truth:
 *   size 0 -> nothing selected
 *   size 1 -> single-select: highlight node + its 1-hop neighbors, open
 *             the node inspector
 *   size 2 -> pairwise: highlight union of both nodes' direct edges,
 *             also opens the pairwise compare popup (edge editor) as before
 *   size 3+ -> multi-select: highlight union of all selected nodes' direct
 *              edges + neighbors, no popup (ambiguous which pair to edit)
 *
 * All of this composes with the active search/category filter: only nodes
 * currently matching the filter are clickable, and the final highlighted
 * set is intersected with the filtered set.
 * ---------------------------------------------------------------------- */
function onNodeClick(event, d) {
  event.stopPropagation();
  if (suppressClick) return;
  if (filterActive() && !nodeMatchesFilter(d)) return; // not selectable while filtered out

  const modified = event.shiftKey || event.ctrlKey || event.metaKey;
  let ids = new Set(state.selectedNodeIds);
  if (modified) {
    if (ids.has(d.id)) ids.delete(d.id); else ids.add(d.id);
  } else {
    ids = new Set([d.id]);
  }
  if (ids.size === 0) { onBackgroundClick(); return; }
  selectNodesUI(Array.from(ids));
}

function onEdgeClick(event, d) {
  event.stopPropagation();
  if (suppressClick) return;
  state.selectedEdgeId = d.id;
  state.selectedNodeIds = new Set();
  closeComparePopup();
  applyDimming();
  updateSelectionClasses();
  openEdgeInspector(d.id);
}

function onBackgroundClick() {
  state.selectedNodeIds = new Set();
  state.selectedEdgeId = null;
  closeComparePopup();
  applyDimming();
  updateSelectionClasses();
  closeInspector();
}

function selectNodesUI(ids) {
  state.selectedNodeIds = new Set(ids);
  state.selectedEdgeId = null;
  closeComparePopup();

  if (state.selectedNodeIds.size === 1) {
    openNodeInspector(Array.from(state.selectedNodeIds)[0]);
  } else if (state.selectedNodeIds.size === 2) {
    closeInspector();
    const [a, b] = Array.from(state.selectedNodeIds);
    openComparePopup(a, b);
  } else {
    closeInspector();
  }
  applyDimming();
  updateSelectionClasses();
}

function connectedNodeIds(id) {
  const s = new Set([id]);
  state.edges.forEach((e) => {
    if (e.source === id) s.add(e.target);
    if (e.target === id) s.add(e.source);
  });
  return s;
}

// Computes the node id set that should render at full opacity, or null if
// there is no active restriction (no filter, no selection -> show all).
function computeActiveNodeSet() {
  const filterSet = filterActive()
    ? new Set(state.nodes.filter(nodeMatchesFilter).map((n) => n.id))
    : null;

  let selSet = null;
  if (state.selectedEdgeId) {
    const e = getEdge(state.selectedEdgeId);
    if (e) selSet = new Set([e.source, e.target]);
  } else if (state.selectedNodeIds.size === 1) {
    selSet = connectedNodeIds(Array.from(state.selectedNodeIds)[0]);
  } else if (state.selectedNodeIds.size >= 2) {
    selSet = new Set();
    state.selectedNodeIds.forEach((id) => connectedNodeIds(id).forEach((x) => selSet.add(x)));
  }

  if (!filterSet && !selSet) return null;
  if (filterSet && !selSet) return filterSet;
  if (!filterSet && selSet) return selSet;
  const out = new Set();
  selSet.forEach((id) => { if (filterSet.has(id)) out.add(id); });
  return out;
}

function applyDimming() {
  const active = computeActiveNodeSet();
  gNodes.selectAll(".node-group").classed("dimmed", (d) => (active ? !active.has(d.id) : false));
  gEdges.selectAll(".edge-group").classed(
    "hidden-edge",
    (d) => (active ? !(active.has(d.source) && active.has(d.target)) : false)
  );
}

function updateSelectionClasses() {
  const ids = state.selectedNodeIds;
  gNodes.selectAll(".node-group")
    .classed("selected", (d) => ids.has(d.id))
    .classed("compare-a", (d) => ids.size === 2 && Array.from(ids)[0] === d.id)
    .classed("compare-b", (d) => ids.size === 2 && Array.from(ids)[1] === d.id)
    .classed("multi-selected", (d) => ids.size > 2 && ids.has(d.id));
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
  refreshCategoryDatalist();
  renderCategoryChips();
}

/* ---------------------------------------------------------------------- *
 * Inspector panel — node editing (fixed overlay, usable from any tab)
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
  bind("#f-category", "input", (v) => { node.category = v; updateNodeVisual(id); renderLegend(); refreshTables(); });
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
    refreshTables();
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
    bind("#f-rmin", "input", (v) => { node.range = [Number(v), node.range[1]]; updateNodeVisual(node.id); refreshTables(); }, true);
    bind("#f-rmax", "input", (v) => { node.range = [node.range[0], Number(v)]; updateNodeVisual(node.id); refreshTables(); }, true);
    bind("#f-mean", "input", (v) => { node.baseline_mean = Number(v); refreshTables(); }, true);
    bind("#f-std", "input", (v) => { node.baseline_std = Number(v); updateNodeVisual(node.id); refreshTables(); }, true);
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
      bind(`#cat-name-${i}`, "input", (v) => { node.categories[i] = v; refreshTables(); });
      bind(`#cat-prob-${i}`, "input", (v) => { node.probabilities[i] = Number(v); }, true);
      const rm = document.getElementById(`cat-rm-${i}`);
      if (rm) rm.addEventListener("click", () => {
        if (node.categories.length <= 1) return;
        node.categories.splice(i, 1);
        node.probabilities.splice(i, 1);
        renderTypeFields(node, false, range);
        refreshTables();
        markDirty();
      });
    });
    document.getElementById("f-cat-add").addEventListener("click", () => {
      node.categories.push("Nueva");
      node.probabilities.push(0);
      renderTypeFields(node, false, range);
      refreshTables();
      markDirty();
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
  bindEdgeFieldListeners(edge, "e1", () => { updateEdgeVisual(id); refreshTables(); });
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
  bind(`#${ns}-weight`, "input", (v) => { edge.weight = Number(v); onVisualChange(); }, true);
  bind(`#${ns}-formula`, "input", (v) => { edge.formula = v; });
  bind(`#${ns}-desc`, "input", (v) => { edge.desc = v; onVisualChange(); });
  bind(`#${ns}-ref`, "input", (v) => { edge.ref = v; });
}

/* ---------------------------------------------------------------------- *
 * Pairwise compare popup
 * ---------------------------------------------------------------------- */
function openComparePopup(idA, idB) {
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
  if (edge) bindEdgeFieldListeners(edge, "c1", () => { updateEdgeVisual(edge.id); refreshTables(); });
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
    markDirty();
  });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

/* ---------------------------------------------------------------------- *
 * Tabs
 * ---------------------------------------------------------------------- */
function wireTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(name) {
  activeTab = name;
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === "panel-" + name);
  });
  if (name === "graph") {
    recenterGraph();
  } else if (name === "analysis" && analysisStale) {
    runAnalysis();
  }
}

function recenterGraph() {
  if (!simulation) return;
  const w = document.getElementById("canvas-wrap").clientWidth || 800;
  const h = document.getElementById("canvas-wrap").clientHeight || 600;
  simulation.force("center", d3.forceCenter(w / 2, h / 2));
}

/* ---------------------------------------------------------------------- *
 * Variables tab — CRUD table over state.nodes
 * ---------------------------------------------------------------------- */
function keyParamsHtml(n) {
  if (n.type === "continuous" || n.type === "ordinal") {
    const r = Array.isArray(n.range) ? n.range : ["?", "?"];
    return `rango ${r[0]}–${r[1]}, μ=${n.baseline_mean ?? "?"}, σ=${n.baseline_std ?? "?"}`;
  }
  const cats = Array.isArray(n.categories) ? n.categories : [];
  return truncate(cats.join(", "), 44);
}

function domSafeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function rowHtmlForNode(n) {
  const sid = domSafeId(n.id);
  return `<tr>
    <td class="mono">${escapeHtml(n.id)}</td>
    <td>${escapeHtml(n.label || "")}</td>
    <td><span class="chip" style="background:${categoryColor(n.category)}"></span> ${escapeHtml(n.category || "")}</td>
    <td>${escapeHtml(n.type || "")}</td>
    <td class="small">${escapeHtml(keyParamsHtml(n))}</td>
    <td class="row-actions">
      <button class="icon-btn" id="v-edit-${sid}" type="button">Editar</button>
      <button class="icon-btn danger" id="v-del-${sid}" type="button">Eliminar</button>
    </td>
  </tr>`;
}

function renderVariablesTable() {
  const tbody = document.getElementById("variables-tbody");
  if (!tbody) return;
  const rows = state.nodes.filter(nodeMatchesFilter);
  const countEl = document.getElementById("variables-count");
  if (countEl) countEl.textContent = `${rows.length} / ${state.nodes.length} variables`;
  tbody.innerHTML = rows.length
    ? rows.map(rowHtmlForNode).join("")
    : `<tr><td colspan="6" class="empty-row">Sin resultados para el filtro actual.</td></tr>`;
  rows.forEach((n) => {
    const sid = domSafeId(n.id);
    const editBtn = document.getElementById(`v-edit-${sid}`);
    const delBtn = document.getElementById(`v-del-${sid}`);
    if (editBtn) editBtn.addEventListener("click", () => editNodeFromTable(n.id));
    if (delBtn) delBtn.addEventListener("click", () => deleteNode(n.id));
  });
}

function editNodeFromTable(id) {
  state.selectedNodeIds = new Set([id]);
  state.selectedEdgeId = null;
  closeComparePopup();
  applyDimming();
  updateSelectionClasses();
  openNodeInspector(id);
}

function deleteNode(id) {
  const node = getNode(id);
  if (!node) return;
  const relatedEdges = state.edges.filter((e) => e.source === id || e.target === id);
  const ok = confirm(`¿Eliminar variable "${node.label || id}" (${id}) y sus ${relatedEdges.length} relación(es) asociadas?`);
  if (!ok) return;

  state.nodes = state.nodes.filter((n) => n.id !== id);
  state.edges = state.edges.filter((e) => e.source !== id && e.target !== id);
  state.selectedNodeIds.delete(id);
  if (state.selectedEdgeId && relatedEdges.some((e) => e.id === state.selectedEdgeId)) {
    state.selectedEdgeId = null;
  }
  closeInspector();
  closeComparePopup();
  rebuildGraph();
  refreshTables();
  renderLegend();
  markDirty();
}

/* ---------------------------------------------------------------------- *
 * Correlations & Relationships tab — CRUD table over state.edges
 * ---------------------------------------------------------------------- */
function rowHtmlForEdge(e) {
  const s = getNode(e.source), t = getNode(e.target);
  const sid = domSafeId(e.id);
  return `<tr>
    <td class="mono">${escapeHtml(e.id)}</td>
    <td>${escapeHtml(s ? s.label : e.source)}</td>
    <td>${escapeHtml(t ? t.label : e.target)}</td>
    <td>${escapeHtml(e.relationType || "")}</td>
    <td>${escapeHtml(e.strength || "")}</td>
    <td>${e.weight ?? ""}</td>
    <td class="mono small">${escapeHtml(truncate(e.formula || "", 28))}</td>
    <td class="small">${escapeHtml(truncate(e.desc || "", 40))}</td>
    <td class="row-actions">
      <button class="icon-btn" id="c-edit-${sid}" type="button">Editar</button>
      <button class="icon-btn danger" id="c-del-${sid}" type="button">Eliminar</button>
    </td>
  </tr>`;
}

function renderCorrelationsTable() {
  const tbody = document.getElementById("correlations-tbody");
  if (!tbody) return;
  const rows = state.edges.filter(edgeMatchesFilter);
  const countEl = document.getElementById("correlations-count");
  if (countEl) countEl.textContent = `${rows.length} / ${state.edges.length} relaciones`;
  tbody.innerHTML = rows.length
    ? rows.map(rowHtmlForEdge).join("")
    : `<tr><td colspan="9" class="empty-row">Sin resultados para el filtro actual.</td></tr>`;
  rows.forEach((e) => {
    const sid = domSafeId(e.id);
    const editBtn = document.getElementById(`c-edit-${sid}`);
    const delBtn = document.getElementById(`c-del-${sid}`);
    if (editBtn) editBtn.addEventListener("click", () => editEdgeFromTable(e.id));
    if (delBtn) delBtn.addEventListener("click", () => deleteEdge(e.id));
  });
}

function editEdgeFromTable(id) {
  state.selectedEdgeId = id;
  state.selectedNodeIds = new Set();
  closeComparePopup();
  applyDimming();
  updateSelectionClasses();
  openEdgeInspector(id);
}

function deleteEdge(id) {
  const edge = getEdge(id);
  if (!edge) return;
  const ok = confirm(`¿Eliminar la relación "${edge.id}" (${edge.source} → ${edge.target})?`);
  if (!ok) return;

  state.edges = state.edges.filter((e) => e.id !== id);
  if (state.selectedEdgeId === id) state.selectedEdgeId = null;
  closeInspector();
  closeComparePopup();
  rebuildGraph();
  refreshTables();
  markDirty();
}

function refreshTables() {
  renderVariablesTable();
  renderCorrelationsTable();
}

/* ---------------------------------------------------------------------- *
 * Add Node / Add Edge modals
 * ---------------------------------------------------------------------- */
function wireModals() {
  document.getElementById("btn-add-node").addEventListener("click", openAddNodeModal);
  document.getElementById("btn-add-edge").addEventListener("click", openAddEdgeModal);
}

function openAddNodeModal() {
  const el = document.getElementById("node-form-modal");
  el.hidden = false;
  el.innerHTML = `
    <div class="modal-card">
      <h3>Nueva variable <button class="icon-btn" id="nfm-close" type="button">&times;</button></h3>
      <div class="field-row"><label>ID (snake_case, único)</label><input type="text" id="nfm-id" placeholder="ej. nueva_variable"></div>
      <div class="field-row"><label>Etiqueta</label><input type="text" id="nfm-label"></div>
      <div class="field-pair">
        <div class="field-row"><label>Categoría</label><input type="text" id="nfm-category" list="category-datalist"></div>
        <div class="field-row"><label>Tipo</label><select id="nfm-type">${NODE_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("")}</select></div>
      </div>
      <p class="modal-error" id="nfm-error" hidden></p>
      <div class="modal-actions">
        <button class="secondary-btn" id="nfm-cancel" type="button">Cancelar</button>
        <button class="primary-btn" id="nfm-submit" type="button">Crear</button>
      </div>
    </div>`;
  document.getElementById("nfm-close").addEventListener("click", closeAddNodeModal);
  document.getElementById("nfm-cancel").addEventListener("click", closeAddNodeModal);
  document.getElementById("nfm-submit").addEventListener("click", submitAddNode);
  el.addEventListener("click", (ev) => { if (ev.target === el) closeAddNodeModal(); });
}
function closeAddNodeModal() {
  const el = document.getElementById("node-form-modal");
  el.hidden = true;
  el.innerHTML = "";
}

function submitAddNode() {
  const id = document.getElementById("nfm-id").value.trim();
  const label = document.getElementById("nfm-label").value.trim();
  const category = document.getElementById("nfm-category").value.trim();
  const type = document.getElementById("nfm-type").value;
  const err = document.getElementById("nfm-error");

  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    err.textContent = "ID inválido: usar snake_case (minúsculas, números, guión bajo; debe iniciar con letra).";
    err.hidden = false;
    return;
  }
  if (getNode(id)) {
    err.textContent = `Ya existe una variable con id "${id}".`;
    err.hidden = false;
    return;
  }
  if (!label) {
    err.textContent = "La etiqueta es obligatoria.";
    err.hidden = false;
    return;
  }

  const w = document.getElementById("canvas-wrap").clientWidth || 800;
  const h = document.getElementById("canvas-wrap").clientHeight || 600;
  const node = {
    id, label, category: category || "sin_categoria", desc: "", type,
    x: w / 2 + (Math.random() - 0.5) * 120, y: h / 2 + (Math.random() - 0.5) * 120
  };
  if (type === "continuous" || type === "ordinal") {
    node.range = [0, 10];
    node.baseline_mean = 5;
    node.baseline_std = 1;
  } else {
    node.categories = ["A", "B"];
    node.probabilities = [0.5, 0.5];
  }
  state.nodes.push(node);
  closeAddNodeModal();
  rebuildGraph();
  refreshTables();
  renderLegend();
  editNodeFromTable(id);
  markDirty();
}

function openAddEdgeModal() {
  const el = document.getElementById("edge-form-modal");
  el.hidden = false;
  const nodeOptions = state.nodes
    .map((n) => `<option value="${escapeAttr(n.id)}">${escapeHtml(n.label)} (${escapeHtml(n.id)})</option>`)
    .join("");
  el.innerHTML = `
    <div class="modal-card">
      <h3>Nueva relación <button class="icon-btn" id="efm-close" type="button">&times;</button></h3>
      <div class="field-pair">
        <div class="field-row"><label>Origen</label><input type="text" id="efm-source" list="edge-node-datalist" placeholder="buscar por id o etiqueta…"></div>
        <div class="field-row"><label>Destino</label><input type="text" id="efm-target" list="edge-node-datalist" placeholder="buscar por id o etiqueta…"></div>
      </div>
      <datalist id="edge-node-datalist">${nodeOptions}</datalist>
      <div class="field-pair">
        <div class="field-row"><label>Tipo de relación</label><select id="efm-rel">${RELATION_TYPES.map((r) => `<option value="${r}">${r}</option>`).join("")}</select></div>
        <div class="field-row"><label>Fuerza</label><select id="efm-strength">${STRENGTHS.map((s) => `<option value="${s}" ${s === "moderate" ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      </div>
      <div class="field-row"><label>Peso</label><input type="number" step="any" id="efm-weight" value="1"></div>
      <div class="field-row"><label>Fórmula</label><input type="text" id="efm-formula" value="target += source * weight"></div>
      <div class="field-row"><label>Descripción</label><textarea id="efm-desc"></textarea></div>
      <div class="field-row"><label>Referencia</label><input type="text" id="efm-ref"></div>
      <p class="modal-error" id="efm-error" hidden></p>
      <div class="modal-actions">
        <button class="secondary-btn" id="efm-cancel" type="button">Cancelar</button>
        <button class="primary-btn" id="efm-submit" type="button">Crear</button>
      </div>
    </div>`;
  document.getElementById("efm-close").addEventListener("click", closeAddEdgeModal);
  document.getElementById("efm-cancel").addEventListener("click", closeAddEdgeModal);
  document.getElementById("efm-submit").addEventListener("click", submitAddEdge);
  el.addEventListener("click", (ev) => { if (ev.target === el) closeAddEdgeModal(); });
}
function closeAddEdgeModal() {
  const el = document.getElementById("edge-form-modal");
  el.hidden = true;
  el.innerHTML = "";
}

function resolveNodeIdFromInput(raw) {
  const v = (raw || "").trim();
  if (!v) return null;
  if (getNode(v)) return v;
  const m = state.nodes.find((n) => n.label === v || `${n.label} (${n.id})` === v);
  return m ? m.id : null;
}

function submitAddEdge() {
  const err = document.getElementById("efm-error");
  const sourceId = resolveNodeIdFromInput(document.getElementById("efm-source").value);
  const targetId = resolveNodeIdFromInput(document.getElementById("efm-target").value);
  const relationType = document.getElementById("efm-rel").value;
  const strength = document.getElementById("efm-strength").value;
  const weight = Number(document.getElementById("efm-weight").value);
  const formula = document.getElementById("efm-formula").value.trim();
  const desc = document.getElementById("efm-desc").value;
  const ref = document.getElementById("efm-ref").value;

  if (!sourceId || !targetId) {
    err.textContent = "Selecciona un nodo de origen y destino válidos (de la lista de sugerencias).";
    err.hidden = false;
    return;
  }
  if (sourceId === targetId) {
    err.textContent = "Origen y destino deben ser distintos.";
    err.hidden = false;
    return;
  }
  if (relationType !== "correlated" && !/^target\s*(\+=|-=|=)/.test(formula)) {
    err.textContent = "La fórmula debe iniciar con 'target' seguido de '+=', '-=' o '=' (ej. \"target += source * weight\").";
    err.hidden = false;
    return;
  }

  let id = `e_${sourceId}_${targetId}`;
  if (getEdge(id)) {
    let i = 2;
    while (getEdge(`${id}_${i}`)) i++;
    id = `${id}_${i}`;
  }
  const edge = {
    id, source: sourceId, target: targetId, relationType, strength, weight,
    formula: relationType === "correlated" ? "" : formula, desc, ref
  };
  state.edges.push(edge);
  closeAddEdgeModal();
  rebuildGraph();
  refreshTables();
  editEdgeFromTable(id);
  markDirty();
}

/* ---------------------------------------------------------------------- *
 * Auto-save-to-server + auto re-analyze — debounced ~800ms after the last
 * schema-modifying edit anywhere in the app. Any CRUD action (node/edge
 * add/edit/delete, Parameter Inspector field change) calls markDirty().
 * ---------------------------------------------------------------------- */
function markDirty() {
  analysisStale = true;
  setSaveStatus("pending");
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(doSync, SYNC_DEBOUNCE_MS);
}

async function doSync() {
  setSaveStatus("saving");
  try {
    const res = await fetch("/api/schema", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportSchema())
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) { /* noop */ }
      throw new Error(msg);
    }
    setSaveStatus("saved");
  } catch (err) {
    setSaveStatus("error", err.message);
  }
  if (activeTab === "analysis" && analysisStale) {
    runAnalysis();
  }
}

function setSaveStatus(status, err) {
  const el = document.getElementById("save-status");
  if (!el) return;
  if (status === "pending") { el.textContent = "cambios sin guardar…"; el.className = "save-status pending"; }
  else if (status === "saving") { el.textContent = "guardando…"; el.className = "save-status saving"; }
  else if (status === "saved") { el.textContent = "guardado"; el.className = "save-status saved"; }
  else if (status === "error") { el.textContent = "error al guardar: " + err; el.className = "save-status error"; }
}

/* ---------------------------------------------------------------------- *
 * Data Analysis tab — live EDA via POST /api/analyze
 * ---------------------------------------------------------------------- */
async function runAnalysis() {
  const host = document.getElementById("analysis-content");
  if (!host) return;
  host.innerHTML = `<p class="analysis-loading">Analizando…</p>`;
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: exportSchema(), n: 500, seed: null })
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) { /* noop */ }
      throw new Error(msg);
    }
    const data = await res.json();
    analysisStale = false;
    renderAnalysis(data);
  } catch (err) {
    host.innerHTML = `<p class="analysis-unavailable">Análisis de datos no disponible — ¿está corriendo la versión más reciente de server.py? (${escapeHtml(err.message)})</p>`;
  }
}

function fmtNum(v) { return typeof v === "number" ? v.toFixed(2) : String(v); }

function renderAnalysis(data) {
  const host = document.getElementById("analysis-content");

  const numericHtml = Object.entries(data.numeric || {}).map(([id, s]) => {
    const n = getNode(id);
    return `<div class="stat-tile">
      <div class="stat-tile-title">${escapeHtml(n ? n.label : id)}</div>
      <div class="stat-tile-grid">
        <div><span class="stat-k">media</span><span class="stat-v">${fmtNum(s.mean)}</span></div>
        <div><span class="stat-k">σ</span><span class="stat-v">${fmtNum(s.std)}</span></div>
        <div><span class="stat-k">mín</span><span class="stat-v">${fmtNum(s.min)}</span></div>
        <div><span class="stat-k">máx</span><span class="stat-v">${fmtNum(s.max)}</span></div>
      </div>
    </div>`;
  }).join("");

  const catHtml = Object.entries(data.categorical || {}).map(([id, counts]) => {
    const n = getNode(id);
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    const rows = Object.entries(counts).map(([k, v]) => `
      <div class="freq-row">
        <span class="freq-label" title="${escapeAttr(String(k))}">${escapeHtml(String(k))}</span>
        <div class="freq-bar-wrap"><div class="freq-bar" style="width:${(v / total * 100).toFixed(1)}%"></div></div>
        <span class="freq-count">${v}</span>
      </div>`).join("");
    return `<div class="stat-tile"><div class="stat-tile-title">${escapeHtml(n ? n.label : id)}</div>${rows}</div>`;
  }).join("");

  const corrIds = Object.keys(data.correlations || {});
  const corrHtml = corrIds.length ? buildCorrHeatmap(corrIds, data.correlations) : `<p class="muted">Sin datos de correlación.</p>`;

  const warnings = (data.privacy && data.privacy.warnings) || [];
  const note = (data.privacy && data.privacy.note) || "";
  const privacyHtml = `
    <div class="privacy-panel ${warnings.length ? "has-warnings" : ""}">
      <h4>Advertencias de privacidad ${warnings.length ? `(${warnings.length})` : ""}</h4>
      ${warnings.length ? `<ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>` : `<p class="muted">Sin advertencias.</p>`}
      <p class="privacy-note">${escapeHtml(note)}</p>
    </div>`;

  host.innerHTML = `
    <div class="analysis-meta">n=${data.n ?? "?"} perfiles sintéticos generados para este análisis (se re-ejecuta automáticamente tras cada edición del esquema).</div>
    <section class="analysis-section"><h3>Variables numéricas</h3><div class="stat-tile-row">${numericHtml || '<p class="muted">Sin variables numéricas.</p>'}</div></section>
    <section class="analysis-section"><h3>Variables categóricas</h3><div class="stat-tile-row">${catHtml || '<p class="muted">Sin variables categóricas.</p>'}</div></section>
    <section class="analysis-section"><h3>Matriz de correlación</h3>${corrHtml}</section>
    <section class="analysis-section">${privacyHtml}</section>
  `;
}

function buildCorrHeatmap(ids, corr) {
  const label = (id) => { const n = getNode(id); return n ? n.label : id; };
  const cellStyle = (r) => {
    if (typeof r !== "number") return "";
    const t = Math.min(1, Math.abs(r));
    const base = r >= 0 ? "var(--div-pos)" : "var(--div-neg)";
    return `background:color-mix(in srgb, ${base} ${(t * 70).toFixed(0)}%, var(--div-mid));`;
  };
  const header = `<tr><th></th>${ids.map((id) => `<th class="heat-h" title="${escapeAttr(label(id))}">${escapeHtml(truncate(label(id), 10))}</th>`).join("")}</tr>`;
  const rows = ids.map((a) => {
    const cells = ids.map((b) => {
      if (a === b) return `<td class="heat-cell" style="${cellStyle(1)}" title="${escapeAttr(label(a))}">1.00</td>`;
      const r = corr[a] && corr[a][b];
      if (typeof r !== "number") return `<td class="heat-cell"></td>`;
      return `<td class="heat-cell" style="${cellStyle(r)}" title="${escapeAttr(label(a))} × ${escapeAttr(label(b))}">${r.toFixed(2)}</td>`;
    }).join("");
    return `<tr><th class="heat-h" title="${escapeAttr(label(a))}">${escapeHtml(truncate(label(a), 10))}</th>${cells}</tr>`;
  }).join("");
  return `<div class="table-scroll"><table class="heatmap-table"><thead>${header}</thead><tbody>${rows}</tbody></table></div>`;
}

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
        markDirty();
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
