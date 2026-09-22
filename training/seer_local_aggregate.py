"""Run this LOCALLY, on the machine where your SEER export lives. Never
share the SEER file itself, a row-level excerpt, or run this against a copy
sent elsewhere — this script's whole purpose is to compute only aggregate,
small-cell-suppressed statistics so nothing else ever needs to touch the raw
data. Its output (printed + optionally a small JSON) is what you hand back —
not the file, not any row.

Produces marginal frequencies for the schema's real_data-tier fields plus two
new ones you asked for (chemotherapy, radiotherapy) that aren't wired into a
schema node yet — computed now so the numbers are ready when you decide how
to use them.

BEFORE RUNNING: edit the CONFIG block below to match your actual SEER export's
column headers — SEER*Stat exports vary by which fields/recodes you selected,
so this can't be guessed. Column names are typical SEER*Stat conventions
(e.g. "Site recode ICD-O-3/WHO 2008", "Chemotherapy recode (yes, no/unk)",
"Radiation recode", a "Derived AJCC Stage Group" edition) — verify against your
own file's header row before trusting the mapping.

CLI:
    python3 training/seer_local_aggregate.py /path/to/your/seer_export.csv
"""

import argparse
import csv
import json
import sys
from collections import Counter

# ============================================================================
# CONFIG — edit these to match your actual SEER export's column headers.
# Run once with --list-columns first if you're not sure of the exact names.
# ============================================================================
COLUMNS = {
    "site": "Site recode ICD-O-3/WHO 2008",
    "stage": "Derived AJCC Stage Group",           # pick whichever edition your export has
    "chemotherapy": "Chemotherapy recode (yes, no/unk)",
    "radiation": "Radiation recode",
}

# Minimum patient count for a category to be reported at all — categories
# below this are suppressed (printed as "<THRESHOLD, suppressed"), not
# silently dropped, so you can see suppression happened. Check your own DUA
# for its specific small-cell-suppression threshold and adjust if it differs.
MIN_CELL_COUNT = 11

# SEER's "Site recode ICD-O-3/WHO 2008" labels, mapped to this schema's 7
# cancer_type_* categories. This is the standard SEER site-recode category
# list, not this specific export — verify against --list-values output before
# trusting it; anything not listed here shows up as UNMAPPED, not silently
# dropped.
SITE_TO_SCHEMA_CATEGORY = {
    "Breast": "breast",
    "Lung and Bronchus": "lung",
    "Colon and Rectum": "gastrointestinal",
    "Stomach": "gastrointestinal",
    "Esophagus": "gastrointestinal",
    "Liver and Intrahepatic Bile Duct": "gastrointestinal",
    "Pancreas": "gastrointestinal",
    "Small Intestine": "gastrointestinal",
    "Urinary Bladder": "genitourinary",
    "Kidney and Renal Pelvis": "genitourinary",
    "Prostate": "genitourinary",
    "Testis": "genitourinary",
    "Corpus and Uterus, NOS": "gynecological",
    "Corpus Uteri": "gynecological",
    "Cervix Uteri": "gynecological",
    "Ovary": "gynecological",
    "Vulva": "gynecological",
    "Vagina": "gynecological",
    "Non-Hodgkin Lymphoma": "hematologic",
    "Hodgkin Lymphoma": "hematologic",
    "Leukemia": "hematologic",
    "Myeloma": "hematologic",
}
# Everything else (Melanoma, Head/Neck, Brain/CNS, Thyroid, Bone, Soft Tissue,
# Unknown Primary, etc.) falls to "other_site" by default below — matching the
# schema's cancer_type_other_site catch-all.


def stage_to_bucket(raw):
    """Same Roman-numeral logic as training/train_ecog_bn.py's stage_to_bucket
    — AJCC stage naming is standardized across registries, so this generalizes."""
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s.startswith("Stage") and not s.startswith("St "):
        return None
    code = s.split(" ", 1)[-1].strip() if " " in s else s
    if code.startswith("IV"):
        return "Terminal"
    if code.startswith("III"):
        return "Stage 3 (Advanced)"
    if code.startswith("II"):
        return "Stage 2 (Moderate)"
    if code.startswith("I"):
        return "Stage 1 (Mild)"
    return None


def site_to_schema_category(raw):
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    if raw in SITE_TO_SCHEMA_CATEGORY:
        return SITE_TO_SCHEMA_CATEGORY[raw]
    unknown_markers = ("unknown", "ill-defined", "not otherwise")
    if any(m in raw.lower() for m in unknown_markers):
        return None
    return "other_site"


def yes_no(raw):
    """Generic yes/no normalizer for chemo/radiation recode fields — SEER
    typically codes these as descriptive strings, not booleans. Adjust the
    marker lists below if your export uses different wording."""
    if not isinstance(raw, str):
        return None
    low = raw.strip().lower()
    if not low:
        return None
    no_markers = ("none", "no/unk", "unknown", "refused", "not recommended")
    if any(m in low for m in no_markers):
        return "No"
    return "Yes"


def suppressed_counter(counter, total, min_count):
    """Returns {category: pct} for categories >= min_count, plus a
    'suppressed_categories' count for anything below it — never the raw
    category names of suppressed cells, never their exact tiny counts."""
    kept = {k: v for k, v in counter.items() if v >= min_count}
    suppressed = [k for k, v in counter.items() if 0 < v < min_count]
    kept_total = sum(kept.values())
    return {
        "percentages": {k: round(v / total, 4) for k, v in sorted(kept.items(), key=lambda kv: -kv[1])},
        "suppressed_category_count": len(suppressed),
        "suppressed_patient_count_totaled": total - kept_total,  # aggregate only, no per-cell breakdown
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_path", help="path to your local SEER export (never shared, never leaves this machine)")
    parser.add_argument("--list-columns", action="store_true", help="print the CSV's column headers and exit (no data read)")
    parser.add_argument("--list-values", metavar="FIELD", help="print unique raw values + counts for one CONFIG field key (site/stage/chemotherapy/radiation) and exit — for verifying the mapping before trusting final output")
    parser.add_argument("--min-cell-count", type=int, default=MIN_CELL_COUNT)
    parser.add_argument("--json-out", default=None, help="optional: write the final aggregate result to this file too")
    args = parser.parse_args()

    with open(args.csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if args.list_columns:
            for col in reader.fieldnames:
                print(col)
            return

        if args.list_values:
            col = COLUMNS.get(args.list_values)
            if not col:
                sys.exit(f"unknown field key {args.list_values!r} — expected one of {list(COLUMNS)}")
            counts = Counter()
            for row in reader:
                counts[row.get(col, "")] += 1
            for val, n in counts.most_common():
                print(f"{n:>8}  {val!r}")
            return

        rows = list(reader)

    total = len(rows)
    print(f"Total records: {total}", file=sys.stderr)

    site_counts = Counter()
    stage_counts = Counter()
    chemo_counts = Counter()
    rad_counts = Counter()
    unmapped_sites = Counter()

    for row in rows:
        site_raw = row.get(COLUMNS["site"], "")
        site = site_to_schema_category(site_raw)
        if site is None and site_raw:
            unmapped_sites[site_raw] += 1
        elif site:
            site_counts[site] += 1

        stage = stage_to_bucket(row.get(COLUMNS["stage"], ""))
        if stage:
            stage_counts[stage] += 1

        chemo = yes_no(row.get(COLUMNS["chemotherapy"], ""))
        if chemo:
            chemo_counts[chemo] += 1

        rad = yes_no(row.get(COLUMNS["radiation"], ""))
        if rad:
            rad_counts[rad] += 1

    result = {
        "n_total": total,
        "min_cell_count": args.min_cell_count,
        "cancer_site": suppressed_counter(site_counts, sum(site_counts.values()) or 1, args.min_cell_count),
        "disease_stage": suppressed_counter(stage_counts, sum(stage_counts.values()) or 1, args.min_cell_count),
        "chemotherapy": suppressed_counter(chemo_counts, sum(chemo_counts.values()) or 1, args.min_cell_count),
        "radiation": suppressed_counter(rad_counts, sum(rad_counts.values()) or 1, args.min_cell_count),
        "unmapped_site_labels_count": len(unmapped_sites),
    }

    print(json.dumps(result, indent=2))

    if unmapped_sites:
        print(file=sys.stderr)
        print(
            f"NOTE: {sum(unmapped_sites.values())} records had a site label not in "
            "SITE_TO_SCHEMA_CATEGORY and weren't 'unknown' either — they fell through "
            "uncounted rather than being silently miscategorized. Run --list-values site "
            "to see what's in your file and extend the mapping if needed.",
            file=sys.stderr,
        )

    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(f"\nAlso wrote {args.json_out}", file=sys.stderr)


if __name__ == "__main__":
    main()
