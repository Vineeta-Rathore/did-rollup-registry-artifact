#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Figures 1-4 of the paper (IEEE two-column) from the raw JSONL data.
Usage: python analysis/make_figures.py [data_dir] [--out DIR]   (defaults: ../data, ./figs)
Figures are written at final size (3.5 in single column, 7.16 in double column) so LaTeX
places them at 1:1 scale. Palette validated for colour-vision deficiency: ERC-1056 #0072B2,
storage #D55E00; every series also has a marker or line-style cue for grayscale print.
Fonts are embedded as TrueType (pdf.fonttype 42). Tested with matplotlib 3.10.5."""
import os, sys
from statistics import median
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FixedLocator, FuncFormatter, NullLocator
from common import (P, H, data_dir, local_gas, july_rows, july_row, compress_cells, charged_size, gas,
                    premium, mainnet, history_cells, ok_ms, pct, ols)

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

# ---- Fig. 1: setAttribute gas vs payload, local EVM -------------------------------------------
gm = local_gas(D)
fig, ax = plt.subplots(figsize=(COL, 2.15))
for d, op, c, ls, mk, name in [("erc1056", "setAttribute", C_ERC, "-", "o", "ERC-1056 (event)"),
                               ("storage", "setAttribute", C_STO, "-", "s", "Storage, first write"),
                               ("storage", "setAttribute_update", C_STO, "--", "^", "Storage, update")]:
    ys = [gm(d, op, p) for p in P]
    ax.plot(P, ys, ls=ls, marker=mk, color=c, label=f"{name}, {ols(P, ys)[0]:.3g} gas/B")
ax.xaxis.set_major_locator(FixedLocator([0] + P)); ax.yaxis.set_major_formatter(kfmt)
ax.set_xlabel("Attribute payload (bytes)"); ax.set_ylabel("Gas per setAttribute")
ax.set_xlim(0, 270); ax.set_ylim(0, 270000); ax.legend(loc="upper left", handlelength=2.2)
save(fig, "fig1_payload_gas")

# ---- Fig. 2: charged L1 size on OP Sepolia, repeated vs random payload ------------------------
cells, _ = compress_cells(D)
jr = july_rows(D)
fig, ax = plt.subplots(figsize=(COL, 2.05))
ax.axhline(100, color=MUTED, lw=0.8, ls=":")
ax.text(255, 96, "100-byte floor", color=MUTED, fontsize=7.5, va="top", ha="right")
ax.plot(P, [charged_size(cells, "rnd", p) for p in P], "-o", color=INK, label="Random bytes (incompressible)")
ax.plot(P, [charged_size(cells, "rep", p) for p in P], "--s", color=MUTED, label="Repeated byte 0xab")
jp = [32, 256]
ax.plot(jp, [int(july_row(jr, "opSepolia", "erc1056", "setAttribute", p)["l1GasUsed"]) / 16 for p in jp], "D", color=MUTED,
        mfc="white", ms=5, ls="none", label="July receipts (0xab)")
ax.xaxis.set_major_locator(FixedLocator([0] + P)); ax.set_xlim(0, 270); ax.set_ylim(75, 360)
ax.set_xlabel("Attribute payload (bytes)"); ax.set_ylabel("Charged L1 size (bytes)")
ax.legend(loc="upper left")
save(fig, "fig2_l1_size")

# ---- Fig. 3: premium vs data share, Eq. (2), with operating points ----------------------------
eA, sA = july_row(jr, "opSepolia", "erc1056", "setAttribute", 256), july_row(jr, "opSepolia", "storage", "setAttribute", 256)
pA, l2A = int(eA["l1Fee"]) / (int(eA["l1GasUsed"]) / 16), int(eA["effectiveGasPriceWei"])
m = mainnet(D)
ge, gs, L = gas(cells, "rnd", 256, "erc1056"), gas(cells, "rnd", 256, "storage"), charged_size(cells, "rnd", 256)
R256, R32 = gs / ge, gas(cells, "rnd", 32, "storage") / gas(cells, "rnd", 32, "erc1056")
pts = [("A", "o", int(eA["l1Fee"]) / int(eA["totalFeeWei"]), int(sA["totalFeeWei"]) / int(eA["totalFeeWei"])),
       ("B", "s", *premium(ge, gs, L, pA, l2A)[::-1]),
       ("C", "^", *premium(ge, gs, L, m["c_median"], m["egp_p50"])[::-1]),
       ("D", "v", *premium(ge, gs, L, m["c_median"], m["egp_p90"])[::-1]),
       ("E", "D", *premium(ge, gs, L, m["c_median"], m["base_median"])[::-1])]
fig, ax = plt.subplots(figsize=(COL, 2.35))
s = [i / 100 for i in range(101)]
ax.plot([x * 100 for x in s], [R256 - x * (R256 - 1) for x in s], "-", color=INK, lw=1.2)
ax.plot([x * 100 for x in s], [R32 - x * (R32 - 1) for x in s], "--", color=MUTED, lw=1.2)
ax.text(72, R256 - 0.72 * (R256 - 1) + 0.35, "256-B payload", fontsize=7.5, color=INK, rotation=-30, rotation_mode="anchor")
ax.text(14, R32 - 0.14 * (R32 - 1) + 0.12, "32-B payload", fontsize=7.5, color=MUTED, rotation=-10, rotation_mode="anchor")
ax.axhline(1, color=MUTED, lw=0.7, ls=":")
offs = {"A": (6, 4), "B": (7, 2), "C": (-4, -14), "D": (4, 7), "E": (-6, 6)}
for tag, mk, sh, pr in pts:
    ax.plot(sh * 100, pr, mk, color=C_STO, mec="white", mew=0.7, ms=6, zorder=5)
    dx, dy = offs[tag]
    ax.annotate(tag, (sh * 100, pr), xytext=(dx, dy), textcoords="offset points", fontsize=8, fontweight="bold",
                color=INK, ha="left" if dx > 0 else "right")
ax.set_xlabel("L1 data share of the ERC-1056 fee (%)"); ax.set_ylabel("Storage / ERC-1056 fee")
ax.set_xlim(-2, 102); ax.set_ylim(0.6, 7.0)
save(fig, "fig3_premium")
print("  Fig. 3 points:", [(t, round(sh * 100, 1), round(pr, 2)) for t, _, sh, pr in pts], f"R256={R256:.2f} R32={R32:.2f}; mainnet source: {m['label']}")

# ---- Fig. 4: resolution latency vs history length (run 2), median with interquartile band -----
hc, _ = history_cells(D, "did_history_v2.jsonl")
fig, axes = plt.subplots(1, 3, figsize=(DCOL, 2.15), sharey=True)
panels = [("sepolia", "erc1056", "Sepolia (L1)"), ("opSepolia", "erc1056", "OP Sepolia"),
          ("arbSepolia", "erc1056_arbL2", "Arbitrum Sepolia, ArbSys-pointer registry")]
for ax, (net, ed, title) in zip(axes, panels):
    for design, method, c, ls, mk, lbl in [(ed, "spec_walk", C_ERC, "-", "o", "Event walk (spec)"),
                                           (ed, "production_cold", C_ERC, "--", "s", "ethr-did-resolver, cold"),
                                           ("storage", "view_calls", C_STO, "-", "^", "Storage view calls")]:
        xs = [h for h in H if ok_ms(hc.get((net, design, method, h), []))]
        v = [[x / 1000 for x in ok_ms(hc[(net, design, method, h)])] for h in xs]
        ax.fill_between(xs, [pct(a, 25) for a in v], [pct(a, 75) for a in v], color=c, alpha=0.15, lw=0)
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
save(fig, "fig4_history")
