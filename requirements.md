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
| 2 | Bayesian Network — full oncology schema calibration | Deliverables complete — awaiting sign-off (see `HANDOFF.md` Round 4) | Santiago (kickoff) | 2026-09-03 |
| 3 | Clinical consistency verification & parameter tuning | First pass complete against Stage 2's output (`reports/stage3_consistency_pass.md`) — awaiting sign-off | — | — |
| 4 | XGBoost — psychiatric database classifier | Placeholder (no dataset yet) | — | — |

---

## 1. Context

`schema/graph_model.json` (57 nodes / 91 edges, v1.2.0) is hand-authored: baseline means/stds, edge weights, and formulas were estimated from the clinical literature in `/context/` (advanced-cancer palliative-care studies — Delgado-Guay, Atinafu, Chan, Gontijo Garcia, Efendioglu, etc.), not fit to real patient data. `generator/engine.py` samples from it using a linear formula grammar (`target += source * weight`) plus a Gaussian-copula step for correlated continuous variables, and `generator/privacy.py`'s own docstring explicitly notes its audit is schema-level only "because no real patient dataset exists" for a Distance-to-Closest-Record or membership-inference comparison.

That precondition just changed. `ingest/parse_tcga_cases.py` has parsed 2,591 real, de-identified TCGA clinical cases (NCI GDC export) into `data/tcga_parsed/`, including a one-row-per-case `baseline_profile.csv` covering primary diagnosis, AJCC stage, ECOG/KPS, demographics, treatment history, and outcomes. A second, smaller real dataset covering psychiatric/psychological variables in palliative-care patients is being sourced separately by the team (tracked in the team plan artifact, Etapa 2/3) and does not exist yet.

This document specs the pipeline that uses the TCGA data (and, later, the psychiatric data) to replace hand-estimated schema parameters with parameters and models actually fit to real data — in four approval-gated stages, with a dedicated verification stage (Stage 3) between the two Bayesian Network stages and the eventual psychiatric-data classifier.

**Background note, not open for re-litigation:** the original hackathon brief (`context/ACOMPANAR_Algoritmo_v1.pdf`) scoped the product around depression in neurological degenerative disease (Parkinson/ALS/Alzheimer/Huntington). `HANDOFF.md` documents a deliberate, already-completed pivot to an oncology-exclusive schema (that node and its edges were removed 2026-08-10 as ungrounded in the cancer-only literature corpus this repo actually audited). Every stage below is scoped to the current oncology-exclusive schema. Do not resurrect the neurological-disease branch as part of this spec.

---

## 2. Architecture Decision (locked)

**Trained models are wired directly into the generation engine as loadable artifacts ("Option B").** `engine.py` will load trained model objects (pgmpy `DiscreteBayesianNetwork`, later an XGBoost classifier) and sample/score through them, instead of exclusively through the linear formula grammar.

This is a deliberate, explicit departure from the constraint documented in `HANDOFF.md` ("stdlib only Python") and `README.md` ("Requiere solo Python 3 — sin dependencias externas"). Chosen over two alternatives:
- *Calibrate schema only* (translate trained-model outputs back into `baseline_mean`/`baseline_std`/edge `weight` fields, keep engine.py stdlib-only) — rejected because it caps model fidelity to what a linear formula can express, which conflicts with the goal of moving past linear relationships.
- *Offline-only* (produce calibration reports, wire nothing into the app) — rejected as insufficient; the team wants trained models actually driving generation, not just informing manual edits.

**Consequences every stage must account for:**
- `Dockerfile` and a new `requirements.txt` must be introduced/updated to `pip install` real dependencies (pandas, numpy, pgmpy, networkx, scipy, scikit-learn; xgboost when Stage 4 starts). This is a required deliverable, not an incidental side effect — call it out explicitly in each stage's PR/commit, since it silently breaks a constraint two docs currently assert as true.
- The frontend's "no-code visual editor" pitch (`ui/`, `@frontend_architect`'s Parameter Inspector) loses direct edit access to any node now driven by a trained Bayesian Network — its distribution lives in a CPT inside a model object, not in editable `baseline_mean`/`baseline_std` fields. This is an accepted trade-off. Building UI to inspect/edit a BN's CPTs is explicitly **out of scope** for Stages 1–4; flag it as a follow-on task if the team wants it later.
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
  - Note: no GDPR legal text exists anywhere in this repo's `/context/` — the above is general guidance, not a citation of anything in this project. If the psychiatric dataset (Stage 4) ever includes EU data subjects, get an actual legal/compliance review before shipping; this spec does not substitute for one.
- Whichever psychiatric dataset Stage 4 eventually uses, run it through the same privacy posture before it touches `data/` — smaller psychiatric/clinical cohorts re-identify more easily than a 2,591-case oncology set.

### 4.2 Clinical / DSM-5 Validity

Confirmed against `context/dsm5.txt`:
- A major depressive episode requires ≥2 weeks of depressed mood or anhedonia (Criterion A1/A2) **plus** ≥5 of 9 Criterion A symptoms total, present nearly every day — this is the basis for `somatic_symptoms_cluster` and should bound any model-predicted symptom combination.
- Diagnostic coding splits explicitly on **single vs. recurrent episode**, which is exactly the existing `depressive_episode_type` node and its gating edge into `depressive_diagnosis_dsm5` (`schema/graph_model.json`'s `e_depressive_episode_type_depressive_diagnosis_dsm5`, formula-enforced today) — any Stage 2/3 model output must preserve this gate, not just approximate it statistically.
- Persistent depressive disorder (dysthymia) requires ≥2 years of mood disturbance in adults — relevant if a future stage tries to distinguish "Major depressive disorder" vs. "Dysthymia" from duration data rather than severity alone.
- Anxiety-disorder DSM-5 criteria were not found in the grepped range of `dsm5.txt` (only the depressive-disorder chapter was covered) — if Stage 4 needs to ground `psychiatric_comorbidities`'s "Anxiety disorder" category more rigorously than the current literature-derived estimate, a separate DSM-5 pass is needed then, not assumed from this document.

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

**Objective, revised from the original scope below:** the original framing ("full oncology-relevant portion of the schema" — oncology/functional/symptom/side_effect/non-psychiatric-medication/clinical) is not fully achievable with the data actually available. TCGA is a genomics registry, not a symptom-tracking one — it has zero ground truth for `functional` (ADL/IADL/MMSE/nutrition/mobility), all 7 `symptom` nodes, `side_effect`, and non-psychiatric `medication`. Those stay on their current literature/formula-based footing; they need a different (symptom-focused) dataset that doesn't exist in `data/` yet. Confirmed field coverage in `data/tcga_parsed/baseline_profile.csv`: `ajcc_pathologic_stage` 94%, `age_at_diagnosis_years` 99%, `sex_at_birth` 100%, `ajcc_pathologic_m` 87%, `has_chemo` 100%, `project_id` 100%.

**Tier A — real-data baseline recalibration** (recompute a node's own `probabilities`/`baseline_mean` from real TCGA marginals, no new model file):
- `disease_stage`: real distribution is Advanced 62.1% / Terminal 31.3% / Mild 0.4% / Moderate 0.3% (vs. current 25/35/25/15) — TCGA's late-stage skew is appropriate for a palliative population; recalibrate.
- `age_bracket`: recompute from the real age distribution (99% coverage).
- `gender`: **decided.** Rescale only the Female/Male split to TCGA's real ratio (Male 57.8% / Female 42.2%, sex-at-birth) — TCGA cannot inform gender identity at all, so `Non-binary`/`Prefer not to say` keep their current small literature-estimated share exactly as-is, untouched. Node `desc` gets a note that the real-data grounding is sex-at-birth, not self-identified gender.
- `chemotherapy_current`: **decided — renamed to `has_chemo`.** TCGA's field means "ever received chemotherapy," not "currently receiving" — rather than keep a mismatched name with a caveat, rename the node id (cascading to its edges: `e_chemotherapy_current_fatigue`, `e_chemotherapy_current_nausea_vomiting`, and any others sourced from it) and its `label`/`desc` to honestly reflect treatment history, then recalibrate its baseline to TCGA's real 36.3% (close to the current 40%, so this is mostly a truthfulness fix, not a big numeric shift).
- `cancer_type_*` (7 site nodes): **decided — not touched.** TCGA's project mix (Other 31.5%/GI 26.3%/GU 23.7%/Breast 10.4%/Lung 8.0%/Gyn 0.1%/**Heme 0%**) reflects whichever studies got pulled into `context/data.json`, not real palliative-population epidemiology — zero hematologic cases is a sampling artifact. Keep the literature-curated distribution (8 dedicated palliative-cohort studies), tagged `literature`, not `real_data`.

**Tier B — genuine conditional model** (same `model_ref` mechanism as Stage 1, new `training/train_metastatic_bn.py`):
- `metastatic_disease` ← `disease_stage`, trained on `ajcc_pathologic_m` (87% coverage, ~1,770 usable cases after excluding `MX`/missing). Real metastatic rate among assessed cases is ~18%, vs. the current schema's 55% baseline — replaces today's compound-formula gate (`target='No' if source<=1 else target`).

**Tier C — explicitly not calibratable now, tag only:** every node in `functional`, `symptom`, `side_effect`, `medication`, and `demographic` beyond age/gender keeps its current value untouched. This is where Stage 1's deferred full-schema `evidence_tier` backfill happens: tag every node and edge `real_data` (Tier A/B outputs), `literature` (has a real citation in `ref`), or `clinical_estimate` (this session's own fitted formulas — e.g. the ECOG-driven ADL/MMSE/nutrition edges from the Stage 1 rollout).

**Explicit scope boundary (unchanged):** `psychological`, `emotional`, `relational` categories are not covered by TCGA and stay on their current hand-tuned literature-derived baseline until real psychiatric data exists (Stage 4+). Stage 2 must not silently degrade or overwrite those nodes' existing calibration.

**SEER — on standby, included in Stage 2's plan but not blocking it.** Access has been requested (SEER*Stat registration) but is not yet granted as of 2026-09-03. Stage 2 proceeds now on TCGA alone. SEER is a population-based registry (45.9% of the US population), not a curated research cohort — once access arrives, it's the natural source to revisit the `cancer_type_*` distribution decision above (TCGA's project mix has 0% hematologic representation, a sampling artifact SEER wouldn't share) and to add scale/population-representativeness to `disease_stage`/demographics. Do not block Stage 2's current implementation on it; treat a future SEER-informed pass as a follow-up round (documented in `HANDOFF.md` when it happens), not a reason to leave this round half-finished.

**Engine integration:** only Tier B needs the mixed BN/formula dispatch (`metastatic_disease` becomes `model_ref`-backed, same mechanism `ecog_performance_status` already uses) — Tier A is a plain baseline-value rewrite, no dispatch logic needed. `disease_stage` and `age_bracket` are roots (no predictors needed), so no new ordering risk there.

**Definition of Done:**
- [x] Tier A: `disease_stage`, `age_bracket`, `gender` (F/M portion only), `has_chemo` (renamed from `chemotherapy_current`) baselines recalibrated to real TCGA marginals.
- [x] Tier B: `models/metastatic_bn.pkl` + CPT export + eval report (`reports/stage2_metastatic_bn_eval.md`), `metastatic_disease` tagged `evidence_tier: "real_data"`, its old compound-formula gate retired per the Rule 6 supersession rule. 87.0% accuracy / 0.823 macro-F1 vs. 81.9% majority baseline — genuinely predictive, not just honestly-weak like Stage 1's ECOG model.
- [x] Tier C: every node (56/56) and edge (90/90) in the schema carries an explicit `evidence_tier` (the deferred Stage 1 backfill, done here): 6 `real_data`, 61 edges/20 nodes `literature`, 29 edges/30 nodes `clinical_estimate`.
- [x] `generator/privacy.py`'s real-data DCR audit (§4.1) implemented (`real_data_dcr_audit()`) and run — found and fixed a real methodological bug along the way (sparse-field combo fragmentation inflating "rare match" rate to 27% even on a control test that should read ~0%; fixed via an auto-detected minimum-coverage filter). Wired into `/api/analyze` as a new `"dcr"` key; verified it degrades gracefully (no crash) when `data/` isn't present, via a fresh Docker rebuild.
- [x] `schema/graph_model.json`'s `metadata.version` bumped to 1.4.0, `HANDOFF.md` Round 4 entry added.
- [x] **Stage 3 (clinical consistency verification) run against this stage's output** — `reports/stage3_consistency_pass.md`, 0 deterministic findings, LLM reviewer pass found no new issues (one apparent MMSE-vs-age anomaly traced to small-sample noise, confirmed non-issue at scale).

**Stage 2 completion notes:**
- **Scope was corrected before implementation, not discovered partway through.** Checked actual TCGA field coverage first; found `functional`/`symptom`/`side_effect`/non-psychiatric-`medication` categories have zero TCGA ground truth, revised the plan to Tier A/B/C above, and got explicit user sign-off on the revised scope (including 3 specific judgment calls — gender rescaling, the has_chemo rename, and declining to let TCGA's non-representative project mix override the literature-curated cancer-site distribution) before writing any code.
- **SEER was requested by the user during this stage but deliberately not used** — access not yet granted as of 2026-09-03. Documented as a standby follow-up (see HANDOFF.md Round 4), not blocking this round's closure.

**STOP — Awaiting user approval before Stage 3 begins.**

---

## 7. Stage 3 — Clinical Consistency Verification & Parameter Tuning

**Objective:** Run the verification pipeline (deterministic checks + an LLM clinical-plausibility review) against whatever schema Stage 2 just produced, and tune parameters — edge weights, baseline means/stds, conditional-probability tables — until the schema is internally consistent, before Stage 4 builds a classifier on top of it. This gate exists because Stage 1's own ECOG rollout already proved the need for it in practice: landing one real-data-calibrated node exposed a chain of pre-existing and newly-introduced consistency issues elsewhere in the schema (ECOG-vs-mobility contradictions, opioid/sedation toxicity disconnected from disease severity, an emotional/psychological cluster saturated at its range limits, hardcoded formulas silently disconnected from the schema graph, among others) — found only through manual inspection of generated output, not through any automated check that existed at the time.

**The tooling for this stage was already built and proven during Stage 1's rollout, ahead of schedule** — this stage is about running it as a formal, mandatory gate after every major recalibration, not building new infrastructure:
- `generator/clinical_consistency.py` — deterministic, rule-based checks (ECOG-vs-functional-status consistency, pharmacology-vs-disease-severity, demographic/epidemiological plausibility, caregiver-support-vs-dependency). Zero marginal cost per run, already wired into `server.py`'s `/api/analyze` and the UI's Data Analysis tab.
- `.claude/agents/06_clinical_consistency_reviewer.md` — the complementary LLM review-pass role, for statistical/novel-combination implausibilities a fixed rule set can't anticipate (e.g. a variable saturating at its range ceiling for half the population, a whole cluster drifting from its declared baseline through compounding edge weights). Findings only — no auto-fixing; a finding becomes a fix through the same approval discipline as any other stage (Rule 1, §3).

**Approach (the measure-then-rescale methodology already established during Stage 1's rollout, not a new invention):**
1. Generate a large sample (≥5,000 rows) from Stage 2's freshly-calibrated schema.
2. Run `generator/clinical_consistency.py`'s `consistency_audit()` — fix every deterministic finding before moving on; these are definitional/known-pattern issues, not judgment calls.
3. Produce a compact cross-tabulated summary (conditional distributions of key variables against disease stage/ECOG/demographics — not a raw row dump) and run the LLM reviewer pass over it.
4. For each finding: measure the actual empirical contribution of every inbound edge into the affected node (not just its declared baseline — sources carry their own upstream drift), rescale in dependency order (fix the upstream root of the drift first, remeasure, cascade downstream), and re-verify.
5. Repeat steps 2-4 until the deterministic audit is clean and the LLM pass surfaces no new high-severity findings.
6. Every fix stays gated per the policy already used during Stage 1: threshold/table-tightening fixes may be applied directly and reported; anything touching `model_ref`/`evidence_tier` nodes, or requiring a genuinely new causal relationship (a missing edge, a pruned node), stops for explicit user sign-off before it lands.

**Definition of Done:**
- `generator/clinical_consistency.py`'s `consistency_audit()` returns zero findings (or only findings explicitly accepted and documented as residual/expected — e.g. a small tail rate that's clinically plausible, not systemic — rather than silently ignored).
- At least one full LLM reviewer pass completed against Stage 2's output, with every finding either fixed or explicitly deferred with reasoning (matching how Stage 1's rollout handled `depression_severity_index`'s floor rate — investigated, found to be correct DSM-5 behavior rather than a bug, documented rather than blindly "fixed").
- A round entry added to `HANDOFF.md` documenting what was found and fixed, in the same format as Stage 1's rounds.
- Full HTTP round-trip re-verified (`/api/generate`, `/api/analyze`, and a Docker rebuild) — no silent `refactor pass skipped` fallbacks, no schema validation errors.
- If pruning or new edges were needed to resolve a finding, `schema/graph_model.json`'s `metadata.version` bumped accordingly.

**Note on scope:** this stage covers the nodes Stage 2 actually touched (oncology/functional/symptom/side_effect/non-psychiatric clinical/medication categories per §6) plus anything structurally connected to them. The `psychological`/`emotional` cluster and nodes like `spiritual_pain` are explicitly out of Stage 2's scope and therefore not re-audited here either — unless Stage 2's changes to a connected node (e.g. `chronic_pain`, `fatigue`) shift what that cluster's own inputs look like enough to reopen its calibration. Use judgment, and ask the user if it's unclear whether a finding is in scope for this pass.

This stage does not depend on Stage 4 having a dataset — it runs purely against Stage 2's schema output, and gates Stage 4 the same way Stage 1 gated Stage 2.

**STOP — Awaiting user approval before Stage 4 begins.**

---

## 8. Stage 4 — XGBoost Classifier on the Psychiatric Database (Placeholder)

**Status: not started, no dataset chosen.** Per the team's Etapa 3 plan, the psychiatric/psychological dataset (candidates: HRS, NHATS, MIDUS, NHANES, Metapsy, DAIC-WOZ, HCP-DES, MIND Set — see the team-plan artifact) is still being researched by David/Cristian. This section defines the contract the eventual work must satisfy, not a concrete implementation plan.

**Required once a dataset is chosen:**
- A parser analogous to `ingest/parse_tcga_cases.py`, producing a normalized `psych_profile.csv` with a documented schema (same `clean()`/sentinel-null conventions).
- Since the psychiatric cohort and the TCGA oncology cohort are **different patients** (no real per-patient join key), any join is cross-population / distributional, not row-level — the modeling approach must reflect that (e.g., conditioning on shared covariates like age/sex/cancer-stage-where-available, not a literal table join).
- A decided target variable: either `depressive_diagnosis_dsm5`'s categories directly, or a binary clinically-significant-symptom flag derived from whatever screening instrument the chosen dataset uses (PHQ-9 ≥ 10, GAD-7 ≥ 10, HADS cutoff — instrument-specific, decide when the dataset is known).
- **Open design question to resolve before this stage starts, not now:** XGBoost is a discriminative classifier, not a generative model like Stages 1–2's Bayesian Network — it can label/score a case but can't directly sample a new synthetic value the way a BN can. Clarify with the user whether Stage 4's role is (a) a *validator* that scores Stage 2's BN-generated synthetic profiles for psychiatric plausibility, or (b) a component that gets composed with a generative step some other way. Do not assume (a) or (b) — ask when this stage actually starts.

This stage does not gate Stage 1, Stage 2, or Stage 3 approval, and its row in §0 should stay `Placeholder` until a dataset is confirmed.

---

## 9. Risks & Open Items

- **ECOG label coverage ceiling.** Stage 1's model is trained on ~20-28% of TCGA cases with any performance-status reading at all — this bounds achievable model quality regardless of algorithm choice. If Stage 1's evaluation report shows poor macro-F1, that's expected, not necessarily a bug; consider whether SEER/cBioPortal (both flagged in the team's source table as having "explicit baseline ECOG") should be added to the training set before concluding the BN approach itself is inadequate.
- **Treatment-feature leakage** (see §5) needs an explicit decision, not a default.
- **Deploy footprint.** Moving off stdlib-only changes Cloud Run image size/cold-start and requires the Dockerfile change in §2 — confirm this is acceptable before Stage 1's engine-integration work ships to the deployed demo, not just locally.
- **Frontend capability loss** (§2) — no UI currently exists to inspect/edit a trained BN's CPTs; flag to the team as a likely future ask once Stage 2 ships and someone wants to hand-tune a model-backed node the way they can today.
- **No GDPR text in this repo** (§4.1) — the compliance guidance here is general, not grounded in project sources. Get real legal review before any EU-facing use of Stage 4's psychiatric data.
- **Stage 3's LLM reviewer pass isn't free or instant.** Budget for it explicitly when scheduling Stage 2→Stage 4 — it's a real review step (cross-tab generation + a full reasoning pass), not a script that runs unattended in the background.

---

## 10. File Map (new/changed by this pipeline)

```
ingest/
  parse_tcga_cases.py       existing — TCGA JSON -> data/tcga_parsed/*.csv
  parse_<psych_source>.py   Stage 4 — added once dataset is chosen
training/
  train_ecog_bn.py          Stage 1
  train_schema_bn.py        Stage 2
models/
  ecog_bn.pkl                Stage 1 artifact
  ecog_bn_cpts.json           Stage 1 human-readable export
  schema_bn.pkl               Stage 2 artifact
generator/
  clinical_consistency.py   existing (built during Stage 1) — deterministic checks, reused by Stage 3
.claude/agents/
  06_clinical_consistency_reviewer.md   existing (built during Stage 1) — LLM reviewer role, reused by Stage 3
reports/
  stage1_ecog_bn_eval.md
  stage2_schema_bn_eval.md
  stage3_consistency_pass.md   Stage 3 — findings + fixes from the post-Stage-2 verification round
requirements.txt             new — Stage 1, pip deps for the model layer
Dockerfile                   updated — Stage 1, adds pip install step
generator/engine.py          updated — Stage 1 (single-node dispatch), Stage 2 (full dispatch)
generator/privacy.py         updated — Stage 1 or 2, real DCR audit
schema/graph_model.json      updated — Stage 2 (calibrated params), Stage 3 (consistency fixes)
```
