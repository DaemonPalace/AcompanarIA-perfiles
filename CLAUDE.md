# Palliative Graph & Synthetic Profile Network

## System Directives
- **Execution Style**: Caveman (Zero prose, no greetings/intros, direct structured code/data outputs).
- **Core Objective**: Autonomous generation of synthetic patient profiles with continuous visual fine-tuning, schema import/export, and parameter persistence.
- **Model Construction & Persistence**:
  - `@clinical_researcher` & `@data_analyst` extract initial baseline variables from `/context/` -> `schema/graph_model.json`.
  - `@frontend_architect` builds UI import/export & parameter editing tools so users can visually tweak parameters without code.
  - `@data_analyst` ensures `generator/engine.py` accepts any valid user-edited/imported JSON schema to output updated datasets dynamically.

---

## Agent Network

- **`@orchestrator`**: Controls workflow, prevents agent drift, manages state handoffs.
- **`@clinical_researcher`**: Reads `/context/`. Outputs structured variable nodes, directional edges, and 1-sentence UI clinical explanations.
- **`@data_analyst`**: Assigns baseline math parameters (weights, formulas, ranges), validates DAG topology, updates `generator/engine.py` to support live parameter changes, and outputs synthetic CSVs.
- **`@frontend_architect`**: Builds React Flow/D3 mind-map UI with:
  - Import / Export JSON modal for version saving/loading.
  - Parameter Inspector Panel (edit baseline means, std devs, edge weights, and logic formulas).
  - Real-time "Generate Dataset" trigger linked to current canvas state.
- **`@data_visualizer`**: Generates Seaborn/Plotly diagnostic plots comparing baseline vs fine-tuned model outputs.
- **`@privacy_ethics`**: Audits newly saved/modified schema parameter sets for overfitting and re-identification risks.

---

## Schema Persistence Format (`schema/graph_model.json`)

```json
{
  "metadata": {
    "model_name": "Palliative Care Baseline",
    "version": "1.2.0",
    "last_modified": "2026-08-10"
  },
  "nodes": [
    {
      "id": "pain_scale",
      "label": "Pain Severity",
      "type": "ordinal",
      "range": [0, 10],
      "baseline_mean": 3.0,
      "baseline_std": 1.5
    }
  ],
  "edges": [
    {
      "id": "e_pain_opioid",
      "source": "pain_scale",
      "target": "opioid_daily_mme",
      "relationType": "causal",
      "weight": 15.0,
      "formula": "target += source * 15.0"
    }
  ]
}
