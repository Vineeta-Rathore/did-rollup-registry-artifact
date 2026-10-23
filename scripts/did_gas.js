// SPDX-License-Identifier: MIT
/** Table I and Fig. 1: DID registry lifecycle gas - local Hardhat (Paris EVM).
 * Compares ERC-1056 EthereumDIDRegistry (event-carried attribute data) vs
 * StorageDIDRegistry (state-carried). Fresh identities/names per run keep
 * storage slots cold and comparable; explicit *_update rows measure the warm
 * path. Output: build/did_gas_local.jsonl
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "build", "did_gas_local.jsonl");
const RUNS = 3;
const PAYLOADS = [32, 64, 128, 256];
const DAY = 86400n;

function val(bytes) { return "0x" + "ab".repeat(bytes); }
function name32(tag, i) { return hre.ethers.encodeBytes32String(`${tag}-${i}`.slice(0, 31)); }
const rows = [];

async function meas(design, op, payload, run, txPromise, note) {
  const tx = await txPromise;
  const rc = await tx.wait();
  rows.push({ design, op, payload, run, gasUsed: Number(rc.gasUsed),
              calldataBytes: (tx.data.length - 2) / 2, note: note || "" });
}

async function main() {
  const signers = await hre.ethers.getSigners();
  const s0 = signers[0];
  const erc = await (await hre.ethers.getContractFactory("EthereumDIDRegistry")).deploy();
  const sto = await (await hre.ethers.getContractFactory("StorageDIDRegistry")).deploy();
  await erc.waitForDeployment(); await sto.waitForDeployment();

  const DTYPE = hre.ethers.encodeBytes32String("veriKey");
  const fresh = (i) => hre.ethers.getAddress("0x" + (0x1000 + i).toString(16).padStart(40, "0"));

  // ---- ERC-1056 (identity creation is implicit and free by design) ----
  rows.push({ design: "erc1056", op: "create", payload: 0, run: 0, gasUsed: 0,
              calldataBytes: 0, note: "implicit; free by design" });
  for (let r = 0; r < RUNS; r++) {
    const s = signers[1 + r]; // fresh identity per run
    await meas("erc1056", "changeOwner", 0, r,
      erc.connect(s).changeOwner(s.address, fresh(900 + r)));
  }
  for (let r = 0; r < RUNS; r++)
    await meas("erc1056", "addDelegate", 0, r,
      erc.connect(s0).addDelegate(s0.address, DTYPE, fresh(r), DAY));
  for (let r = 0; r < RUNS; r++)
    await meas("erc1056", "revokeDelegate", 0, r,
      erc.connect(s0).revokeDelegate(s0.address, DTYPE, fresh(r)));
  for (const p of PAYLOADS) {
    for (let r = 0; r < RUNS; r++)
      await meas("erc1056", "setAttribute", p, r,
        erc.connect(s0).setAttribute(s0.address, name32(`ea${p}`, r), val(p), DAY));
    for (let r = 0; r < RUNS; r++)
      await meas("erc1056", "setAttribute_update", p, r,
        erc.connect(s0).setAttribute(s0.address, name32(`ea${p}`, r), val(p), DAY));
    for (let r = 0; r < RUNS; r++)
      await meas("erc1056", "revokeAttribute", p, r,
        erc.connect(s0).revokeAttribute(s0.address, name32(`ea${p}`, r), val(p)),
        "signature carries value bytes");
  }
  for (let r = 0; r < RUNS; r++) {
    const s = signers[4 + r];
    await meas("erc1056", "deactivate", 0, r,
      erc.connect(s).changeOwner(s.address, hre.ethers.ZeroAddress),
      "method-spec deactivation = owner->0x0");
  }

  // ---- StorageDIDRegistry ----
  for (let r = 0; r < RUNS; r++) {
    const s = signers[7 + r];
    await meas("storage", "create", 0, r, sto.connect(s).register(s.address),
      "explicit registration");
  }
  for (let r = 0; r < RUNS; r++) {
    const s = signers[10 + r];
    await meas("storage", "changeOwner", 0, r,
      sto.connect(s).changeOwner(s.address, fresh(910 + r)));
  }
  for (let r = 0; r < RUNS; r++)
    await meas("storage", "addDelegate", 0, r,
      sto.connect(s0).addDelegate(s0.address, DTYPE, fresh(r), DAY));
  for (let r = 0; r < RUNS; r++)
    await meas("storage", "revokeDelegate", 0, r,
      sto.connect(s0).revokeDelegate(s0.address, DTYPE, fresh(r)));
  for (const p of PAYLOADS) {
    for (let r = 0; r < RUNS; r++)
      await meas("storage", "setAttribute", p, r,
        sto.connect(s0).setAttribute(s0.address, name32(`sa${p}`, r), val(p), DAY));
    for (let r = 0; r < RUNS; r++)
      await meas("storage", "setAttribute_update", p, r,
        sto.connect(s0).setAttribute(s0.address, name32(`sa${p}`, r), val(p), DAY));
    for (let r = 0; r < RUNS; r++)
      await meas("storage", "revokeAttribute", p, r,
        sto.connect(s0).revokeAttribute(s0.address, name32(`sa${p}`, r)),
        "delete -> refund applies");
  }
  for (let r = 0; r < RUNS; r++) {
    const s = signers[13 + r];
    await meas("storage", "deactivate", 0, r, sto.connect(s).deactivate(s.address));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`wrote ${rows.length} rows -> ${OUT}`);

  // quick sanity table
  const agg = {};
  for (const r of rows) {
    const k = `${r.design}/${r.op}/${r.payload}`;
    (agg[k] = agg[k] || []).push(r.gasUsed);
  }
  for (const [k, v] of Object.entries(agg))
    console.log(k.padEnd(38), v.join(","));
}

main().catch((e) => { console.error(e); process.exit(1); });
