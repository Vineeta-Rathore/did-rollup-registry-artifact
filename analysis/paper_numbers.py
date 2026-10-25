#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Recompute every number quoted in the paper from the raw JSONL data.
Usage: python analysis/paper_numbers.py [data_dir]   (default: ../data)
Filters are defined once in common.py and shared with make_figures.py."""
import sys
from datetime import datetime
from statistics import median
from common import (P, H, TIP_DEFAULT, data_dir, load, pct, boot_ci, ols, steady, erc_replace, july_rows, july_row,
                    price_per_byte, july_point, compress_cells, charged_size, gas, real_txs, med_tx, tasks, task_fee,
                    task_premium, data_share, mainnet, history_cells, ok_ms, methods_cells, latest_versions)

D = data_dir(sys.argv)
line = lambda title: print("=" * 78 + "\n" + title)
g = steady(D)

line("RQ1  gas on the local EVM by phase (did_gas_steady.jsonl) -> Table I, Fig. 1")
print("  phases: fresh = first operation on an identity; init = identity initialised, slot still empty; again = slot already in use")
rows = [("create (storage: register)", 0, g("storage", "register", "fresh")),
        ("rotate owner, first change of a fresh identity", g("erc1056", "changeOwner", "fresh"), g("storage", "changeOwner", "fresh")),
        ("rotate owner, identity initialised (ERC pointer set / storage registered)", g("erc1056", "changeOwner", "init"), g("storage", "changeOwner", "init")),
        ("rotate owner, later", g("erc1056", "changeOwner", "again"), g("storage", "changeOwner", "again")),
        ("add delegate (new)", g("erc1056", "addDelegate", "init"), g("storage", "addDelegate", "init")),
        ("revoke delegate", g("erc1056", "revokeDelegate", "again"), g("storage", "revokeDelegate", "again")),
        ("deactivate, first operation", g("erc1056", "deactivate", "fresh"), g("storage", "deactivate", "fresh")),
        ("deactivate, later", g("erc1056", "deactivate", "again"), g("storage", "deactivate", "init"))]
for p in [32, 33, 256]:
    rows += [(f"set attribute {p} B (first write of a name)", g("erc1056", "setAttribute", "init", p), g("storage", "setAttribute", "init", p)),
             (f"replace attribute {p} B (ERC: set + revoke, two transactions)", erc_replace(g, p), g("storage", "setAttribute", "replace", p))]
rows += [("revoke attribute 256 B", g("erc1056", "revokeAttribute", "again", 256), g("storage", "revokeAttribute", "again", 256))]
for name, e, s in rows:
    print(f"  {name:72s} ERC {e:>9,.0f}  storage {s:>9,.0f}  storage/ERC {s/e if e else float('nan'):.2f}")
print(f"  create + first rotation: ERC {g('erc1056','changeOwner','fresh'):,.0f}  storage {g('storage','register','fresh') + g('storage','changeOwner','init'):,.0f}")
print(f"  one-time ERC pointer initialisation (fresh rotation - initialised rotation): {g('erc1056','changeOwner','fresh') - g('erc1056','changeOwner','init'):,.0f} gas")
print(f"  attribute-name storage: set attribute again_same (same value, new validTo) 256 B: {g('storage','setAttribute','again_same',256):,.0f}")
for label, f in [("ERC set attribute (first write = append)", lambda p: g("erc1056", "setAttribute", "init", p)),
                 ("ERC replace (set + revoke)", lambda p: erc_replace(g, p)),
                 ("storage first write", lambda p: g("storage", "setAttribute", "init", p)),
                 ("storage replace", lambda p: g("storage", "setAttribute", "replace", p))]:
    print(f"  slope {label:42s} {ols(P, [f(p) for p in P])[0]:7.1f} gas/B   " + "  ".join(f"{p}B={f(p):,.0f}" for p in P))
for p in [32, 33, 256]:
    print(f"  first write storage/ERC {p} B: {g('storage','setAttribute','init',p)/g('erc1056','setAttribute','init',p):.2f}x ; replace {g('storage','setAttribute','replace',p)/erc_replace(g,p):.2f}x")
legacy = {(r["design"], r["op"], r["payload"]): r["gasUsed"] for r in load(D, "did_gas_local.jsonl", required=False) if r.get("op") == "setAttribute" and r.get("run") == 2}
if legacy:
    worst = max(abs(legacy[(d, "setAttribute", p)] - g(d, "setAttribute", "init", p)) / g(d, "setAttribute", "init", p) for d in ["erc1056", "storage"] for p in P)
    print(f"  consistency with the earlier matrix (did_gas_local.jsonl, first writes): max relative difference {100*worst:.3f}%")

jr = july_rows(D)
tx2 = load(D, "did_history_tx_v2.jsonl")
def tx_gas(net, design, tag=None, op=None):
    return [r["gasUsed"] for r in tx2 if r.get("net") == net and r.get("design") == design and (tag is None or r.get("tag") == tag) and (op is None or r.get("op") == op)]
print("  Sepolia October receipts (after the Glamsterdam upgrade, EIP-8037) against July:")
print(f"    storage registration: October {tx_gas('sepolia','storage',op='create')[0]:,} vs July {july_row(jr,'sepolia','storage','create',0)['gasUsed']:,}")
print(f"    storage first write of a 33-B key: October {tx_gas('sepolia','storage','set-key0')[0]:,} (OP Sepolia {tx_gas('opSepolia','storage','set-key0')[0]:,})")
print(f"    ERC-1056 first write of an identity (pointer written): October {tx_gas('sepolia','erc1056','set-svc')[0]:,} (OP Sepolia {tx_gas('opSepolia','erc1056','set-svc')[0]:,})")
# Break-even number of replacements: extra first-write gas of the storage registry divided by the gas saved per replacement.
# ERC first write is taken with the pointer slot written (set-svc) and without it (a later key write, set-key0 after set-svc).
def break_even(net, erc_rep):
    s_first, s_rep = tx_gas(net, "storage", "set-key0")[0], tx_gas(net, "storage", "set-key1")[0]
    e_with, e_without = tx_gas(net, "erc1056", "set-svc")[0], tx_gas(net, "erc1056", "set-key0")[0]
    saving = erc_rep - s_rep
    return s_rep, saving, (s_first - e_with) / saving, (s_first - e_without) / saving
for net, label, e_rep in [("sepolia", "October Sepolia", tx_gas("sepolia", "erc1056", "set-key1")[0] + tx_gas("sepolia", "erc1056", "revoke-key0")[0]),
                          ("opSepolia", "OP Sepolia (July rules)", tx_gas("opSepolia", "erc1056", "set-key1")[0] + tx_gas("opSepolia", "erc1056", "revoke-key1")[0])]:
    s_rep, saving, n_with, n_without = break_even(net, e_rep)
    print(f"    {label}: replacement of a 33-B key ERC {e_rep:,} (set + revoke) vs storage {s_rep:,} gas (ratio {s_rep/e_rep:.2f}); "
          f"break-even {n_with:.1f} replacements (ERC first write with pointer slot) to {n_without:.1f} (without)")
print(f"    October Sepolia ERC-1056 replacement parts: set {tx_gas('sepolia','erc1056','set-key1')[0]:,}, revoke {tx_gas('sepolia','erc1056','revoke-key0')[0]:,} gas")
# Share of the local-EVM replacement gap that is transaction base cost (21,000 gas per transaction).
_e_rep33, _s_rep33 = erc_replace(g, 33), g("storage", "setAttribute", "replace", 33)
print(f"  base cost in the 33-B replacement: ERC {_e_rep33:,} = 2 x 21,000 + {_e_rep33 - 42000:,}; storage {_s_rep33:,} = 21,000 + {_s_rep33 - 21000:,}; "
      f"a one-transaction ERC replacement would cost about {_e_rep33 - 21000:,} gas (estimate: the work of both transactions plus one base cost)")

line("RQ2a  July 2026 OP Sepolia receipts, canonical pair (did_l2_measured.jsonl)")
for p in [32, 256]:
    e, s = july_row(jr, "opSepolia", "erc1056", "setAttribute", p), july_row(jr, "opSepolia", "storage", "setAttribute", p)
    fe, fs = int(e["totalFeeWei"]), int(s["totalFeeWei"])
    print(f"  {p}B: calldata {e['calldataBytes']} B; l1GasUsed {e['l1GasUsed']} -> charged {int(e['l1GasUsed'])/16:.1f} B; l1Fee {int(e['l1Fee'])/1e9:.2f} gwei; "
          f"price per charged byte ERC {price_per_byte(e):.6g} wei, storage {price_per_byte(s):.6g} wei; gas ratio {s['gasUsed']/e['gasUsed']:.2f}x; "
          f"fee ratio {fs/fe:.3f}x; ERC data share {int(e['l1Fee'])/fe:.3f}")
e32, e256 = july_row(jr, "opSepolia", "erc1056", "setAttribute", 32), july_row(jr, "opSepolia", "erc1056", "setAttribute", 256)
print(f"  ERC-1056 receipts, 32 B vs 256 B: l1Fee ratio {int(e256['l1Fee'])/int(e32['l1Fee']):.5f}, charged-size ratio {int(e256['l1GasUsed'])/int(e32['l1GasUsed']):.5f}, "
      f"price-per-byte difference {100*abs(price_per_byte(e256)/price_per_byte(e32)-1):.3f}%")
cA, pA = july_point(jr)
print(f"  point A (July 256-B ERC receipt): L1 {cA:.6g} wei per charged byte, L2 gas price {pA} wei (base 250 + tip {pA-250})")
for L in [int(e32['l1GasUsed'])/16, int(e256['l1GasUsed'])/16]:
    print(f"  FastLZ size implied by Eq. (3) for charged {L:.2f} B: {(L + 42.5856)/0.8365:.1f} B (inferred, not measured)")

line("RQ2b  payload compressibility (did_compress.jsonl) -> Fig. 2")
cells, init = compress_cells(D)
print(f"  pointer-initialising ERC writes excluded (gas above the cell minimum): " + "; ".join(f"{k}: {v}" for k, v in sorted(init.items())))
for k, v in sorted(cells.items()):
    assert len(v) == (2 if (k[1] == "erc1056" and k[2] == "rep" and k[3] == 32) else 3), (k, len(v))
for kind in ["rep", "rnd"]:
    sizes = [charged_size(cells, kind, p) for p in P]
    for p, L in zip(P, sizes):
        xs = cells[("opSepolia", "erc1056", kind, p)] + cells[("opSepolia", "storage", kind, p)]
        print(f"  {kind}{p:<4d} charged size {L:.1f} B (l1GasUsed {sorted(set(int(x['l1GasUsed']) for x in xs))}, n={len(xs)}); signed tx {sorted(set(x['signedTxBytes'] for x in xs))} B; "
              f"gas ERC {gas(cells, kind, p, 'erc1056')} storage {gas(cells, kind, p, 'storage')}")
    print(f"  charged-size slope {kind}: {ols(P, sizes)[0]:.3f} B per payload byte")
diffs = []
for net in ["local", "opSepolia"]:
    for d in ["erc1056", "storage"]:
        for p in P:
            rep = {x["rep"]: x["gasUsed"] for x in cells[(net, d, "rep", p)]}
            rnd = {x["rep"]: x["gasUsed"] for x in cells[(net, d, "rnd", p)]}
            diffs += [abs(rep[i] - rnd[i]) for i in rep if i in rnd]
print(f"  execution gas, random vs repeated payload (paired rows, local EVM + OP Sepolia, n={len(diffs)}): max |diff| = {max(diffs)} gas")
print(f"  arbSepolia: gasUsedForL1 values {sorted(set(x.get('gasUsedForL1') for k, v in cells.items() if k[0] == 'arbSepolia' for x in v))}")
rt = real_txs(D)
for key in [("erc1056", "first"), ("erc1056", "set"), ("erc1056", "revoke"), ("erc1056", "svc"), ("storage", "first"), ("storage", "set")]:
    gs, sz = med_tx(rt[key])
    print(f"  real transaction {key[0]:8s} {key[1]:6s}: gas {gs:,.0f}, charged {sz:.1f} B (n={len(rt[key])})")
tk = tasks(D)
for name, (erc, sto) in tk.items():
    print(f"  task {name}: ERC {[(int(a), round(b, 1)) for a, b in erc]}  storage {[(int(a), round(b, 1)) for a, b in sto]}  gas ratio {sum(a for a,_ in sto)/sum(a for a,_ in erc):.2f}")

line("RQ2c  fee premium by task and price point (model: Eq. (1) per transaction, measured gas and sizes)")
m = mainnet(D)
span = (m["times"][0], m["times"][-1]) if m["times"] else ("?", "?")
print(f"  source: {m['label']}; OP Mainnet: {m['n_op']} transactions from {m['n_blocks']} blocks, {m['rounds']} rounds, {span[0]} .. {span[1]}; missed samples {len(m['missed'])}")
print(f"  OP Mainnet L1 price per charged byte: median {m['c_median']:.4g} wei (IQR {m['c_p25']:.4g}-{m['c_p75']:.4g}); block base fee median {m['base_median']:.0f} wei; "
      f"effective gas price of sampled transactions p10/p50/p90 = {m['egp_p10']:.0f}/{m['egp_p50']:.0f}/{m['egp_p90']:.0f} wei; "
      f"share of transactions at base fee + default tip (1e6 wei) or less: {sum(1 for x in m['egp'] if x <= m['base_median'] + TIP_DEFAULT)/len(m['egp']):.2f}")
points = [("July OP Sepolia prices (point A)", cA, pA), ("mainnet, base fee only", m["c_median"], m["base_median"]),
          ("mainnet, default tip (1e6 wei)", m["c_median"], m["base_median"] + TIP_DEFAULT),
          ("mainnet, median of other senders", m["c_median"], m["egp_p50"]), ("mainnet, 90th percentile of other senders", m["c_median"], m["egp_p90"])]
print("  " + " " * 44 + "".join(f"{n:>26s}" for n, _, _ in points))
for name, task in tk.items():
    print(f"  premium  {name:34s}" + "".join(f"{task_premium(task, c, p):>26.2f}" for _, c, p in points))
for name, task in tk.items():
    print(f"  L1 share {name:34s}" + "".join(f"{data_share(task[0], c, p):>26.3f}" for _, c, p in points))
print("  per-transaction premium over the sampled OP Mainnet transactions (each with its own L1 and L2 price), p10 / p50 / p90:")
for name, task in tk.items():
    vals = [task_premium(task, c, p) for c, p in zip(m["c"], m["egp"])]
    print(f"    {name:12s} {pct(vals, 10):.2f} / {pct(vals, 50):.2f} / {pct(vals, 90):.2f}")
big = tk["first_256"]
absf = task_fee(big[1], m["c_median"], m["base_median"] + TIP_DEFAULT)
print(f"  absolute fee of the storage 256-B first write at the default tip: {absf:.3g} wei = {absf/1e18:.2g} ETH")
print(f"  Arbitrum One sample: {m['arb_nonzero']}/{m['n_arb']} receipts with gasUsedForL1 > 0; median share of gasUsed {m['arb_share_median']:.3f}")
ts = sorted({datetime.fromisoformat(t.replace("Z", "+00:00")) for t in m["times"]})
if len(ts) > 1:
    gap = max((b - a, a, b) for a, b in zip(ts, ts[1:]))
    print(f"  sample coverage: {len(ts)} distinct blocks from {ts[0]:%Y-%m-%d %H:%M}Z to {ts[-1]:%Y-%m-%d %H:%M}Z; "
          f"largest gap {gap[0]} (between {gap[1]:%Y-%m-%d %H:%M}Z and {gap[2]:%Y-%m-%d %H:%M}Z); "
          f"UTC hours of the day with at least one sampled block: {len({t.hour for t in ts})} of 24; weekdays covered: {sorted({t.strftime('%a') for t in ts})}")
l1p = load(D, "did_arb_l1price.jsonl", required=False)
if l1p:
    cur = {r["net"]: r["l1BaseFeeEstimateWei"] for r in l1p if r.get("kind") == "current"}
    atb = [r for r in l1p if r.get("kind") == "at_receipt_block"]
    got = [r for r in atb if "l1BaseFeeEstimateWei" in r]
    print(f"  ArbGasInfo.getL1BaseFeeEstimate now: Arbitrum Sepolia {cur.get('arbSepolia')} wei, Arbitrum One {cur.get('arbOne')} wei; at July receipt blocks: "
          f"{len(got)} of {len(atb)} readable ({[r['l1BaseFeeEstimateWei'] for r in got]}), the others pruned by the endpoint")
for r in load(D, "did_operator_fee_check.jsonl", required=False):
    print(f"  OP Stack operator fee: {r['net']}: {r['withOperatorFeeFields']} of {r['sample']} receipts carry operatorFeeScalar/operatorFeeConstant "
          f"({r['withL1FeeField']} carry l1Fee)"
          + (f"; L1Block predeploy {r['predeploy']['version']}: operatorFeeScalar {r['predeploy']['operatorFeeScalar']}, operatorFeeConstant {r['predeploy']['operatorFeeConstant']}" if r.get("predeploy") else ""))

for fname, label in [("did_history_v2.jsonl", "run 2 (paper, Fig. 3)"), ("did_history.jsonl", "run 1 (replicate; its production timings mix cold and warm cache)")]:
    line(f"RQ3  resolution vs history length, {label}: {fname}")
    hc, dup = history_cells(D, fname)
    print(f"  duplicate (cell, round) rows dropped: {dup}")
    for key in sorted(hc, key=lambda k: (k[0], str(k[1]), k[2], k[3])):
        rs = hc[key]; ms = ok_ms(rs)
        errs = sorted(set(str(r.get("message") or r.get("error"))[:60] for r in rs if not r.get("ok") and (r.get("error") or r.get("message"))))
        if ms:
            lo, hi = boot_ci(ms)
            print(f"  {key[0]:10s} {str(key[1]):14s} {key[2]:17s} H={key[3]:2d} ok {len(ms)}/{len(rs)} median {median(ms):7.0f} "
                  f"IQR [{pct(ms,25):.0f},{pct(ms,75):.0f}] p95 {pct(ms,95):7.0f} CI [{lo:.0f},{hi:.0f}] calls {rs[0].get('calls')} {errs if errs else ''}")
        else:
            print(f"  {key[0]:10s} {str(key[1]):14s} {key[2]:17s} H={key[3]:2d} ok 0/{len(rs)} {errs[:1]}")
    for net in ["sepolia", "opSepolia", "arbSepolia"]:
        ed = "erc1056_arbL2" if net == "arbSepolia" else "erc1056"
        allr = [r for k, v in hc.items() if k[0] == net and not (net == "arbSepolia" and k[1] == "erc1056") and k[2] != "production_warmup" for r in v]
        bad = [r for r in allr if not r.get("ok")]
        print(f"  {net}: {len(allr)-len(bad)}/{len(allr)} correct; failures: {[(r['H'], r['method'], str(r.get('message') or r.get('error'))[:50]) for r in bad]}")
        if net == "arbSepolia":
            um = [r for k, v in hc.items() if k[0] == net and k[1] == "erc1056" and k[2] != "production_warmup" for r in v]
            print(f"  arbSepolia unmodified ERC-1056: {sum(1 for r in um if r.get('ok'))}/{len(um)} correct")
        for design, method in [(ed, "spec_walk"), (ed, "production_cold"), (ed, "production"), ("storage", "view_calls")]:
            pts = {h: median(ok_ms(hc[(net, design, method, h)])) for h in H if ok_ms(hc.get((net, design, method, h), []))}
            if len(pts) >= 3:
                hs = sorted(pts)
                sl, b = ols(hs, [pts[h] for h in hs])
                print(f"  fit {net:10s} {design:14s} {method:16s}: {sl:6.1f} ms/event + {b:6.0f} ms   " + "  ".join(f"H{h}={pts[h]/1000:.2f}s" for h in hs))
                if method != "view_calls" and 2 in pts and 64 in pts:
                    sto = {h: median(ok_ms(hc[(net, 'storage', 'view_calls', h)])) for h in (2, 64)}
                    reqs = median(r["calls"] for r in hc[(net, design, method, 64)] if r.get("calls")) if method == "spec_walk" else None
                    per_call = f"; walk at H=64: {reqs:.0f} requests, {pts[64]/reqs:.0f} ms each" if reqs else ""
                    print(f"      {method}/storage reads: H=2 {pts[2]/sto[2]:.2f}x  H=64 {pts[64]/sto[64]:.2f}x{per_call}")
        w = ok_ms(hc.get((net, ed, "production_warm", 64), []))
        wall = hc.get((net, ed, "production_warm", 64), [])
        if wall:
            slow = [r["ms"] for r in wall if r.get("ms") and r["ms"] > 5000]
            print(f"  {net} production_warm H=64: median {median(w):.0f} ms (ok {len(w)}/{len(wall)}); resolutions slower than 5 s: {len(slow)} {[round(x/1000,1) for x in slow]}")
    if "run 2" in label:
        hc2 = hc
    else:
        print("  run 1 vs run 2 (same endpoints, a different identity, hours apart), H=64 medians in ms:")
        for net in ["sepolia", "opSepolia", "arbSepolia"]:
            ed = "erc1056_arbL2" if net == "arbSepolia" else "erc1056"
            for design, method in [(ed, "spec_walk"), ("storage", "view_calls")]:
                a, b = median(ok_ms(hc[(net, design, method, 64)])), median(ok_ms(hc2[(net, design, method, 64)]))
                print(f"    {net:10s} {method:10s} run1 {a:8.0f}  run2 {b:8.0f}  run1/run2 {a/b:.2f}")
    txname = fname.replace("did_history", "did_history_tx")
    tx = [r for r in load(D, txname) if r.get("net") == "arbSepolia" and r.get("op") == "setAttribute" and str(r.get("tag", "")).startswith("set-key")]
    by = {}
    for r in tx:
        by.setdefault(r["tag"], {})[r["design"]] = r["gasUsed"]
    pairs = [(v["erc1056"], v["erc1056_arbL2"]) for v in by.values() if "erc1056" in v and "erc1056_arbL2" in v]
    chg = [b - a for a, b in pairs if a > 33000]; same = [b - a for a, b in pairs if a <= 33000]
    allp = [b - a for a, b in pairs]
    print(f"  ArbSys write overhead: {len(pairs)} paired key writes; vs pointer-changing writes +{median(chg) if chg else '-'} gas (n={len(chg)}); "
          f"vs same-value writes +{median(same) if same else '-'} gas (n={len(same)}); mean over all pairs +{sum(allp)/len(allp):.0f} gas")
    ch_e = [a for a, _ in pairs if a > 33000]; sv_e = [a for a, _ in pairs if a <= 33000]
    if ch_e and sv_e:
        print(f"  unmodified registry on Arbitrum: a write that leaves the pointer unchanged costs {median(ch_e) - median(sv_e):.0f} gas less "
              f"({median(sv_e):.0f} vs {median(ch_e):.0f}); {len(sv_e)} of {len(pairs)} consecutive key writes left it unchanged")
    erc_l1 = [r for r in load(D, txname) if r.get("net") == "arbSepolia" and r.get("design") == "erc1056" and r.get("block") and r.get("l1BlockNumber") and r.get("op") in ("setAttribute", "revokeAttribute")]
    if erc_l1:
        last_r = max(erc_l1, key=lambda r: r["block"])
        print(f"  unmodified registry, last event: L2 block {last_r['block']:,}, receipt l1BlockNumber {int(last_r['l1BlockNumber']):,}")

line("Table III  resolution strategies at 64 events (did_resolve_methods.jsonl; two sessions of 20 rounds, pooled)")
mc, setup = methods_cells(D)
if not mc:
    print("  (no data)")
ratios = []
for net in ["sepolia", "opSepolia", "arbSepolia"]:
    if net in setup:
        s = setup[net]
        print(f"  {net}: endpoint {s['host']}; scan range {s['startBlock']:,}..{s['headBlock']:,} from {s['startIso']} in {s['chunks']} chunks of {s['cap']:,} blocks; {s['conc']} requests in flight for range_par")
    for method in ["spec_walk", "range_seq", "range_par", "storage_seq3", "storage_full"]:
        rs = mc.get((net, method), [])
        ms = ok_ms(rs)
        if not rs:
            continue
        calls = sorted(r.get("calls") for r in rs if r.get("calls") is not None)
        splits = sorted(r.get("splits", 0) for r in rs if "splits" in r)
        errs = sorted(set(str(r.get("error"))[:50] for r in rs if not r.get("ok") and r.get("error")))
        if ms:
            print(f"    {method:13s} ok {len(ms)}/{len(rs)}  median {median(ms)/1000:6.2f} s  IQR [{pct(ms,25)/1000:.2f}, {pct(ms,75)/1000:.2f}]  requests median {median(calls)}" +
                  (f" (splits {median(splits):.0f})" if splits else "") + (f"  errors {errs}" if errs else ""))
            by_s = {k: [r for r in rs if r.get("session") == k] for k in (1, 2)}
            med_s = {k: (median(ok_ms(v)) / 1000 if ok_ms(v) else None) for k, v in by_s.items()}
            if all(med_s.values()):
                ratios.append((med_s[2] / med_s[1], net, method))
                print(f"        sessions: S1 {med_s[1]:.2f} s ({len(ok_ms(by_s[1]))}/{len(by_s[1])}), S2 {med_s[2]:.2f} s ({len(ok_ms(by_s[2]))}/{len(by_s[2])}); S2/S1 = {med_s[2]/med_s[1]:.2f}")
        else:
            print(f"    {method:13s} ok 0/{len(rs)}  errors {errs}")

if ratios:
    rr = sorted(ratios)
    print(f"  session-to-session ratio of the medians over {len(rr)} cells: min {rr[0][0]:.2f} ({rr[0][1]} {rr[0][2]}), max {rr[-1][0]:.2f} ({rr[-1][1]} {rr[-1][2]}); "
          f"{sum(1 for x in rr if 0.8 <= x[0] <= 1.25)} of {len(rr)} within 0.8-1.25")

line("Table IV  resolver releases vs on-chain truth (latest run without endpoint failures)")
vrows, skipped = latest_versions(D)
print(f"  runs skipped because of endpoint failures: {skipped}; run {vrows[0]['run']}")
for r in vrows:
    print(f"  {r['case']} {r['net']:10s} v{r['version']:7s} {r['verdict']:13s} err={r['error']} controller_ok={r['controller'] == r['truthOwner']} "
          f"docEntries={len(r['docSet'])} truthEntries={len(r['truthSet'] or [])} truthEvents={r.get('truthEvents')} pointer={r.get('pointer')}")
print("=" * 78)

# How much do the price points depend on which blocks were sampled? Whole blocks are resampled (transactions of one
# block share the L1 price and the base fee), and the sample is also split in time.
import random as _random
from collections import defaultdict as _dd
_blocks = _dd(list)
for _r in m["ops"]:
    _blocks[_r["block"]].append(_r)
def _points(rows):
    c = median(price_per_byte(r) for r in rows)
    base = median({r["block"]: int(r["baseFeeWei"]) for r in rows}.values())
    egp = [int(r["effectiveGasPriceWei"]) for r in rows]
    return c, base, pct(egp, 50)
def _premiums(rows):
    c, base, p50 = _points(rows)
    return {(n, lab): task_premium(t, c, p) for n, t in tk.items() for lab, p in [("base fee only", base), ("default tip", base + TIP_DEFAULT), ("median sender", p50)]}, c
_rng = _random.Random(11)
_ids = sorted(_blocks)
_draws, _cs = [], []
for _ in range(2000):
    rows = [r for b in _rng.choices(_ids, k=len(_ids)) for r in _blocks[b]]
    pr, c = _premiums(rows)
    _draws.append(pr); _cs.append(c)
print(f"  block-level bootstrap over {len(_ids)} blocks (2000 resamples), 95% interval; point estimate in the full sample in brackets:")
print(f"    L1 price per charged byte, median: {pct(_cs, 2.5):.3g} - {pct(_cs, 97.5):.3g} wei [{m['c_median']:.3g}]")
_full, _ = _premiums(m["ops"])
for key in _full:
    xs = [d[key] for d in _draws]
    print(f"    premium {key[0]:11s} {key[1]:14s}: {pct(xs, 2.5):.2f} - {pct(xs, 97.5):.2f} [{_full[key]:.2f}]")
_order = sorted(_ids, key=lambda b: _blocks[b][0]["blockTime"])
for lab, part in [("first half of the blocks", _order[:len(_order)//2]), ("second half of the blocks", _order[len(_order)//2:])]:
    rows = [r for b in part for r in _blocks[b]]
    pr, c = _premiums(rows)
    print(f"  {lab} ({len(part)} blocks, {len(rows)} tx): c median {c:.3g} wei; premium 256-B first write: base fee only {pr[('first_256','base fee only')]:.2f}, default tip {pr[('first_256','default tip')]:.2f}, median sender {pr[('first_256','median sender')]:.2f}")
