"""Clinical-consistency audit over a generated sample.

Unlike privacy.py (re-identification/disclosure risk) or stats.py (summary
statistics), this checks whether generated profiles are internally coherent
against real clinical definitions and epidemiology — e.g. "Bedridden" mobility
and ECOG performance status both measure the same underlying functional
capacity and should not contradict each other.

Deterministic, rule-based: catches definitional/known-pattern inconsistencies
cheaply and repeatably, every run, at zero marginal cost. It does not replace
clinical judgment for novel patterns a fixed rule set doesn't anticipate — pair
it with the LLM review pass described in
.claude/agents/06_clinical_consistency_reviewer.md for that.

Hardcodes this schema's variable names (like refactor_synthetic_dataset.py,
unlike engine.py which is schema-generic) — every check guards on column
presence so a user-edited schema missing a node just skips that check instead
of crashing.
"""


def _present(rows, *cols):
    if not rows:
        return False
    return all(c in rows[0] for c in cols)


def check_ecog_functional_consistency(rows):
    """ECOG is defined by functional capacity — a mobility/ADL reading that
    contradicts the reported ECOG grade is a definitional error, not just an
    unusual combination (found via manual QA: "ECOG Rating Compression")."""
    if not _present(rows, "mobility", "ecog_performance_status"):
        return None
    n = len(rows)
    findings = []

    bedridden_low_ecog = sum(
        1 for r in rows
        if r.get("mobility") == "Bedridden" and (r.get("ecog_performance_status") or 0) < 3
    )
    if bedridden_low_ecog:
        findings.append({
            "rule": "ecog_mobility_contradiction",
            "severity": "high",
            "count": bedridden_low_ecog,
            "fraction": round(bedridden_low_ecog / n, 4),
            "description": (
                f"{bedridden_low_ecog}/{n} profiles ({bedridden_low_ecog/n:.1%}) are 'Bedridden' "
                "mobility with ECOG < 3 — ECOG 3 is definitionally 'confined to bed/chair >50% of "
                "waking hours', so this is a contradiction, not an unusual combination."
            ),
        })

    impaired_mobility_ecog0 = sum(
        1 for r in rows
        if r.get("mobility") in ("Wheelchair", "Bedridden") and r.get("ecog_performance_status") == 0
    )
    if impaired_mobility_ecog0:
        findings.append({
            "rule": "ecog0_impaired_mobility",
            "severity": "high",
            "count": impaired_mobility_ecog0,
            "fraction": round(impaired_mobility_ecog0 / n, 4),
            "description": (
                f"{impaired_mobility_ecog0}/{n} profiles are ECOG 0 ('fully active') with Wheelchair "
                "or Bedridden mobility — ECOG 0 excludes any mobility impairment by definition."
            ),
        })

    return findings


def check_pharmacology_vs_severity(rows):
    """Opioid/sedation intensity should track pain/disease severity, not occur
    by base-rate chance regardless of it (found via manual QA: "Severe Opioid
    & Sedation Toxicity in Early Stages")."""
    if not _present(rows, "disease_stage", "metastatic_disease", "chemotherapy_current",
                     "sedation_level", "chronic_pain"):
        return None
    n = len(rows)
    mismatches = [
        r for r in rows
        if r.get("disease_stage") == "Stage 1 (Mild)"
        and r.get("metastatic_disease") == "No"
        and r.get("chemotherapy_current") == "No"
        and (r.get("sedation_level") or 0) >= 8
        and (r.get("chronic_pain") or 0) <= 6
    ]
    if not mismatches:
        return []
    return [{
        "rule": "mild_stage_severe_sedation",
        "severity": "medium",
        "count": len(mismatches),
        "fraction": round(len(mismatches) / n, 4),
        "description": (
            f"{len(mismatches)}/{n} profiles ({len(mismatches)/n:.1%}) are Stage 1 (Mild), "
            "non-metastatic, no chemotherapy, yet show sedation_level >= 8 without correspondingly "
            "severe chronic_pain (<=6) to explain it — a pharmacological burden inconsistent with "
            "mild disease and no clear driver."
        ),
    }]


def check_demographic_plausibility(rows, male_breast_cancer_ceiling=0.05):
    """Aggregate (sample-level, not per-row) epidemiological plausibility —
    found via manual QA: male breast cancer overrepresented in a small sample.
    Real-world rate is ~1% of breast cancer cases; the ceiling here is
    deliberately generous to avoid flagging small-sample noise."""
    if not _present(rows, "gender", "cancer_type_breast"):
        return None
    males = [r for r in rows if r.get("gender") == "Male"]
    if not males:
        return []
    male_breast = sum(1 for r in males if r.get("cancer_type_breast") == "Yes")
    rate = male_breast / len(males)
    if rate <= male_breast_cancer_ceiling:
        return []
    return [{
        "rule": "male_breast_cancer_overrepresented",
        "severity": "medium",
        "count": male_breast,
        "fraction": round(rate, 4),
        "description": (
            f"{rate:.1%} of male profiles (n={len(males)}) have cancer_type_breast='Yes' — "
            f"real-world male breast cancer is ~1% of breast cancer cases; "
            f"{male_breast_cancer_ceiling:.0%} was used as the flagging ceiling."
        ),
    }]


def check_caregiver_vs_dependency(rows):
    """Severe functional/cognitive dependency with an identified caregiver
    should imply frequent contact, not just any nonzero contact (found via
    manual QA: "Caregiver Support Discrepancies")."""
    if not _present(rows, "mobility", "ecog_performance_status", "cognitive_function_mmse",
                     "caregiver_type", "caregiver_contact_frequency"):
        return None
    n = len(rows)

    def severe(r):
        mmse = r.get("cognitive_function_mmse")
        return (
            r.get("mobility") == "Bedridden"
            or (r.get("ecog_performance_status") or 0) >= 3
            or (mmse is not None and mmse <= 12)
        )

    mismatches = [
        r for r in rows
        if severe(r)
        and r.get("caregiver_type") != "None identified"
        and r.get("caregiver_contact_frequency") in ("Weekly visits", "Sporadic contact")
    ]
    if not mismatches:
        return []
    return [{
        "rule": "caregiver_support_insufficient",
        "severity": "medium",
        "count": len(mismatches),
        "fraction": round(len(mismatches) / n, 4),
        "description": (
            f"{len(mismatches)}/{n} profiles ({len(mismatches)/n:.1%}) have severe functional/cognitive "
            "dependency (bedridden, ECOG>=3, or MMSE<=12) with an identified caregiver visiting only "
            "weekly or sporadically — a support-level mismatch."
        ),
    }]


CHECKS = [
    check_ecog_functional_consistency,
    check_pharmacology_vs_severity,
    check_demographic_plausibility,
    check_caregiver_vs_dependency,
]


def consistency_audit(rows):
    """Run every deterministic clinical-consistency check against a generated
    sample.

    Returns {"findings": [...], "skipped_checks": [...], "note": str}.
    findings is flat across all checks. skipped_checks lists checks whose
    required columns weren't present (e.g. a user-edited schema missing a node
    a check depends on) — skipped, not failed, so one incompatible check never
    blocks the others.
    """
    findings = []
    skipped = []
    for check in CHECKS:
        result = check(rows)
        if result is None:
            skipped.append(check.__name__)
        else:
            findings.extend(result)

    return {
        "findings": findings,
        "skipped_checks": skipped,
        "note": (
            "Deterministic, rule-based checks only — catches known-pattern definitional/"
            "epidemiological inconsistencies at zero marginal cost per run. Does not replace a "
            "clinical-plausibility review for novel combinations a fixed rule set doesn't anticipate; "
            "pair with an LLM review pass over a sample summary for that "
            "(see .claude/agents/06_clinical_consistency_reviewer.md)."
        ),
    }
