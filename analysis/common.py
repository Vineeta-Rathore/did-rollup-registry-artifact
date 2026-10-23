# SPDX-License-Identifier: MIT
"""Shared data access and filters for paper_numbers.py and make_figures.py, so that every
number in the text and every point in a figure comes from the same rows.

Filters applied everywhere:
 - did_compress: the first ERC-1056 write of each network run initialises the registry's
   `changed` pointer (about 17.1 kgas extra) and is excluded from per-payload medians.
 - did_l2_measured: only rows after the last deployment of each network (the canonical pair).
 - did_history*: rows are de-duplicated by (net, design, method, H, round), keeping the last
   (a restarted checkpoint re-measures every round); latency statistics use correct
   resolutions only (`ok` true), and the number of excluded rows is reported.
 - did_resolver_versions: only the latest complete run.
"""
import json, os, random, sys
from statistics import median
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
P = [32, 64, 128, 256]
H = [2, 4, 8, 16, 32, 64]


def data_dir(argv):
    if len(argv) > 1 and not argv[1].startswith("--"):
        return argv[1]
    for d in (os.path.join(HERE, "..", "data"), os.path.join(HERE, "data")):
        if os.path.isdir(d):
            return d
    sys.exit("data directory not found; pass it as the first argument")


def load(D, name, required=True):
    p = os.path.join(D, name)
    if not os.path.exists(p):
        if required:
            sys.exit(f"missing data file: {p}")
        return []
    with open(p, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def pct(xs, q):
    """Linear-interpolated percentile (numpy's default)."""
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q / 100
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def boot_ci(xs, b=5000, seed=7):
    rng = random.Random(seed)
    ms = sorted(median(rng.choices(xs, k=len(xs))) for _ in range(b))
    return ms[int(0.025 * b)], ms[int(0.975 * b)]


def ols(x, y):
    n = len(x); mx = sum(x) / n; my = sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    slope = sum((a - mx) * (c - my) for a, c in zip(x, y)) / sxx
    return slope, my - slope * mx


# ---------------------------------------------------------------- RQ1: local lifecycle gas
def local_gas(D):
    rows = [r for r in load(D, "did_gas_local.jsonl") if r.get("op")]
    def gmed(design, op, p=0):
        v = [r["gasUsed"] for r in rows if r["design"] == design and r["op"] == op and r["payload"] == p]
        return median(v) if v else None
    return gmed


# ---------------------------------------------------------------- RQ2: July receipts
def july_rows(D):
    """Rows sent to the canonical registry pair: those after the last deployment per network."""
    rows = load(D, "did_l2_measured.jsonl")
    out, cur = [], {}
    for i, r in enumerate(rows):
        if r.get("deploy"):
            cur[r["net"]] = i
    for i, r in enumerate(rows):
        if r.get("op") and i > cur.get(r["net"], -1):
            out.append(r)
    return out


def july_row(rows, net, design, op, payload):
    c = [r for r in rows if r["net"] == net and r["design"] == design and r["op"] == op and r["payload"] == payload]
    assert len(c) == 1, (net, design, op, payload, len(c))
    return c[0]


def july_prices(rows):
    pb = [int(r["l1Fee"]) / (int(r["l1GasUsed"]) / 16) for r in rows if r["net"] == "opSepolia" and r.get("l1Fee")]
    l2 = [int(r["effectiveGasPriceWei"]) for r in rows if r["net"] == "opSepolia"]
    return median(pb), median(l2), (min(pb), max(pb))


# ---------------------------------------------------------------- RQ2: compressibility sweep
def compress_cells(D):
    rows = [r for r in load(D, "did_compress.jsonl") if r.get("op") == "setAttribute"]
    first = {}
    for r in rows:                              # first ERC-1056 write per network = pointer initialisation
        if r.get("firstWrite") or (r["design"] == "erc1056" and r["net"] not in first and "firstWrite" not in r):
            first.setdefault(r["net"], r["txHash"])
    cells = defaultdict(list)
    for r in rows:
        if first.get(r["net"]) != r["txHash"]:
            cells[(r["net"], r["design"], r["kind"], r["payload"])].append(r)
    return cells, first


def charged_size(cells, kind, p, net="opSepolia"):
    xs = cells[(net, "erc1056", kind, p)] + cells[(net, "storage", kind, p)]
    return median(int(x["l1GasUsed"]) for x in xs) / 16


def gas(cells, kind, p, design, net="opSepolia"):
    return median(x["gasUsed"] for x in cells[(net, design, kind, p)])


def premium(g_erc, g_sto, size, price_per_byte, l2_price):
    """Eq. (1)-(2): returns (fee premium, L1 data share of the ERC-1056 fee)."""
    d = size * price_per_byte
    f_erc, f_sto = g_erc * l2_price + d, g_sto * l2_price + d
    return f_sto / f_erc, d / f_erc


# ---------------------------------------------------------------- RQ2: mainnet sample
def mainnet(D):
    rows = load(D, "did_mainnet_snapshot_24h.jsonl", required=False)
    label = "24-hour sample"
    if not rows:
        rows, label = load(D, "did_mainnet_snapshot.jsonl"), "36-second snapshot (superseded)"
    op = [r for r in rows if r.get("net") == "opMainnet" and int(r.get("l1GasUsed", 0) or 0) > 0]
    arb = [r for r in rows if r.get("net") == "arbOne" and "gasUsedForL1" in r]
    c = [int(r["l1Fee"]) / (int(r["l1GasUsed"]) / 16) for r in op]
    egp = [int(r["effectiveGasPriceWei"]) for r in op]
    out = {"label": label, "n_op": len(op), "n_arb": len(arb),
           "blocks_op": sorted(set(r["block"] for r in op)), "times": sorted(r.get("blockTime", "") for r in op if r.get("blockTime")),
           "c_median": median(c), "c_p25": pct(c, 25), "c_p75": pct(c, 75),
           "base_median": median(int(r["baseFeeWei"]) for r in op),
           "egp": egp, "egp_p10": pct(egp, 10), "egp_p50": pct(egp, 50), "egp_p90": pct(egp, 90),
           "missed": [r for r in rows if r.get("missed")]}
    nz = [r for r in arb if int(r["gasUsedForL1"]) > 0]
    out["arb_nonzero"] = len(nz)
    out["arb_share_median"] = median(int(r["gasUsedForL1"]) / int(r["gasUsed"]) for r in nz) if nz else None
    return out


# ---------------------------------------------------------------- RQ3: history sweep
def history_cells(D, fname):
    rows = [r for r in load(D, fname) if r.get("method") and r.get("H") is not None and r.get("round") is not None]
    last = {}
    for r in rows:                              # keep the last measurement of each (cell, round)
        last[(r["net"], r.get("design"), r["method"], r["H"], r["round"])] = r
    cells = defaultdict(list)
    for (net, design, method, h, _), r in last.items():
        cells[(net, design, method, h)].append(r)
    return cells, len(rows) - len(last)


def ok_ms(rows):
    return [r["ms"] for r in rows if r.get("ok") and r.get("ms") is not None]


# ---------------------------------------------------------------- Table II
def latest_versions(D):
    rows = load(D, "did_resolver_versions.jsonl")
    runs = sorted(set(r.get("run") for r in rows if r.get("run")))
    return [r for r in rows if r.get("run") == runs[-1]] if runs else rows
