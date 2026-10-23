/** Paper 4 revision: how three ethr-did-resolver releases behave on Arbitrum.
 * 11.0.4 (pinned by ethr-did 3.0.38, used by Veramo's ethr provider), 14.1.2 (used in the
 * paper's experiments) and 14.1.4 (latest on 2026-10-23). Read-only; public RPCs.
 * Each case is compared with on-chain truth: identityOwner() and the identity's events found
 * by a ranged eth_getLogs over a known L2 block window (independent of the pointer chain).
 * Verdicts: CORRECT (no error, controller and attribute keys match the truth),
 *           FAILS CLOSED (error returned), FAILS OPEN (no error but the document is wrong).
 * Env: SEPOLIA_RPC_URL (from ../.env). Appends ../build/did_resolver_versions.jsonl.
 */
const fs = require("fs");
const path = require("path");
// Read only the Sepolia RPC URL from ../.env (never PRIVATE_KEY), without touching process.env.
let ENV = {};
try { ENV = require("dotenv").parse(require("fs").readFileSync(path.join(__dirname, "..", ".env"))); } catch (_) { /* no .env: public RPCs */ }
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || ENV.SEPOLIA_RPC_URL;
const redact = (s) => String(s ?? "").split(SEPOLIA_RPC_URL || "\u0000").join("<rpc-url>").replace(/https?:\/\/[^\s"',)}]+/g, "<url>");
const { ethers } = require("ethers");
const { Resolver } = require("did-resolver");

const VERSIONS = ["11.0.4", "14.1.2", "14.1.4"];
const OUT = path.join(__dirname, "..", "build", "did_resolver_versions.jsonl");
const RPC = { sepolia: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
  opSepolia: process.env.OP_RPC || ENV.OP_RPC || "https://sepolia.optimism.io",
  arbSepolia: process.env.ARB_RPC || ENV.ARB_RPC || "https://sepolia-rollup.arbitrum.io/rpc" };
const CHUNK = { sepolia: 10, opSepolia: 100000, arbSepolia: 1000000 };
// Transient infrastructure failures of public endpoints; never matches the resolver's own
// "No logs found for block ... previousChange points here" failure.
const INFRA = /no backend|rate|429|502|503|504|timeout|ECONNRESET|socket|exceeded|Service Unavailable|Bad Gateway|missing response/i;
const retry = async (fn, tries = 6) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= tries - 1) throw e; await new Promise((r) => setTimeout(r, 2000 * (i + 1))); } } };
const CHAIN = { sepolia: 11155111, opSepolia: 11155420, arbSepolia: 421614 };
const ABI = ["function identityOwner(address) view returns (address)", "function changed(address) view returns (uint256)",
  "event DIDOwnerChanged(address indexed identity, address owner, uint previousChange)",
  "event DIDDelegateChanged(address indexed identity, bytes32 delegateType, address delegate, uint validTo, uint previousChange)",
  "event DIDAttributeChanged(address indexed identity, bytes32 name, bytes value, uint validTo, uint previousChange)"];

// window = [fromBlock, toBlock] containing every event of the identity: the ranged scan gives the ground
// truth (still-valid entries at run time) independently of the pointer chain. Verdicts depend on the run
// date, because attributes expire (the revision identities' entries are valid until about Oct 2027).
const CASES = [
  { id: "A", net: "arbSepolia", note: "paper's July identity; owner rotated on chain; attributes expired",
    registry: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d", identity: "0x7ab54d25541FD1309457eE086A06dD0a42a88555", window: [288846000, 288846600] },
  { id: "B", net: "arbSepolia", note: "revision identity (H=64, live service + key) on the unmodified registry",
    registry: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d", identity: "0xd3401C1030aB8800CB89f2694F66f0D0f4853DfC", window: [321859000, 321866500] },
  { id: "C", net: "arbSepolia", note: "third-party identity on the canonical registry deployment",
    registry: "0x03d5003bf0e79C5F5223588F347ebA39AfbC3818", identity: "0x1ee1af9515ee75dd4ae571e9da538cbc5fdd3d82", window: [292556000, 292587500] },
  { id: "D", net: "arbSepolia", note: "revision identity on the ArbSys.arbBlockNumber() registry variant",
    registry: "0x3b3c53ce023b43a5dfc5be10a08549ed3be71559", identity: "0xd3401C1030aB8800CB89f2694F66f0D0f4853DfC", window: [321859000, 321866500] },
  { id: "E", net: "sepolia", note: "control: revision identity on Sepolia (L1)",
    registry: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49", identity: "0xd3401C1030aB8800CB89f2694F66f0D0f4853DfC", window: [11972500, 11972660] },
  { id: "F", net: "opSepolia", note: "control: revision identity on OP Sepolia",
    registry: "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D", identity: "0xd3401C1030aB8800CB89f2694F66f0D0f4853DfC", window: [50452600, 50453750] },
];

async function truth(c, prov, iface) {
  const owner = await prov.call({ to: c.registry, data: iface.encodeFunctionData("identityOwner", [c.identity]) });
  const out = { owner: ethers.getAddress("0x" + owner.slice(26)), pointer: Number(BigInt(await prov.call({ to: c.registry, data: iface.encodeFunctionData("changed", [c.identity]) }))) };
  if (c.window) { // ranged scan: count events and compute the still-valid attribute set
    const logs = [];
    const step = CHUNK[c.net];   // some providers cap eth_getLogs ranges (Alchemy free tier: 10 blocks)
    for (let from = c.window[0]; from <= c.window[1]; from += step) {
      const to = Math.min(c.window[1], from + step - 1);
      logs.push(...await retry(() => prov.send("eth_getLogs", [{ address: c.registry, fromBlock: ethers.toBeHex(from), toBlock: ethers.toBeHex(to),
        topics: [null, ethers.zeroPadValue(c.identity, 32)] }])));
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    const latest = new Map();
    for (const lg of logs) {
      const p = iface.parseLog(lg);
      if (p.name === "DIDAttributeChanged") latest.set(p.args.name + ethers.hexlify(p.args.value), p.args.validTo);
      if (p.name === "DIDDelegateChanged") latest.set("dlg" + p.args.delegateType + p.args.delegate, p.args.validTo);
    }
    out.events = logs.length;
    out.eventBlocks = [...new Set(logs.map((l) => Number(l.blockNumber)))];
    out.validEntries = [...latest.values()].filter((v) => v > now).length;
  }
  return out;
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const run = new Date().toISOString();
  const iface = new ethers.Interface(ABI);
  for (const c of CASES) {
    const prov = new ethers.JsonRpcProvider(RPC[c.net], CHAIN[c.net], { staticNetwork: true });
    let t = null;
    try { t = await retry(() => truth(c, prov, iface)); } catch (e) { t = { error: redact(e.shortMessage || e.message).slice(0, 160) }; }
    for (const v of VERSIONS) {
      const { getResolver } = require(`ethr-did-resolver-${v}`);
      const conf = { networks: [{ name: "net", chainId: CHAIN[c.net], rpcUrl: RPC[c.net], registry: c.registry }] };
      if (v.startsWith("14")) conf.cache = null; // cold resolution; 11.x has no cache option
      const res = new Resolver(getResolver(conf));
      const did = `did:ethr:net:${c.identity}`;
      let r, ms, attempts = 0;
      for (;;) {          // up to 3 attempts while the failure is a transient endpoint error
        attempts++;
        const t0 = performance.now();
        try { r = await res.resolve(did); } catch (e) { r = { didResolutionMetadata: { error: "threw", message: redact(e.message) } }; }
        ms = performance.now() - t0;
        const m = String(r.didResolutionMetadata?.message || "");
        if (!r.didResolutionMetadata?.error || /No logs found/.test(m) || !INFRA.test(m) || attempts >= 3) break;
        await new Promise((res2) => setTimeout(res2, 5000 * attempts));
      }
      const infra = !!r.didResolutionMetadata?.error && !/No logs found/.test(String(r.didResolutionMetadata?.message || "")) && INFRA.test(String(r.didResolutionMetadata?.message || ""));
      const doc = r.didDocument || {};
      const ctrl = (doc.verificationMethod || []).find((m) => /#controller$/.test(m.id));
      const controller = ctrl && ctrl.blockchainAccountId ? ethers.getAddress(ctrl.blockchainAccountId.split(":").pop()) : null;
      const err = r.didResolutionMetadata?.error || null;
      const entries = (doc.verificationMethod || []).filter((m) => !/#controller(Key)?$/.test(m.id)).length + (doc.service || []).length;
      let verdict;
      if (infra) verdict = "INFRA ERROR (endpoint failure, not a resolver result)";
      else if (!t || t.error || t.validEntries === undefined) verdict = err ? "FAILS CLOSED (truth unavailable)" : "UNKNOWN (truth unavailable)";
      else if (err) verdict = "FAILS CLOSED";
      else if (controller === t.owner && t.validEntries === entries) verdict = "CORRECT";
      else verdict = "FAILS OPEN";
      const row = { run, case: c.id, net: c.net, note: c.note, version: v, registry: c.registry, identity: c.identity,
        error: err, message: err ? redact(r.didResolutionMetadata.message || "").slice(0, 160) : null,
        controller, truthOwner: t && t.owner, pointer: t && t.pointer, truthEvents: t && t.events, truthEventBlocks: t && t.eventBlocks,
        truthValidEntries: t && t.validEntries, docEntries: entries, ms: Math.round(ms), attempts, verdict, ts: new Date().toISOString() };
      fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.log(`${c.id} ${c.net} v${v}: ${verdict}  err=${err} controller=${controller} truthOwner=${t && t.owner} entries=${entries}/${t && t.validEntries} pointer=${t && t.pointer}`);
    }
  }
}
main().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
