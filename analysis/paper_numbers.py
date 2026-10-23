#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Recompute every number quoted in the paper from the raw JSONL data.
Usage: python analysis/paper_numbers.py [data_dir]   (default: ../data)
Filters are defined once in common.py and shared with make_figures.py."""
import sys
from statistics import median
from common import (P, H, data_dir, local_gas, july_rows, july_row, july_prices, compress_cells,
                    charged_size, gas, premium, mainnet, history_cells, ok_ms, pct, boot_ci, ols, latest_versions)

D = data_dir(sys.argv)
line = lambda title: print("=" * 78 + "\n" + title)

line("RQ1  lifecycle gas on the local EVM (did_gas_local.jsonl) -> Table I, Fig. 1")
gm = local_gas(D)
for d in ["erc1056", "storage"]:
    for op in ["create", "changeOwner", "addDelegate", "revokeDelegate", "deactivate"]:
        print(f"  {d:8s} {op:15s} {gm(d, op)}")
    for p in P:
        print(f"  {d:8s} setAttribute {p:3d}B first={gm(d, 'setAttribute', p)} update={gm(d, 'setAttribute_update', p)} "
              f"revoke={gm(d, 'revokeAttribute', p)}")
for d, op in [("erc1056", "setAttribute"), ("storage", "setAttribute"), ("storage", "setAttribute_update")]:
    print(f"  slope {d}/{op}: {ols(P, [gm(d, op, p) for p in P])[0]:.1f} gas/B")
print(f"  storage/ERC first write: 256 B {gm('storage','setAttribute',256)/gm('erc1056','setAttribute',256):.2f}x, "
      f"32 B {gm('storage','setAttribute',32)/gm('erc1056','setAttribute',32):.2f}x; "
      f"update 256 B {gm('storage','setAttribute_update',256)/gm('erc1056','setAttribute_update',256):.2f}x")

line("RQ2a  July 2026 OP Sepolia receipts, canonical pair (did_l2_measured.jsonl)")
jr = july_rows(D)
for p in [32, 256]:
    e, s = july_row(jr, "opSepolia", "erc1056", "setAttribute", p), july_row(jr, "opSepolia", "storage", "setAttribute", p)
    fe, fs = int(e["totalFeeWei"]), int(s["totalFeeWei"])
    print(f"  {p}B: calldata {e['calldataBytes']} B; l1GasUsed {e['l1GasUsed']} -> charged {int(e['l1GasUsed'])/16:.1f} B; "
          f"l1Fee {int(e['l1Fee'])/1e9:.2f} gwei; gas ratio {s['gasUsed']/e['gasUsed']:.2f}x; fee ratio {fs/fe:.3f}x; "
          f"ERC data share {int(e['l1Fee'])/fe:.3f}")
_, _, (jlo, jhi) = july_prices(jr)
eA = july_row(jr, "opSepolia", "erc1056", "setAttribute", 256)   # point A: prices of this very transaction
JPB, JL2 = int(eA["l1Fee"]) / (int(eA["l1GasUsed"]) / 16), int(eA["effectiveGasPriceWei"])
print(f"  point-A prices: L1 {JPB:.5g} wei per charged byte, L2 gas price {JL2} wei "
      f"(all canonical July OP receipts: {jlo:.4g}-{jhi:.4g} wei per byte)")

line("RQ2b  payload compressibility (did_compress.jsonl) -> Fig. 2")
cells, first = compress_cells(D)
print(f"  excluded first ERC-1056 write per network (pointer initialisation): {sorted(first)}")
for k, v in sorted(cells.items()):             # 3 repetitions per cell; 2 where the pointer-initialising write was dropped
    assert len(v) == (2 if (k[1] == "erc1056" and k[2] == "rep" and k[3] == 32) else 3), (k, len(v))
for kind in ["rep", "rnd"]:
    sizes = [charged_size(cells, kind, p) for p in P]
    for p, L in zip(P, sizes):
        xs = cells[("opSepolia", "erc1056", kind, p)] + cells[("opSepolia", "storage", kind, p)]
        print(f"  {kind}{p:<4d} charged size {L:.1f} B (l1GasUsed values {sorted(set(int(x['l1GasUsed']) for x in xs))}); "
              f"signed tx {sorted(set(x['signedTxBytes'] for x in xs))} B; gas erc {gas(cells, kind, p, 'erc1056')} sto {gas(cells, kind, p, 'storage')}")
    print(f"  charged-size slope {kind}: {ols(P, sizes)[0]:.3f} B per payload byte")
diffs = []
for net in ["local", "opSepolia"]:                  # row-level pairs; Arbitrum excluded (pointer no-op writes)
    for d in ["erc1056", "storage"]:
        for p in P:
            rep = {x["rep"]: x["gasUsed"] for x in cells[(net, d, "rep", p)]}
            rnd = {x["rep"]: x["gasUsed"] for x in cells[(net, d, "rnd", p)]}
            diffs += [abs(rep[i] - rnd[i]) for i in rep if i in rnd]
print(f"  execution gas, random vs repeated payload (paired rows, local EVM + OP Sepolia, n={len(diffs)}): max |diff| = {max(diffs)} gas")
for net in ["arbSepolia"]:
    vals = sorted(set(x.get("gasUsedForL1") for k, v in cells.items() if k[0] == net for x in v))
    print(f"  {net}: gasUsedForL1 values {vals}")
print("  premium at the July OP Sepolia prices (measured gas and charged size, July L1 price and L2 gas price):")
for kind in ["rep", "rnd"]:
    for p in [32, 256]:
        ge, gs = gas(cells, kind, p, "erc1056"), gas(cells, kind, p, "storage")
        pr, sh = premium(ge, gs, charged_size(cells, kind, p), JPB, JL2)
        print(f"     {kind}{p}: gas ratio {gs/ge:.2f}x  data share {sh:.3f}  premium {pr:.2f}x")

line("RQ2c  mainnet fee levels -> Fig. 3 points C-E")
m = mainnet(D)
print(f"  source: {m['label']}; OP Mainnet rows {m['n_op']} from {len(m['blocks_op'])} blocks "
      f"({m['times'][0] if m['times'] else '?'} .. {m['times'][-1] if m['times'] else '?'}); missed samples {len(m['missed'])}")
print(f"  L1 price per charged byte: median {m['c_median']:.4g} wei (IQR {m['c_p25']:.4g}-{m['c_p75']:.4g}); "
      f"L2 base fee median {m['base_median']:.0f} wei; effective gas price p10/p50/p90 = "
      f"{m['egp_p10']:.0f}/{m['egp_p50']:.0f}/{m['egp_p90']:.0f} wei")
ge, gs, L = gas(cells, "rnd", 256, "erc1056"), gas(cells, "rnd", 256, "storage"), charged_size(cells, "rnd", 256)
for lbl, l2p in [("E base fee only", m["base_median"]), ("p10 tip", m["egp_p10"]), ("C median tip", m["egp_p50"]), ("D p90 tip", m["egp_p90"])]:
    pr, sh = premium(ge, gs, L, m["c_median"], l2p)
    print(f"     rnd256 @ {lbl:16s} L2 {l2p:>12.0f} wei: data share {sh:.3f} premium {pr:.2f}x")
below = sum(1 for x in m["egp"] if premium(ge, gs, L, m["c_median"], x)[0] <= 3.95) / len(m["egp"])
print(f"  share of sampled OP transactions whose fee level gives a premium <= 3.95x: {below:.2f}")
absf = gs * m["egp_p50"] + L * m["c_median"]
print(f"  storage 256-B random first write at the median fee level: {absf:.3g} wei = {absf/1e18:.2g} ETH")
print(f"  Arbitrum One: {m['arb_nonzero']}/{m['n_arb']} receipts with gasUsedForL1 > 0; median share of gasUsed "
      f"{m['arb_share_median']:.3f}")

for fname, label in [("did_history_v2.jsonl", "run 2 (paper, Fig. 4)"), ("did_history.jsonl", "run 1 (replicate; its production timings mix cold and warm cache)")]:
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
            pts = [(h, median(ok_ms(hc[(net, design, method, h)]))) for h in H if ok_ms(hc.get((net, design, method, h), []))]
            if len(pts) >= 3:
                sl, b = ols([q[0] for q in pts], [q[1] for q in pts])
                print(f"  fit {net:10s} {design:14s} {method:16s}: {sl:6.1f} ms/event + {b:6.0f} ms   "
                      + "  ".join(f"H{h}={v/1000:.2f}s" for h, v in pts))
                if method != "view_calls":
                    s2, s64 = median(ok_ms(hc[(net, 'storage', 'view_calls', 2)])), median(ok_ms(hc[(net, 'storage', 'view_calls', 64)]))
                    print(f"      ratio to storage: H=2 {pts[0][1]/s2:.2f}x  H=64 {pts[-1][1]/s64:.2f}x")
        w = ok_ms(hc.get((net, ed, "production_warm", 64), []))
        if w:
            print(f"  {net} production_warm H=64: median {median(w):.0f} ms (n={len(w)})")
    txname = fname.replace("did_history", "did_history_tx")
    from common import load
    tx = [r for r in load(D, txname) if r.get("net") == "arbSepolia" and r.get("op") == "setAttribute" and str(r.get("tag", "")).startswith("set-key")]
    by = {}
    for r in tx:
        by.setdefault(r["tag"], {})[r["design"]] = r["gasUsed"]
    pairs = [(v["erc1056"], v["erc1056_arbL2"]) for v in by.values() if "erc1056" in v and "erc1056_arbL2" in v]
    chg = [b - a for a, b in pairs if a > 33000]; same = [b - a for a, b in pairs if a <= 33000]
    print(f"  ArbSys write overhead: {len(pairs)} paired writes; vs pointer-changing writes +{median(chg) if chg else '-'} gas (n={len(chg)}); "
          f"vs same-value writes +{median(same) if same else '-'} gas (n={len(same)}); same-value writes {len(same)}/{len(pairs)}")

line("Table II  resolver releases vs on-chain truth (latest run of did_resolver_versions.jsonl)")
for r in latest_versions(D):
    print(f"  {r['case']} {r['net']:10s} v{r['version']:7s} {r['verdict']:14s} err={r['error']} controller={r['controller']} "
          f"truthOwner={r['truthOwner']} entries {r['docEntries']}/{r['truthValidEntries']} pointer {r['pointer']} attempts {r.get('attempts')}")
print("=" * 78)
