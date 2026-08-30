#!/usr/bin/env python3
"""Differential-test src/core/model/validate.ts against a reference validator.

src/core/model/validate.ts is hand-written, because the browser bundle carries
no dependencies (REQ-DATA-7) and the test run has no build step (REQ-TEST-2).
Hand-written means it can be wrong in the one direction that matters: silently
accepting a model GSSK will reject. This tool is the evidence that it is not.

It mutates every model in GSSK's own normative corpora plus this repository's
reference diagrams, runs both validators over the results, and reports any case
where they disagree about accept-versus-reject.

The two do not agree on error *paths*, by design. `jsonschema` anchors an
additionalProperties or required failure at the containing object;
validate.ts anchors it at the offending key, because naming the key is the
whole point (REQ-KERN-3). So a path of ours is accepted when it equals a
jsonschema path or refines one by exactly one token.

Dev-only. Not part of `node --test`, and CI does not run it: it needs Python and
`jsonschema`, and the point of the hand-written validator is that the shipped
gate needs neither. Run it when the vendored schema is re-vendored from a new
GSSK release, and record the result in the ADR.

    python3 tools/xcheck-validator.py --gssk ../GSSK

Exit codes: 0 the validators agree, 1 they do not, 2 the harness could not run.
"""
import argparse
import copy
import glob
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA = os.path.join(REPO, "src", "core", "model", "gssk.schema.json")
MUTATIONS = ("addkey", "addunderscore", "retype", "dropreq",
             "badenum", "badnum", "longstr", "nullify")

DRIVER = r"""
import { readFileSync, writeFileSync } from 'node:fs';
import { validateModel } from '%s';
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'));
writeFileSync(process.argv[3], JSON.stringify(cases.map((m) => {
  // nodeType is a kernel-parity rule the schema does not express, so a
  // reference JSON Schema validator cannot be expected to report it.
  const errors = validateModel(m).errors.filter((e) => e.keyword !== 'nodeType');
  return [...new Set(errors.map((e) => e.path))].sort();
})));
"""


def locations(node, out=None):
    """Every (key, containing-object) pair in a document."""
    out = [] if out is None else out
    if isinstance(node, dict):
        for key, value in node.items():
            out.append((key, node))
            locations(value, out)
    elif isinstance(node, list):
        for value in node:
            locations(value, out)
    return out


def mutate(model, rnd):
    m = copy.deepcopy(model)
    where = locations(m)
    if not where:
        return None
    key, parent = rnd.choice(where)
    kind = rnd.choice(MUTATIONS)
    if kind == "addkey":               parent["zzStray"] = 1
    elif kind == "addunderscore":      parent["_note"] = "annotation"
    elif kind == "retype":             parent[key] = "storge" if key == "type" else 12345
    elif kind == "dropreq":            parent.pop(key, None)
    elif kind == "badenum":            parent[key] = "not_a_member"
    elif kind == "badnum":             parent[key] = -1e9
    elif kind == "longstr":            parent[key] = "x" * 200
    elif kind == "nullify":            parent[key] = None
    return m


def corpora(gssk):
    paths = []
    for pattern in ("examples/*.json", "tests/schema_fixtures/*.json"):
        paths += sorted(glob.glob(os.path.join(gssk, pattern)))
    paths += sorted(glob.glob(os.path.join(REPO, "docs", "diagrams", "*.json")))
    return paths


def parent_pointer(pointer):
    return pointer.rsplit("/", 1)[0] if "/" in pointer else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gssk", default=os.path.join(os.path.dirname(REPO), "GSSK"),
                    help="path to a GSSK checkout (default: ../GSSK)")
    ap.add_argument("--per-model", type=int, default=30)
    ap.add_argument("--seed", type=int, default=20260829)
    ap.add_argument("--node", default="node")
    args = ap.parse_args()

    try:
        from jsonschema import Draft202012Validator
    except ImportError:
        print("SKIPPED: python3 -m pip install jsonschema  (not installed)")
        return 2
    if shutil.which(args.node) is None:
        print(f"SKIPPED: '{args.node}' is not on PATH")
        return 2

    sources = corpora(args.gssk)
    if not sources:
        print(f"ERROR: no models found under {args.gssk}")
        return 2

    schema = json.load(open(SCHEMA))
    Draft202012Validator.check_schema(schema)
    reference = Draft202012Validator(schema)

    rnd = random.Random(args.seed)
    cases = []
    for path in sources:
        model = json.load(open(path))
        cases.append(model)                       # the unmutated model too
        for _ in range(args.per_model):
            m = mutate(model, rnd)
            if m is not None:
                cases.append(m)

    expected = [
        sorted({"/" + "/".join(str(t) for t in e.absolute_path) if e.absolute_path else ""
                for e in reference.iter_errors(m)})
        for m in cases
    ]

    with tempfile.TemporaryDirectory() as tmp:
        driver = os.path.join(tmp, "driver.mjs")
        cases_json, ours_json = os.path.join(tmp, "cases.json"), os.path.join(tmp, "ours.json")
        with open(driver, "w") as fh:
            fh.write(DRIVER % os.path.join(REPO, "src", "core", "model", "validate.ts"))
        json.dump(cases, open(cases_json, "w"))
        run = subprocess.run([args.node, driver, cases_json, ours_json],
                             capture_output=True, text=True)
        if run.returncode != 0:
            print("ERROR: the node driver failed\n" + run.stderr)
            return 2
        actual = json.load(open(ours_json))

    verdicts = [i for i in range(len(cases)) if bool(expected[i]) != bool(actual[i])]
    unexplained = [
        (i, p) for i in range(len(cases)) for p in actual[i]
        if p not in expected[i] and parent_pointer(p) not in expected[i]
    ]
    missed = [
        (i, p) for i in range(len(cases)) for p in expected[i]
        if p not in actual[i] and not any(parent_pointer(q) == p for q in actual[i])
    ]

    rejected = sum(1 for e in expected if e)
    print(f"models   {len(sources)}")
    print(f"cases    {len(cases)}  ({rejected} rejected, {len(cases) - rejected} accepted)")
    print(f"verdict disagreements        {len(verdicts)}")
    print(f"paths of ours not explained  {len(unexplained)}")
    print(f"paths of theirs we missed    {len(missed)}")

    for label, rows in (("VERDICT", [(i, "") for i in verdicts]),
                        ("UNEXPLAINED", unexplained), ("MISSED", missed)):
        for i, p in rows[:10]:
            print(f"  {label} case {i} {p}\n    reference: {expected[i]}\n    ours:      {actual[i]}")

    if verdicts or unexplained or missed:
        return 1
    print("\nOK — the validators agree on every case.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
