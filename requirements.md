# Requirements — Real-Data Model Calibration Pipeline

**Project:** AcompañarIA · Palliative Graph & Synthetic Profile Network
**Document type:** Spec-driven development requirements, written for AI-assisted / orchestrator-agent execution
**Status:** Draft, awaiting Stage 1 kickoff approval

---

## 0. Stage Status Tracker

Keep this table current. This is the literal approval gate — no agent may begin a stage's tasks while its row reads anything other than `Approved`.

| Stage | Description | Status | Approved by | Date |
|---|---|---|---|---|
| 1 | Bayesian Network — ECOG performance status | **Approved** | Santiago | 2026-09-02 |
| 2 | Bayesian Network — full oncology schema calibration | Not started — do not begin without explicit user go-ahead | — | — |
| 3 | XGBoost — psychiatric database classifier | Placeholder (no dataset yet) | — | — |

---

## 1. Context

`schema/graph_model.json` (57 nodes / 91 edges, v1.2.0) is hand-authored: baseline means/stds, edge weights, and formulas were estimated from the clinical literature in `/context/` (advanced-cancer palliative-care studies — Delgado-Guay, Atinafu, Chan, Gontijo Garcia, Efendioglu, etc.), not fit to real patient data. `generator/engine.py` samples from it using a linear formula grammar (`target += source * weight`) plus a Gaussian-copula step for correlated continuous variables, and `generator/privacy.py`'s own docstring explicitly notes its audit is schema-level only "because no real patient dataset exists" for a Distance-to-Closest-Record or membership-inference comparison.

That precondition just changed. `ingest/parse_tcga_cases.py` has parsed 2,591 real, de-identified TCGA clinical cases (NCI GDC export) into `data/tcga_parsed/`, including a one-row-per-case `baseline_profile.csv` covering primary diagnosis, AJCC stage, ECOG/KPS, demographics, treatment history, and outcomes. A second, smaller real dataset covering psychiatric/psychological variables in palliative-care patients is being sourced separately by the team (tracked in the team plan artifact, Etapa 2/3) and does not exist yet.

This document specs the pipeline that uses the TCGA data (and, later, the psychiatric data) to replace hand-estimated schema parameters with parameters and models actually fit to real data — in three approval-gated stages.

**Background note, not open for re-litigation:** the original hackathon brief (`context/ACOMPANAR_Algoritmo_v1.pdf`) scoped the product around depression in neurological degenerative disease (Parkinson/ALS/Alzheimer/Huntington). `HANDOFF.md` documents a deliberate, already-completed pivot to an oncology-exclusive schema (that node and its edges were removed 2026-08-10 as ungrounded in the cancer-only literature corpus this repo actually audited). Every stage below is scoped to the current oncology-exclusive schema. Do not resurrect the neurological-disease branch as part of this spec.

---

## 2. Architecture Decision (locked)

**Trained models are wired directly into the generation engine as loadable artifacts ("Option B").** `engine.py` will load trained model objects (pgmpy `DiscreteBayesianNetwork`, later an XGBoost classifier) and sample/score through them, instead of exclusively through the linear formula grammar.

This is a deliberate, explicit departure from the constraint documented in `HANDOFF.md` ("stdlib only Python") and `README.md` ("Requiere solo Python 3 — sin dependencias externas"). Chosen over two alternatives:
- *Calibrate schema only* (translate trained-model outputs back into `baseline_mean`/`baseline_std`/edge `weight` fields, keep engine.py stdlib-only) — rejected because it caps model fidelity to what a linear formula can express, which conflicts with the goal of moving past linear relationships.
- *Offline-only* (produce calibration reports, wire nothing into the app) — rejected as insufficient; the team wants trained models actually driving generation, not just informing manual edits.

**Consequences every stage must account for:**
- `Dockerfile` and a new `requirements.txt` must be introduced/updated to `pip install` real dependencies (pandas, numpy, pgmpy, networkx, scipy, scikit-learn; xgboost when Stage 3 starts). This is a required deliverable, not an incidental side effect — call it out explicitly in each stage's PR/commit, since it silently breaks a constraint two docs currently assert as true.
- The frontend's "no-code visual editor" pitch (`ui/`, `@frontend_architect`'s Parameter Inspector) loses direct edit access to any node now driven by a trained Bayesian Network — its distribution lives in a CPT inside a model object, not in editable `baseline_mean`/`baseline_std` fields. This is an accepted trade-off. Building UI to inspect/edit a BN's CPTs is explicitly **out of scope** for Stages 1–3; flag it as a follow-on task if the team wants it later.
- `engine.py` needs a **per-node dispatch**: nodes with a trained model backing them sample through that model; nodes without one keep using the existing formula grammar. The schema and the engine both need to represent "this node is now model-backed" (e.g., a `model_ref` field on the node, or a parallel manifest) — the exact mechanism is a Stage 1 design task, not decided here.

---

## 3. Global Execution Rules

Apply to every agent (orchestrator or specialized) working from this spec:

1. **Stage gate is mandatory.** Do not start a stage's tasks until its row in §0 reads `Approved`. Update the tracker row to `In progress` when starting, and stop at the stage's Definition of Done — present the deliverable and explicitly ask the user to approve before touching the next stage's row or files.
2. **No fabricated data or citations.** Every model input traces to a file in `data/tcga_parsed/` or a future equivalently-parsed real dataset. Do not invent statistics, URLs, or sources — this repo has already had to correct fabricated-URL risk once this session (team-plan artifact); same standard applies here.
3. **Reuse existing utilities.** `ingest/parse_tcga_cases.py`'s `clean()`/`kps_to_ecog()`/CSV-writing conventions, `generator/stats.py`'s summary-stats shape, and `generator/privacy.py`'s audit shape are the established patterns — extend them, don't fork new ad hoc versions.
4. **Real clinical data never gets committed unreviewed.** `data/` and `context/data.json` (the raw 2,591-case TCGA export) must be `.gitignore`d before any commit touches this pipeline, pending `@privacy_ethics` sign-off (see §4).
5. **DSM-5 consistency is a hard constraint, not a soft one**, for any node under `depressive_diagnosis_dsm5`, `depressive_episode_type`, `psychiatric_comorbidities`, or `somatic_symptoms_cluster` (see §4). A model that violates it is a bug, not a calibration nuance.
6. **Every node and edge carries an explicit `evidence_tier`.** The schema mixes evidence of genuinely different strength — a value fit on this project's own real patient data is not the same kind of claim as a published aggregate statistic from someone else's cohort (Efendioglu Turkey, Atinafu Ethiopia, Chan Hong Kong, etc.), and neither should be silently indistinguishable from an unrefereed clinical estimate. Tag every node and edge with one of:
   - `"real_data"` — parameter fit directly on this project's own parsed patient-level data (`data/tcga_parsed/`, later the psychiatric dataset).
   - `"literature"` — parameter grounded in a cited external study (`ref` field points to a real paper), but not fit on data this project holds.
   - `"clinical_estimate"` — hand-set, not backed by a specific citation (e.g. `js/schema.js clinical estimate` refs already in the schema today).

   This is additive to the existing `ref`/`desc` fields, not a replacement. **Supersession rule:** when a node gains a `"real_data"` model (via the `model_ref` mechanism in §2), any `"literature"`/`"clinical_estimate"` edges that previously targeted that same node are retired (removed or explicitly marked superseded, engine's choice) — not because literature grounding is invalid, but because a direct-patient-data source for that exact node now exists and takes precedence. Nodes that will never get real-data coverage (`spiritual_pain`, `meaning_in_life`, caregiver nodes, etc.) keep their `"literature"`/`"clinical_estimate"` tier permanently — that tagging is not a removal queue, it's provenance.

---

## 4. Cross-Cutting Requirements

### 4.1 Privacy & Compliance

- `generator/privacy.py` currently performs **schema-level structural risk auditing only** (near-zero variance, dominant categories, collinear pairs on a generated sample) — explicitly because, per its own docstring, no real reference dataset existed. That precondition is now false. **Stage 1 or Stage 2 must extend `privacy_audit()` (or add a sibling function) to run an actual Distance-to-Closest-Record check between generated synthetic profiles and `data/tcga_parsed/baseline_profile.csv`.** This is the deferred work `privacy.py` itself flagged, now unblocked.
- TCGA clinical data is public, de-identified, released under NCI's own data use terms — materially lower legal exposure than primary-collected clinical data, but still health data in substance. Apply general data-protection principles regardless of jurisdiction: **data minimization and purpose limitation** (only ingest/retain fields actually used by a node in the schema), **privacy by design** (the DCR audit above should run before any calibrated schema is written to `schema/graph_model.json`, not after), and **security of processing** (real-data CSVs stay out of git per Rule 4 above).
  - Note: no GDPR legal text exists anywhere in this repo's `/context/` — the above is general guidance, not a citation of anything in this project. If the psychiatric dataset (Stage 3) ever includes EU data subjects, get an actual legal/compliance review before shipping; this spec does not substitute for one.
- Whichever psychiatric dataset Stage 3 eventually uses, run it through the same privacy posture before it touches `data/` — smaller psychiatric/clinical cohorts re-identify more easily than a 2,591-case oncology set.

### 4.2 Clinical / DSM-5 Validity

Confirmed against `context/dsm5.txt`:
- A major depressive episode requires ≥2 weeks of depressed mood or anhedonia (Criterion A1/A2) **plus** ≥5 of 9 Criterion A symptoms total, present nearly every day — this is the basis for `somatic_symptoms_cluster` and should bound any model-predicted symptom combination.
- Diagnostic coding splits explicitly on **single vs. recurrent episode**, which is exactly the existing `depressive_episode_type` node and its gating edge into `depressive_diagnosis_dsm5` (`schema/graph_model.json`'s `e_depressive_episode_type_depressive_diagnosis_dsm5`, formula-enforced today) — any Stage 2/3 model output must preserve this gate, not just approximate it statistically.
- Persistent depressive disorder (dysthymia) requires ≥2 years of mood disturbance in adults — relevant if a future stage tries to distinguish "Major depressive disorder" vs. "Dysthymia" from duration data rather than severity alone.
- Anxiety-disorder DSM-5 criteria were not found in the grepped range of `dsm5.txt` (only the depressive-disorder chapter was covered) — if Stage 3 needs to ground `psychiatric_comorbidities`'s "Anxiety disorder" category more rigorously than the current literature-derived estimate, a separate DSM-5 pass is needed then, not assumed from this document.

---

## 5. Stage 1 — Bayesian Network for ECOG Performance Status

**Objective:** Replace `ecog_performance_status`'s hand-estimated baseline (`ordinal`, mean 2, std 1) and its driving edges (`e_metastatic_disease_ecog_performance_status`, etc.) with a Bayesian Network trained on real TCGA data, and prove out the engine-integration mechanism that Stage 2 will reuse for the rest of the schema.

**Data:** `data/tcga_parsed/baseline_profile.csv` (2,591 cases). Known constraint: only 507 cases (20%) carry a real `ecog_performance_status` reading; another 220 (8%) have KPS only. Training signal is therefore ~28% of the corpus — call this out in the evaluation report, don't hide it.

**Candidate predictors** (from `baseline_profile.csv`): `ajcc_pathologic_stage`, `age_at_diagnosis_years`, `project_id`/`primary_site`, `prior_malignancy_flag`, `smoking_status`. **Caveat to resolve during modeling, not assume away:** `has_chemo`/`has_radiation`/`has_surgery`/`n_treatment_lines` may postdate or coincide with the performance-status reading rather than precede it (TCGA's `follow_ups` are timestamped independently of treatment courses) — using them as predictors risks leaking information in the wrong causal direction. Document whichever choice is made and why.

**Approach:**
1. `pgmpy.models.DiscreteBayesianNetwork` (or `bnlearn`) fit on the ~507-728 case labeled subset (ECOG direct + KPS-derived fallback, kept as separate label-quality tiers, not silently merged).
2. Train/verification split (the 2,591-case corpus is explicitly large enough for this — hold out a verification set, don't evaluate on training data).
3. Persist the trained model (`models/ecog_bn.pkl`) plus a human-readable CPT export (`models/ecog_bn_cpts.json` or similar) so a non-Python reviewer (supervisor, `@privacy_ethics`) can sanity-check it without loading pickle.
4. Extend `engine.py` with the model-backed sampling dispatch described in §2, applied to just this one node, gated so the legacy linear-formula path still works for every other node unchanged.

**Definition of Done:**
- [x] `models/ecog_bn.pkl` + CPT export (`models/ecog_bn_cpts.json`) written.
- [x] Evaluation report at `reports/stage1_ecog_bn_eval.md` (macro-F1 + within-1 accuracy + majority-baseline comparison + label-quality-tier breakdown, training-coverage caveat stated plainly).
- [x] `engine.py` generates `ecog_performance_status` via the trained BN (`model_ref` dispatch, §2's mechanism, implemented) — verified end-to-end through `server.py`'s actual `/api/schema`, `/api/generate`, `/api/analyze` routes, not just the CLI.
- [x] `requirements.txt` added; `Dockerfile` updated (base image bumped `python:3.11-slim` -> `python:3.12-slim`, `numpy==2.5.2` requires >=3.12) — container build and boot confirmed.
- [x] `context/data.json` and `data/` gitignored (were not before — real patient data was one commit away from landing in git).
- [x] `ecog_performance_status` tagged `evidence_tier: "real_data"` in `schema/graph_model.json`; `e_metastatic_disease_ecog_performance_status` (its only literature-sourced inbound edge) removed per the supersession rule in Rule 6 (§3). Schema bumped to v1.3.0.
- [ ] `generator/privacy.py` real DCR extension — **explicitly deferred to Stage 2**, not built now. Reasoning: the only `real_data`-tier fields that exist after Stage 1 are `disease_stage` x `age_bracket` (16 total combinations) — a DCR audit over a field space that small would flag nearly every generated row as "near-identical to a real record" by construction, not because of genuine re-identification risk. That's a degenerate result, not a meaningful one; shipping it now would just teach the team to ignore the audit. Meaningful once Stage 2 adds real-data-grounded dimensionality.
- [ ] Full-schema `evidence_tier` backfill (the other ~57 nodes / ~95 edges) — **deferred to Stage 2**, bundled with that stage's own `evidence_tier` supersession work rather than done twice.

**Stage 1 completion notes (for whoever reads this before approving):**
- The model does not beat a majority-class baseline on exact accuracy (0.500 vs 0.500) after two independent improvement attempts — see `reports/stage1_ecog_bn_eval.md` for the full investigation (a real preoperative-timing bias in `pick_baseline_follow_up()` was found and fixed along the way, now benefiting `baseline_profile.csv` generally, not just this model; a 3rd predictor, `primary_site_group`, improved macro-F1 modestly but couldn't be wired in — see below). Shipped anyway per the evidence_tier reasoning in Rule 6: an honestly-weak real-data model is still better provenance than an arbitrary literature guess, and the weakness is documented, not hidden.
- **Found and fixed in `ingest/parse_tcga_cases.py` along the way (not scoped, but necessary):** `kps_to_ecog()` was mapping KPS=0 ("Dead") to an invented ECOG value of 5, outside the schema's declared `[0,4]` range. Fixed to return `None` for KPS=0 instead.
- **Real architectural finding for Stage 2:** a model_ref predictor must be a node whose value is fully resolved by the time the per-node topo loop reaches the model-backed node. The 7 `cancer_type_*` binaries don't qualify as-is — their "exactly one active site" invariant is only enforced in `apply_hard_constraints()`, which runs after that loop. Stage 2's "mixed dependency graph" design task (§6) needs to either move that resolution earlier or find another way to expose a clean site predictor mid-loop.

**Stage 1 approved 2026-09-02 (Santiago). Stage 2 remains explicitly on hold — do not start it without a separate, explicit go-ahead, even though the gate is technically unblocked.**

---

## 6. Stage 2 — Bayesian Network to Calibrate the Full Schema

**Objective:** Extend Stage 1's approach from one node to the full oncology-relevant portion of the schema — the `oncology`, `functional`, `symptom`, `side_effect`, and non-psychiatric `medication`/`clinical` category nodes — using `data/tcga_parsed/` (all six tables, not just `baseline_profile.csv`, for richer conditioning where useful).

**Structural approach:** Do not let structure-learning run unconstrained. Use the existing edges in `schema/graph_model.json` as a structural prior/whitelist for the BN's DAG, and only add data-supported arcs beyond that where they don't produce a clinically inexplicable relationship — the schema needs to stay traceable and explainable to a non-ML supervisor, which is also why `HANDOFF.md` calls the schema shape itself "frozen." Structure that contradicts an already-cited literature edge (e.g. reversing a causal direction) needs a specific call-out and justification, not a silent overwrite.

**Explicit scope boundary:** `psychological`, `emotional`, `relational`, and demographic-beyond-age/sex categories are **not** covered by TCGA and stay on their current hand-tuned literature-derived baseline until real psychiatric data exists (Stage 3+). Stage 2 must not silently degrade or overwrite those nodes' existing calibration.

**Engine integration:** generalizes Stage 1's per-node dispatch to many nodes — `engine.py` needs to sample each node via its trained BN if one exists, else fall back to the legacy formula for that node, in the correct topological order across a *mixed* dependency graph (a BN-backed node may depend on a formula-driven node's output and vice versa). This ordering logic is the core technical risk of this stage; design it explicitly rather than patching per-node.

**Definition of Done:**
- Updated `engine.py` handling the mixed BN/formula dependency graph.
- `models/schema_bn.pkl` (or equivalent) covering the in-scope node set.
- Validation: `generator/stats.py`-style before/after comparison (hand-tuned baseline vs. TCGA-calibrated) on the covered nodes, reviewed for clinical plausibility, not just statistical fit.
- `generator/privacy.py`'s real-data DCR audit (§4.1) run against the calibrated schema's generated sample — must pass (or documented flags reviewed and accepted by `@privacy_ethics`) before `schema/graph_model.json` is overwritten.
- `schema/graph_model.json`'s `metadata.version` bumped, and a note added to `HANDOFF.md` documenting this round's changes, consistent with how prior rounds were documented.

**STOP — Awaiting user approval before Stage 3 begins.**

---

## 7. Stage 3 — XGBoost Classifier on the Psychiatric Database (Placeholder)

**Status: not started, no dataset chosen.** Per the team's Etapa 3 plan, the psychiatric/psychological dataset (candidates: HRS, NHATS, MIDUS, NHANES, Metapsy, DAIC-WOZ, HCP-DES, MIND Set — see the team-plan artifact) is still being researched by David/Cristian. This section defines the contract the eventual work must satisfy, not a concrete implementation plan.

**Required once a dataset is chosen:**
- A parser analogous to `ingest/parse_tcga_cases.py`, producing a normalized `psych_profile.csv` with a documented schema (same `clean()`/sentinel-null conventions).
- Since the psychiatric cohort and the TCGA oncology cohort are **different patients** (no real per-patient join key), any join is cross-population / distributional, not row-level — the modeling approach must reflect that (e.g., conditioning on shared covariates like age/sex/cancer-stage-where-available, not a literal table join).
- A decided target variable: either `depressive_diagnosis_dsm5`'s categories directly, or a binary clinically-significant-symptom flag derived from whatever screening instrument the chosen dataset uses (PHQ-9 ≥ 10, GAD-7 ≥ 10, HADS cutoff — instrument-specific, decide when the dataset is known).
- **Open design question to resolve before this stage starts, not now:** XGBoost is a discriminative classifier, not a generative model like Stages 1–2's Bayesian Network — it can label/score a case but can't directly sample a new synthetic value the way a BN can. Clarify with the user whether Stage 3's role is (a) a *validator* that scores Stage 2's BN-generated synthetic profiles for psychiatric plausibility, or (b) a component that gets composed with a generative step some other way. Do not assume (a) or (b) — ask when this stage actually starts.

This stage does not gate Stage 1 or Stage 2 approval, and its row in §0 should stay `Placeholder` until a dataset is confirmed.

---

## 8. Risks & Open Items

- **ECOG label coverage ceiling.** Stage 1's model is trained on ~20-28% of TCGA cases with any performance-status reading at all — this bounds achievable model quality regardless of algorithm choice. If Stage 1's evaluation report shows poor macro-F1, that's expected, not necessarily a bug; consider whether SEER/cBioPortal (both flagged in the team's source table as having "explicit baseline ECOG") should be added to the training set before concluding the BN approach itself is inadequate.
- **Treatment-feature leakage** (see §5) needs an explicit decision, not a default.
- **Deploy footprint.** Moving off stdlib-only changes Cloud Run image size/cold-start and requires the Dockerfile change in §2 — confirm this is acceptable before Stage 1's engine-integration work ships to the deployed demo, not just locally.
- **Frontend capability loss** (§2) — no UI currently exists to inspect/edit a trained BN's CPTs; flag to the team as a likely future ask once Stage 2 ships and someone wants to hand-tune a model-backed node the way they can today.
- **No GDPR text in this repo** (§4.1) — the compliance guidance here is general, not grounded in project sources. Get real legal review before any EU-facing use of Stage 3's psychiatric data.

---

## 9. File Map (new/changed by this pipeline)

```
ingest/
  parse_tcga_cases.py       existing — TCGA JSON -> data/tcga_parsed/*.csv
  parse_<psych_source>.py   Stage 3 — added once dataset is chosen
training/
  train_ecog_bn.py          Stage 1
  train_schema_bn.py        Stage 2
models/
  ecog_bn.pkl                Stage 1 artifact
  ecog_bn_cpts.json           Stage 1 human-readable export
  schema_bn.pkl               Stage 2 artifact
reports/
  stage1_ecog_bn_eval.md
  stage2_schema_bn_eval.md
requirements.txt             new — Stage 1, pip deps for the model layer
Dockerfile                   updated — Stage 1, adds pip install step
generator/engine.py          updated — Stage 1 (single-node dispatch), Stage 2 (full dispatch)
generator/privacy.py         updated — Stage 1 or 2, real DCR audit
schema/graph_model.json      updated — Stage 2, calibrated params written after approval
```
