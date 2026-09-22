"""Stage 2 Tier B — train a Bayesian Network for metastatic_disease on real TCGA data.

Single predictor: disease_stage (categorical, matches STAGE_IDX 0-3 directly,
same convention as train_ecog_bn.py). Target: metastatic_disease (binary
No/Yes), derived from TCGA's ajcc_pathologic_m — M0/cM0(i+) -> No, M1/M1a/M1b/M1c
-> Yes, MX/missing excluded (not a usable reading, not "not metastatic").

Replaces the schema's current compound-formula gate
(e_disease_stage_metastatic_disease: "target = 'No' if source <= 1 else target"),
which only enforced Stage 1/2 => non-metastatic and left Stage 3/Terminal at
their independent baseline draw — this model instead fits the real conditional
rate directly.

CLI:
    python3 training/train_metastatic_bn.py data/tcga_parsed/baseline_profile.csv \
        --model-out models/metastatic_bn.pkl --cpt-out models/metastatic_bn_cpts.json \
        --report-out reports/stage2_metastatic_bn_eval.md
"""

import argparse
import json
import pickle
import sys
from collections import Counter

import pandas as pd
from pgmpy.estimators import BayesianEstimator
from pgmpy.inference import VariableElimination
from pgmpy.models import DiscreteBayesianNetwork
from sklearn.metrics import f1_score
from sklearn.model_selection import train_test_split

STAGE_BUCKETS = ["Stage 1 (Mild)", "Stage 2 (Moderate)", "Stage 3 (Advanced)", "Terminal"]
PREDICTORS = ["disease_stage"]
TARGET = "metastatic_disease"


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


def ajcc_m_to_metastatic(raw):
    if not raw:
        return None
    raw = raw.strip()
    if raw in ("M0", "cM0 (i+)"):
        return "No"
    if raw.startswith("M1"):
        return "Yes"
    return None  # MX, empty, or anything else unusable


def load_training_frame(csv_path):
    df = pd.read_csv(csv_path)
    df["disease_stage"] = df["ajcc_pathologic_stage"].apply(
        lambda v: stage_to_bucket(v) if isinstance(v, str) else None
    )
    df[TARGET] = df["ajcc_m"].apply(lambda v: ajcc_m_to_metastatic(v) if isinstance(v, str) else None)

    before = len(df)
    df = df.dropna(subset=["disease_stage", TARGET])
    dropped = before - len(df)
    return df[["case_id", "disease_stage", TARGET]], dropped


def majority_baseline_accuracy(train_y, test_y):
    majority = Counter(train_y).most_common(1)[0][0]
    return sum(1 for y in test_y if y == majority) / len(test_y), majority


def evaluate(model, test_df):
    infer = VariableElimination(model)
    preds, actuals = [], []
    for _, row in test_df.iterrows():
        q = infer.query(variables=[TARGET], evidence={"disease_stage": row["disease_stage"]}, show_progress=False)
        idx = int(q.values.argmax())
        preds.append(q.state_names[TARGET][idx])
        actuals.append(row[TARGET])
    return preds, actuals


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
    parser.add_argument("--model-out", default="models/metastatic_bn.pkl")
    parser.add_argument("--cpt-out", default="models/metastatic_bn_cpts.json")
    parser.add_argument("--report-out", default="reports/stage2_metastatic_bn_eval.md")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()

    df, dropped = load_training_frame(args.csv_path)
    n_total = len(df) + dropped
    class_counts = Counter(df[TARGET])

    train_df, test_df = train_test_split(
        df, test_size=args.test_size, random_state=args.seed, stratify=df[TARGET]
    )

    model = DiscreteBayesianNetwork([("disease_stage", TARGET)])
    estimator = BayesianEstimator(model, train_df[["disease_stage", TARGET]])
    cpds = estimator.get_parameters(prior_type="BDeu", equivalent_sample_size=10)
    model.add_cpds(*cpds)

    preds, actuals = evaluate(model, test_df)
    acc = sum(1 for p, a in zip(preds, actuals) if p == a) / len(preds)
    macro_f1 = f1_score(actuals, preds, average="macro", zero_division=0, labels=["No", "Yes"])
    baseline_acc, majority_class = majority_baseline_accuracy(list(train_df[TARGET]), list(test_df[TARGET]))

    with open(args.model_out, "wb") as f:
        pickle.dump(model, f)
    with open(args.cpt_out, "w", encoding="utf-8") as f:
        json.dump(export_cpts(model), f, indent=2)

    stage_rates = df.groupby("disease_stage")[TARGET].apply(lambda s: (s == "Yes").mean())

    report = f"""# Stage 2 Evaluation — metastatic_disease Bayesian Network

**Model:** `DiscreteBayesianNetwork`, structure `disease_stage -> metastatic_disease`,
CPTs fit via `BayesianEstimator` (BDeu prior, equivalent_sample_size=10).

Replaces the schema's previous compound-formula gate
(`e_disease_stage_metastatic_disease`: `target = 'No' if source <= 1 else target`),
which only enforced Stage 1/2 => non-metastatic and left Stage 3/Terminal cases at
an independent 55% baseline draw regardless of stage.

## Data

- Full corpus: {n_total} cases. Usable `ajcc_pathologic_m` reading: {len(df)} ({dropped} dropped —
  `MX` ["cannot be assessed"] or missing, not a real "non-metastatic" reading).
- Used for training/verification: {len(df)}.
- Target class distribution: {dict(sorted(class_counts.items()))}.
- Train/verification split: {len(train_df)} / {len(test_df)} (stratified, seed={args.seed}).

## Real metastatic rate by disease_stage (population-level, all {len(df)} usable cases)

{chr(10).join(f"- {k}: {v:.1%}" for k, v in stage_rates.items())}

## Verification Metrics

| Metric | Value |
|---|---|
| Exact accuracy | {acc:.3f} |
| Macro F1 | {macro_f1:.3f} |
| Majority-class baseline accuracy (always predict '{majority_class}') | {baseline_acc:.3f} |

## Honest read

Unlike Stage 1's ECOG model, this one has {'a much larger' if len(df) > 1000 else 'a'} labeled set ({len(df)}
cases, {len(df)/n_total:.0%} of the full corpus, vs. ECOG's ~19%) and a single, low-cardinality
categorical predictor — expect this model to meaningfully beat the majority baseline if disease_stage
is genuinely predictive of metastatic status, which the per-stage rates above should make visually
obvious even before looking at the accuracy numbers.
"""
    with open(args.report_out, "w", encoding="utf-8") as f:
        f.write(report)

    sys.stderr.write(report)


if __name__ == "__main__":
    main()
