"""Summary statistics over a generated dataset, driven by the schema.

Stdlib only (statistics module).
"""

import statistics

NUMERIC_TYPES = ("continuous", "ordinal")
CATEGORICAL_TYPES = ("categorical", "binary")


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


def summarize(schema, rows):
    nodes = schema.get("nodes", [])
    node_by_id = {n["id"]: n for n in nodes}

    numeric_ids = [n["id"] for n in nodes if n.get("type") in NUMERIC_TYPES]
    categorical_ids = [n["id"] for n in nodes if n.get("type") in CATEGORICAL_TYPES]
    binary_ids = [n["id"] for n in nodes if n.get("type") == "binary"]

    numeric = {}
    for nid in numeric_ids:
        vals = [r[nid] for r in rows if r.get(nid) is not None]
        if not vals:
            continue
        numeric[nid] = {
            "mean": statistics.mean(vals),
            "std": statistics.pstdev(vals),
            "min": min(vals),
            "max": max(vals),
        }

    categorical = {}
    for nid in categorical_ids:
        counts = {}
        for r in rows:
            if nid not in r:
                continue
            val = r[nid]
            counts[val] = counts.get(val, 0) + 1
        categorical[nid] = counts

    def to_num(nid, val):
        node = node_by_id[nid]
        if node["type"] == "binary":
            return node["categories"].index(val)
        return val

    corr_ids = numeric_ids + binary_ids
    series = {}
    for nid in corr_ids:
        series[nid] = [to_num(nid, r[nid]) if r.get(nid) is not None else None for r in rows]

    correlations = {nid: {} for nid in corr_ids}
    for i in range(len(corr_ids)):
        for j in range(i + 1, len(corr_ids)):
            a, b = corr_ids[i], corr_ids[j]
            pairs = [(x, y) for x, y in zip(series[a], series[b]) if x is not None and y is not None]
            if not pairs:
                continue
            xs, ys = zip(*pairs)
            r = _pearson(list(xs), list(ys))
            if r is None:
                continue
            correlations[a][b] = r
            correlations[b][a] = r

    return {
        "numeric": numeric,
        "categorical": categorical,
        "correlations": correlations,
    }
