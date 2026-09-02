"""Parse GDC/TCGA clinical case JSON exports into structured CSV tables.

Input is the nested case JSON as exported from the NCI GDC Portal
(context/clinical.cases_selection.*.json). Each case has variable-length
arrays (diagnoses, treatments per diagnosis, exposures, follow_ups), so this
produces normalized tables (one row per record) plus a flattened
one-row-per-case baseline table for feeding schema/graph_model.json.

Stdlib only, consistent with generator/*.py.

CLI:
    python3 ingest/parse_tcga_cases.py context/clinical.cases_selection.2026-09-01.json --outdir data/tcga_parsed
"""

import argparse
import csv
import json
import sys
from pathlib import Path

# Sentinel strings GDC uses in place of a real null.
NULL_TOKENS = {"not reported", "unknown", "n/a", "na", ""}

# Standard KPS -> ECOG crosswalk (Buccheri et al. 1996), used when
# ecog_performance_status is "Unknown" but karnofsky_performance_status is present.
# KPS=0 ("Dead" on the Karnofsky scale) deliberately has no bin: ECOG is a living-
# patient performance scale (schema range [0,4], no "dead" state — vital_status
# already captures mortality), so KPS=0 must map to None, not an invented ECOG 5.
KPS_ECOG_BINS = [(90, 0), (70, 1), (50, 2), (30, 3), (10, 4)]

TREATMENT_OUTCOME_RANK = [
    "Complete Response",
    "Partial Response",
    "Stable Disease",
    "Progressive Disease",
]


def clean(val):
    if val is None:
        return None
    if isinstance(val, str) and val.strip().lower() in NULL_TOKENS:
        return None
    return val


def to_float(val):
    val = clean(val)
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def to_int(val):
    f = to_float(val)
    return int(f) if f is not None else None


def days_to_years(days):
    days = to_float(days)
    return round(days / 365.25, 2) if days is not None else None


def days_to_months(days):
    days = to_float(days)
    return round(days / 30.44, 2) if days is not None else None


def kps_to_ecog(kps):
    kps = to_int(kps)
    if kps is None:
        return None
    for floor, ecog in KPS_ECOG_BINS:
        if kps >= floor:
            return ecog
    return None


def parse_ecog(raw):
    raw = clean(raw)
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def write_csv(path, rows):
    if not rows:
        return
    fieldnames = []
    seen = set()
    for row in rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, restval="", extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def extract_normalized(cases):
    """Flatten nested arrays into independent record lists, FK'd to case_id."""
    diagnoses, treatments, exposures, follow_ups, follow_up_attrs = [], [], [], [], []

    for case in cases:
        case_id = case["case_id"]

        for dx in case.get("diagnoses", []):
            dx_row = {k: clean(v) for k, v in dx.items() if not isinstance(v, (list, dict))}
            dx_row["case_id"] = case_id
            diagnoses.append(dx_row)

            for tx in dx.get("treatments", []):
                tx_row = {k: clean(v) for k, v in tx.items() if not isinstance(v, (list, dict))}
                tx_row["case_id"] = case_id
                tx_row["diagnosis_id"] = dx.get("diagnosis_id")
                treatments.append(tx_row)

        for ex in case.get("exposures", []):
            ex_row = {k: clean(v) for k, v in ex.items() if not isinstance(v, (list, dict))}
            ex_row["case_id"] = case_id
            exposures.append(ex_row)

        for fu in case.get("follow_ups", []):
            fu_row = {k: clean(v) for k, v in fu.items() if not isinstance(v, (list, dict))}
            fu_row["case_id"] = case_id
            follow_ups.append(fu_row)

            for attr in fu.get("other_clinical_attributes", []):
                attr_row = {k: clean(v) for k, v in attr.items() if not isinstance(v, (list, dict))}
                attr_row["case_id"] = case_id
                attr_row["follow_up_id"] = fu.get("follow_up_id")
                follow_up_attrs.append(attr_row)

    return {
        "diagnoses": diagnoses,
        "treatments": treatments,
        "exposures": exposures,
        "follow_ups": follow_ups,
        "follow_up_attributes": follow_up_attrs,
    }


def pick_primary_diagnosis(diagnoses):
    for dx in diagnoses:
        if str(clean(dx.get("diagnosis_is_primary_disease"))).lower() == "true":
            return dx
    for dx in diagnoses:
        if clean(dx.get("classification_of_tumor")) == "primary":
            return dx
    return diagnoses[0] if diagnoses else {}


def collect_treatments(diagnoses):
    out = []
    for dx in diagnoses:
        out.extend(dx.get("treatments", []))
    return out


def best_treatment_outcome(treatments):
    seen = {clean(t.get("treatment_outcome")) for t in treatments}
    seen.discard(None)
    for outcome in TREATMENT_OUTCOME_RANK:
        if outcome in seen:
            return outcome
    return None


def pick_baseline_follow_up(follow_ups):
    """Earliest follow-up carrying a performance-status reading.

    Excludes "Preoperative" readings when a non-preoperative alternative exists:
    a pre-surgery snapshot taken near diagnosis skews heavily toward good
    performance status (ECOG 0-1) and is not representative of the disease
    trajectory a palliative-care model cares about (confirmed empirically —
    94% of Preoperative-tagged readings were ECOG 0-1 vs. a much wider spread
    elsewhere). Used only as a last resort when it's the sole reading available.
    """
    candidates = [
        fu for fu in follow_ups
        if clean(fu.get("ecog_performance_status")) is not None
        or clean(fu.get("karnofsky_performance_status")) is not None
    ]
    if not candidates:
        return None

    def sort_key(fu):
        days = to_float(fu.get("days_to_follow_up"))
        return days if days is not None else float("inf")

    non_preop = [fu for fu in candidates if clean(fu.get("timepoint_category")) != "Preoperative"]
    pool = non_preop or candidates
    return min(pool, key=sort_key)


def pick_last_follow_up(follow_ups):
    if not follow_ups:
        return None
    dated = [fu for fu in follow_ups if to_float(fu.get("days_to_follow_up")) is not None]
    if not dated:
        return None
    return max(dated, key=lambda fu: to_float(fu.get("days_to_follow_up")))


def build_baseline_profile(case):
    demo = case.get("demographic", {}) or {}
    diagnoses = case.get("diagnoses", [])
    exposures = case.get("exposures", [])
    follow_ups = case.get("follow_ups", [])

    primary_dx = pick_primary_diagnosis(diagnoses)
    treatments = collect_treatments(diagnoses)
    baseline_fu = pick_baseline_follow_up(follow_ups) or {}
    last_fu = pick_last_follow_up(follow_ups) or {}
    exposure = exposures[0] if exposures else {}

    ecog = parse_ecog(baseline_fu.get("ecog_performance_status"))
    ecog_source = "direct" if ecog is not None else None
    if ecog is None:
        ecog = kps_to_ecog(baseline_fu.get("karnofsky_performance_status"))
        if ecog is not None:
            ecog_source = "kps_derived"

    treatment_types = {clean(t.get("treatment_type")) or "" for t in treatments}
    has = lambda kw: any(kw.lower() in tt.lower() for tt in treatment_types)

    prior_malignancy_flag = any(
        clean(dx.get("prior_malignancy")) == "yes"
        or clean(dx.get("classification_of_tumor")) == "Prior primary"
        for dx in diagnoses
    )

    days_to_death = clean(demo.get("days_to_death"))

    return {
        "case_id": case.get("case_id"),
        "submitter_id": case.get("submitter_id"),
        "project_id": (case.get("project") or {}).get("project_id"),
        "primary_site": clean(case.get("primary_site")),
        "disease_type": clean(case.get("disease_type")),
        "icd_10_code": clean(primary_dx.get("icd_10_code")),
        "primary_diagnosis": clean(primary_dx.get("primary_diagnosis")),
        "morphology": clean(primary_dx.get("morphology")),
        "ajcc_pathologic_stage": clean(primary_dx.get("ajcc_pathologic_stage")),
        "ajcc_t": clean(primary_dx.get("ajcc_pathologic_t")),
        "ajcc_n": clean(primary_dx.get("ajcc_pathologic_n")),
        "ajcc_m": clean(primary_dx.get("ajcc_pathologic_m")),
        "age_at_diagnosis_years": days_to_years(primary_dx.get("age_at_diagnosis")) or days_to_years(demo.get("days_to_birth") and -to_float(demo.get("days_to_birth"))),
        "age_at_index_years": to_float(demo.get("age_at_index")),
        "sex_at_birth": clean(demo.get("sex_at_birth")),
        "race": clean(demo.get("race")),
        "ethnicity": clean(demo.get("ethnicity")),
        "country_of_residence": clean(demo.get("country_of_residence_at_enrollment")),
        "vital_status": clean(demo.get("vital_status")),
        "survival_months": days_to_months(days_to_death),
        "n_diagnoses": len(diagnoses),
        "prior_malignancy_flag": prior_malignancy_flag,
        "residual_disease": clean(primary_dx.get("residual_disease")),
        "baseline_ecog": ecog,
        "baseline_ecog_source": ecog_source,
        "baseline_kps": to_int(baseline_fu.get("karnofsky_performance_status")),
        "smoking_status": clean(exposure.get("tobacco_smoking_status")),
        "pack_years_smoked": to_float(exposure.get("pack_years_smoked")),
        "n_treatment_lines": sum(1 for t in treatments if clean(t.get("treatment_or_therapy")) == "yes"),
        "has_chemo": has("chemotherapy"),
        "has_radiation": has("radiation"),
        "has_surgery": has("surgery"),
        "has_immunotherapy": has("immunotherapy"),
        "best_treatment_outcome": best_treatment_outcome(treatments),
        "disease_response_last": clean(last_fu.get("disease_response")),
        "progression_or_recurrence_last": clean(last_fu.get("progression_or_recurrence")),
        "lost_to_followup": clean(case.get("lost_to_followup")),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", help="Path to GDC clinical case JSON export")
    parser.add_argument("--outdir", default="data/tcga_parsed", help="Output directory for CSVs")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        cases = json.load(f)

    outdir = Path(args.outdir)

    normalized = extract_normalized(cases)
    for name, rows in normalized.items():
        write_csv(outdir / f"{name}.csv", rows)

    baseline_rows = [build_baseline_profile(case) for case in cases]
    write_csv(outdir / "baseline_profile.csv", baseline_rows)

    print(f"casos procesados: {len(cases)}", file=sys.stderr)
    for name, rows in normalized.items():
        print(f"  {name}.csv: {len(rows)} filas", file=sys.stderr)
    print(f"  baseline_profile.csv: {len(baseline_rows)} filas", file=sys.stderr)


if __name__ == "__main__":
    main()
