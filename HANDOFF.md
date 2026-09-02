# Handoff — Palliative Graph & Synthetic Profile Network

Status as of 2026-09-02 (third round). See "Round 3" section below for the real-data model-calibration pipeline (`requirements.md`) and its Stage 1 deliverable. Everything below "Round 3" describes state as of 2026-08-10 (second round) and is otherwise unchanged.

## Round 3 (2026-09-02) — Real-data calibration pipeline, Stage 1

Full spec: `requirements.md` (spec-driven, stage-gated — see it for Stages 2/3 and the architecture rationale). Summary of what actually changed:

- **Stdlib-only runtime constraint deliberately dropped.** `requirements.txt` (new) pins `pandas`, `numpy`, `scipy`, `scikit-learn`, `pgmpy`. `Dockerfile` now runs `pip install -r requirements.txt` and its base image moved `python:3.11-slim` -> `python:3.12-slim` (`numpy==2.5.2` requires >=3.12). This was a deliberate architecture choice (requirements.md §2, "Option B"), not scope creep — schemas with no `model_ref` nodes still need nothing beyond the stdlib.
- **`generator/engine.py`:** nodes may now carry a `model_ref: {"model": "<file under models/>", "predictors": [node_id, ...]}` field. Such a node's value is sampled (stochastically, from the trained model's posterior — not a MAP point estimate) from a loaded model instead of `baseline_mean`/`std`/`categories`/`probabilities`. `_topo_sort()` treats a model_ref node's predictors as structural dependencies (same ordering guarantee a causal edge would give), folded into `validate_schema()`'s DAG check too. pgmpy is imported lazily, only when a `model_ref` node is actually encountered.
- **`schema/graph_model.json` (v1.2.0 -> v1.3.0):** `ecog_performance_status` now carries `evidence_tier: "real_data"` and `model_ref` pointing at `models/ecog_bn.pkl` (trained on real TCGA data, not literature). Its only literature-sourced inbound edge, `e_metastatic_disease_ecog_performance_status`, was removed (superseded — requirements.md §3 Rule 6). `evidence_tier` is a new schema convention (real_data / literature / clinical_estimate) — only this one node is tagged so far; full backfill is a Stage 2 task.
- **New: `ingest/parse_tcga_cases.py`** — parses a GDC/TCGA clinical case JSON export (2,591 real, de-identified cases) into normalized CSVs under `data/tcga_parsed/` (gitignored — see below). Along the way, fixed two real bugs found during Stage 1: (1) `kps_to_ecog()` was mapping KPS=0 ("Dead") to an invented ECOG value of 5, outside the schema's `[0,4]` range — now returns `None`; (2) `pick_baseline_follow_up()` was preferring "Preoperative" follow-up readings, which skew heavily toward good performance status (94% ECOG 0-1) and don't represent a palliative-relevant baseline — now deprioritized in favor of any other available reading.
- **New: `training/train_ecog_bn.py`** — trains the Stage 1 `DiscreteBayesianNetwork` (`disease_stage` x `age_bracket` -> `ecog_performance_status`, BDeu-smoothed CPTs) and writes `models/ecog_bn.pkl` + `models/ecog_bn_cpts.json` (human-readable CPT export) + `reports/stage1_ecog_bn_eval.md`. **Known limitation, documented not hidden:** the model does not beat a majority-class-baseline on exact accuracy (0.500 vs 0.500) — TCGA only carries a usable ECOG/KPS reading for ~20-28% of cases, and two independent improvement attempts (the preoperative-timing fix above, and a 3rd `primary_site_group` predictor) only moved macro-F1 modestly (0.133 -> 0.166). Shipped anyway per the `evidence_tier` reasoning: honestly-weak real-data grounding beats an arbitrary literature guess, and the weakness is visible in the eval report, not hidden.
- **`.gitignore`/`.dockerignore`:** `context/data.json` and `data/` (real patient data, previously untracked but NOT gitignored — one `git add -A` away from landing in the repo) are now excluded from both git and the Docker build context. `models/`/`reports/` are NOT excluded — they're aggregate statistics (CPTs), not row-level records.
- **Verification done:** `engine.generate()` unit-level with a live `model_ref` schema edit; full `server.py` smoke test (`/api/schema`, `/api/generate`, `/api/analyze`) against the actual modified `schema/graph_model.json`, both natively and inside a freshly-built Docker image; confirmed the one `generator/privacy.py` collinearity warning that appears post-change is pre-existing (present on the pre-Stage-1 schema too, just a different variable pair — not a regression).
- **Not done / explicitly deferred to Stage 2** (with reasoning in `requirements.md` §5): `generator/privacy.py`'s real Distance-to-Closest-Record audit (meaningless over a 16-combination real-data field space right now); full-schema `evidence_tier` backfill; the `primary_site_group` 3rd predictor (blocked on a real ordering problem — `apply_hard_constraints()`'s single-active-cancer-site resolution runs after the per-node generation loop that `model_ref` sampling happens inside).
- **Stage 1 status:** deliverables complete, awaiting explicit user sign-off before Stage 2 starts (`requirements.md` §0 — documentation-only approval gate, mandatory).

**Follow-up fix, same round:** manual QA on Stage 1 surfaced that `functional_autonomy_adl`/`instrumental_autonomy_iadl`/`cognitive_function_mmse` were only weakly, indirectly coupled to `ecog_performance_status` (dominated instead by a separate `nutritional_status_mna`-rooted chain; `apply_hard_constraints()` only capped them post-hoc). `generator/refactor_synthetic_dataset.py` already implements the correct ECOG-conditional derivation (Layer 2: `adl = 100 - 22*ecog + noise`, IADL/MMSE/mobility/communication similarly bounded/derived) but was never called by the live app — it needed pandas/numpy, unavailable under the old stdlib-only constraint. Now that Stage 1 requires pandas anyway, wired it in: `server.py`'s `_handle_generate`/`_handle_analyze` now call a new `_apply_refactor()` helper after `engine.generate()`, which runs the refactor pass and re-normalizes types (`engine._clip_to_node`) so downstream CSV/stats/privacy see consistent values regardless of whether it ran. Falls back gracefully (returns the un-refactored rows, logs a warning) if a user-edited schema is missing a column the pass needs — verified via `set(CANCER_SITE_COLS).issubset(df.columns)`-style internal guards plus an outer `try/except`. Verified: mean ADL by ECOG now runs a clean 95.7/73.9/49.9/26.3/14.3 across ECOG 0-4 (was a muddled 84.6/73.6/57.3/20/20, with 3 and 4 flattened to the same old cap), confirmed through the actual HTTP `/api/generate`/`/api/analyze` routes (not just a direct function call) with no numpy-type JSON-serialization issues.

**Two more bugs found via user-reported manual QA on a real downloaded CSV, same round, both fixed:**
1. **`csv.DictWriter` crash on `complex_psychometrics_unevaluable`.** `refactor_synthetic_dataset.py`'s Layer 5 introduces this column but no matching schema node exists for it — `_apply_refactor()` was passing every DataFrame column back, including it, and `engine.to_csv()`'s `DictWriter(fieldnames=node_ids)` rejects unknown fields (`extrasaction="raise"` default). Fixed: `_apply_refactor()` now does `df = df[node_ids]` before converting back to rows — the schema is the source of truth for what fields exist; extra refactor-script columns get dropped, not shipped.
2. **Critical regression: the refactor pass was silently discarding Stage 1's real-data-trained ECOG.** `_layer2_organ_severity_functional()` unconditionally recomputed `ecog_performance_status` from `disease_stage`/`metastatic_disease` via the old literature formula (`ecog_mean = 0.6 + 0.55*stage_idx + 1.0*meta_flag`) — meaning wiring in the refactor pass (the fix above) had silently undone Stage 1's entire purpose. Fixed by adding a `protected_columns` parameter (driven by `evidence_tier == "real_data"`, threaded from `server.py`'s schema through `refactor_synthetic_dataset()` down into Layer 2) — any node tagged `real_data` is treated as trustworthy input, not something this layer recomputes. Verified: 0/200 ECOG mismatches before vs. after the refactor pass on a regenerated sample; mobility now correctly conditions on the *preserved* real ECOG (verified against `MOBILITY_GIVEN_ECOG`'s intended distribution, e.g. ECOG=0 → 85% Autonomous, matched).
3. **IADL floor added** (same investigation, a separate pre-existing gap, not a regression): Layer 2 only ever capped `instrumental_autonomy_iadl` *down* to match ADL (`np.minimum`), never raised a too-low IADL for a cognitively-intact, good-ADL patient. Verified before the fix: 22.4% of rows with ADL>70/MMSE>20/fluent-verbal communication still had IADL<3 (Lawton scale, 0-8) — implausible. Added a floor at 0.6x the ADL-implied ceiling for non-cognitively-impaired rows (deliberately not full proportionality — IADL is clinically more sensitive to early cognitive/executive decline than ADL even at a nominally-intact MMSE, so some gap below the ceiling stays legitimate). Verified after: 0% of that same cohort now falls below IADL 3 (min observed 3.41), cognitively-impaired rows still correctly capped at IADL≤2.0 (untouched by the floor), and mean IADL-by-ECOG is now cleanly monotonic (6.61/4.80/3.06/1.62/0.89 across ECOG 0-4).

All three fixes verified through the actual HTTP `/api/generate`/`/api/analyze` routes, not just direct function calls.

## Round 3 continued (2026-09-02) — Clinical consistency verification pipeline

User reported 4 more issues from manual review of a downloaded CSV: (1) ECOG rating compression — bedridden/severe-symptom patients categorized ECOG 1-3, not 3-4; (2) severe opioid/sedation toxicity in Stage 1 Mild, non-metastatic, no-chemo patients; (3) male breast cancer overrepresented in a small sample; (4) severe dependency (MMSE 12, bedridden) paired with only weekly caregiver visits. Asked for a repeatable verification pipeline, not just one-off fixes. Design locked with the user: deterministic rules-engine (fast, free, catches known-pattern issues every run) + one LLM reviewer pass (catches novel/statistical issues a fixed rule set can't anticipate) — not a 4-agent pipeline. Auto-apply for low-risk/threshold-tightening fixes; gate anything touching model_ref/evidence_tier or of ambiguous scope.

**Root-cause fixes (all verified, auto-applied per the low-risk policy):**
1. **ECOG rating compression** — `MOBILITY_GIVEN_ECOG` (refactor_synthetic_dataset.py) allowed 15% Wheelchair/Bedridden at ECOG 1 and 2% Bedridden at ECOG 2, both definitional contradictions (ECOG 2 requires "up and about >50% of waking hours"). Tightened so Bedridden is 0% at ECOG 0-2, rising properly from ECOG 3. Verified: 0/5000 ECOG-mobility contradictions after the fix (was flagged by the new `generator/clinical_consistency.py` itself mid-fix — first row of tightening still allowed 2% at ECOG 2, caught and re-tightened).
2. **Opioid/sedation toxicity in early-stage patients** — `opioid_use` was sampled independently (35% baseline) with zero conditioning on `disease_stage`; a Stage-1-Mild patient could get it by pure chance, then strong causal edges (weight 2.5/6.0) drove severe sedation/constipation regardless of actual disease severity. Fixed via a new schema edge `e_disease_stage_opioid_use` (compound, gates `opioid_use='No'` for Stage 1 Mild at baseline sampling) — the existing high-pain escalation rule in refactor Layer 4 still re-enables it when `chronic_pain>6`, so genuinely severe incidental pain in early-stage disease still correctly triggers opioid use (WHO analgesic ladder principle: pain severity drives prescribing, not stage alone). Verified: opioid_use=Yes in Stage 1 Mild dropped to 21.1%, now entirely tied to actual high pain (was previously stage-independent).
3. **Male breast cancer overrepresented** — `cancer_type_breast`'s baseline probability (21%) had zero gender conditioning, unlike `cancer_type_gynecological` which already had an absolute male exclusion. Added a probabilistic (not absolute — male breast cancer is real, ~1% of cases) 95%-reassignment rule in both `engine.py apply_hard_constraints()` and `refactor_synthetic_dataset.py`'s Layer 1 (which independently re-derives the same single-active-site logic — patched both). Verified: male rate dropped from ~21% to 0.07%, female unaffected (20.4%).
4. **Caregiver frequency vs. dependency mismatch** — severe dependency (bedridden/ECOG≥3/MMSE≤12) with an identified caregiver could still show "Weekly visits"/"Sporadic contact" — nothing escalated contact frequency for severe cases, only `living_environment` was patched by existing logic. Added an escalation rule to refactor Layer 6 (`caregiver_contact_frequency` → at least "Daily visits" when severely dependent and a caregiver exists). Verified: 100% of severe-dependency-with-caregiver rows now show Daily/24-7 contact.
5. **Bonus bug found via verification of fix #2:** `opioid_induced_constipation` stayed at 0 for patients newly flipped to `opioid_use=Yes` by Layer 4's pain-escalation rule — an earlier pass (engine.py's `apply_hard_constraints`, which ran while they were still `opioid_use=No`) had already zeroed it, and Layer 4 only ever zeroed constipation for `opioid_use=No`, never raised it for newly-Yes patients. Fixed by recomputing constipation for the flipped subset. **Caught a second regression while fixing this**: the recompute initially assigned float values into an int64-typed pandas column, which pandas 3.x rejects outright (silently triggering `_apply_refactor()`'s broad `try/except` fallback, masking the entire refactor pass for that call) — fixed by rounding to int before assignment. Both verified via the actual HTTP routes.

**New infrastructure (the actual "verification pipeline"):**
- `generator/clinical_consistency.py` — deterministic, rule-based audit (same pattern as `stats.py`/`privacy.py`): `check_ecog_functional_consistency`, `check_pharmacology_vs_severity`, `check_demographic_plausibility`, `check_caregiver_vs_dependency`. Every check guards on column presence (skips gracefully on a user-edited schema missing a node, matching `_apply_refactor()`'s existing convention). Wired into `server.py`'s `/api/analyze` (new `"consistency"` key) and rendered in `ui/app.js`'s Data Analysis tab (new panel, reusing `.privacy-panel` styling).
- `.claude/agents/06_clinical_consistency_reviewer.md` — new agent role documenting the complementary LLM review pass (input: a compact cross-tab summary + the deterministic findings; output: findings only, no fix proposals — those stay a separate human-approved step, matching `requirements.md`'s stage-gate pattern).

**LLM reviewer pass run this round, found 2 more issues — NOT auto-fixed, flagged for user decision** (structurally different risk class from the 4 above: these need edge-*weight* rebalancing across a dense multi-parent node, not a threshold/table tightening):
- **`anxiety_level` ceiling-saturated**: mean 9.59/10, 47.6% of all generated profiles sit exactly at the range ceiling (10.0), nearly flat across every stratification (gender, stage, site, religiosity) — its 4 inbound causal edges' typical contributions sum with the baseline mean to ~10.7, already exceeding the declared range [0,10] before any input variation is applied. Pre-existing, not caused by this round's changes.
- **`depression_severity_index` still substantially floor-clipped**: 53.4% of profiles sit exactly at 0, median 0. This is the SAME issue already flagged as known/deferred earlier in this file ("floor-clipped to ~0 for ~99.9% of generated profiles... needs a data_analyst pass to re-weight those inhibitory edges") — this round's ADL/IADL-ECOG coupling fix appears to have already improved it somewhat (99.9% → 53.4%) as a side effect, but it remains a real, substantial issue.

Both need a `data_analyst`-scoped pass re-weighting the dense edge sets into these two nodes, not a quick fix — flagged to the user rather than touched.

## Round 3 continued again (2026-09-02) — Rebalanced anxiety_level/depression_severity_index, found a third and more serious issue

User approved fixing the 2 flagged nodes, then running another verification cycle.

**`anxiety_level` fixed.** Measured actual contributions empirically (not just declared baseline means — sources have their own upstream edges pushing them well above declared baseline): `distress_level` alone contributed 4.53 to anxiety's mean via weight 0.644, with the other 3 edges adding another 4.03 — total 8.56 added to baseline_mean 4.5 = ~13, already past the range ceiling of 10 before any input variation. Scaled all 4 inbound edge weights by the same factor (~0.29, preserving their relative literature-cited strength ordering — `distress_level` stays the dominant driver) to bring the typical total down to a sensible ~7. Verified: mean 7.13, std 2.08, ceiling fraction (>=9.9) dropped from 47.6% to 10%, genuine spread from 0.6 to 10.

**`depression_severity_index` — turned out not to need the fix it first looked like it needed.** Scaled its 5 inhibitory edges by ~0.11 the same way. Floor rate barely moved (54.2% vs. 53.4% before) — investigated why: **100% of the floor-clipped rows have `depressive_diagnosis_dsm5 == "No formal diagnosis"`**, and `apply_hard_constraints()` *deliberately* forces `depression_severity_index = 0` for those patients (a DSM-5-consistency rule from an earlier round, verified "0 violations... over 3000-row sample" at the time). That's correct behavior, not a bug — a patient without a diagnosed depressive episode should score 0 on a scale that measures episode severity. The real problem was among *diagnosed* patients: before the edge rebalancing, 0% floor rate is confirmed among them now, and their mean is a healthy 10.86 (std 4.92, spread 0.2-26.5) — the edge-overwhelm that was dragging even diagnosed patients toward 0 is what's actually fixed. (Also note: 45.8%-54.2% "No formal diagnosis" split is itself a separate, un-investigated question — real-world clinically-significant depression prevalence in advanced cancer is typically cited around 20-40%, so this schema's 45.8%-diagnosed rate runs a bit high; not touched this round, flagged for a future pass if the team wants it.)

**Second verification cycle surfaced a third, more serious issue — not fixed, flagged.** `suicidal_ideation_risk` (4 inbound edges: `depression_severity_index`, `distress_level`, `loneliness` causal; `meaning_in_life` inhibitory) has mean 6.94 against a declared `baseline_mean` of 2, and **38.6% of all generated profiles now cross its own schema-documented "scores >=7 should trigger the maximum-priority alert protocol" threshold** — clearly unrealistic, and would badly mislead anyone using this dataset to test/calibrate a real alerting system. Worse: mean is nearly identical (6.91-7.01) regardless of `depressive_diagnosis_dsm5` — a "No formal diagnosis" patient shows essentially the same suicide-risk score as a "Major depressive disorder" patient, which is clinically backwards. Root cause is the same systemic pattern as before, but one layer deeper: `distress_level`, `loneliness`, and `meaning_in_life` are themselves each mildly elevated/depressed from their *own* upstream edges (not yet audited), and that drift compounds by the time it reaches `suicidal_ideation_risk`. This is evidence the anxiety/depression fixes were treating symptoms of a broader pattern across the whole ~8-node emotional/psychological cluster (`distress_level`, `loneliness`, `meaning_in_life`, `death_anxiety`, `emotional_trend_7d`, `anxiety_level`, `depression_severity_index`, `suicidal_ideation_risk`), not two isolated nodes — worth auditing as a cluster next time, not one node at a time. Flagged for the user rather than auto-fixed (same reasoning as before: this needs edge-weight rebalancing, not a threshold tweak, and it's the schema's single highest-stakes safety variable — deserves explicit sign-off, not a silent patch).

All changes verified via the actual HTTP `/api/generate`/`/api/analyze` routes; `generator/clinical_consistency.py`'s deterministic checks still pass clean (only the same pre-existing 0.04% residual `mild_stage_severe_sedation` finding).

## Round 3 continued a third time (2026-09-02) — Full emotional/psychological cluster rebalanced

User approved the full-cluster fix, noting Stage 3 will eventually recalibrate this cluster against real psychiatric data — so the target here is "internally consistent and clinically sane" (evidence_tier stays `literature`/`clinical_estimate`, not a claim of precision), not a final calibration.

**Method:** measured every inbound causal/inhibitory edge's actual empirical contribution (source's real generated mean × weight, not just declared baseline means — sources have their own upstream drift) for all 9 nodes in the `psychological`/`emotional` categories (`spiritual_pain`, `distress_level`, `meaning_in_life`, `loneliness`, `death_anxiety`, `emotional_trend_7d`, `anxiety_level`, `depression_severity_index`, `suicidal_ideation_risk`), then rescaled in topological order (fixing `distress_level` first since it's the actual root of the drift — mean 7.62 vs. declared baseline 5 — and everything else in the cluster depends on it either directly or transitively), remeasuring after each step since fixing an upstream node changes what downstream nodes actually receive. `loneliness` self-corrected after its two upstream fixes and needed no edit.

**Results (baseline_mean → final empirical mean, all now within a sensible range of declared baseline, no more saturation):**
- `distress_level`: 7.62 → 6.03 (baseline 5)
- `meaning_in_life`: 2.28 → 4.37 (baseline 5.5) — was inhibited to near-floor, now healthy
- `loneliness`: 6.13 → 5.51 (baseline 5) — self-corrected, no edit needed
- `death_anxiety`: 7.20 → ~5.5 (baseline 4.5)
- `emotional_trend_7d`: 8.59 → 6.00 (baseline 5)
- `anxiety_level`: re-verified after distress_level's fix — 8.4% ceiling rate (was 47.6% two rounds ago)
- `suicidal_ideation_risk`: 6.94 → 3.22 (baseline 2); "maximum-priority alert" (>=7) rate 38.6% → 3.2%

**A second, distinct bug found while rebalancing `suicidal_ideation_risk`:** rescaling alone wasn't enough — depression diagnosis stopped meaningfully differentiating suicidal-ideation scores (Major Depressive Disorder patients scored almost identically to non-diagnosed ones) no matter how the weight was tuned. Root cause was an **ordering bug**, not a weight problem: `suicidal_ideation_risk` is computed in `engine.py`'s main topo loop using `depression_severity_index`'s value at that point — but the DSM-5 diagnosis-consistency floor (0 for "No formal diagnosis", DSM-5-consistent minimums for actual diagnoses) only lived in `apply_hard_constraints()`, a post-hoc pass that runs *after* `suicidal_ideation_risk` already consumed the stale, ungated value. Fixed by adding `e_depressive_diagnosis_dsm5_depression_severity_index_gate` — a proper `compound` schema edge (matching the existing `depressive_episode_type`/`psychoactive_medication` gating pattern) that runs the DSM-5 floor logic in topo order, before any downstream node reads it. `apply_hard_constraints()`'s copy of this rule kept as a backstop, but **its floor values were also independently wrong** (`0.50`/`0.10` compared directly against a 0-27 range — effectively a no-op — instead of `0.5*27=13.5`/`0.1*27=2.7`, matching `refactor_synthetic_dataset.py`'s already-correct version); fixed alongside.

**Result:** `suicidal_ideation_risk` now correctly orders by diagnosis — No formal diagnosis 2.46 < Subclinical/Dysthymia ~3.6 < Major depressive disorder 4.54 — consistent with DSM-5 Criterion A9 being a major-depressive-episode criterion specifically.

Verified via `generator/clinical_consistency.py` (0 new findings, same pre-existing 0.04% residual) and the actual HTTP routes (generate CSV, analyze, no silent refactor-pass skips).

## Round 3 continued a fourth time (2026-09-02) — Schema-wide audit: symptoms, pruning, functional-node architecture finding

User noticed `insomnia_severity=10` with `drowsiness=4` — asked "aren't these linked?" and "what does emotional_trend_7d=10 even mean?", then asked to evaluate pruning and extend the audit schema-wide (excluding psychological/emotional/medication, which are Stage 3's territory): symptoms, demographics, pathologies, ECOG/ADL/IADL.

**Structural changes:**
- Added `e_insomnia_severity_drowsiness` (causal, weight 0.14 after later rebalancing) — was completely missing; insomnia and drowsiness previously had zero direct relationship (verified: drowsiness given insomnia≥9 was statistically indistinguishable from insomnia<3).
- **Pruned `emotional_trend_7d`** — redundant (linear combination of `distress_level`+`loneliness`, no new information) and structurally undefinable: its own description is "weighted average of the last 7 emotional check-ins," but this generator produces one static row per patient, not a time series — there's no 7-day sequence to average.
- **Pruned `global_performance_status`** — redundant with the now real-data-grounded `ecog_performance_status`; kept both was carrying a second, less-grounded functional-status measure alongside the calibrated one. Removing it required also deleting a hardcoded recreation of the column in `refactor_synthetic_dataset.py` Layer 2 (`df["global_performance_status"] = ...`) that would have silently reintroduced it even after the schema removal — found via grep, not automatically caught by schema validation, since that script hardcodes column names independently of the schema (by design, see its own docstring).
- 56 nodes / 90 edges after pruning (was 58/98).

**Symptom cluster rebalanced** (same measure-empirically-then-rescale method as the emotional cluster, in dependency order: `chronic_pain` was already fine, `fatigue` fixed first since `appetite_loss`/`nausea_vomiting`/`insomnia_severity`/`drowsiness` all depend on it, then each of those, `drowsiness` fixed last since it depends on the now-fixed `fatigue` and `insomnia_severity`):

| Node | Before (mean / frac≥9) | After (mean / frac≥9) |
|---|---|---|
| fatigue | 6.75 / 21.8% | 5.86 / 10.9% |
| appetite_loss | 6.41 / 19.7% | 5.12 / 7.7% |
| insomnia_severity | 6.53 / 28.0% | 5.23 / 11.0% |
| drowsiness | 7.86 / 39.0% (worse after adding the new edge, since insomnia was still elevated) | 5.18 / 4.8% |

New insomnia→drowsiness relationship survives the rebalancing: drowsiness given insomnia≥9 is 5.77 vs. 4.58 given insomnia<3 — a real, meaningful gap now.

**Demographics and pathologies (oncology) needed no changes** — every node in both categories has zero causal/inhibitory inbound edges (pure independently-sampled baselines), structurally immune to the compounding-drift pattern that affected everything else.

**Significant architecture finding in the functional category, not fixed — flagged for a decision:** `cognitive_function_mmse`, `functional_autonomy_adl`, and `nutritional_status_mna` are **unconditionally overwritten** by hardcoded formulas in `refactor_synthetic_dataset.py` (age/stage/ECOG-driven for MMSE and ADL; appetite/nausea/stage-driven for nutritional status) — meaning their schema edges (`nutritional_status_mna → functional_autonomy_adl`, `→ instrumental_autonomy_iadl`, `→ cognitive_function_mmse`; `functional_autonomy_adl → instrumental_autonomy_iadl`, `→ cognitive_function_mmse`; `instrumental_autonomy_iadl → cognitive_function_mmse`) compute a value in `engine.py`'s topo loop that is **thrown away every time**. A user editing those specific edges' weights in the UI's Parameter Inspector would see no effect on generated output. `instrumental_autonomy_iadl` is only partially affected — its schema-edge-computed base value survives, then gets clamped to an ECOG/ADL-derived floor/ceiling. All three overwritten nodes are themselves already well-calibrated (MMSE mean 19.0/30, 14.5% severe impairment; nutritional status mean 8.52/14, 0.3% severe malnutrition) — this isn't a calibration bug, it's a **schema-truthfulness bug**: the visible graph doesn't match what actually drives the output. Not resolved this round since it's a real design decision (remove the decorative edges, migrate the formulas into the schema, or just document the discrepancy) rather than a threshold tweak.

Verified via `generator/clinical_consistency.py` (0 new findings) and the full HTTP round-trip.

## Round 3 continued a fifth time (2026-09-02) — Migrated hardcoded ADL/MMSE/nutrition formulas into the schema

User chose option 2 from the prior finding: migrate `refactor_synthetic_dataset.py`'s hardcoded `cognitive_function_mmse`/`functional_autonomy_adl`/`nutritional_status_mna` formulas into proper schema edges where possible, so the UI's Parameter Inspector actually reflects what drives generation.

**Schema changes:**
- `functional_autonomy_adl`: `baseline_mean` 55→100, `baseline_std` 22→8. Removed `e_nutritional_status_mna_functional_autonomy_adl` (nutrition no longer the driver — matches what was already validated as correct). Added `e_ecog_performance_status_functional_autonomy_adl` (inhibitory, weight 22): `target -= source * weight`.
- `cognitive_function_mmse`: `baseline_mean` 23→27, `baseline_std` 5→2.5. Removed its 3 old inbound edges (nutrition/ADL/IADL). Added 3 new edges: `age_bracket` (compound — a plain weighted edge can't reproduce the non-linear 0/1/2.5/4 age-penalty curve, so this one uses an explicit ternary formula instead of a simple `target -= source * weight`), `disease_stage` (inhibitory, weight 1.5), `ecog_performance_status` (inhibitory, weight 1.8).
- `nutritional_status_mna`: `baseline_mean` 9→14, `baseline_std` 3→1.2. Reused and corrected the weights on its 2 existing edges (`appetite_loss` 0.4→0.55, `nausea_vomiting` 0.3→0.35) to match the formula being migrated, and added `e_disease_stage_nutritional_status_mna` (inhibitory, weight 0.6).
- `refactor_synthetic_dataset.py`: removed the 3 corresponding hardcoded overwrite lines (kept everything downstream that *refines* these values against `mobility`/`communication_capacity` — those can't become schema edges since they're not finalized until this same layer runs). Removed the now-orphaned `AGE_PENALTY` constant.

**A second, more serious bug surfaced during verification, not part of the plan:** the migrated values came out ~10-13 points low across the board (e.g. ADL at ECOG 0: 82.5 instead of the expected ~96). Root cause: `engine.py`'s `apply_hard_constraints()` had rules keying off `mobility`/`communication_capacity`/`cognitive_function_mmse` (ECOG-mobility consistency bump, severe-dependency ADL/IADL caps, communication-based MMSE clipping) that run **before** `mobility`/`communication_capacity` are actually finalized — that only happens in `refactor_synthetic_dataset.py`'s Layer 2, which runs later. These rules were harmless before this migration because `functional_autonomy_adl`/`cognitive_function_mmse` were unconditionally overwritten downstream anyway (whatever `apply_hard_constraints` did to them got discarded). Once those values started flowing through from the schema edges instead, the premature caps — based on a stale, not-yet-ECOG-conditioned `communication_capacity` draw (~25% of all rows, independent of ECOG) — started corrupting the final output. **Worse: the same pattern could bump a real-data-trained `ecog_performance_status` value upward** off a premature "Bedridden" mobility read, which would have quietly undermined Stage 1's whole point. Fixed by removing those specific rules from `apply_hard_constraints()` — `refactor_synthetic_dataset.py`'s Layer 2 already re-implements every one of them correctly, with the right timing. Two mobility/communication-referencing rules were deliberately *not* removed (`living_environment`/`caregiver_type` logic) since nothing downstream re-derives those from the final mobility value — removing them would have left that constraint completely unenforced, which is worse than a premature-but-correlated check.

**Verified:** ADL-by-ECOG (94.8/75.2/51.6/21.3/9.8) and MMSE (mean 19.8, 9.5% severe impairment) now closely match the pre-migration reference values; `generator/clinical_consistency.py` clean; full HTTP round-trip clean. One new (expected, not a bug) privacy-audit collinearity warning appeared: `functional_autonomy_adl`/`instrumental_autonomy_iadl` at r=0.987 — inherent to IADL's floor/ceiling being literally computed as a function of ADL (this session's earlier fix for the opposite complaint, IADL not tracking ADL closely enough); loosening it to dodge the audit threshold would undo that fix.

---

Status as of 2026-08-10 (second round). Single tabbed graph app, full CRUD + live analysis + persistence, verified end-to-end. Nothing committed to git yet — `git status` shows the legacy-app deletion staged plus modified/untracked new files.

## What this is

**One app now.** The old vanilla-JS legacy app (root `index.html`, `js/*.js`, root `style.css`) was deleted this round (`git rm -r`, staged — recoverable via git history/`git checkout HEAD --`). It's superseded by the graph-based system below, which is now the sole app in the repo.

```
schema/graph_model.json     <- graph data (nodes=variables, edges=relationships), source of truth on disk
generator/engine.py         <- schema-driven synthetic profile generator (stdlib Python)
generator/stats.py          <- EDA summary stats + Pearson correlation matrix (stdlib Python)
generator/privacy.py        <- schema-level re-identification/disclosure risk audit (stdlib Python)
server.py                   <- stdlib HTTP bridge: serves ui/, exposes /api/schema (GET+POST), /api/generate, /api/analyze
ui/index.html+app.js+style.css  <- D3-based tabbed mind-map editor (vanilla JS, no build step)
```

Run it: `python3 server.py [--port 8765]` then open `http://localhost:8765`. Opening `ui/index.html` directly via `file://` will NOT work (fetches need same-origin server).

## Schema contract — `graph_model.json` (frozen, all pieces depend on this exact shape — UNCHANGED from round 1)

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

Rules (unchanged): continuous/ordinal use range+mean+std; categorical/binary use categories+probabilities; `formula` null for `correlated` edges; causal/inhibitory/compound `formula` must be `target` + one of `+=`/`-=`/`=` + expression using only `source`/`weight`; causal/inhibitory/compound subgraph must be a DAG; binary source values are dummy-coded via `categories.index(value)` before formula eval (fixed round 1, see `generator/engine.py` `generate()`).

## Current schema content

`schema/graph_model.json`: **57 nodes, 91 edges** (v1.2.0, last modified 2026-08-10). `/context/` audit confirmed the article corpus is **cancer-exclusive** — every clinical article studies advanced/metastatic cancer populations. 7 `binary` primary-cancer-site indicator nodes act as root causal drivers: `cancer_type_breast`, `cancer_type_lung`, `cancer_type_gastrointestinal`, `cancer_type_genitourinary`, `cancer_type_gynecological`, `cancer_type_hematologic`, `cancer_type_other_site` (catch-all, no outgoing edges — too heterogeneous to ground). Site prevalence (breast ~21%, lung ~18%, GI ~24%, GU ~10%, gynecological ~4%, hematologic ~3%, other ~21%) tallied from 8 mixed-cohort studies weighted by n. 9 causal/inhibitory edges from site → symptom/psych nodes, each `ref`-grounded (lung→dyspnea, GI→nausea/appetite_loss, breast→depression [inhibitory], gynecological→pain/depression, hematologic→fatigue).

**`base_neurological_disease` removed (2026-08-10)** — was ungrounded in `/context/` (leftover from an earlier MVP scope covering Parkinson/ALS/Alzheimer/Huntington), had zero support in the cancer-exclusive article corpus. Node + its one edge (`e_base_neurological_disease_cognitive_function_mmse`) deleted.

**Diagnosis/medication gating added (2026-08-10)** — two new `compound` edges enforce hard clinical constraints the linear formula grammar previously couldn't express:
- `e_depressive_episode_type_depressive_diagnosis_dsm5`: `depressive_episode_type` (binary Single/Recurrent) → `depressive_diagnosis_dsm5`. Formula `target = target if source == 1 else 'No formal diagnosis'` — a Single (non-recurrent) episode can never carry a formal diagnosis; only Recurrent episodes keep whatever diagnosis was drawn.
- `e_depressive_diagnosis_dsm5_psychoactive_medication`: `depressive_diagnosis_dsm5` → `psychoactive_medication`. Formula `target = 'None' if source == 'No formal diagnosis' else target` — no medication can be prescribed without a formal diagnosis.
- Required an **engine grammar extension**: `_apply_formula()` in `generator/engine.py` now also exposes `target` (the node's pre-formula running value) in the eval namespace, alongside the existing `source`/`weight` — enables `=`-op formulas to conditionally keep-or-override a categorical target instead of only computing it from scratch. Fully backward compatible (old formulas never referenced `target`). **This changes the frozen formula-grammar contract documented above** — `target` is now a valid name inside any `causal`/`inhibitory`/`compound` formula expression, not just `source`/`weight`.
- Verified over a 3000-row generated sample: 0 violations of either constraint (no diagnosis from Single episodes, no medication without a formal diagnosis); diagnosis/medication distributions still vary naturally within the permitted (Recurrent / diagnosed) subgroups.

**One known issue remains open (not part of this round's request):**
- `depression_severity_index` is floor-clipped to ~0 for ~99.9% of generated profiles (pre-existing, predates the cancer restructure — confirmed via prior `git show` comparison). Existing inhibitory edges from `nutritional_status_mna`/`functional_autonomy_adl`/`instrumental_autonomy_iadl` overwhelm the baseline before other edges into that node get any visible effect. Needs a data_analyst pass to re-weight those inhibitory edges.

Full provenance/build notes for earlier schema versions: see git history of this file.

## `generator/engine.py` — API (unchanged since round 1)

`load_schema`, `validate_schema`, `generate(schema, n=500, seed=None)`, `to_csv`. CLI: `python3 generator/engine.py schema/graph_model.json --n 500 --seed 42 --out out.csv`.

## `generator/stats.py` — NEW this round

`summarize(schema, rows) -> {"numeric": {id: {mean,std,min,max}}, "categorical": {id: {category: count}}, "correlations": {id_a: {id_b: r}}}`. Population statistics (`statistics.pstdev`, uncorrected Pearson) — same convention as `privacy.py`. Binary nodes dummy-coded into `correlations`. Zero-variance nodes/pairs omitted from `correlations` (no div-by-zero).

## `generator/privacy.py` — NEW this round

`privacy_audit(schema, rows, std_threshold=0.05, category_dominance=0.98, corr_threshold=0.98) -> {"warnings": [str], "flags": {id_or_pair: reason}, "note": str}`. Flags: near-zero-variance continuous/ordinal nodes, dominant-probability categorical/binary nodes, near-collinear numeric pairs (|r| >= threshold) in a generated sample. No real patient dataset exists, so this is schema-level structural risk only — NOT a Distance-to-Closest-Record or membership-inference audit (explicitly noted in the `"note"` field returned to callers). Currently 0 warnings against the real schema at n=100.

## `server.py` — API (stdlib `http.server` only, no pip deps)

- Serves static files from `ui/` at `/` (index.html default doc).
- `GET /api/schema` → JSON contents of `schema/graph_model.json`, 404 if missing. *(unchanged)*
- `POST /api/generate` — body `{"schema":..., "n":500, "seed":null, "format":"csv"|"json"}` → CSV download or `{"columns":[...],"rows":[[...]]}`; 400 `{"error":...}` on invalid schema. *(unchanged)*
- **`POST /api/analyze`** *(NEW)* — body `{"schema":..., "n":500, "seed":null}` (schema wrapped). 200 → `{"n":int, "numeric":{...}, "categorical":{...}, "correlations":{...}, "privacy":{"warnings":[...],"flags":{...},"note":str}}`. 400 → `{"error":...}`.
- **`POST /api/schema`** *(NEW, save/persist)* — body IS the schema object directly (**not** wrapped, unlike the other two POST routes — easy mixup, watch for it). Validates via `engine.validate_schema`; on success atomically overwrites `schema/graph_model.json` (temp file + `os.replace`, `indent=2`), bumps `metadata.last_modified` to today, returns `200 {"ok":true,"nodes":N,"edges":M}`. On invalid schema: `400 {"error":...}`, disk untouched (verified via file-hash diff).

## `ui/` — frontend, rebuilt this round into a tabbed app

Still vanilla JS + D3 v7 CDN for graph physics only, plain SVG rendering, no build step. 4 tabs sharing one in-memory `state` object: **Grafo Visual** (default, the mind-map canvas), **Variables** (CRUD table on nodes), **Correlaciones y Relaciones** (CRUD table on edges), **Análisis de Datos** (live EDA via `/api/analyze`: stat tiles, frequency bars, CSS-heatmap correlation matrix, privacy-warnings panel).

Global search bar + category-chip filter (toolbar, persists across tabs): text matches `id`/`label`/`desc`; on the graph tab, non-matching nodes gray out and their edges are actually hidden (not just dimmed); on Variables/Correlations tabs, rows are filtered. Single-click a node → highlight it + its direct edges + 1-hop neighbors (composes with active filter via set intersection). Shift/ctrl-click multiple nodes → 2 nodes gives the old pairwise-inspection popup, 3+ gives union-highlight (all selected nodes' edges shown, no popup).

CRUD: Variables tab Add/Edit/Delete on nodes (delete cascades to remove all edges touching that node, confirmed inline); Correlations tab Add/Edit/Delete on edges (source/target pickers, formula-grammar client-side check). Both reuse the existing Parameter Inspector overlay rather than duplicating field UI.

**Write-through persistence**: any CRUD edit debounces (800ms) then auto-`POST`s current state to `/api/schema` (saves to disk) AND re-fires `/api/analyze` if the Data Analysis tab is active. A toolbar indicator shows pending/saving/saved/error. Export/Import buttons are unchanged, separate, explicit client-side file download/upload — NOT the same path as autosave.

Category colors remain dynamic (sorted categories → 8-hue CVD-safe palette, not a hardcoded enum) since the schema has 10 categories.

## Verification done this round (all passing)

- `stats.summarize()` fixture test: correct shape, zero-variance node correctly omitted from correlations, no crash.
- `POST /api/analyze` real schema n=100 seed=1 → 200, `numeric` 25 / `categorical` 26 / `correlations` 30 entries, `privacy.warnings` empty list (no structural risk flagged currently).
- `POST /api/analyze` broken schema (dangling ref) → 400, no crash.
- `POST /api/schema` real schema unmodified → 200 `{"ok":true,"nodes":51,"edges":81}`; disk file still parses, still 51/81, `last_modified` bumped.
- `POST /api/schema` broken schema → 400, disk file hash unchanged (confirmed via md5 before/after).
- `GET /api/schema` and `POST /api/generate` regression-checked, unaffected by the new routes.
- Legacy files confirmed gone (`git status` shows staged deletes), grepped repo for stray references — none besides historical docs.
- Headless-Chromium verification of all 4 tabs, tab-state persistence across switches, search/filter gray-out+hide behavior, single-click 1-hop and multi-select union highlighting, cascading node/edge CRUD reflected live on the graph, Data Analysis tab rendering real stats/correlations/privacy panel, autosave round-trip (edited schema on disk actually changed after debounce, indicator updated correctly).
- My own final integration pass (orchestrator-level, after both builder agents finished): fresh `python3 server.py`, hit `/`, `GET /api/schema`, `POST /api/analyze`, `POST /api/schema` round-trip, `POST /api/generate` csv — all 200, schema still 51/81 after everything, server stopped cleanly (confirmed via `ps aux | grep "[s]erver\.py"`, empty).

## Not done / open items

- Nothing committed to git yet.
- No automated test suite — all verification manual/scripted per-session, not saved as repeatable test files.
- Threshold-binned derived variables from the old (now-deleted) `js/schema.js` (nutritional status label, ADL dependency label, etc.) were never ported — not expressible under the linear formula grammar. Underlying continuous nodes are present; binning would need a new formula/edge-type design.
- `privacy_audit()` is schema-level only (no real dataset exists for it to compare against) — if a real Distance-to-Closest-Record audit is ever needed, it requires an actual reference dataset, which is a different task, not a bug in the current implementation.
- `@data_visualizer` agent role (Seaborn/Plotly diagnostic plots) still not built — Data Analysis tab covers basic EDA (tiles/bars/heatmap) but not baseline-vs-fine-tuned comparison plots.
- Auto-save writes directly to the committed `schema/graph_model.json` on every edit now (by explicit request this round — this is a deliberate behavior change from round 1, where exports were client-side-only to avoid silent overwrites). If that's ever unwanted (e.g. want to review diffs before persisting), it'd need a "dry-run"/review-before-save mode — not currently built.

## Key files to read first on a fresh machine

1. `CLAUDE.md` — original spec/directives (caveman-mode execution style, agent roles, schema format).
2. This file.
3. `schema/graph_model.json` — inspect node/edge counts and a few entries to sanity-check nothing got corrupted in transit.
4. `generator/engine.py`, `generator/stats.py`, `generator/privacy.py`, `server.py` — all short, read top to bottom.
5. `ui/app.js` — ~1500 lines, D3 force-graph + 4-tab app + CRUD + autosave.
