# Stage 2 Evaluation — metastatic_disease Bayesian Network

**Model:** `DiscreteBayesianNetwork`, structure `disease_stage -> metastatic_disease`,
CPTs fit via `BayesianEstimator` (BDeu prior, equivalent_sample_size=10).

Replaces the schema's previous compound-formula gate
(`e_disease_stage_metastatic_disease`: `target = 'No' if source <= 1 else target`),
which only enforced Stage 1/2 => non-metastatic and left Stage 3/Terminal cases at
an independent 55% baseline draw regardless of stage.

## Data

- Full corpus: 2591 cases. Usable `ajcc_pathologic_m` reading: 1770 (821 dropped —
  `MX` ["cannot be assessed"] or missing, not a real "non-metastatic" reading).
- Used for training/verification: 1770.
- Target class distribution: {'No': 1448, 'Yes': 322}.
- Train/verification split: 1416 / 354 (stratified, seed=42).

## Real metastatic rate by disease_stage (population-level, all 1770 usable cases)

- Stage 1 (Mild): 0.0%
- Stage 2 (Moderate): 0.0%
- Stage 3 (Advanced): 0.4%
- Terminal: 59.5%

## Verification Metrics

| Metric | Value |
|---|---|
| Exact accuracy | 0.870 |
| Macro F1 | 0.823 |
| Majority-class baseline accuracy (always predict 'No') | 0.819 |

## Honest read

Unlike Stage 1's ECOG model, this one has a much larger labeled set (1770
cases, 68% of the full corpus, vs. ECOG's ~19%) and a single, low-cardinality
categorical predictor — expect this model to meaningfully beat the majority baseline if disease_stage
is genuinely predictive of metastatic status, which the per-stage rates above should make visually
obvious even before looking at the accuracy numbers.
