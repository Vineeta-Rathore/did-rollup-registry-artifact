#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Figures 1-3 of the paper (IEEE two-column) from the raw JSONL data.
Usage: python analysis/make_figures.py [data_dir] [--out DIR]   (defaults: ../data, ./figs)
Figures are written at final size (3.5 in single column, 7.16 in double column) so LaTeX
places them at 1:1 scale. Palette validated for colour-vision deficiency: ERC-1056 #0072B2,
storage #D55E00; every series also has a marker or line-style cue for grayscale print.
Fonts are embedded as TrueType (pdf.fonttype 42). Tested with matplotlib 3.10.5."""
import math, os, sys
from statistics import median
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FixedLocator, FuncFormatter, NullLocator
from common import (P, H, TIP_DEFAULT, data_dir, steady, erc_replace, july_rows, july_row, compress_cells, charged_size, real_txs, med_tx,
                    history_cells, ok_ms, pct, ols, mainnet, tasks, task_premium)

D = data_dir(sys.argv)
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "figs")
os.makedirs(OUT, exist_ok=True)
C_ERC, C_STO, INK, MUTED = "#0072B2", "#D55E00", "#222222", "#6b6b6b"
COL, DCOL = 3.5, 7.16
plt.rcParams.update({
    "pdf.fonttype": 42, "ps.fonttype": 42, "font.family": "serif",
    "font.serif": ["Times New Roman", "STIXGeneral", "DejaVu Serif"], "mathtext.fontset": "stix",
    "font.size": 8, "axes.labelsize": 8.5, "xtick.labelsize": 8, "ytick.labelsize": 8, "legend.fontsize": 8,
    "axes.linewidth": 0.6, "lines.linewidth": 1.3, "lines.markersize": 4.5,
    "xtick.major.width": 0.6, "ytick.major.width": 0.6, "xtick.major.size": 3, "ytick.major.size": 3,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "axes.axisbelow": True,
    "grid.linewidth": 0.4, "grid.alpha": 0.35, "legend.frameon": False,
    "figure.constrained_layout.use": True, "savefig.pad_inches": 0.02,
})


def save(fig, name):
    fig.savefig(os.path.join(OUT, name + ".pdf"), metadata={"CreationDate": None, "ModDate": None})
    fig.savefig(os.path.join(OUT, name + ".png"), dpi=300)
    plt.close(fig); print("wrote", name)


kfmt = FuncFormatter(lambda v, _: f"{v/1000:g}k" if v >= 1000 else f"{v:g}")

# ---- Fig. 1: gas against payload, first writes and replacements (local EVM) ----------------------
g = steady(D)
series = [("ERC-1056, first write", lambda p: g("erc1056", "setAttribute", "init", p), C_ERC, "-", "o"),
          ("ERC-1056, replace (set + revoke)", lambda p: erc_replace(g, p), C_ERC, "--", "v"),
          ("Storage, first write", lambda p: g("storage", "setAttribute", "init", p), C_STO, "-", "s"),
          ("Storage, replace", lambda p: g("storage", "setAttribute", "replace", p), C_STO, "--", "^")]
fig, ax = plt.subplots(figsize=(COL, 2.1))
for name, f, c, ls, mk in series:
    ys = [f(p) for p in P]
    ax.plot(P, ys, ls=ls, marker=mk, color=c, label=f"{name}: {ols(P, ys)[0]:.3g} gas/B")
ax.xaxis.set_major_locator(FixedLocator([0] + P)); ax.yaxis.set_major_formatter(kfmt)
ax.set_xlabel("Attribute payload (bytes)"); ax.set_ylabel("Gas per operation")
ax.set_xlim(0, 270); ax.set_ylim(0, 330000); ax.legend(loc="upper left", handlelength=2.6)
save(fig, "fig1_payload_gas")

# ---- Fig. 2: the rollup fee. (a) charged L1 size, repeated vs random payload, real keys; (b) fee ratio vs gas price ----
cells, _ = compress_cells(D)
jr = july_rows(D)
rt = real_txs(D)
m = mainnet(D)
tk = tasks(D)
fig, (ax, bx) = plt.subplots(1, 2, figsize=(DCOL, 2.1), gridspec_kw={"width_ratios": [1, 1.1]})
ax.axhline(100, color=MUTED, lw=0.8, ls=":")
ax.text(255, 96, "100-byte floor", color=MUTED, fontsize=8, va="top", ha="right")
ax.plot(P, [charged_size(cells, "rnd", p) for p in P], "-o", color=INK, label="Random bytes")
ax.plot(P, [charged_size(cells, "rep", p) for p in P], "--s", color=MUTED, label="Repeated byte 0xab")
jp = [32, 256]
ax.plot(jp, [int(july_row(jr, "opSepolia", "erc1056", "setAttribute", p)["l1GasUsed"]) / 16 for p in jp], "D", color=MUTED,
        mfc="white", ms=5, ls="none", label="July receipts (0xab)")
ax.plot([33], [med_tx(rt[("erc1056", "set")])[1]], "*", color=C_ERC, ms=9, ls="none", label="Real 33-byte key")
ax.xaxis.set_major_locator(FixedLocator([0] + P)); ax.set_xlim(0, 270); ax.set_ylim(75, 380)
ax.set_xlabel("Attribute payload (bytes)"); ax.set_ylabel("Charged L1 size (bytes)")
ax.legend(loc="upper left", ncol=1)
ax.set_title("(a) Charged size, OP Sepolia", fontsize=8.5, loc="left")

c0, base = m["c_median"], m["base_median"]
ps = [10 ** (2.2 + 0.1 * i) for i in range(59)]                  # 158 wei .. 1e8 wei
bx.axvspan(m["egp_p10"], m["egp_p90"], color="#9a9a9a", alpha=0.18, lw=0)
bx.axhline(1, color=MUTED, lw=0.8, ls=":")
marks = [(base, "o"), (base + TIP_DEFAULT, "s"), (m["egp_p90"], "^")]   # the three mainnet columns of Table II
for key, lbl, ls, col in [("first_256", "First write, 256 B", "-", INK), ("first_33", "First write, 33 B key", "--", INK),
                          ("replace_33", "Replace a 33 B key", "-.", MUTED)]:
    bx.plot(ps, [task_premium(tk[key], c0, p) for p in ps], ls=ls, color=col, label=lbl)
    for x, mk in marks:
        bx.plot([x], [task_premium(tk[key], c0, x)], mk, color=col, mfc="white", ms=4.5, ls="none")
bx.set_xscale("log"); bx.set_xlim(150, 1e8); bx.set_ylim(0, 7)
bx.xaxis.set_major_locator(FixedLocator([1e3, 1e4, 1e5, 1e6, 1e7, 1e8]))
bx.xaxis.set_major_formatter(FuncFormatter(lambda v, _: "10$^{%d}$" % round(math.log10(v))))
bx.xaxis.set_minor_locator(NullLocator())
bx.set_xlabel("Effective L2 gas price (wei)"); bx.set_ylabel("Fee ratio, storage / ERC-1056")
bx.legend(loc="upper left", ncol=1)
bx.set_title("(b) Fee ratio at the OP Mainnet L1 price", fontsize=8.5, loc="left")
save(fig, "fig2_rollup_fee")

# ---- Fig. 3: resolution latency vs history length (run 2), median with interquartile band -------
hc, _ = history_cells(D, "did_history_v2.jsonl")
fig, axes = plt.subplots(1, 3, figsize=(DCOL, 2.0), sharey=True)
panels = [("sepolia", "erc1056", "Sepolia (L1)"), ("opSepolia", "erc1056", "OP Sepolia"),
          ("arbSepolia", "erc1056_arbL2", "Arbitrum Sepolia, ArbSys-pointer registry")]
for ax, (net, ed, title) in zip(axes, panels):
    for design, method, c, ls, mk, lbl in [(ed, "spec_walk", C_ERC, "-", "o", "Pointer walk (specification)"),
                                           (ed, "production_cold", C_ERC, "--", "s", "ethr-did-resolver, cold"),
                                           ("storage", "view_calls", C_STO, "-", "^", "Storage, 3 sequential reads")]:
        xs = [h for h in H if ok_ms(hc.get((net, design, method, h), []))]
        v = [[x / 1000 for x in ok_ms(hc[(net, design, method, h)])] for h in xs]
        ax.fill_between(xs, [pct(a, 25) for a in v], [pct(a, 75) for a in v], color=c, alpha=0.3, lw=0)
        ax.plot(xs, [median(a) for a in v], ls=ls, marker=mk, color=c, label=lbl)
    w = [x / 1000 for x in ok_ms(hc.get((net, ed, "production_warm", 64), []))]
    if w:
        ax.plot([64], [median(w)], marker="*", ms=9, color=C_ERC, mfc="white", ls="none", label="ethr-did-resolver, warm cache")
    ax.set_title(title, fontsize=8.5)
    ax.set_xscale("log", base=2); ax.set_yscale("log")
    ax.xaxis.set_major_locator(FixedLocator(H)); ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
    ax.xaxis.set_minor_locator(NullLocator())
    ax.yaxis.set_major_locator(FixedLocator([0.3, 1, 3, 10, 30])); ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:g}"))
    ax.set_xlabel("Events in history")
axes[0].set_ylabel("Resolution latency (s)")
h_, l_ = axes[0].get_legend_handles_labels()
fig.legend(h_, l_, loc="outside upper center", ncol=4, handlelength=2.2)
save(fig, "fig3_history")
