#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Copy measurement JSONL from a build directory into data/, replacing any URL inside
error/message text with "<url>" (RPC URLs can carry API keys), then refuse to finish if
any URL remains, and write data/SHA256SUMS.  Usage: python vendor_data.py <build_dir> [names...]"""
import hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
URL = re.compile(r"https?://[^\s\"',)}\]]+")
TEXT_FIELDS = ("error", "message", "missed")


def clean(row):
    for k in TEXT_FIELDS:
        if isinstance(row.get(k), str):
            row[k] = URL.sub("<url>", row[k])
    return row


def main():
    build, names = sys.argv[1], sys.argv[2:]
    if not names:
        names = sorted(f[:-6] for f in os.listdir(build) if f.startswith("did_") and f.endswith(".jsonl") and "smoke" not in f)
    for n in names:
        src = os.path.join(build, n + ".jsonl")
        with open(src, encoding="utf-8") as f:
            rows = [clean(json.loads(l)) for l in f if l.strip()]
        with open(os.path.join(DATA, n + ".jsonl"), "w", encoding="utf-8", newline="\n") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
        print(f"vendored {n}.jsonl ({len(rows)} rows)")
    bad = []
    for f in sorted(os.listdir(DATA)):
        if f.endswith(".jsonl") and URL.search(open(os.path.join(DATA, f), encoding="utf-8").read()):
            bad.append(f)
    if bad:
        sys.exit(f"URL found after cleaning in {bad}; not publishing")
    with open(os.path.join(DATA, "SHA256SUMS"), "w", encoding="utf-8", newline="\n") as out:
        for f in sorted(os.listdir(DATA)):
            if f.endswith(".jsonl"):
                out.write(hashlib.sha256(open(os.path.join(DATA, f), "rb").read()).hexdigest() + "  " + f + "\n")
    print("no URLs in data/; wrote data/SHA256SUMS")


if __name__ == "__main__":
    main()
