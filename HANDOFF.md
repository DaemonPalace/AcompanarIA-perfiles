# Handoff — Palliative Graph & Synthetic Profile Network

Status as of 2026-08-10. Full pipeline built and verified end-to-end. Nothing committed to git yet (all new files untracked).

## What this is

Two sibling apps in one repo, both generate synthetic palliative-care patient profiles from `/context/` (ACOMPANAR algorithm PDF, DSM-5 excerpt, 14 clinical articles):

1. **Old/existing app** (pre-dates this session): `index.html` + `js/*.js` at repo root. Vanilla JS, no backend, no build. Own variable/correlation format (`js/schema.js`), Cholesky-correlated normal sampling (`js/stats.js`), canvas histograms (`js/viz.js`). Fully working, untouched this session. See root `README.md`.
2. **New graph-based system** (built this session, per `CLAUDE.md` spec): mind-map editor over a directed graph schema, Python generator, local server bridge. This is what the rest of this doc covers.

## Architecture (new system)

```
schema/graph_model.json   <- graph data (nodes=variables, edges=relationships)
generator/engine.py       <- schema-driven synthetic profile generator (stdlib Python)
server.py                 <- stdlib HTTP bridge: serves ui/, exposes /api/schema + /api/generate
ui/index.html+app.js+style.css  <- D3-based mind-map editor (vanilla JS, no build step)
```

Run it: `python3 server.py [--port 8765]` then open `http://localhost:8765`. Opening `ui/index.html` directly via `file://` will NOT work (fetch to `/api/schema` needs same-origin server).

## Schema contract — `graph_model.json` (frozen, all 3 pieces depend on this exact shape)

```json
{
  "metadata": { "model_name": str, "version": str, "last_modified": "YYYY-MM-DD" },
  "nodes": [
    {
      "id": "snake_case", "label": "Human Title",
      "category": "oncology|symptom|medication|psychological|functional|side_effect|clinical|emotional|relational|demographic",
      "desc": "1-sentence clinical definition",
      "type": "continuous|ordinal|categorical|binary",
      "range": [min, max], "baseline_mean": number, "baseline_std": number,
      "categories": ["catA","catB"], "probabilities": [0.6, 0.4]
    }
  ],
  "edges": [
    {
      "id": "e_source_target", "source": "source_id", "target": "target_id",
      "relationType": "causal|correlated|inhibitory|compound",
      "strength": "weak|moderate|strong", "weight": number,
      "formula": "target += source * weight", "desc": "1-sentence popup text",
      "ref": "citation"
    }
  ]
}
```

Rules:
- `continuous`/`ordinal` nodes use `range`+`baseline_mean`+`baseline_std` (no `categories`).
- `categorical`/`binary` nodes use `categories`+`probabilities` (must sum to 1; no `range`/mean/std).
- `formula` is `null` for `correlated` edges (statistical/informational only, NOT applied during generation).
- `formula` for `causal`/`inhibitory`/`compound` must start with `target` then one of `+=`, `-=`, `=`, then an expression using only `source`/`weight` names, e.g. `"target += source * weight"`.
- The subgraph of `causal`/`inhibitory`/`compound` edges MUST be a DAG (engine validates via Kahn's algorithm topo sort, rejects cycles).
- **Binary source gotcha (fixed)**: if a `causal`/`inhibitory`/`compound` edge's *source* node is `type: binary` (e.g. `["No","Yes"]`), `generator/engine.py` dummy-codes the value to its `categories.index(value)` (0/1) before evaluating the formula — otherwise `int + str` crashes. See `generate()` in `generator/engine.py` around the `incoming[nid]` loop. Multi-option (`>2`) categorical nodes are never used as causal source/target in the current schema (not supported by the formula grammar — would need explicit design if added later).

## Current schema content

`schema/graph_model.json`: **51 nodes, 81 edges** (40 causal, 15 inhibitory, 26 correlated). Categories: clinical(6), oncology(2), medication(3), side_effect(2), functional(9), symptom(7), psychological(4), emotional(5), relational(6), demographic(7).

Built by converting `js/schema.js`'s existing 16 numeric + 22 categorical variables into graph form (Efendioglu et al. 2021 Table 3 correlations converted r→regression-slope edge weights), plus new oncology/medication/side_effect nodes grounded in the PDFs/articles not present in the old app: `metastatic_disease`, `chemotherapy_current`, `opioid_use`, `antiemetic_use`, `opioid_induced_constipation`, `sedation_level`, `ecog_performance_status`, `dyspnea`, `drowsiness`, `insomnia_severity`, `anxiety_level`, `suicidal_ideation_risk`, `spiritual_pain`.

Known omission: `js/schema.js`'s threshold-binned label variables (e.g. `estado_nutricional` derived from MNA-SF cutoffs) were dropped — not expressible under the linear `target += source * weight` formula grammar. The underlying continuous nodes they derive from are all present; binning would need a new formula/edge type if wanted.

## `generator/engine.py` — API

- `load_schema(path) -> dict`
- `validate_schema(schema) -> list[str]` (empty = valid). Checks dangling edge refs, missing required fields per type, DAG-ness.
- `generate(schema, n=500, seed=None) -> list[dict]` — topo-sorts nodes, samples baseline (truncated normal for continuous/ordinal, weighted choice for categorical/binary), applies incoming edge formulas in edge-list order, clips/rounds to range.
- `to_csv(rows, node_ids) -> str`
- CLI: `python3 generator/engine.py schema/graph_model.json --n 500 --seed 42 --out out.csv`

## `server.py` — API (stdlib `http.server` only, no pip deps)

- Serves static files from `ui/` at `/` (index.html default doc).
- `GET /api/schema` → JSON contents of `schema/graph_model.json`, 404 JSON error if missing.
- `POST /api/generate` — body `{"schema": <graph_model.json object>, "n": int=500, "seed": int|null=null, "format": "csv"|"json"="csv"}`.
  - `format=csv` → 200, `text/csv`, `Content-Disposition: attachment; filename="synthetic_profiles.csv"`.
  - `format=json` → 200, `{"columns": [node_id,...], "rows": [[val,...],...]}` (column order = schema node order).
  - Invalid schema → 400, `{"error": "validation errors joined with '; '"}`.

## `ui/` — frontend

Vanilla JS + D3 v7 via CDN (`https://d3js.org/d3.v7.min.js`) for force-layout physics/drag/zoom only; rendering is plain SVG. No build step, no npm.

Features implemented: bubble nodes sized by `baseline_std` (numeric) or fixed size (categorical), edge line styles by `relationType` (causal=solid, correlated=dashed, inhibitory=solid red, compound=dotted) with arrowheads on directional types, click-node highlighting (dims non-connected), shift/ctrl-click two nodes → pairwise popup with editable connecting-edge fields, Parameter Inspector side panel (live-edits node/edge fields, canvas re-renders immediately), Import/Export (client-side file download/upload — export never writes to `schema/graph_model.json` on disk), auto-loads `/api/schema` on page load with inline fallback fixture if fetch fails (e.g. opened via `file://`), Generate Dataset button (n/seed inputs) → POSTs to `/api/generate` → downloads CSV, shows red banner on 400 errors.

Category colors are dynamic (sorted categories mapped onto an 8-hue CVD-safe palette from the `dataviz` skill, not a hardcoded 6-item enum) since the real schema ended up with 10 categories, not the 6 originally spec'd.

Export whitelisting confirmed clean: no leaked D3 runtime fields (`x/y/vx/vy/fx/fy/index`) in exported JSON; edge `source`/`target` always plain string ids even after simulation mutates them in place.

## Verification done this session (all passing)

- `validate_schema` catches dangling edge refs and 2-node cycles (fixture tests).
- `generate()` reproducible under same seed, values respect `range`/`type`.
- Real 51/81 schema: `python3 generator/engine.py schema/graph_model.json --n 20 --seed 7 --out out.csv` → clean CSV, 21 lines (header+20).
- `server.py` live: `GET /api/schema` → 51 nodes/81 edges; `POST /api/generate` (real schema, n=15, format=json) → 200, 51 cols × 15 rows; `GET /` → 200 (serves `ui/index.html`).
- Frontend verified via headless Chromium against the real running server + real schema: renders all 51 nodes/81 edges, arrowhead/color/dash rules correct, highlighting/inspector/pairwise-popup/export-roundtrip all confirmed, Generate Dataset error path confirmed pre-fix (see bug below), success path confirmed against fixture.

## Bug fixed this session

Frontend verification against the real schema surfaced: 8 causal/inhibitory edges have a `binary`-type source node (`metastatic_disease`, `chemotherapy_current`, `opioid_use`, `antiemetic_use`) whose sampled value is the string `"Yes"`/`"No"`, crashing `target += source * weight` with `TypeError: int + str`. Fixed in `generator/engine.py`, `generate()`: binary source values are now dummy-coded via `categories.index(value)` before formula evaluation. Re-verified clean after fix (see above).

## Not done / open items

- Nothing committed to git — repo shows all new files as untracked (`.claude/`, `CLAUDE.md`, `context/`, `generator/`, `schema/`, `server.py`, `ui/`).
- No automated test suite — verification was manual/scripted this session, not saved as a repeatable test file.
- Threshold-binned derived variables from the old `js/schema.js` (nutritional status label, ADL dependency label, etc.) not ported to the new graph — see "Current schema content" above.
- No persistence endpoint to save UI edits back to `schema/graph_model.json` on disk (by design — Export is client-side download only, to avoid the server silently overwriting the committed schema file). If "save this edited graph as the new baseline" is wanted later, that's a deliberate new feature, not a bug.
- `@privacy_ethics` agent role from `CLAUDE.md` (audit schema for overfitting/re-identification risk) not yet exercised.
- `@data_visualizer` agent role (Seaborn/Plotly diagnostic plots comparing baseline vs fine-tuned outputs) not yet built — the old app's `js/viz.js` (canvas histograms/heatmap/scatter) covers similar ground for the old system only.

## Key files to read first on a fresh machine

1. `CLAUDE.md` — original spec/directives (caveman-mode execution style, agent roles, schema format).
2. This file.
3. `schema/graph_model.json` — inspect node/edge counts and a few entries to sanity-check nothing got corrupted in transit.
4. `generator/engine.py` and `server.py` — both short, read top to bottom.
5. `ui/app.js` — ~850 lines, D3 force-graph + panels.
