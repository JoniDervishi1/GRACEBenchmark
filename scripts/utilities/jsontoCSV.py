"""
Convert the load/update JSON files produced by workloadGenerator.py into CSV plus
side files used by the benchmark.

Usage: python jsontoCSV.py <vertices.json> <edges.json>

For each input file X.json this writes:
  X.csv          all columns, INCLUDING the label column (xlabel / _label), which the
                 generated Cypher uses to route each row to its label
  X.loaded       one _id per line
  X.keys         property keys only (the label column is NOT listed, it is not a property)
  X.labels.json  per-label schema: row count and which keys are always / sometimes present.
                 Input for generatePreloadMemgraph.py

Labels come from the dataset itself:
  vertices -> "xlabel"
  edges    -> "_label"
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

VERTEX_LABEL_KEY = "xlabel"
EDGE_LABEL_KEY = "_label"


def json_to_csv_and_ids(json_file, csv_file, ids_file, keys_file, labels_file, id_key, label_key):
    with open(json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        raise ValueError(f"Expected a list of objects in {json_file}, got {type(data)}")

    # Union of keys across all objects (CSV columns)
    all_keys = sorted({k for obj in data for k in obj.keys()})
    if label_key not in all_keys:
        raise ValueError(f"No '{label_key}' key found in {json_file}")
    property_keys = [k for k in all_keys if k != label_key]

    # Per-label statistics
    row_count = defaultdict(int)
    key_count = defaultdict(lambda: defaultdict(int))
    for row in data:
        if id_key not in row:
            raise ValueError(f"Row missing expected ID key '{id_key}': {row}")
        label = row.get(label_key)
        if label is None or str(label) == "":
            raise ValueError(f"Row missing label key '{label_key}': {row}")
        label = str(label)
        row_count[label] += 1
        for k, v in row.items():
            if v is not None:
                key_count[label][k] += 1

    schema = {}
    for label in sorted(row_count):
        n = row_count[label]
        keys = sorted(k for k in key_count[label] if k != label_key)
        schema[label] = {
            "count": n,
            "always": [k for k in keys if key_count[label][k] == n],
            "sometimes": [k for k in keys if key_count[label][k] < n],
        }

    # Property keys only (labels are not properties)
    with open(keys_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        for key in property_keys:
            writer.writerow([key])

    with open(labels_file, "w", encoding="utf-8") as f:
        json.dump({"label_key": label_key, "id_key": id_key, "labels": schema}, f, indent=2)

    with open(csv_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=all_keys)
        writer.writeheader()
        for row in data:
            writer.writerow(row)

    with open(ids_file, "w", encoding="utf-8") as f:
        for row in data:
            f.write(f"{row[id_key]}\n")

    print(f"✅ Converted {json_file} → {csv_file}: {len(data)} rows, {len(all_keys)} columns, "
          f"{len(schema)} labels ({label_key})")
    for label, s in schema.items():
        print(f"     {label}: {s['count']}")
    print(f"✅ IDs → {ids_file}, property keys → {keys_file}, label schema → {labels_file}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python jsontoCSV.py vertices.json edges.json")
        sys.exit(1)

    for json_path, label_key in ((sys.argv[1], VERTEX_LABEL_KEY), (sys.argv[2], EDGE_LABEL_KEY)):
        p = Path(json_path)
        json_to_csv_and_ids(
            json_path,
            p.with_suffix(".csv"),
            p.with_suffix(".loaded"),
            p.with_suffix(".keys"),
            p.with_suffix(".labels.json"),
            id_key="_id",
            label_key=label_key,
        )