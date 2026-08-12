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
            "No real patient dataset available for Distance-to-Closest-Record or "
            "membership-inference comparison; audit limited to schema-level structural "
            "risk (near-zero variance, dominant categories, collinear variable pairs) "
            "over a generated sample."
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
