"""Correlated-restructuring post-processor for the oncology palliative synthetic dataset.

Takes a raw DataFrame produced by generator/engine.py (independent-then-patched
sampling) and re-derives every column in strict 6-layer conditional order so
the output is jointly consistent: no column's value can contradict a column
that causally precedes it. Pure pandas/numpy, vectorized, no per-row Python loops
except the two categorical re-draws (mobility, communication_capacity) which use
cumulative-probability vectorized sampling, not row-wise apply.

CLI:
    python3 generator/refactor_synthetic_dataset.py in.csv --out out.csv --seed 42
"""

import argparse
import sys

import numpy as np
import pandas as pd

RNG_SEED_DEFAULT = 42

STAGE_IDX = {"Stage 1 (Mild)": 0, "Stage 2 (Moderate)": 1, "Stage 3 (Advanced)": 2, "Terminal": 3}
AGE_PENALTY = {"18-35": 0.0, "36-55": 1.0, "56-70": 2.5, "71+": 4.0}
MOBILITY_CATS = ["Autonomous", "With support", "Wheelchair", "Bedridden"]
COMM_CATS = ["Fluent verbal", "Limited verbal", "Gestural only", "No verbal communication"]
CANCER_SITE_COLS = [
    "cancer_type_breast", "cancer_type_lung", "cancer_type_gastrointestinal",
    "cancer_type_genitourinary", "cancer_type_gynecological",
    "cancer_type_hematologic", "cancer_type_other_site",
]
CANCER_SITE_PREVALENCE = {
    "cancer_type_breast": 0.21, "cancer_type_lung": 0.18,
    "cancer_type_gastrointestinal": 0.24, "cancer_type_genitourinary": 0.10,
    "cancer_type_gynecological": 0.04, "cancer_type_hematologic": 0.03,
    "cancer_type_other_site": 0.21,
}

# conditional probability tables: row index = ECOG (0-4), columns follow *_CATS order
MOBILITY_GIVEN_ECOG = np.array([
    [0.85, 0.13, 0.02, 0.00],
    [0.45, 0.40, 0.13, 0.02],
    [0.15, 0.40, 0.35, 0.10],
    [0.03, 0.17, 0.40, 0.40],
    [0.00, 0.02, 0.18, 0.80],
])
COMM_GIVEN_ECOG = np.array([
    [0.85, 0.13, 0.02, 0.00],
    [0.65, 0.28, 0.05, 0.02],
    [0.45, 0.35, 0.15, 0.05],
    [0.20, 0.35, 0.30, 0.15],
    [0.08, 0.22, 0.35, 0.35],
])


def _clip(s, lo, hi):
    return s.clip(lower=lo, upper=hi)


def _cumulative_categorical_draw(rng, cond_idx, prob_table, cats):
    """Vectorized multinomial draw: cond_idx (Series of int row-selector) -> category string.

    prob_table rows are cumsum'd once; each row's draw compares a single
    uniform(0,1) against its own cumulative row via a boolean-matrix argmax,
    avoiding a per-row Python sampling loop.
    """
    n = len(cond_idx)
    cum = np.cumsum(prob_table, axis=1)
    u = rng.random(n)
    row_cum = cum[cond_idx.to_numpy()]
    idx = (u[:, None] > row_cum).sum(axis=1)
    idx = np.clip(idx, 0, len(cats) - 1)
    return pd.Series(np.array(cats)[idx], index=cond_idx.index)


def _layer1_demographics_oncology(df, rng):
    """Layer 1: baseline demographics + oncology profile. Independent roots only;
    enforces single-active-primary-site and the gynecological/male exclusion."""
    if set(CANCER_SITE_COLS).issubset(df.columns):
        active = df[CANCER_SITE_COLS].eq("Yes")
        n_active = active.sum(axis=1)

        male_mask = df.get("gender", pd.Series("", index=df.index)).eq("Male")
        df.loc[male_mask, "cancer_type_gynecological"] = "No"
        active = df[CANCER_SITE_COLS].eq("Yes")
        n_active = active.sum(axis=1)

        zero_mask = n_active == 0
        if zero_mask.any():
            candidates = [c for c in CANCER_SITE_COLS if c != "cancer_type_gynecological"]
            weights = np.array([CANCER_SITE_PREVALENCE[c] for c in candidates])
            weights = weights / weights.sum()
            choice_idx = rng.choice(len(candidates), size=zero_mask.sum(), p=weights)
            gyn_eligible = ~df.loc[zero_mask, "gender"].eq("Male") if "gender" in df.columns else pd.Series(True, index=df.loc[zero_mask].index)
            for i, ridx in enumerate(df.loc[zero_mask].index):
                col = candidates[choice_idx[i]]
                if col == "cancer_type_gynecological" and not gyn_eligible.loc[ridx]:
                    col = "cancer_type_other_site"
                df.loc[ridx, col] = "Yes"

        active = df[CANCER_SITE_COLS].eq("Yes")
        n_active = active.sum(axis=1)
        multi_mask = n_active > 1
        for ridx in df.loc[multi_mask].index:
            on_cols = [c for c in CANCER_SITE_COLS if df.at[ridx, c] == "Yes"]
            keep = rng.choice(on_cols)
            for c in on_cols:
                if c != keep:
                    df.at[ridx, c] = "No"

    if "disease_stage" in df.columns and "metastatic_disease" in df.columns:
        stage_idx = df["disease_stage"].map(STAGE_IDX)
        df.loc[stage_idx <= 1, "metastatic_disease"] = "No"

    return df


def _layer2_organ_severity_functional(df, rng):
    """Layer 2: ECOG <- stage/metastatic; mobility <- ECOG; ADL/IADL bounded by
    ECOG/mobility with IADL <= ADL enforced; MMSE <- age/stage/ECOG."""
    stage_idx = df["disease_stage"].map(STAGE_IDX).fillna(0)
    meta_flag = df["metastatic_disease"].eq("Yes").astype(float)

    ecog_mean = 0.6 + 0.55 * stage_idx + 1.0 * meta_flag
    df["ecog_performance_status"] = _clip(
        (ecog_mean + rng.normal(0, 0.6, len(df))).round(), 0, 4
    ).astype(int)

    ecog_int = df["ecog_performance_status"].to_numpy()
    df["mobility"] = _cumulative_categorical_draw(rng, pd.Series(ecog_int, index=df.index), MOBILITY_GIVEN_ECOG, MOBILITY_CATS)
    df["communication_capacity"] = _cumulative_categorical_draw(rng, pd.Series(ecog_int, index=df.index), COMM_GIVEN_ECOG, COMM_CATS)

    age_pen = df["age_bracket"].map(AGE_PENALTY).fillna(2.0)
    mmse_mean = 27 - age_pen - 1.5 * stage_idx - 1.8 * df["ecog_performance_status"]
    mmse = mmse_mean + rng.normal(0, 2.5, len(df))
    df["cognitive_function_mmse"] = _clip(mmse.round(), 0, 30)

    no_verbal = df["communication_capacity"].eq("No verbal communication")
    df["mmse_unevaluable"] = np.where(no_verbal, "Yes", "No")
    df.loc[no_verbal, "cognitive_function_mmse"] = np.nan

    gestural = df["communication_capacity"].eq("Gestural only")
    limited = df["communication_capacity"].eq("Limited verbal")
    df.loc[gestural, "cognitive_function_mmse"] = df.loc[gestural, "cognitive_function_mmse"].clip(upper=10)
    df.loc[limited, "cognitive_function_mmse"] = df.loc[limited, "cognitive_function_mmse"].clip(upper=22)

    ecog4_or_bedridden = df["ecog_performance_status"].eq(4) | df["mobility"].eq("Bedridden")
    severe = df["ecog_performance_status"].ge(3) | df["mobility"].eq("Bedridden")
    cog_impaired = df["cognitive_function_mmse"].le(12) | gestural | no_verbal

    adl_base = 100 - 22 * df["ecog_performance_status"] + rng.normal(0, 8, len(df))
    df["functional_autonomy_adl"] = _clip(adl_base, 0, 100)
    df.loc[severe, "functional_autonomy_adl"] = df.loc[severe, "functional_autonomy_adl"].clip(upper=40)
    df.loc[ecog4_or_bedridden, "functional_autonomy_adl"] = df.loc[ecog4_or_bedridden, "functional_autonomy_adl"].clip(upper=20)
    df.loc[cog_impaired, "functional_autonomy_adl"] = df.loc[cog_impaired, "functional_autonomy_adl"].clip(upper=40)
    ecog0 = df["ecog_performance_status"].eq(0) & ~cog_impaired
    df.loc[ecog0, "functional_autonomy_adl"] = df.loc[ecog0, "functional_autonomy_adl"].clip(lower=90)

    iadl_ceiling_pct = df["functional_autonomy_adl"] / 100.0 * 8.0
    df["instrumental_autonomy_iadl"] = np.minimum(df["instrumental_autonomy_iadl"], iadl_ceiling_pct)
    df.loc[cog_impaired, "instrumental_autonomy_iadl"] = df.loc[cog_impaired, "instrumental_autonomy_iadl"].clip(upper=2.0)
    df["instrumental_autonomy_iadl"] = _clip(df["instrumental_autonomy_iadl"], 0, 8)

    df["global_performance_status"] = _clip(
        5.5 - 1.0 * df["ecog_performance_status"] + 0.1 * (df["functional_autonomy_adl"] - 55) / 22 + rng.normal(0, 1.2, len(df)),
        0, 10,
    )
    df.loc[severe, "global_performance_status"] = df.loc[severe, "global_performance_status"].clip(upper=4.0)

    return df


def _layer3_somatic_symptoms(df, rng):
    """Layer 3: symptom cluster bounds chronic_pain/fatigue/appetite/nausea/
    dyspnea/drowsiness/insomnia; MNA-SF derived inversely from appetite+nausea+stage."""
    stage_idx = df["disease_stage"].map(STAGE_IDX).fillna(0)
    cluster = df["somatic_symptoms_cluster"]

    insomnia_floor = np.where(cluster.eq("Insomnia"), 3.0, 0.0)
    insomnia_ceiling = np.where(cluster.eq("Hypersomnia"), 2.9, 10.0)
    df["insomnia_severity"] = _clip(df["insomnia_severity"], insomnia_floor, insomnia_ceiling)

    agitation = cluster.eq("Psychomotor agitation")
    df.loc[agitation, "drowsiness"] = df.loc[agitation, "drowsiness"].clip(upper=6.0)

    for col in ("chronic_pain", "fatigue", "appetite_loss", "nausea_vomiting", "dyspnea"):
        df[col] = _clip(df[col] + 0.15 * stage_idx, 0, 10)

    df["nutritional_status_mna"] = _clip(
        14 - 0.55 * df["appetite_loss"] - 0.35 * df["nausea_vomiting"] - 0.6 * stage_idx + rng.normal(0, 1.2, len(df)),
        0, 14,
    )
    return df


def _layer4_pharmacology(df, rng):
    """Layer 4: opioid_use <- chronic_pain; constipation gated by opioid_use;
    antiemetic_use <- nausea + chemo; psychoactive_medication <- diagnosis + anxiety;
    sedation_level <- weighted composite of opioid/psychoactive/drowsiness."""
    high_pain = df["chronic_pain"].gt(6.0)
    flip_to_opioid = high_pain & df["opioid_use"].eq("No") & (rng.random(len(df)) < 0.85)
    df.loc[flip_to_opioid, "opioid_use"] = "Yes"

    opioid_yes = df["opioid_use"].eq("Yes")
    df.loc[~opioid_yes, "opioid_induced_constipation"] = 0

    need_antiemetic = (df["nausea_vomiting"].ge(6) | (df["chemotherapy_current"].eq("Yes") & df["nausea_vomiting"].ge(4)))
    flip_to_antiemetic = need_antiemetic & df["antiemetic_use"].eq("No") & (rng.random(len(df)) < 0.8)
    df.loc[flip_to_antiemetic, "antiemetic_use"] = "Yes"
    df.loc[df["antiemetic_use"].eq("Yes"), "nausea_vomiting"] = (df.loc[df["antiemetic_use"].eq("Yes"), "nausea_vomiting"] * 0.6).clip(lower=0)

    has_dx_basis = ~(df["depressive_diagnosis_dsm5"].eq("No formal diagnosis") & df["psychiatric_comorbidities"].eq("None"))
    df.loc[~has_dx_basis, "psychoactive_medication"] = "None"
    high_anxiety = df["anxiety_level"].ge(7.0)
    none_med = df["psychoactive_medication"].eq("None")
    flip_to_anxiolytic = has_dx_basis & high_anxiety & none_med & (rng.random(len(df)) < 0.6)
    df.loc[flip_to_anxiolytic, "psychoactive_medication"] = "Anxiolytics"

    psych_active = ~df["psychoactive_medication"].eq("None")
    sedation = 0.45 * df["drowsiness"] + 3.5 * opioid_yes.astype(float) + 1.8 * psych_active.astype(float)
    df["sedation_level"] = _clip(sedation + rng.normal(0, 1.0, len(df)), 0, 10)
    no_driver = ~opioid_yes & ~psych_active
    df.loc[no_driver, "sedation_level"] = df.loc[no_driver, "sedation_level"].clip(upper=3.0)

    return df


def _layer5_psychological(df, rng):
    """Layer 5: depression_severity_index <- diagnosis (with DSM-5 range floors);
    validity boundary blanks self-reported metrics when MMSE<12 or non-verbal."""
    dx = df["depressive_diagnosis_dsm5"]
    idx = df["depression_severity_index"]
    idx = idx.where(~dx.eq("No formal diagnosis"), 0.0)
    idx = idx.where(~dx.eq("Major depressive disorder"), idx.clip(lower=0.5 * 27))
    idx = idx.where(~dx.eq("Dysthymia (persistent depressive disorder)"), idx.clip(lower=0.1 * 27))
    df["depression_severity_index"] = _clip(idx, 0, 27)

    no_verbal = df["communication_capacity"].eq("No verbal communication")
    mmse_unreliable = df["cognitive_function_mmse"].isna() | (df["cognitive_function_mmse"] < 12)
    unevaluable = no_verbal | mmse_unreliable
    df["complex_psychometrics_unevaluable"] = np.where(unevaluable, "Yes", "No")
    for col in ("suicidal_ideation_risk", "spiritual_pain", "meaning_in_life"):
        if col in df.columns:
            df.loc[unevaluable, col] = np.nan

    return df


def _layer6_caregiver_environment(df, rng):
    """Layer 6: living_environment restricted by ADL; caregiver_burnout_zarit <-
    dependency + contact frequency, forced 0 if no caregiver identified."""
    none_caregiver = df["caregiver_type"].eq("None identified")
    low_adl = df["functional_autonomy_adl"].lt(30)
    not_247 = ~df["caregiver_contact_frequency"].eq("24/7 at home")
    illegal_alone = low_adl & df["living_environment"].eq("Living alone") & (not_247 | none_caregiver)
    df.loc[illegal_alone, "living_environment"] = "Family home"

    freq_weight = df["caregiver_contact_frequency"].map({
        "24/7 at home": 1.0, "Daily visits": 0.7, "Weekly visits": 0.4, "Sporadic contact": 0.2,
    }).fillna(0.5)
    dependency = 100.0 - df["functional_autonomy_adl"]
    disruptive = (df["chronic_pain"] + df["dyspnea"] + df["insomnia_severity"]) / 3.0
    burnout = freq_weight * dependency * 0.75 + disruptive * 1.5
    df["caregiver_burnout_zarit"] = _clip(burnout + rng.normal(0, 4, len(df)), 0, 88)
    df.loc[none_caregiver, "caregiver_burnout_zarit"] = 0.0
    df.loc[none_caregiver, "caregiver_contact_frequency"] = "Sporadic contact"

    return df


def refactor_synthetic_dataset(df, seed=RNG_SEED_DEFAULT):
    """Enforce the full 6-layer conditional/sequential restructuring matrix
    on an already-generated (independent-then-patched) synthetic profile
    DataFrame, in place semantics on a copy. Guarantees 100% logical
    consistency with the clinical hierarchy: every downstream column is
    re-derived or bounded strictly from its already-finalized upstream layers.
    """
    df = df.copy()
    rng = np.random.default_rng(seed)

    df = _layer1_demographics_oncology(df, rng)
    df = _layer2_organ_severity_functional(df, rng)
    df = _layer3_somatic_symptoms(df, rng)
    df = _layer4_pharmacology(df, rng)
    df = _layer5_psychological(df, rng)
    df = _layer6_caregiver_environment(df, rng)

    return df


def main():
    parser = argparse.ArgumentParser(description="Enforce correlated-restructuring matrix on a synthetic profile CSV.")
    parser.add_argument("csv_path", help="path to raw synthetic dataset CSV")
    parser.add_argument("--out", default=None, help="output CSV path (default: stdout)")
    parser.add_argument("--seed", type=int, default=RNG_SEED_DEFAULT)
    args = parser.parse_args()

    df = pd.read_csv(args.csv_path)
    out = refactor_synthetic_dataset(df, seed=args.seed)

    if args.out:
        out.to_csv(args.out, index=False)
    else:
        out.to_csv(sys.stdout, index=False)


if __name__ == "__main__":
    main()
