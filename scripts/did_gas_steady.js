// SPDX-License-Identifier: MIT
/** Table I (initialization vs steady state): DID registry gas on the local Hardhat EVM,
 * separating the one-time cost of touching a storage slot for the first time from the
 * cost of an operation on an identity whose slots are already in use.
 *
 * Phases (column `phase`):
 *   fresh  - the first operation on an identity with no prior state;
 *   init   - the identity is initialised (ERC-1056: `changed` pointer written; storage
 *            registry: registered) but the slots this operation writes are still empty;
 *   again  - the slots this operation writes already hold non-zero values.
 * `replace` rows overwrite an attribute with a DIFFERENT value of the same size (the
 * storage registry's real replacement; ERC-1056 has no replace, it needs set + revoke).
 * Identities are deterministic wallets (keccak256 of a label), so runs are repeatable;
 * each configuration is run RUNS times on separate identities.
 * Output: build/did_gas_steady.jsonl
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "build", "did_gas_steady.jsonl");
const RUNS = 3;
const DAY = 86400n;
const SIZES = [32, 33, 64, 128, 256];
const { ethers } = hre;
const rows = [];

const wallet = (label) => new ethers.Wallet(ethers.keccak256(ethers.toUtf8Bytes("steady:" + label)), ethers.provider);
async function funded(label) {
  const w = wallet(label);
  await hre.network.provider.send("hardhat_setBalance", [w.address, "0x56BC75E2D63100000"]); // 100 ETH
  return w;
}
const val = (bytes, fill) => "0x" + fill.repeat(bytes);
const name32 = (tag) => ethers.encodeBytes32String(tag.slice(0, 31));
const addr = (label) => wallet("addr:" + label).address;

async function m(design, op, phase, payload, run, txPromise, note) {
  const tx = await txPromise;
  const rc = await tx.wait();
  rows.push({ design, op, phase, payload, run, gasUsed: Number(rc.gasUsed), calldataBytes: (tx.data.length - 2) / 2, note: note || "" });
}

async function main() {
  const erc = await (await hre.ethers.getContractFactory("EthereumDIDRegistry")).deploy();
  const sto = await (await hre.ethers.getContractFactory("StorageDIDRegistry")).deploy();
  await erc.waitForDeployment(); await sto.waitForDeployment();
  const T = ethers.encodeBytes32String("veriKey");
  const ercAs = (w) => erc.connect(w);
  const stoAs = (w) => sto.connect(w);

  for (let r = 0; r < RUNS; r++) {
    // ---------- ERC-1056 ----------
    // first operation of a fresh identity = rotation / deactivation (pointer AND owner slot written)
    let a = await funded(`ercA${r}`);
    await m("erc1056", "changeOwner", "fresh", 0, r, ercAs(a).changeOwner(a.address, addr(`o${r}`)));
    let c = await funded(`ercC${r}`);
    await m("erc1056", "deactivate", "fresh", 0, r, ercAs(c).changeOwner(c.address, ethers.ZeroAddress), "owner -> 0x0");
    // identity B: pointer initialised by a delegate, then everything else
    const b = await funded(`ercB${r}`);
    await m("erc1056", "addDelegate", "fresh", 0, r, ercAs(b).addDelegate(b.address, T, addr(`d1${r}`), DAY), "also writes the pointer");
    await m("erc1056", "addDelegate", "init", 0, r, ercAs(b).addDelegate(b.address, T, addr(`d2${r}`), DAY));
    await m("erc1056", "addDelegate", "again", 0, r, ercAs(b).addDelegate(b.address, T, addr(`d2${r}`), DAY), "extends an existing delegate");
    await m("erc1056", "revokeDelegate", "again", 0, r, ercAs(b).revokeDelegate(b.address, T, addr(`d2${r}`)));
    for (const p of SIZES) {
      const nm = name32(`k${p}-${r}`);
      await m("erc1056", "setAttribute", "init", p, r, ercAs(b).setAttribute(b.address, nm, val(p, "ab"), DAY), "events only; no storage slot for the value");
      await m("erc1056", "setAttribute", "again", p, r, ercAs(b).setAttribute(b.address, nm, val(p, "cd"), DAY), "append: a second valid value for the same name");
      await m("erc1056", "revokeAttribute", "again", p, r, ercAs(b).revokeAttribute(b.address, nm, val(p, "ab")), "must resend the value");
    }
    const o1 = await funded(`ercO1${r}`), o2 = await funded(`ercO2${r}`);
    await m("erc1056", "changeOwner", "init", 0, r, ercAs(b).changeOwner(b.address, o1.address), "pointer written, owner slot empty");
    await m("erc1056", "changeOwner", "again", 0, r, ercAs(o1).changeOwner(b.address, o2.address), "owner slot already written");
    await m("erc1056", "deactivate", "again", 0, r, ercAs(o2).changeOwner(b.address, ethers.ZeroAddress), "owner -> 0x0, slot cleared");

    // ---------- Storage registry ----------
    const d = await funded(`stoD${r}`);
    await m("storage", "register", "fresh", 0, r, stoAs(d).register(d.address), "optional; writes registered and owners");
    const so1 = await funded(`stoO1${r}`), so2 = await funded(`stoO2${r}`);
    await m("storage", "changeOwner", "init", 0, r, stoAs(d).changeOwner(d.address, so1.address), "after registration (owner slot written)");
    await m("storage", "changeOwner", "again", 0, r, stoAs(so1).changeOwner(d.address, so2.address));
    await m("storage", "deactivate", "init", 0, r, stoAs(so2).deactivate(d.address), "sets the deactivated flag");
    const e = await funded(`stoE${r}`);
    await m("storage", "changeOwner", "fresh", 0, r, stoAs(e).changeOwner(e.address, addr(`so${r}`)), "unregistered identity: writes the owner slot");
    const f = await funded(`stoF${r}`);
    await m("storage", "deactivate", "fresh", 0, r, stoAs(f).deactivate(f.address), "unregistered identity");
    const g = await funded(`stoG${r}`);
    await m("storage", "addDelegate", "init", 0, r, stoAs(g).addDelegate(g.address, T, addr(`d1${r}`), DAY));
    await m("storage", "addDelegate", "again", 0, r, stoAs(g).addDelegate(g.address, T, addr(`d1${r}`), DAY), "extends an existing delegate");
    await m("storage", "revokeDelegate", "again", 0, r, stoAs(g).revokeDelegate(g.address, T, addr(`d1${r}`)));
    for (const p of SIZES) {
      const nm = name32(`k${p}-${r}`);
      await m("storage", "setAttribute", "init", p, r, stoAs(g).setAttribute(g.address, nm, val(p, "ab"), DAY), "first write of a new name");
      await m("storage", "setAttribute", "again_same", p, r, stoAs(g).setAttribute(g.address, nm, val(p, "ab"), DAY), "same value, new validTo (the earlier Table I 'update')");
      await m("storage", "setAttribute", "replace", p, r, stoAs(g).setAttribute(g.address, nm, val(p, "cd"), DAY), "different value of the same size");
      await m("storage", "revokeAttribute", "again", p, r, stoAs(g).revokeAttribute(g.address, nm), "delete; refund applies");
    }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  console.log(`wrote ${rows.length} rows -> ${OUT}`);
  const agg = {};
  for (const x of rows) (agg[`${x.design}/${x.op}/${x.phase}/${x.payload}`] ||= []).push(x.gasUsed);
  for (const [k, v] of Object.entries(agg)) console.log(k.padEnd(44), v.join(","));
}

main().catch((e) => { console.error(e); process.exit(1); });
