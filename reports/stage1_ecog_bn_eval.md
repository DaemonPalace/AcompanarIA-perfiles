# Stage 1 Evaluation — ECOG Bayesian Network

**Model:** `DiscreteBayesianNetwork`, structure `{disease_stage, age_bracket} -> ecog_performance_status`,
CPTs fit via `BayesianEstimator` (BDeu prior, equivalent_sample_size=10) to smooth sparse cells.
Both predictors are existing schema/graph_model.json categorical nodes (`disease_stage`, `age_bracket`) —
their category strings are reused as the trained model's variable states directly, so no translation table
is needed at generation time.

**A 3rd predictor (`primary_site_group`, mapped from TCGA `project_id` onto the schema's 7 `cancer_type_*`
categories) was tried and improved macro F1 modestly (0.133 -> 0.166) but not exact accuracy (0.500 -> 0.490,
falling slightly below baseline) — and doesn't correspond to any single existing schema node ready to serve
as a model_ref predictor: the 7 `cancer_type_*` binaries only resolve to one active site in
`apply_hard_constraints()`, which runs after the per-node generation loop that model_ref sampling happens
inside. Wiring it in needs that resolution moved earlier — deferred to Stage 2's mixed dependency-graph
ordering work (requirements.md §6), not shipped here.**

## Data

- TCGA cases with a usable ECOG reading: 490 (0 dropped for missing stage/age bucket after mapping).
- Used for training/verification: 490.
- Label-quality tiers (not silently merged): {'direct': 388, 'kps_derived': 102}.
- Target class distribution: {'0': 244, '1': 181, '2': 40, '3': 19, '4': 6}.
- Train/verification split: 392 / 98 (stratified by ECOG class, seed=42).

**Coverage caveat:** these 490 cases are ~20-28% of the full 2,591-case TCGA corpus — TCGA does not
systematically record performance status. This bounds achievable model quality regardless of algorithm choice
(see requirements.md §8, "ECOG label coverage ceiling").

**Excluded predictors:** treatment features (`has_chemo`, `n_treatment_lines`, etc.) were deliberately excluded —
TCGA's `follow_ups` are not reliably ordered relative to treatment courses, so using them risked the model
learning from information that postdates the performance-status reading (requirements.md §5 caveat).
`smoking_status` and `primary_site_group` were tested and excluded from the shipped model (see above) —
predictor combination space is 4 stages x 4 age brackets = 16 cells for 392 training rows.

## Verification Metrics

| Metric | Value |
|---|---|
| Exact accuracy | 0.500 |
| Macro F1 | 0.133 |
| Within-1 accuracy (ECOG off by <=1) | 0.867 |
| Majority-class baseline accuracy (always predict '0') | 0.500 |

### By label-quality tier

| Tier | n (verification) | Accuracy |
|---|---|---|
| direct | 65 | 0.446 |
| kps_derived | 33 | 0.606 |

## Honest read

With only 392 training rows across a 5-class ordinal target, exact-accuracy and macro-F1 are
expected to be noisy — the within-1 and majority-baseline comparisons matter more than exact accuracy alone
for judging whether this model is worth wiring into `engine.py` over the old literature-estimated baseline.
