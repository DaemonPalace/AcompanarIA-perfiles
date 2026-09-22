"""Schema-level privacy/re-identification risk audit.

No real patient dataset exists to compare against, so this audits structural
risk in the schema + a generated sample rather than computing Distance to
Closest Record against real records.
"""


def privacy_audit(schema, rows, std_threshold=0.05, category_dominance=0.98, corr_threshold=0.98):
    warnings = []
    flags = {}

    nodes = schema.get("nodes", [])
    node_by_id = {n["id"]: n for n in nodes}

    for n in nodes:
        nid = n["id"]
        ntype = n.get("type")
        if ntype in ("continuous", "ordinal"):
            std = n.get("baseline_std", 0) or 0
            rng = n.get("range") or [0, 1]
            span = (rng[1] - rng[0]) or 1
            if std / span < std_threshold:
                warnings.append(
                    f"node '{nid}' has near-zero baseline_std ({std}) relative to range {rng} "
                    "— near-deterministic value, re-identification risk"
                )
                flags[nid] = "low_variance"
        elif ntype in ("categorical", "binary"):
            probs = n.get("probabilities") or []
            if probs and max(probs) >= category_dominance:
                warnings.append(
                    f"node '{nid}' has a category with probability >= {category_dominance} "
                    "— near-deterministic, low information/high disclosure risk"
                )
                flags[nid] = "dominant_category"

    numeric_ids = [n["id"] for n in nodes if n.get("type") in ("continuous", "ordinal")]
    binary_ids = [n["id"] for n in nodes if n.get("type") == "binary"]

    def to_num(nid, val):
        node = node_by_id[nid]
        if node["type"] == "binary":
            return node["categories"].index(val)
        return val

    series = {
        nid: [to_num(nid, r[nid]) if r.get(nid) is not None else None for r in rows]
        for nid in numeric_ids + binary_ids
    }

    ids = list(series.keys())
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            pairs = [(x, y) for x, y in zip(series[a], series[b]) if x is not None and y is not None]
            if not pairs:
                continue
            xs, ys = zip(*pairs)
            r = _pearson(list(xs), list(ys))
            if r is not None and abs(r) >= corr_threshold:
                warnings.append(
                    f"'{a}' and '{b}' are near-collinear in the generated sample (r={r:.3f}) "
                    "— one may be reconstructible from the other, attribute disclosure risk"
                )
                flags[f"{a}~{b}"] = "collinear_pair"

    return {
        "warnings": warnings,
        "flags": flags,
        "note": (
            "Schema-level structural risk only (near-zero variance, dominant categories, "
            "collinear variable pairs) over a generated sample. For an actual "
            "Distance-to-Closest-Record check against real patient data, see "
            "real_data_dcr_audit() below — unblocked once a schema has real_data-tier "
            "fields (see requirements.md Stage 1/2)."
        ),
    }


def real_data_dcr_audit(schema, reference_rows, generated_rows, rare_threshold=3, min_field_coverage=0.8):
    """Distance-to-Closest-Record audit against real patient data.

    This is the check privacy_audit() explicitly couldn't do before — no real
    reference dataset existed, or the real_data-tier field space was too small
    to be meaningful (Stage 1 shipped with only disease_stage x age_bracket,
    16 combinations, where nearly every generated row would trivially "match"
    a real one by construction — a degenerate result, not a genuine signal).
    Unblocked by Stage 2's real-data calibration.

    Fields audited are derived automatically from the schema's evidence_tier
    tags (every node tagged "real_data"), not hardcoded — this keeps working
    as more nodes gain real-data grounding in later stages without code changes.
    A field is excluded if its reference-set coverage is below
    min_field_coverage: a sparsely-populated field (e.g. Stage 1's
    ecog_performance_status, ~19% coverage in TCGA) fragments the combination
    space and inflates "rare combination" counts as an artifact of missingness,
    not genuine uniqueness — verified empirically: resampling directly *from*
    the reference set itself (a trivially-safe "generator") produced an 8.2%
    rare-match rate before this filter, which should be ~0%.

    reference_rows / generated_rows: lists of dicts using the same category
    encoding the schema itself uses for each real_data field (caller's
    responsibility — e.g. disease_stage bucketed via stage_to_bucket(),
    age_bracket via age_to_bracket(), matching training/train_*_bn.py's
    conventions).

    The actual disclosure-risk signal is rare_match_rate, not exact_match_rate:
    a generated row exactly matching a combination held by hundreds of real
    patients isn't attributable to any one of them (expected, harmless,
    especially for low-cardinality categorical fields); exactly matching a
    combination held by only a handful of real patients (k <= rare_threshold)
    is a genuine re-identification signal.
    """
    all_fields = [n["id"] for n in schema.get("nodes", []) if n.get("evidence_tier") == "real_data"]
    n_ref = len(reference_rows) or 1
    fields = [
        f for f in all_fields
        if sum(1 for r in reference_rows if r.get(f) is not None) / n_ref >= min_field_coverage
    ]
    excluded_fields = [f for f in all_fields if f not in fields]
    if not fields:
        return {
            "warnings": [],
            "flags": {},
            "fields": [],
            "note": "No real_data-tier fields in this schema yet — DCR audit not applicable.",
        }

    def combo(row):
        return tuple(row.get(f) for f in fields)

    ref_counts = {}
    for r in reference_rows:
        c = combo(r)
        ref_counts[c] = ref_counts.get(c, 0) + 1

    gen_combos = [combo(r) for r in generated_rows]
    n = len(gen_combos)

    exact_match = sum(1 for c in gen_combos if ref_counts.get(c, 0) > 0)
    rare_match = sum(1 for c in gen_combos if 0 < ref_counts.get(c, 0) <= rare_threshold)

    warnings = []
    flags = {}
    if n and rare_match / n > 0.05:
        warnings.append(
            f"{rare_match}/{n} generated profiles ({rare_match / n:.1%}) exactly match a real-patient "
            f"combination held by <= {rare_threshold} reference patients — a genuine re-identification "
            "signal, not just a common-combination coincidence."
        )
        flags["rare_combination_match"] = round(rare_match / n, 4)

    return {
        "n_generated": n,
        "n_reference": len(reference_rows),
        "fields": fields,
        "excluded_fields": excluded_fields,
        "exact_match_rate": round(exact_match / n, 4) if n else None,
        "rare_match_rate": round(rare_match / n, 4) if n else None,
        "rare_threshold": rare_threshold,
        "warnings": warnings,
        "flags": flags,
        "note": (
            "Real Distance-to-Closest-Record audit against data/tcga_parsed/baseline_profile.csv, "
            "restricted to real_data-tier fields with >= "
            f"{min_field_coverage:.0%} reference coverage (see 'fields'; 'excluded_fields' lists any "
            "real_data field too sparse in the reference set to use without fragmenting the combination "
            "space). The disclosure-risk signal is rare_match_rate (matching a combination held by only "
            "a handful of real patients), not exact_match_rate (expected to be high for low-cardinality "
            "common combinations, not itself a risk)."
        ),
    }


def _pearson(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    vx = sum((x - mx) ** 2 for x in xs)
    vy = sum((y - my) ** 2 for y in ys)
    if vx == 0 or vy == 0:
        return None
    return cov / ((vx ** 0.5) * (vy ** 0.5))
