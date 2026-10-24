// SPDX-License-Identifier: MIT
/** Table IV: how three ethr-did-resolver releases behave on Arbitrum, with controls elsewhere.
 * Releases 11.0.4 (pinned by ethr-did 3.0.38, used by Veramo's ethr provider), 14.1.2 (used in the
 * paper's experiments) and 14.1.4 (latest on 2026-10-23). Read-only; public endpoints.
 *
 * Ground truth for every case does not use the registry's pointer chain: identityOwner() plus a
 * topic-filtered eth_getLogs scan of the registry from the day before deployment to the chain head
 * (ranges the endpoint rejects are halved), reduced to the set of entries that are valid now:
 *   key:<x coordinate>   secp256k1 keys set with did/pub/... attributes
 *   svc:<endpoint>       services set with did/svc/... attributes
 *   dlg:<address>        delegates whose validity has not expired
 * The resolved DID document is reduced to the same kind of set (publicKeyJwk or publicKeyHex ->
 * key:, service.serviceEndpoint -> svc:, delegate verification methods -> dlg:). Verdicts:
 *   CORRECT       no error, controller equals the on-chain owner, entry sets equal
 *   FAILS OPEN    no error but a different controller or entry set
 *   FAILS CLOSED  the resolver returned an error
 *   INFRA ERROR   endpoint failure (retried up to three times), not a resolver result
 * Verdicts depend on the run date, because attributes expire.
 * Env: [SEPOLIA_RPC_URL] [OP_RPC] [ARB_RPC]. Appends ../build/did_resolver_versions.jsonl.
 */
const fs = require("fs");
const path = require("path");
let ENV = {};
try { ENV = require("dotenv").parse(fs.readFileSync(path.join(__dirname, "..", ".env"))); } catch (_) { /* no .env: public RPCs */ }
const { ethers } = require("ethers");
const { Resolver } = require("did-resolver");

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || ENV.SEPOLIA_RPC_URL;
const redact = (s) => String(s ?? "").split(SEPOLIA_RPC_URL || "\u0000").join("<rpc-url>").replace(/https?:\/\/[^\s"',)}]+/g, "<url>");
const VERSIONS = ["11.0.4", "14.1.2", "14.1.4"];
const OUT = path.join(__dirname, "..", "build", "did_resolver_versions.jsonl");
const START_ISO = "2026-07-17T00:00:00Z";           // the day before the registries were deployed
const CHAIN = { sepolia: 11155111, opSepolia: 11155420, arbSepolia: 421614 };
const RPC = { // resolution endpoints (as in the history experiment)
  sepolia: SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
  opSepolia: process.env.OP_RPC || ENV.OP_RPC || "https://sepolia.optimism.io",
  arbSepolia: process.env.ARB_RPC || ENV.ARB_RPC || "https://sepolia-rollup.arbitrum.io/rpc" };
// Ground-truth scans need larger ranges than Alchemy's free tier allows on Sepolia.
const SCAN_RPC = { ...RPC, sepolia: process.env.SCAN_SEPOLIA_RPC || ENV.SCAN_SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com" };
const CAP = { sepolia: 10000, opSepolia: 100000, arbSepolia: 10000000 };
const ABI = ["function identityOwner(address) view returns (address)", "function changed(address) view returns (uint256)",
  "event DIDOwnerChanged(address indexed identity, address owner, uint previousChange)",
  "event DIDDelegateChanged(address indexed identity, bytes32 delegateType, address delegate, uint validTo, uint previousChange)",
  "event DIDAttributeChanged(address indexed identity, bytes32 name, bytes value, uint validTo, uint previousChange)"];
const iface = new ethers.Interface(ABI);
const JULY_ID = "0x7ab54d25541FD1309457eE086A06dD0a42a88555";   // July 2026 lifecycle identity (owner rotated at the end)
const REV_ID = "0xd3401C1030aB8800CB89f2694F66f0D0f4853DfC";    // October run-1 identity (live key and service)
const CASES = [
  { id: "A", net: "arbSepolia", registry: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d", identity: JULY_ID, note: "owner rotated, attributes expired" },
  { id: "B", net: "arbSepolia", registry: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d", identity: REV_ID, note: "live key and service" },
  { id: "C", net: "arbSepolia", registry: "0x03d5003bf0e79C5F5223588F347ebA39AfbC3818", identity: "0x1ee1af9515ee75dd4ae571e9da538cbc5fdd3d82", note: "third-party identity on the canonical deployment" },
  { id: "D", net: "arbSepolia", registry: "0x3b3c53ce023b43a5dfc5be10a08549ed3be71559", identity: REV_ID, note: "ArbSys-pointer registry, live key and service" },
  { id: "E", net: "sepolia", registry: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49", identity: REV_ID, note: "control: live key and service on Sepolia" },
  { id: "F", net: "opSepolia", registry: "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D", identity: REV_ID, note: "control: live key and service on OP Sepolia" },
  { id: "G", net: "sepolia", registry: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49", identity: JULY_ID, note: "control: owner rotated on Sepolia" },
  { id: "H", net: "opSepolia", registry: "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D", identity: JULY_ID, note: "control: owner rotated on OP Sepolia" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INFRA = /no backend|rate|429|502|503|504|timeout|ECONNRESET|socket|exceeded|Service Unavailable|Bad Gateway|missing response|coalesce|ETIMEDOUT|fetch/i;
async function retry(fn, tries = 6) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= tries - 1) throw e; await sleep(2000 * (i + 1)); } } }
const TOO_LARGE = /413|too large|range|limit|exceed|too many|more than|response size/i;

async function getLogsAdaptive(prov, address, topic, from, to) {
  try {
    return await prov.send("eth_getLogs", [{ address, fromBlock: ethers.toQuantity(from), toBlock: ethers.toQuantity(to), topics: [null, topic] }]);
  } catch (e) {
    if (to - from < 100 || !TOO_LARGE.test(String(e.shortMessage || e.message))) throw e;
    const mid = Math.floor((from + to) / 2);
    return [...(await getLogsAdaptive(prov, address, topic, from, mid)), ...(await getLogsAdaptive(prov, address, topic, mid + 1, to))];
  }
}
async function blockAtOrAfter(prov, tsSec, head) {
  let lo = 0, hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await retry(() => prov.send("eth_getBlockByNumber", [ethers.toQuantity(mid), false]));
    if (Number(b.timestamp) >= tsSec) hi = mid; else lo = mid + 1;
  }
  return lo;
}

const xOfKeyHex = (hex) => { const h = hex.toLowerCase().replace(/^0x/, ""); return h.length === 64 ? h : h.slice(2, 66); };
const toSet = (a) => [...new Set(a)].sort();

async function truth(c, scanProv, start, head) {
  const reg = new ethers.Contract(c.registry, ABI, scanProv);
  const owner = await retry(() => reg.identityOwner(c.identity));
  const pointer = Number(await retry(() => reg.changed(c.identity)));   // what a pointer walk starts from
  const topic = ethers.zeroPadValue(c.identity, 32);
  const logs = [];
  for (let s = start; s <= head; s += CAP[c.net]) logs.push(...await retry(() => getLogsAdaptive(scanProv, c.registry, topic, s, Math.min(s + CAP[c.net] - 1, head))));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const latest = new Map();                       // (name,value) / (type,delegate) -> validTo, in log order
  for (const lg of logs) {
    const p = iface.parseLog(lg);
    if (p.name === "DIDAttributeChanged") latest.set("a|" + p.args.name + "|" + ethers.hexlify(p.args.value), { name: ethers.decodeBytes32String(p.args.name), value: p.args.value, validTo: p.args.validTo });
    if (p.name === "DIDDelegateChanged") latest.set("d|" + p.args.delegateType + "|" + p.args.delegate, { delegate: p.args.delegate, validTo: p.args.validTo });
  }
  const set = [];
  for (const e of latest.values()) {
    if (e.validTo <= now) continue;
    if (e.delegate) set.push("dlg:" + e.delegate.toLowerCase());
    else if (e.name.startsWith("did/pub/")) set.push("key:" + xOfKeyHex(ethers.hexlify(e.value)));
    else if (e.name.startsWith("did/svc/")) set.push("svc:" + ethers.toUtf8String(e.value));
  }
  return { owner: ethers.getAddress(owner), pointer, events: logs.length, set: toSet(set) };
}

function docSet(doc) {
  const set = []; let controller = null;
  for (const vm of doc.verificationMethod || []) {
    if (/#controller$/.test(vm.id)) { if (vm.blockchainAccountId) controller = ethers.getAddress(vm.blockchainAccountId.split(":").pop()); continue; }
    if (vm.publicKeyJwk && vm.publicKeyJwk.x) set.push("key:" + Buffer.from(vm.publicKeyJwk.x, "base64url").toString("hex"));
    else if (vm.publicKeyHex) set.push("key:" + xOfKeyHex(vm.publicKeyHex));
    else if (vm.blockchainAccountId) set.push("dlg:" + vm.blockchainAccountId.split(":").pop().toLowerCase());
  }
  for (const s of doc.service || []) set.push("svc:" + s.serviceEndpoint);
  return { controller, set: toSet(set) };
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const run = new Date().toISOString();
  const scanProv = {}, startBlock = {}, head = {};
  for (const net of ["sepolia", "opSepolia", "arbSepolia"]) {
    scanProv[net] = new ethers.JsonRpcProvider(SCAN_RPC[net], CHAIN[net], { staticNetwork: true, batchMaxCount: 1 });
    head[net] = await retry(() => scanProv[net].getBlockNumber());
    startBlock[net] = await blockAtOrAfter(scanProv[net], Math.floor(new Date(START_ISO).getTime() / 1000), head[net]);
  }
  for (const c of CASES) {
    let t;
    try { t = await truth(c, scanProv[c.net], startBlock[c.net], head[c.net]); } catch (e) { t = { error: redact(e.shortMessage || e.message).slice(0, 160) }; }
    for (const v of VERSIONS) {
      const { getResolver } = require(`ethr-did-resolver-${v}`);
      const conf = { networks: [{ name: "net", chainId: CHAIN[c.net], rpcUrl: RPC[c.net], registry: c.registry }] };
      if (v.startsWith("14")) conf.cache = null;   // cold resolution; 11.x has no cache option
      const res = new Resolver(getResolver(conf));
      let r, ms, attempts = 0;
      for (;;) {                                    // up to 3 attempts while the failure is a transient endpoint error
        attempts++;
        const t0 = performance.now();
        try { r = await res.resolve(`did:ethr:net:${c.identity}`); } catch (e) { r = { didResolutionMetadata: { error: "threw", message: redact(e.message) } }; }
        ms = performance.now() - t0;
        const m = String(r.didResolutionMetadata?.message || "");
        if (!r.didResolutionMetadata?.error || /No logs found/.test(m) || !INFRA.test(m) || attempts >= 3) break;
        await sleep(5000 * attempts);
      }
      const err = r.didResolutionMetadata?.error || null;
      const msg = String(r.didResolutionMetadata?.message || "");
      const infra = !!err && !/No logs found/.test(msg) && INFRA.test(msg);
      const d = docSet(r.didDocument || {});
      let verdict;
      if (infra) verdict = "INFRA ERROR";
      else if (err) verdict = "FAILS CLOSED";
      else if (!t || t.error) verdict = "UNKNOWN (truth unavailable)";
      else if (d.controller === t.owner && JSON.stringify(d.set) === JSON.stringify(t.set)) verdict = "CORRECT";
      else verdict = "FAILS OPEN";
      const row = { run, case: c.id, net: c.net, note: c.note, version: v, registry: c.registry, identity: c.identity,
        error: err, message: err ? redact(msg).slice(0, 160) : null, controller: d.controller, truthOwner: t && t.owner, pointer: t && t.pointer,
        docSet: d.set, truthSet: t && t.set, truthEvents: t && t.events, ms: Math.round(ms), attempts, verdict, ts: new Date().toISOString() };
      fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
      console.log(`${c.id} ${c.net.padEnd(10)} v${v.padEnd(6)} ${verdict.padEnd(13)} err=${err} owner ${d.controller === (t && t.owner) ? "ok" : "differs"} docEntries=${d.set.length} truthEntries=${t && t.set ? t.set.length : "?"}`);
    }
  }
}
main().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
