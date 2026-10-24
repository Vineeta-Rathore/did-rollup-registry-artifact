#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""LaTeX tabular bodies for Tables I-IV of the paper, generated from the raw data so that the typeset
numbers cannot drift from the analysis.
Usage: python analysis/make_tables.py [data_dir] [--out DIR]   (defaults: ../data, ./tables)
Writes tab_gas.tex, tab_premium.tex, tab_methods.tex, tab_versions.tex (tabular environments only)."""
import os, sys
from statistics import median
from common import (P, TIP_DEFAULT, data_dir, steady, erc_replace, july_rows, july_point, tasks, task_premium, mainnet,
                    methods_cells, ok_ms, pct, latest_versions)

D = data_dir(sys.argv)
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "tables")
os.makedirs(OUT, exist_ok=True)
n = lambda v: f"{v:,.0f}"


def write(name, text):
    with open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("wrote", name)


# ---- Table I: gas by operation (local EVM) ----------------------------------------------------
g = steady(D)
rows = [("Create (storage: register)", "0", n(g("storage", "register", "fresh"))),
        ("Rotate owner, first change", n(g("erc1056", "changeOwner", "fresh")), n(g("storage", "changeOwner", "fresh"))),
        ("Rotate owner, later", n(g("erc1056", "changeOwner", "again")), n(g("storage", "changeOwner", "again"))),
        ("Add delegate", n(g("erc1056", "addDelegate", "init")), n(g("storage", "addDelegate", "init"))),
        ("Revoke delegate", n(g("erc1056", "revokeDelegate", "again")), n(g("storage", "revokeDelegate", "again"))),
        ("Deactivate, later", n(g("erc1056", "deactivate", "again")), n(g("storage", "deactivate", "init"))),
        ("Set attribute, 33\\,B", n(g("erc1056", "setAttribute", "init", 33)), n(g("storage", "setAttribute", "init", 33))),
        ("Set attribute, 256\\,B", n(g("erc1056", "setAttribute", "init", 256)), n(g("storage", "setAttribute", "init", 256))),
        ("Replace attribute, 33\\,B", n(erc_replace(g, 33)) + "$^{a}$", n(g("storage", "setAttribute", "replace", 33))),
        ("Replace attribute, 256\\,B", n(erc_replace(g, 256)) + "$^{a}$", n(g("storage", "setAttribute", "replace", 256))),
        ("Revoke attribute, 256\\,B", n(g("erc1056", "revokeAttribute", "again", 256)), n(g("storage", "revokeAttribute", "again", 256)))]
body = "\\begin{tabular}{lrr}\n\\toprule\nOperation & ERC-1056 & Storage \\\\\n\\midrule\n"
body += "".join(f"{a} & {b} & {c} \\\\\n" for a, b, c in rows)
body += "\\bottomrule\n\\multicolumn{3}{l}{\\footnotesize $^{a}$Set plus revoke: two transactions.}\n\\end{tabular}\n"
write("tab_gas.tex", body)

# ---- Table II: fee premium by task and price point ---------------------------------------------
m = mainnet(D)
cA, pA = july_point(july_rows(D))
tk = tasks(D)
points = [(cA, pA), (m["c_median"], m["base_median"]), (m["c_median"], m["base_median"] + TIP_DEFAULT), (m["c_median"], m["egp_p90"])]
names = {"first_33": "First write, 33\\,B key", "first_256": "First write, 256\\,B random", "replace_33": "Replace 33\\,B key"}
body = "\\begin{tabular}{lrrrrr}\n\\toprule\n & Gas & July & Base & Default & Others'\\\\\nTask & ratio & prices & fee only & tip & 90th pct.\\\\\n\\midrule\n"
for key in ["first_33", "first_256", "replace_33"]:
    erc, sto = tk[key]
    ratio = sum(a for a, _ in sto) / sum(a for a, _ in erc)
    body += f"{names[key]} & {ratio:.2f} & " + " & ".join(f"{task_premium(tk[key], c, p):.2f}" for c, p in points) + " \\\\\n"
body += "\\bottomrule\n\\end{tabular}\n"
write("tab_premium.tex", body)

# ---- Table III: resolution strategies at 64 events ---------------------------------------------
mc, setup = methods_cells(D)
labels = [("spec_walk", "Pointer walk"), ("range_seq", "Ranged scan, sequential"), ("range_par", "Ranged scan, parallel"),
          ("storage_seq3", "Storage, 3 sequential reads"), ("storage_full", "Storage, complete read")]
nets = ["sepolia", "opSepolia", "arbSepolia"]
body = "\\begin{tabular}{lrrr}\n\\toprule\nStrategy & Sepolia & OP Sepolia & Arbitrum Sepolia \\\\\n\\midrule\n"
for method, label in labels:
    cells = []
    for net in nets:
        rs = mc.get((net, method), [])
        ms = ok_ms(rs)
        if not ms:
            cells.append("--")
            continue
        calls = median(r["calls"] for r in rs if r.get("calls") is not None)
        cells.append(f"{median(ms)/1000:.2f} ({calls:.0f})" + ("" if len(ms) == len(rs) else f"$^{{b}}$"))
    body += f"{label} & " + " & ".join(cells) + " \\\\\n"
body += "\\bottomrule\n\\end{tabular}\n"
write("tab_methods.tex", body)

# ---- Table IV: resolver releases ----------------------------------------------------------------
vrows, skipped = latest_versions(D)
code = {"CORRECT": "correct", "FAILS OPEN": "open", "FAILS CLOSED": None}
def cell(r):
    if r["verdict"] == "FAILS CLOSED":
        return {"notFound": "notFound", "internalError": "internalError"}.get(r["error"], r["error"])
    return code[r["verdict"]]
cases = {"A": "Arbitrum, owner rotated", "B": "Arbitrum, live key and service", "C": "Arbitrum, third-party identity",
         "D": "Arbitrum, ArbSys-pointer registry", "E": "Sepolia, live key and service", "F": "OP Sepolia, live key and service",
         "G": "Sepolia, owner rotated", "H": "OP Sepolia, owner rotated"}
body = "\\begin{tabular}{@{}llll@{}}\n\\toprule\nCase & 11.0.4 & 14.1.2 & 14.1.4 \\\\\n\\midrule\n"
for cid, label in cases.items():
    rs = {r["version"]: r for r in vrows if r["case"] == cid}
    body += f"{cid}~~{label} & " + " & ".join(cell(rs[v]) for v in ["11.0.4", "14.1.2", "14.1.4"]) + " \\\\\n"
body += "\\bottomrule\n\\end{tabular}\n"
write("tab_versions.tex", body)
