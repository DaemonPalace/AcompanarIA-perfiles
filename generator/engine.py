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


CANCER_SITE_PREVALENCE = {
    "cancer_type_breast": 0.21,
    "cancer_type_lung": 0.18,
    "cancer_type_gastrointestinal": 0.24,
    "cancer_type_genitourinary": 0.10,
    "cancer_type_gynecological": 0.04,
    "cancer_type_hematologic": 0.03,
    "cancer_type_other_site": 0.21,
}


def apply_hard_constraints(rows, rng):
    """Clinical hard-constraint repair pass, run after full profile generation.

    Fixes DAG/formula-inexpressible constraints: multi-parent conditional caps
    and dataset-wide checks that engine.py's single-edge topo formulas and the
    global correlated pass cannot guarantee (correlated edges run last and can
    otherwise re-violate a cap set earlier in the topo pass).
    """
    site_cols = [c for c in CANCER_SITE_PREVALENCE if any(c in row for row in rows[:1])]

    for profile in rows:
        # mobility/ECOG vs functional scores (ADL, IADL, global performance)
        if profile.get("mobility") == "Bedridden" and "ecog_performance_status" in profile:
            profile["ecog_performance_status"] = max(profile["ecog_performance_status"], 3)
        severe = profile.get("mobility") == "Bedridden" or profile.get("ecog_performance_status", 0) >= 3
        if severe:
            if "instrumental_autonomy_iadl" in profile:
                profile["instrumental_autonomy_iadl"] = min(profile["instrumental_autonomy_iadl"], 2.0)
            if "global_performance_status" in profile:
                profile["global_performance_status"] = min(profile["global_performance_status"], 4.0)
            if "functional_autonomy_adl" in profile:
                profile["functional_autonomy_adl"] = min(profile["functional_autonomy_adl"], 20.0)

        # ECOG 0 (fully active) mutually exclusive with severe mobility impairment / low ADL
        if profile.get("ecog_performance_status") == 0:
            if profile.get("mobility") in ("Wheelchair", "Bedridden"):
                profile["mobility"] = "Autonomous"
            if "functional_autonomy_adl" in profile:
                profile["functional_autonomy_adl"] = max(profile["functional_autonomy_adl"], 90.0)

        # cognitive/communication impairment vs ADL/IADL caps
        # (takes precedence over the ECOG-0 floor above when both conditions co-occur)
        mmse_raw = profile.get("cognitive_function_mmse")
        comm = profile.get("communication_capacity")
        if (mmse_raw is not None and mmse_raw <= 12) or comm in ("Gestural only", "No verbal communication"):
            if "functional_autonomy_adl" in profile:
                profile["functional_autonomy_adl"] = min(profile["functional_autonomy_adl"], 40.0)
            if "instrumental_autonomy_iadl" in profile:
                profile["instrumental_autonomy_iadl"] = min(profile["instrumental_autonomy_iadl"], 2.0)

        # hierarchy: IADL (0-8 scale) cannot exceed ADL (0-100 scale) once both expressed as %
        if "instrumental_autonomy_iadl" in profile and "functional_autonomy_adl" in profile:
            iadl_pct = profile["instrumental_autonomy_iadl"] / 8.0 * 100.0
            if iadl_pct > profile["functional_autonomy_adl"]:
                profile["instrumental_autonomy_iadl"] = profile["functional_autonomy_adl"] / 100.0 * 8.0

        # communication capacity / sedation vs MMSE (test requires verbal interaction);
        # NaN only ever set alongside the explicit mmse_unevaluable flag
        if "cognitive_function_mmse" in profile:
            sedation = profile.get("sedation_level", 0)
            if comm == "No verbal communication":
                profile["cognitive_function_mmse"] = None
                profile["mmse_unevaluable"] = "Yes"
            else:
                profile["mmse_unevaluable"] = "No"
                if comm == "Gestural only":
                    profile["cognitive_function_mmse"] = min(profile["cognitive_function_mmse"], 10)
                elif comm == "Limited verbal":
                    profile["cognitive_function_mmse"] = min(profile["cognitive_function_mmse"], 22)
                elif sedation >= 5:
                    profile["cognitive_function_mmse"] = min(profile["cognitive_function_mmse"], 20)

        # psychoactive medication requires a formal diagnosis or a psychiatric comorbidity
        if profile.get("psychoactive_medication") not in (None, "None"):
            no_basis = (
                profile.get("depressive_diagnosis_dsm5") == "No formal diagnosis"
                and profile.get("psychiatric_comorbidities") == "None"
            )
            if no_basis:
                profile["psychoactive_medication"] = "None"

        # opioid use vs opioid-induced constipation
        if profile.get("opioid_use") == "No" and "opioid_induced_constipation" in profile:
            profile["opioid_induced_constipation"] = 0

        # sedation requires a pharmacological driver (opioid or psychoactive medication)
        if (
            profile.get("opioid_use") == "No"
            and profile.get("psychoactive_medication") in (None, "None")
            and "sedation_level" in profile
        ):
            profile["sedation_level"] = min(profile["sedation_level"], 3)

        # episode type must desynchronize-proof against 'No formal diagnosis'
        if profile.get("depressive_diagnosis_dsm5") == "No formal diagnosis" and "depressive_episode_type" in profile:
            profile["depressive_episode_type"] = "None"

        # depressive severity index vs formal DSM-5 diagnosis
        if "depression_severity_index" in profile:
            dx = profile.get("depressive_diagnosis_dsm5")
            floor = {
                "Major depressive disorder": 0.50,
                "Dysthymia (persistent depressive disorder)": 0.10,
            }.get(dx)
            if floor is not None:
                if profile["depression_severity_index"] < floor:
                    profile["depression_severity_index"] = floor
            elif dx == "No formal diagnosis":
                profile["depression_severity_index"] = 0.0

        # bedridden / non-verbal patients cannot lack a caregiver
        if (
            profile.get("mobility") == "Bedridden"
            or profile.get("communication_capacity") == "No verbal communication"
        ) and profile.get("caregiver_type") == "None identified":
            profile["caregiver_type"] = rng.choices(
                ["Direct family", "Professional caregiver", "Volunteer"],
                weights=[0.65, 0.2, 0.05],
                k=1,
            )[0]

        # living environment vs caregiver contact frequency (institutional settings aren't "at home")
        if profile.get("living_environment") in ("Clinic", "Nursing home"):
            if profile.get("caregiver_contact_frequency") == "24/7 at home":
                profile["caregiver_contact_frequency"] = "Daily visits"
        if profile.get("caregiver_type") == "None identified" and "caregiver_contact_frequency" in profile:
            profile["caregiver_contact_frequency"] = "Sporadic contact"

        # bedridden / ECOG 4 patients cannot live alone without round-the-clock care
        severe_dependency = profile.get("mobility") == "Bedridden" or profile.get("ecog_performance_status") == 4
        if (
            severe_dependency
            and profile.get("living_environment") == "Living alone"
            and profile.get("caregiver_contact_frequency") != "24/7 at home"
        ):
            profile["living_environment"] = "Family home"

        # caregiver burnout as a function of contact frequency and patient dependency (soft correlation)
        if "caregiver_burnout_zarit" in profile and "functional_autonomy_adl" in profile:
            freq_weight = {
                "24/7 at home": 1.0,
                "Daily visits": 0.7,
                "Weekly visits": 0.4,
                "Sporadic contact": 0.2,
            }.get(profile.get("caregiver_contact_frequency"), 0.5)
            dependency = 100.0 - profile["functional_autonomy_adl"]
            burnout_target = freq_weight * dependency * 0.88
            profile["caregiver_burnout_zarit"] = _clip(
                0.5 * profile["caregiver_burnout_zarit"] + 0.5 * burnout_target, 0, 88
            )

        # gender-specific biological exclusion (ovary/cervix/uterus require female anatomy)
        if profile.get("gender") == "Male" and "cancer_type_gynecological" in profile:
            profile["cancer_type_gynecological"] = "No"

        # exactly one active primary cancer site (single-primary plausibility, no CUP node modeled)
        if site_cols:
            active = [c for c in site_cols if profile.get(c) == "Yes"]
            if len(active) == 0:
                candidates = [
                    c for c in site_cols
                    if not (c == "cancer_type_gynecological" and profile.get("gender") == "Male")
                ]
                weights = [CANCER_SITE_PREVALENCE[c] for c in candidates]
                chosen = rng.choices(candidates, weights=weights, k=1)[0]
                profile[chosen] = "Yes"
            elif len(active) > 1:
                keep = rng.choice(active)
                for c in active:
                    if c != keep:
                        profile[c] = "No"

        # somatic symptom cluster antagonism (hypersomnia vs insomnia, agitation vs drowsiness)
        cluster = profile.get("somatic_symptoms_cluster")
        if "insomnia_severity" in profile:
            if cluster == "Hypersomnia":
                profile["insomnia_severity"] = min(profile["insomnia_severity"], 2.9)
            elif cluster == "Insomnia":
                profile["insomnia_severity"] = max(profile["insomnia_severity"], 3.0)
        if cluster == "Psychomotor agitation" and "drowsiness" in profile:
            profile["drowsiness"] = min(profile["drowsiness"], 6.0)

        # antiemetic coverage should track nausea severity (soft correlation)
        p = 0.0
        if profile.get("opioid_use") == "Yes" and profile.get("nausea_vomiting", 0) > 5.0:
            p = max(p, 0.9)
        if profile.get("nausea_vomiting", 0) >= 8:
            p = max(p, 0.85)
        if p > 0 and profile.get("antiemetic_use") == "No" and rng.random() < p:
            profile["antiemetic_use"] = "Yes"

    return rows


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
                if src_node["type"] in REQUIRED_CATEGORY_TYPES:
                    src_val = src_node["categories"].index(src_val)
                value = _apply_formula(edge["formula"], src_val, edge.get("weight", 0), value)

            profile[nid] = _clip_to_node(node, value)

        for edge in edges:
            if edge.get("relationType") != "correlated":
                continue
            src_node = node_by_id[edge["source"]]
            tgt_node = node_by_id[edge["target"]]
            src_val = profile[edge["source"]]
            if src_node["type"] in REQUIRED_CATEGORY_TYPES:
                cats = src_node["categories"]
                src_val = src_node["categories"].index(src_val) - (len(cats) - 1) / 2
            delta = src_val * edge.get("weight", 0)

            tgt_val = profile[edge["target"]]
            if tgt_node["type"] in REQUIRED_CATEGORY_TYPES:
                cats = tgt_node["categories"]
                idx = cats.index(tgt_val)
                idx = int(round(_clip(idx + delta, 0, len(cats) - 1)))
                tgt_val = cats[idx]
            else:
                tgt_val = tgt_val + delta

            profile[edge["target"]] = _clip_to_node(tgt_node, tgt_val)

        rows.append(profile)

    rows = apply_hard_constraints(rows, rng)

    return rows


def _clip_to_node(node, value):
    ntype = node["type"]
    if ntype in REQUIRED_RANGE_TYPES:
        lo, hi = node["range"]
        value = _clip(value, lo, hi)
        if ntype == "ordinal":
            value = round(value)
    return value


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
