#!/usr/bin/env python3
"""
Generate preloadMemgraph.cypher for the PreloadData folder.

RunBenchmark.sh copies the dataset files into PreloadData under fixed names:

    PreloadData/vertices.csv            (from <dataset>_load_vertices.csv)
    PreloadData/edges.csv               (from <dataset>_load_edges.csv)
    PreloadData/vertices.labels.json    (from <dataset>_load_vertices.labels.json)
    PreloadData/edges.labels.json       (from <dataset>_load_edges.labels.json)

This script reads the two .labels.json schemas (written by jsontoCSV.py) from that
folder and writes PreloadData/preloadMemgraph.cypher next to them. PreloadData is
mounted at /var/lib/memgraph/import in the Memgraph containers, so the generated
LOAD CSV statements point at /var/lib/memgraph/import/vertices.csv and
/var/lib/memgraph/import/edges.csv.

Vertices get the dataset's xlabel as their label, edges get the dataset's _label as
their type. Every other column becomes a property (plus `id`, copied from `_id`, which
GraceClient and the indexes use). The label columns themselves are not stored.

Usage:
  python generatePreloadMemgraph.py --preload-dir "$PRELOAD_DATA"

Notes
- Cypher cannot take a label from a variable, so one LOAD CSV pass is generated per
  label. Each pass re-reads the CSV and keeps only the rows of that label.
- Edge endpoints are not tagged with their label in the CSV, so each endpoint is looked
  up through the (label, id) index of every vertex label and the one that matches is used.
- The generated file contains NO comments. mgconsole splits piped input on ';' while tracking
  quotes, and an apostrophe in a '//' comment can open a string that swallows every
  following statement, so nothing runs and no error is shown. The script verifies the
  output with a comment-unaware splitter before writing it.
- All values are loaded as strings, the same as GraceClient sends them.
- A key that is missing for only some rows of a label is set only when the CSV cell is
  non-empty (a CSV cannot tell "" from absent). Keys present on every row are always set.
"""
import argparse
import csv
import json
import os
import sys

PRESERVED_INDEX_KEYS_VERTEX = ["id", "searchKey"]
PRESERVED_INDEX_KEYS_EDGE = ["id", "_outV", "_inV", "searchKey"]


def ident(s):
    """Backtick-quoted Cypher identifier."""
    return "`" + s.replace("`", "``") + "`"


def lit(s):
    """Single-quoted Cypher string literal."""
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def col(name):
    return "row." + ident(name)


def prop_block(var_clause, spec, label_key, id_key):
    """Return (map_literal, foreach_clauses) for the properties of one label."""
    assigns = [f"{ident('id')}: {col(id_key)}"]
    for k in spec["always"]:
        if k in ("id", label_key):
            continue
        assigns.append(f"{ident(k)}: {col(k)}")
    foreach = []
    for k in spec["sometimes"]:
        if k in ("id", label_key):
            continue
        foreach.append(
            f"FOREACH (x IN CASE WHEN {col(k)} <> '' THEN [1] ELSE [] END | "
            f"SET {var_clause}.{ident(k)} = {col(k)})"
        )
    return "{" + ", ".join(assigns) + "}", foreach


def split_statements(text):
    """Split like a quote-tracking splitter that does not understand comments (worst case)."""
    quote, esc, cur, stmts = None, False, [], []
    for ch in text:
        cur.append(ch)
        if quote:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch == ";":
            stmts.append("".join(cur).strip())
            cur = []
    return stmts, "".join(cur).strip()


def load_schema(path):
    if not os.path.isfile(path):
        sys.exit(f"ERROR: schema file not found: {path}\n"
                 f"       jsontoCSV.py writes it as <dataset>_load_*.labels.json; "
                 f"RunBenchmark.sh must copy it into the preload folder.")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check_csv_header(path, required):
    """If the CSV is already in place, make sure it has the columns the Cypher reads."""
    if not os.path.isfile(path):
        print(f"WARNING: {path} not found yet - header not checked")
        return
    with open(path, newline="", encoding="utf-8") as f:
        header = next(csv.reader(f), [])
    missing = [c for c in required if c not in header]
    if missing:
        sys.exit(f"ERROR: {path} has no column(s) {missing}; header is {header}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--preload-dir", default=os.environ.get("PRELOAD_DATA", "PreloadData"),
                    help="Folder holding vertices.csv, edges.csv and the .labels.json files, "
                         "and where preloadMemgraph.cypher is written (default: $PRELOAD_DATA or ./PreloadData)")
    ap.add_argument("--vertices-schema", default=None, help="default: <preload-dir>/vertices.labels.json")
    ap.add_argument("--edges-schema", default=None, help="default: <preload-dir>/edges.labels.json")
    ap.add_argument("--out", default=None, help="default: <preload-dir>/preloadMemgraph.cypher")
    ap.add_argument("--import-dir", default="/var/lib/memgraph/import",
                    help="Where the preload folder is mounted inside the Memgraph container")
    ap.add_argument("--vertex-csv", default="vertices.csv")
    ap.add_argument("--edge-csv", default="edges.csv")
    args = ap.parse_args()

    pre = args.preload_dir
    vs_path = args.vertices_schema or os.path.join(pre, "vertices.labels.json")
    es_path = args.edges_schema or os.path.join(pre, "edges.labels.json")
    out_path = args.out or os.path.join(pre, "preloadMemgraph.cypher")

    vs = load_schema(vs_path)
    es = load_schema(es_path)

    v_label_key, v_id_key, v_labels = vs["label_key"], vs["id_key"], vs["labels"]
    e_label_key, e_id_key, e_labels = es["label_key"], es["id_key"], es["labels"]
    vertex_csv = f"{args.import_dir}/{args.vertex_csv}"
    edge_csv = f"{args.import_dir}/{args.edge_csv}"

    check_csv_header(os.path.join(pre, args.vertex_csv), [v_label_key, v_id_key])
    check_csv_header(os.path.join(pre, args.edge_csv), [e_label_key, e_id_key, "_outV", "_inV"])

    out = []
    w = out.append

    w("")
    w("MATCH (n) DETACH DELETE n;")
    w("")

    for label in v_labels:
        w(f"CREATE INDEX ON :{ident(label)};")
        for k in PRESERVED_INDEX_KEYS_VERTEX:
            w(f"CREATE INDEX ON :{ident(label)}({ident(k)});")
    for label in e_labels:
        w(f"CREATE EDGE INDEX ON :{ident(label)};")
        for k in PRESERVED_INDEX_KEYS_EDGE:
            w(f"CREATE EDGE INDEX ON :{ident(label)}({ident(k)});")
    w("")

    for label, spec in v_labels.items():
        props, foreach = prop_block("n", spec, v_label_key, v_id_key)
        w(f'LOAD CSV FROM "{vertex_csv}" WITH HEADER AS row')
        w(f"WITH row WHERE {col(v_label_key)} = {lit(label)}")
        w(f"CREATE (n:{ident(label)} {props})")
        for fe in foreach:
            w(fe)
        w(";")
        w("")

    vlabels = list(v_labels)
    for label, spec in e_labels.items():
        props, foreach = prop_block("r", spec, e_label_key, e_id_key)
        w(f'LOAD CSV FROM "{edge_csv}" WITH HEADER AS row')
        w(f"WITH row WHERE {col(e_label_key)} = {lit(label)}")
        for i, vl in enumerate(vlabels):
            w(f"OPTIONAL MATCH (s{i}:{ident(vl)} {{id: {col('_outV')}}})")
        w("WITH row, coalesce(" + ", ".join(f"s{i}" for i in range(len(vlabels))) + ") AS a")
        for i, vl in enumerate(vlabels):
            w(f"OPTIONAL MATCH (t{i}:{ident(vl)} {{id: {col('_inV')}}})")
        w("WITH row, a, coalesce(" + ", ".join(f"t{i}" for i in range(len(vlabels))) + ") AS b")
        w("WHERE a IS NOT NULL AND b IS NOT NULL")
        w(f"CREATE (a)-[r:{ident(label)} {props}]->(b)")
        for fe in foreach:
            w(fe)
        w(";")
        w("")

    w("MATCH (n) RETURN count(n) AS vertex_count;")
    w("MATCH ()-[r]->() RETURN count(r) AS edge_count;")
    w("MATCH (n) UNWIND labels(n) AS label RETURN label, count(*) AS vertices ORDER BY label;")
    w("MATCH ()-[r]->() RETURN type(r) AS edge_type, count(*) AS edges ORDER BY edge_type;")

    text = "\n".join(out).strip() + "\n"
    expected = (1                                                     # clear database
                + len(v_labels) * (1 + len(PRESERVED_INDEX_KEYS_VERTEX))
                + len(e_labels) * (1 + len(PRESERVED_INDEX_KEYS_EDGE))
                + len(v_labels) + len(e_labels)                       # LOAD CSV passes
                + 4)                                                  # verification queries
    stmts, tail = split_statements(text)
    if len(stmts) != expected or tail:
        sys.exit(f"ERROR: generated file would split into {len(stmts)} statements (expected {expected}, "
                 f"{len(tail)} trailing chars). A stray quote in a label or key is likely.")

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(text)

    expected_v = sum(s["count"] for s in v_labels.values())
    expected_e = sum(s["count"] for s in e_labels.values())
    print(f"Wrote {out_path}: {len(v_labels)} vertex labels, {len(e_labels)} edge labels")
    print(f"Reads {vertex_csv} and {edge_csv}; {expected} statements, split check OK")
    print(f"Expect vertex_count={expected_v}, edge_count={expected_e}")


if __name__ == "__main__":
    main()