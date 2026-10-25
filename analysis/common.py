# SPDX-License-Identifier: MIT
"""Shared data access and filters for paper_numbers.py and make_figures.py, so that every
number in the text and every point in a figure comes from the same rows.

Filters applied everywhere:
 - did_gas_steady: median over three runs on separate identities, per (design, op, phase, payload).
 - did_compress: the first ERC-1056 write on a network also initialises the registry's `changed`
   pointer (about 17,100 gas extra). It is identified by its gas (more than 10,000 above the minimum
   of its cell), not by file order, and excluded from per-payload medians.
 - did_l2_measured: only rows after the last deployment of each network (the canonical pair).
 - did_history*: rows are de-duplicated by (net, design, method, H, round), keeping the last
   (a restarted checkpoint re-measures every round); latency statistics use correct
   resolutions only (`ok` true), and the number of excluded rows is reported.
 - did_resolve_methods: correct resolutions only; calls are medians.
 - did_resolver_versions: the latest run without endpoint failures.
"""
import json, os, random, sys
from statistics import median
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
P = [32, 64, 128, 256]
H = [2, 4, 8, 16, 32, 64]
TIP_DEFAULT = 1_000_000          # wei: the priority fee that our own clients paid on OP (July 2026 receipts)


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


# ---------------------------------------------------------------- RQ1: gas by phase (local EVM)
def steady(D):
    """Median gas per (design, op, phase, payload) from did_gas_steady.jsonl (three runs each)."""
    cells = defaultdict(list)
    for r in load(D, "did_gas_steady.jsonl"):
        cells[(r["design"], r["op"], r["phase"], r["payload"])].append(r["gasUsed"])
    def g(design, op, phase, payload=0):
        v = cells.get((design, op, phase, payload))
        assert v and len(v) == 3, (design, op, phase, payload, v)
        return median(v)
    return g


def erc_replace(g, p):
    """ERC-1056 has no replace: a new value is a setAttribute plus a revokeAttribute of the old one."""
    return g("erc1056", "setAttribute", "again", p) + g("erc1056", "revokeAttribute", "again", p)


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


def price_per_byte(r):
    """L1 price per charged byte of one OP receipt: l1Fee / (l1GasUsed / 16)."""
    return int(r["l1Fee"]) / (int(r["l1GasUsed"]) / 16)


def july_point(rows):
    """Prices of the July ERC-1056 256-byte receipt (point A): (L1 wei per charged byte, L2 gas price in wei)."""
    e = july_row(rows, "opSepolia", "erc1056", "setAttribute", 256)
    return price_per_byte(e), int(e["effectiveGasPriceWei"])


# ---------------------------------------------------------------- RQ2: compressibility sweep and real transactions
def compress_cells(D):
    rows = [r for r in load(D, "did_compress.jsonl") if r.get("op") == "setAttribute"]
    raw = defaultdict(list)
    for r in rows:
        raw[(r["net"], r["design"], r["kind"], r["payload"])].append(r)
    cells, init = {}, defaultdict(list)
    for k, v in raw.items():
        if k[1] == "erc1056":                   # drop the write that also initialised the pointer
            lo = min(x["gasUsed"] for x in v)
            cells[k] = [x for x in v if x["gasUsed"] - lo <= 10000]
            init[k[0]] += [x["gasUsed"] - lo for x in v if x["gasUsed"] - lo > 10000]
        else:
            cells[k] = v
    return cells, dict(init)


def charged_size(cells, kind, p, net="opSepolia"):
    xs = cells[(net, "erc1056", kind, p)] + cells[(net, "storage", kind, p)]
    return median(int(x["l1GasUsed"]) for x in xs) / 16


def gas(cells, kind, p, design, net="opSepolia"):
    return median(x["gasUsed"] for x in cells[(net, design, kind, p)])


def real_txs(D):
    """Measured OP Sepolia transactions of the October history run with real 33-byte secp256k1 keys:
    {(design, kind): [(gas, charged bytes), ...]} for set-key (first write and replacements) and revoke-key."""
    out = defaultdict(list)
    for r in load(D, "did_history_tx_v2.jsonl"):
        if r.get("net") != "opSepolia" or not r.get("l1GasUsed") or not r.get("tag"):
            continue
        t = r["tag"]
        kind = ("first" if t == "set-key0" else "set" if t.startswith("set-key") else
                "revoke" if t.startswith("revoke-key") else "svc" if t == "set-svc" else None)
        if kind:
            out[(r["design"], kind)].append((r["gasUsed"], int(r["l1GasUsed"]) / 16))
    return out


def med_tx(lst):
    return (median(g for g, _ in lst), median(s for _, s in lst))


def tasks(D):
    """Fee-model inputs per task, from measured OP Sepolia transactions: {task: (erc_txs, sto_txs)} with
    each tx = (gas, charged bytes). Replacement = ERC-1056 set + revoke (two transactions) against one
    storage overwrite."""
    rt = real_txs(D)
    erc_set, erc_rev, sto_set = med_tx(rt[("erc1056", "set")]), med_tx(rt[("erc1056", "revoke")]), med_tx(rt[("storage", "set")])
    erc_first, sto_first = med_tx(rt[("erc1056", "first")]), med_tx(rt[("storage", "first")])
    cells, _ = compress_cells(D)
    big = (gas(cells, "rnd", 256, "erc1056"), charged_size(cells, "rnd", 256)), (gas(cells, "rnd", 256, "storage"), charged_size(cells, "rnd", 256))
    return {"first_33": ([erc_first], [sto_first]),
            "first_256": ([big[0]], [big[1]]),
            "replace_33": ([erc_set, erc_rev], [sto_set])}


def task_fee(txs, c, p):
    """Eq. (1) summed over the transactions of a task: gas * L2 price + charged bytes * L1 price per byte."""
    return sum(g * p + s * c for g, s in txs)


def task_premium(task, c, p):
    erc, sto = task
    return task_fee(sto, c, p) / task_fee(erc, c, p)


def data_share(txs, c, p):
    d = sum(s * c for _, s in txs)
    return d / task_fee(txs, c, p)


def premium(g_erc, g_sto, size, price_per_byte_, l2_price):
    """Eq. (3) for a single transaction of equal size: returns (fee premium, L1 data share of the ERC-1056 fee)."""
    d = size * price_per_byte_
    f_erc, f_sto = g_erc * l2_price + d, g_sto * l2_price + d
    return f_sto / f_erc, d / f_erc


# ---------------------------------------------------------------- RQ2: mainnet sample
def mainnet(D):
    rows = load(D, "did_mainnet_snapshot_24h.jsonl", required=False)
    attempted = {r["round"] for r in rows or [] if r.get("net") == "opMainnet" and "round" in r}
    label = f"sample of {len(attempted)} half-hourly rounds"
    if not rows:
        rows, label = load(D, "did_mainnet_snapshot.jsonl"), "36-second snapshot (superseded)"
    op = [r for r in rows if r.get("net") == "opMainnet" and int(r.get("l1GasUsed", 0) or 0) > 0]
    arb = [r for r in rows if r.get("net") == "arbOne" and "gasUsedForL1" in r]
    if not op:
        sys.exit("no OP Mainnet rows in the mainnet sample")
    c = [price_per_byte(r) for r in op]
    egp = [int(r["effectiveGasPriceWei"]) for r in op]
    by_block = {r["block"]: int(r["baseFeeWei"]) for r in op}      # one base fee per block
    times = sorted(r["blockTime"] for r in op if r.get("blockTime"))
    out = {"label": label, "n_op": len(op), "n_arb": len(arb), "n_blocks": len(by_block),
           "rounds": len(set(r["round"] for r in op if "round" in r)), "times": times,
           "c": c, "egp": egp, "ops": op,
           "c_median": median(c), "c_p25": pct(c, 25), "c_p75": pct(c, 75),
           "base_median": median(by_block.values()),
           "egp_p10": pct(egp, 10), "egp_p50": pct(egp, 50), "egp_p90": pct(egp, 90),
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


def methods_cells(D):
    """Table III: resolution strategies at 64 events. Returns ({(net, method): rows}, {net: setup}).
    The file holds two sessions of the same protocol (20 interleaved rounds per network each), merged
    and ordered by timestamp; a `setup` row opens each session. Every result row is tagged
    r["session"] = 1 or 2 by the number of setup rows of its network that precede it, so that the
    sessions can be compared; the table pools both. `setup` keeps the latest setup row per network."""
    rows = sorted(load(D, "did_resolve_methods.jsonl", required=False), key=lambda r: r["ts"])
    cells, setup, opened = defaultdict(list), {}, defaultdict(int)
    for r in rows:
        if r.get("setup"):
            opened[r["net"]] += 1
            setup[r["net"]] = r["setup"]
        elif r.get("method"):
            r["session"] = max(1, opened[r["net"]])
            cells[(r["net"], r["method"])].append(r)
    return cells, setup


# ---------------------------------------------------------------- Table IV
def latest_versions(D):
    """Rows of the latest resolver-release run in which every result is a resolver result (no endpoint
    failures, truth available). Returns (rows, number of runs skipped)."""
    rows = load(D, "did_resolver_versions.jsonl")
    runs = sorted(set(r["run"] for r in rows if r.get("run")))
    skipped = 0
    for run in reversed(runs):
        rs = [r for r in rows if r.get("run") == run]
        if all(not r["verdict"].startswith(("INFRA", "UNKNOWN")) for r in rs) and len(rs) >= 24:
            return rs, skipped
        skipped += 1
    sys.exit("no complete resolver-release run in did_resolver_versions.jsonl")
