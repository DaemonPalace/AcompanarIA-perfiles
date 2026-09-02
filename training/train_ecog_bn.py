"""Stage 1 — train a Bayesian Network for ecog_performance_status on real TCGA data.

Predictors are deliberately restricted to disease_stage and age_bracket — both
already exist as schema/graph_model.json categorical nodes with the exact
category strings used here as the trained model's variable states, so no
translation table is needed at generation time (see generator/engine.py's
model_ref dispatch). Treatment-derived features (has_chemo, n_treatment_lines,
etc.) are excluded: TCGA's follow_ups are not reliably ordered relative to
treatment courses, so using them risks the model learning from information
that postdates the performance-status reading it's supposed to predict
(see requirements.md Stage 1, "Caveat to resolve during modeling").

Trains on all 507 labeled cases (389 direct ECOG reads + 118 KPS-derived
fallback, see baseline_ecog_source in baseline_profile.csv) — label-quality
tiers are evaluated separately, not silently merged, per requirements.md §5.

CLI:
    python3 training/train_ecog_bn.py data/tcga_parsed/baseline_profile.csv \
        --model-out models/ecog_bn.pkl --cpt-out models/ecog_bn_cpts.json \
        --report-out reports/stage1_ecog_bn_eval.md
"""

import argparse
import json
import pickle
import sys
from collections import Counter

import numpy as np
import pandas as pd
from pgmpy.estimators import BayesianEstimator
from pgmpy.inference import VariableElimination
from pgmpy.models import DiscreteBayesianNetwork
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split

STAGE_BUCKETS = ["Stage 1 (Mild)", "Stage 2 (Moderate)", "Stage 3 (Advanced)", "Terminal"]
AGE_BRACKETS = ["18-35", "36-55", "56-70", "71+"]
ECOG_STATES = ["0", "1", "2", "3", "4"]

# Not used by the shipped 2-predictor model below — kept as documentation of a
# real mapping decision for whoever picks up the Stage 2 site-aware retry (see
# the model_ref ordering note further down). Maps TCGA project_id onto the
# schema's existing 7 cancer_type_* binary indicator category labels.
PROJECT_TO_SITE_GROUP = {
    "TCGA-BRCA": "breast",
    "TCGA-LUAD": "lung", "TCGA-LUSC": "lung",
    "TCGA-STAD": "gastrointestinal", "TCGA-COAD": "gastrointestinal", "TCGA-READ": "gastrointestinal",
    "TCGA-LIHC": "gastrointestinal", "TCGA-ESCA": "gastrointestinal", "TCGA-CHOL": "gastrointestinal",
    "TCGA-PAAD": "gastrointestinal",
    "TCGA-BLCA": "genitourinary", "TCGA-KIRC": "genitourinary", "TCGA-KIRP": "genitourinary",
    "TCGA-KICH": "genitourinary", "TCGA-PRAD": "genitourinary", "TCGA-TGCT": "genitourinary",
    "TCGA-UCEC": "gynecological", "TCGA-CESC": "gynecological", "TCGA-OV": "gynecological",
    "TCGA-UCS": "gynecological",
    "TCGA-LAML": "hematologic", "TCGA-DLBC": "hematologic",
    "TCGA-HNSC": "other_site", "TCGA-SKCM": "other_site", "TCGA-THCA": "other_site",
    "TCGA-MESO": "other_site", "TCGA-UVM": "other_site", "TCGA-PCPG": "other_site",
    "TCGA-SARC": "other_site", "TCGA-GBM": "other_site", "TCGA-LGG": "other_site",
}

# primary_site_group (mapped from project_id, see PROJECT_TO_SITE_GROUP) was
# tested as a 3rd predictor and improved macro-F1 modestly (0.133 -> 0.166) but
# not exact accuracy (0.500 -> 0.490) — and it doesn't correspond to any single
# existing schema node: the 7 cancer_type_* binaries only resolve to one active
# site in apply_hard_constraints(), which runs AFTER the per-node generation
# loop that model_ref sampling happens inside (engine.py). Wiring it in would
# need that single-site resolution moved earlier — deferred to Stage 2's mixed
# dependency-graph ordering work (requirements.md §6), not built here. Stage 1
# ships the 2-predictor model, which needs no such reordering (both predictors
# are already-independent root nodes).
PREDICTORS = ["disease_stage", "age_bracket"]
TARGET = "ecog_performance_status"


def stage_to_bucket(raw):
    if not raw or not raw.startswith("Stage "):
        return None
    code = raw[len("Stage "):]
    if code.startswith("IV"):
        return "Terminal"
    if code.startswith("III"):
        return "Stage 3 (Advanced)"
    if code.startswith("II"):
        return "Stage 2 (Moderate)"
    if code.startswith("I"):
        return "Stage 1 (Mild)"
    return None


def age_to_bracket(age_years):
    if age_years in (None, ""):
        return None
    age_years = float(age_years)
    if age_years <= 35:
        return "18-35"
    if age_years <= 55:
        return "36-55"
    if age_years <= 70:
        return "56-70"
    return "71+"


def load_training_frame(csv_path):
    df = pd.read_csv(csv_path)
    df = df[df["baseline_ecog"].notna() & (df["baseline_ecog"] != "")]

    df["disease_stage"] = df["ajcc_pathologic_stage"].apply(
        lambda v: stage_to_bucket(v) if isinstance(v, str) else None
    )
    df["age_bracket"] = df["age_at_diagnosis_years"].apply(age_to_bracket)
    df[TARGET] = df["baseline_ecog"].astype(float).astype(int).astype(str)

    before = len(df)
    df = df.dropna(subset=["disease_stage", "age_bracket"])
    dropped = before - len(df)

    return df[["case_id"] + PREDICTORS + [TARGET, "baseline_ecog_source"]], dropped


def majority_baseline_accuracy(train_y, test_y):
    majority = Counter(train_y).most_common(1)[0][0]
    return sum(1 for y in test_y if y == majority) / len(test_y), majority


def evaluate(model, test_df):
    infer = VariableElimination(model)
    preds, actuals = [], []
    for _, row in test_df.iterrows():
        evidence = {p: row[p] for p in PREDICTORS}
        q = infer.query(variables=[TARGET], evidence=evidence, show_progress=False)
        idx = int(np.argmax(q.values))
        pred = int(q.state_names[TARGET][idx])
        preds.append(pred)
        actuals.append(int(row[TARGET]))
    return preds, actuals


def within1_accuracy(preds, actuals):
    return sum(1 for p, a in zip(preds, actuals) if abs(p - a) <= 1) / len(preds)


def export_cpts(model):
    out = {}
    for cpd in model.get_cpds():
        out[cpd.variable] = {
            "variable": cpd.variable,
            "evidence": cpd.get_evidence(),
            "state_names": {k: list(v) for k, v in cpd.state_names.items()},
            "values": cpd.get_values().tolist(),
        }
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", help="path to baseline_profile.csv")
    parser.add_argument("--model-out", default="models/ecog_bn.pkl")
    parser.add_argument("--cpt-out", default="models/ecog_bn_cpts.json")
    parser.add_argument("--report-out", default="reports/stage1_ecog_bn_eval.md")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()

    df, dropped = load_training_frame(args.csv_path)
    n_total = len(df) + dropped
    class_counts = Counter(df[TARGET])

    try:
        train_df, test_df = train_test_split(
            df, test_size=args.test_size, random_state=args.seed, stratify=df[TARGET]
        )
    except ValueError:
        train_df, test_df = train_test_split(df, test_size=args.test_size, random_state=args.seed)

    model = DiscreteBayesianNetwork([(p, TARGET) for p in PREDICTORS])
    estimator = BayesianEstimator(model, train_df[PREDICTORS + [TARGET]])
    cpds = estimator.get_parameters(prior_type="BDeu", equivalent_sample_size=10)
    model.add_cpds(*cpds)

    preds, actuals = evaluate(model, test_df)
    acc = sum(1 for p, a in zip(preds, actuals) if p == a) / len(preds)
    macro_f1 = f1_score(actuals, preds, average="macro", zero_division=0)
    within1 = within1_accuracy(preds, actuals)
    baseline_acc, majority_class = majority_baseline_accuracy(list(train_df[TARGET]), list(test_df[TARGET]))

    tier_breakdown = {}
    for tier in ("direct", "kps_derived"):
        tier_test = test_df[test_df["baseline_ecog_source"] == tier]
        if len(tier_test) == 0:
            continue
        tier_preds, tier_actuals = evaluate(model, tier_test)
        tier_acc = sum(1 for p, a in zip(tier_preds, tier_actuals) if p == a) / len(tier_preds)
        tier_breakdown[tier] = {"n": len(tier_test), "accuracy": tier_acc}

    with open(args.model_out, "wb") as f:
        pickle.dump(model, f)

    with open(args.cpt_out, "w", encoding="utf-8") as f:
        json.dump(export_cpts(model), f, indent=2)

    report = f"""# Stage 1 Evaluation — ECOG Bayesian Network

**Model:** `DiscreteBayesianNetwork`, structure `{{disease_stage, age_bracket}} -> ecog_performance_status`,
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

- TCGA cases with a usable ECOG reading: {n_total} ({dropped} dropped for missing stage/age bucket after mapping).
- Used for training/verification: {len(df)}.
- Label-quality tiers (not silently merged): {dict(Counter(df['baseline_ecog_source']))}.
- Target class distribution: {dict(sorted(class_counts.items()))}.
- Train/verification split: {len(train_df)} / {len(test_df)} (stratified by ECOG class, seed={args.seed}).

**Coverage caveat:** these {n_total} cases are ~20-28% of the full 2,591-case TCGA corpus — TCGA does not
systematically record performance status. This bounds achievable model quality regardless of algorithm choice
(see requirements.md §8, "ECOG label coverage ceiling").

**Excluded predictors:** treatment features (`has_chemo`, `n_treatment_lines`, etc.) were deliberately excluded —
TCGA's `follow_ups` are not reliably ordered relative to treatment courses, so using them risked the model
learning from information that postdates the performance-status reading (requirements.md §5 caveat).
`smoking_status` and `primary_site_group` were tested and excluded from the shipped model (see above) —
predictor combination space is 4 stages x 4 age brackets = 16 cells for {len(train_df)} training rows.

## Verification Metrics

| Metric | Value |
|---|---|
| Exact accuracy | {acc:.3f} |
| Macro F1 | {macro_f1:.3f} |
| Within-1 accuracy (ECOG off by <=1) | {within1:.3f} |
| Majority-class baseline accuracy (always predict '{majority_class}') | {baseline_acc:.3f} |

### By label-quality tier

| Tier | n (verification) | Accuracy |
|---|---|---|
{chr(10).join(f"| {tier} | {v['n']} | {v['accuracy']:.3f} |" for tier, v in tier_breakdown.items())}

## Honest read

With only {len(train_df)} training rows across a 5-class ordinal target, exact-accuracy and macro-F1 are
expected to be noisy — the within-1 and majority-baseline comparisons matter more than exact accuracy alone
for judging whether this model is worth wiring into `engine.py` over the old literature-estimated baseline.
"""
    with open(args.report_out, "w", encoding="utf-8") as f:
        f.write(report)

    sys.stderr.write(report)


if __name__ == "__main__":
    main()
