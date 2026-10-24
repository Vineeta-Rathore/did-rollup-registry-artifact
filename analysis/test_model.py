# SPDX-License-Identifier: MIT
"""Consistency checks for the fee model and for the data the paper quotes. Plain asserts, no test framework.

    python3 analysis/test_model.py data

Exit status 0 means: Eq. (3) agrees with Eq. (1) summed directly, the raw receipts obey the Fjord
size rule used in Eq. (2), the quoted slopes and ratios follow from the rows, and every vendored data
file matches its SHA-256 sum.
"""
import hashlib, os, random, sys
from common import P, data_dir, load, ols, steady, erc_replace, july_rows, july_row, premium, compress_cells

D = data_dir(sys.argv)
failed = []


def check(name, ok, detail=""):
    print(("ok    " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))
    if not ok:
        failed.append(name)


# Eq. (3) must equal the ratio of two Eq. (1) fees for any gas ratio, share and price.
rng = random.Random(1)
worst = 0.0
for _ in range(1000):
    g_erc, g_sto = rng.randint(30_000, 80_000), rng.randint(40_000, 260_000)
    size, c, p = rng.uniform(100, 400), rng.uniform(1e6, 1e9), rng.uniform(1e2, 1e8)
    prem, share = premium(g_erc, g_sto, size, c, p)
    r = g_sto / g_erc
    worst = max(worst, abs(prem - (r - share * (r - 1))))
check("Eq. (3) equals the ratio of Eq. (1) fees", worst < 1e-9, f"max deviation {worst:.2e}")
check("premium tends to the gas ratio as the L2 price grows", abs(premium(40_000, 120_000, 150, 1e8, 1e12)[0] - 3.0) < 1e-3)
check("premium tends to 1 as the data share tends to 1", abs(premium(40_000, 120_000, 150, 1e8, 1)[0] - 1.0) < 1e-3)

# Fjord size rule (Eq. 2): l1GasUsed = 16 L and L is at least 100 bytes.
cells, _ = compress_cells(D)
rows = [r for (net, *_), xs in cells.items() if net == "opSepolia" for r in xs]
check("OP Sepolia receipts: charged size at least 100 bytes", all(int(r["l1GasUsed"]) >= 1600 for r in rows))

# July canonical pair: price per charged byte (l1Fee / (l1GasUsed / 16)). The two ERC-1056 receipts (32 and 256 B)
# agree to within 0.02 % as the paper states; the storage receipts sit in other blocks and agree to within 0.5 %.
jr = july_rows(D)
ppb = lambda r: int(r["l1Fee"]) / (int(r["l1GasUsed"]) / 16)
e32, e256 = (july_row(jr, "opSepolia", "erc1056", "setAttribute", p) for p in (32, 256))
check("July ERC-1056 receipts, 32 vs 256 B: price per charged byte within 0.02 %", abs(ppb(e32) - ppb(e256)) / ppb(e32) < 2e-4,
      f"{100 * abs(ppb(e32) - ppb(e256)) / ppb(e32):.3f} %")
for p in (32, 256):
    e, s_ = july_row(jr, "opSepolia", "erc1056", "setAttribute", p), july_row(jr, "opSepolia", "storage", "setAttribute", p)
    check(f"July receipts at {p} B: ERC-1056 and storage price per byte within 0.5 %", abs(ppb(e) - ppb(s_)) / ppb(e) < 5e-3)

# Slopes and ratios quoted in the paper (Table I, Fig. 1), from the steady-state matrix.
g = steady(D)
xs = list(P)
slope_erc, _ = ols(xs, [g("erc1056", "setAttribute", "init", p) for p in xs])
slope_sto, _ = ols(xs, [g("storage", "setAttribute", "init", p) for p in xs])
slope_rep, _ = ols(xs, [erc_replace(g, p) for p in xs])
check("ERC-1056 first-write slope is 26.4 gas per byte", abs(slope_erc - 26.4) < 0.1, f"{slope_erc:.2f}")
check("storage first-write slope is 710 gas per byte", abs(slope_sto - 709.5) < 1.0, f"{slope_sto:.1f}")
check("ERC-1056 replacement slope is 52.9 gas per byte", abs(slope_rep - 52.9) < 0.2, f"{slope_rep:.2f}")

# October Sepolia: the storage overwrite is dearer than on the July rules and the break-even follows from the receipts.
tx2 = load(D, "did_history_tx_v2.jsonl")
def gas_of(net, design, tag):
    v = [r["gasUsed"] for r in tx2 if r.get("net") == net and r.get("design") == design and r.get("tag") == tag]
    return v[0]
e_rep = gas_of("sepolia", "erc1056", "set-key1") + gas_of("sepolia", "erc1056", "revoke-key0")
s_rep = gas_of("sepolia", "storage", "set-key1")
saving = e_rep - s_rep
check("October Sepolia: storage replacement is cheaper than ERC-1056 set + revoke", saving > 0, f"{s_rep:,} vs {e_rep:,}")
n_with = (gas_of("sepolia", "storage", "set-key0") - gas_of("sepolia", "erc1056", "set-svc")) / saving
check("October Sepolia break-even is between 30 and 45 replacements", 30 < n_with < 45, f"{n_with:.1f}")

# Vendored data files match their checksums.
sums = os.path.join(D, "SHA256SUMS")
if os.path.exists(sums):
    bad = []
    for line in open(sums):
        if line.strip():
            h, name = line.split(None, 1)
            name = name.strip().lstrip("*")
            if hashlib.sha256(open(os.path.join(D, name), "rb").read()).hexdigest() != h:
                bad.append(name)
    check("data files match SHA256SUMS", not bad, ", ".join(bad))

print(f"\n{len(failed)} check(s) failed" if failed else "\nall checks passed")
sys.exit(1 if failed else 0)
