"""Schema-driven synthetic patient profile generator.

Consumes any valid graph_model.json-format schema (arbitrary nodes/edges) and
produces synthetic patient profiles. No variable names are hardcoded.

CLI:
    python3 generator/engine.py schema/graph_model.json --n 500 --seed 42 --out out.csv
"""

import argparse
import csv
import io
import json
import random
import sys

CAUSAL_TYPES = ("causal", "inhibitory", "compound")

REQUIRED_COMMON = ("id", "type")
REQUIRED_RANGE_TYPES = ("continuous", "ordinal")
REQUIRED_CATEGORY_TYPES = ("categorical", "binary")


def load_schema(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate_schema(schema):
    errors = []

    nodes = schema.get("nodes", [])
    edges = schema.get("edges", [])

    if not isinstance(nodes, list):
        errors.append("schema.nodes must be a list")
        nodes = []
    if not isinstance(edges, list):
        errors.append("schema.edges must be a list")
        edges = []

    node_ids = set()
    for i, node in enumerate(nodes):
        nid = node.get("id")
        if not nid:
            errors.append(f"node[{i}] missing required field 'id'")
            continue
        if nid in node_ids:
            errors.append(f"duplicate node id '{nid}'")
        node_ids.add(nid)

        ntype = node.get("type")
        if ntype not in REQUIRED_RANGE_TYPES + REQUIRED_CATEGORY_TYPES:
            errors.append(f"node '{nid}' has invalid or missing 'type': {ntype!r}")
            continue

        if ntype in REQUIRED_RANGE_TYPES:
            for field in ("range", "baseline_mean", "baseline_std"):
                if node.get(field) is None:
                    errors.append(f"node '{nid}' (type={ntype}) missing required field '{field}'")
            rng = node.get("range")
            if isinstance(rng, list) and len(rng) == 2:
                if rng[0] > rng[1]:
                    errors.append(f"node '{nid}' has invalid range {rng} (min > max)")
            elif rng is not None:
                errors.append(f"node '{nid}' has malformed 'range' (expected [min, max])")
        elif ntype in REQUIRED_CATEGORY_TYPES:
            cats = node.get("categories")
            probs = node.get("probabilities")
            if not cats:
                errors.append(f"node '{nid}' (type={ntype}) missing required field 'categories'")
            if not probs:
                errors.append(f"node '{nid}' (type={ntype}) missing required field 'probabilities'")
            if cats and probs and len(cats) != len(probs):
                errors.append(
                    f"node '{nid}' categories/probabilities length mismatch "
                    f"({len(cats)} vs {len(probs)})"
                )

    edge_ids = set()
    for i, edge in enumerate(edges):
        eid = edge.get("id", f"<index {i}>")
        if edge.get("id") in edge_ids:
            errors.append(f"duplicate edge id '{edge.get('id')}'")
        edge_ids.add(edge.get("id"))

        src = edge.get("source")
        tgt = edge.get("target")
        if src is None:
            errors.append(f"edge '{eid}' missing required field 'source'")
        elif src not in node_ids:
            errors.append(f"edge '{eid}' references unknown source node '{src}'")
        if tgt is None:
            errors.append(f"edge '{eid}' missing required field 'target'")
        elif tgt not in node_ids:
            errors.append(f"edge '{eid}' references unknown target node '{tgt}'")

        rel = edge.get("relationType")
        if rel not in ("causal", "correlated", "inhibitory", "compound"):
            errors.append(f"edge '{eid}' has invalid or missing 'relationType': {rel!r}")

        if rel in CAUSAL_TYPES and not edge.get("formula"):
            errors.append(f"edge '{eid}' (relationType={rel}) missing required field 'formula'")

    # DAG check over causal/inhibitory/compound edges only, via Kahn's algorithm.
    if not errors or node_ids:
        adj = {nid: [] for nid in node_ids}
        indeg = {nid: 0 for nid in node_ids}
        for edge in edges:
            if edge.get("relationType") not in CAUSAL_TYPES:
                continue
            src, tgt = edge.get("source"), edge.get("target")
            if src not in node_ids or tgt not in node_ids:
                continue
            adj[src].append(tgt)
            indeg[tgt] += 1

        queue = [nid for nid in node_ids if indeg[nid] == 0]
        visited = 0
        queue_idx = 0
        while queue_idx < len(queue):
            n = queue[queue_idx]
            queue_idx += 1
            visited += 1
            for m in adj[n]:
                indeg[m] -= 1
                if indeg[m] == 0:
                    queue.append(m)

        if visited != len(node_ids):
            cyclic = sorted(nid for nid in node_ids if indeg[nid] > 0)
            errors.append(
                "cycle detected in causal/inhibitory/compound edge subgraph "
                f"(involves nodes: {cyclic})"
            )

    return errors


def _topo_sort(node_ids, edges):
    """Kahn's algorithm topo sort restricted to causal/inhibitory/compound edges."""
    adj = {nid: [] for nid in node_ids}
    indeg = {nid: 0 for nid in node_ids}
    incoming = {nid: [] for nid in node_ids}
    for edge in edges:
        if edge.get("relationType") not in CAUSAL_TYPES:
            continue
        src, tgt = edge["source"], edge["target"]
        adj[src].append(tgt)
        indeg[tgt] += 1
        incoming[tgt].append(edge)

    queue = [nid for nid in node_ids if indeg[nid] == 0]
    order = []
    queue_idx = 0
    while queue_idx < len(queue):
        n = queue[queue_idx]
        queue_idx += 1
        order.append(n)
        for m in adj[n]:
            indeg[m] -= 1
            if indeg[m] == 0:
                queue.append(m)

    return order, incoming


def _sample_baseline(node, rng):
    ntype = node["type"]
    if ntype in REQUIRED_RANGE_TYPES:
        lo, hi = node["range"]
        val = rng.normalvariate(node["baseline_mean"], node["baseline_std"])
        val = _clip(val, lo, hi)
        if ntype == "ordinal":
            val = round(val)
        return val
    else:
        cats = node["categories"]
        probs = node["probabilities"]
        return rng.choices(cats, weights=probs, k=1)[0]


def _clip(val, lo, hi):
    return max(lo, min(hi, val))


def _apply_formula(formula, source_val, weight, running_val):
    """Parse 'target <op> <expr>' where op is one of '+=', '-=', '='.

    Evaluates <expr> with a restricted namespace {source, weight, target}, then
    applies the operator against the running value. 'target' in the namespace
    exposes the pre-formula running value so a '=' formula can conditionally
    keep or override it (e.g. gating a categorical target on a source value:
    "target = target if source == 1 else 'No'").
    """
    text = formula.strip()
    if not text.startswith("target"):
        raise ValueError(f"formula must start with 'target': {formula!r}")
    rest = text[len("target"):].lstrip()

    for op in ("+=", "-=", "="):
        if rest.startswith(op):
            expr = rest[len(op):].strip()
            namespace = {"source": source_val, "weight": weight, "target": running_val}
            rhs = eval(expr, {"__builtins__": {}}, namespace)
            if op == "+=":
                return running_val + rhs
            elif op == "-=":
                return running_val - rhs
            else:
                return rhs

    raise ValueError(f"formula missing supported operator (+=, -=, =): {formula!r}")


def generate(schema, n=500, seed=None):
    errors = validate_schema(schema)
    if errors:
        raise ValueError("; ".join(errors))

    nodes = schema["nodes"]
    edges = schema["edges"]
    node_by_id = {node["id"]: node for node in nodes}
    node_ids = [node["id"] for node in nodes]

    order, incoming = _topo_sort(node_ids, edges)

    rng = random.Random(seed)

    rows = []
    for _ in range(n):
        profile = {}
        for nid in order:
            node = node_by_id[nid]
            value = _sample_baseline(node, rng)

            for edge in incoming[nid]:
                src_node = node_by_id[edge["source"]]
                src_val = profile[edge["source"]]
                if src_node["type"] == "binary":
                    src_val = src_node["categories"].index(src_val)
                value = _apply_formula(edge["formula"], src_val, edge.get("weight", 0), value)

            ntype = node["type"]
            if ntype in REQUIRED_RANGE_TYPES:
                lo, hi = node["range"]
                value = _clip(value, lo, hi)
                if ntype == "ordinal":
                    value = round(value)

            profile[nid] = value

        rows.append(profile)

    return rows


def to_csv(rows, node_ids):
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=node_ids)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic patient profiles from a graph_model.json schema.")
    parser.add_argument("schema_path", help="path to graph_model.json")
    parser.add_argument("--n", type=int, default=500, help="number of profiles to generate")
    parser.add_argument("--seed", type=int, default=None, help="random seed for reproducibility")
    parser.add_argument("--out", default=None, help="output CSV path (default: stdout)")
    args = parser.parse_args()

    schema = load_schema(args.schema_path)
    errors = validate_schema(schema)
    if errors:
        sys.stderr.write("Schema validation failed:\n")
        for e in errors:
            sys.stderr.write(f"  - {e}\n")
        sys.exit(1)

    rows = generate(schema, n=args.n, seed=args.seed)
    node_ids = [node["id"] for node in schema["nodes"]]
    csv_text = to_csv(rows, node_ids)

    if args.out:
        with open(args.out, "w", encoding="utf-8", newline="") as f:
            f.write(csv_text)
    else:
        sys.stdout.write(csv_text)


if __name__ == "__main__":
    main()
