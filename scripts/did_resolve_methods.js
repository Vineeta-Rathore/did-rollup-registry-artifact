// SPDX-License-Identifier: MIT
/** Table III: resolution strategies compared at the final state of the 64-event histories
 * (read-only; no transactions). On each network, interleaved in rotating order, ROUNDS times:
 *   spec_walk     pointer walk of the did:ethr specification: one eth_getLogs per history block
 *                 (sequential by construction; on Arbitrum against the ArbSys-pointer registry)
 *   range_seq     topic-filtered eth_getLogs over [deployment day, head] in chunks of the endpoint's
 *                 range cap, one chunk after the other, halving any range the endpoint rejects as too
 *                 large (needs no pointer; works on the unmodified ERC-1056 registry on Arbitrum)
 *   range_par     the same chunks with CONC requests in flight
 *   storage_seq3  owner + two known attributes, three sequential view calls (as in Fig. 3)
 *   storage_full  owner, deactivated flag and both attributes with their validTo, one parallel round
 * Every result is checked for correctness (exactly the service and the current key; for storage also
 * not deactivated and not expired). Needs build/did_history_state_<NET>_v2.json from did_history.js.
 * Env: NET=sepolia|opSepolia|arbSepolia [ROUNDS=20] [CONC=6] [SCAN_SEPOLIA_RPC] [SCAN_START_ISO]
 * Output: build/did_resolve_methods.jsonl. Each run appends one session of ROUNDS rounds, opened by a setup row;
 * Table III of the paper pools two sessions per network (rows are assigned to sessions by timestamp in analysis/common.py).
 */
const fs = require("fs");
const path = require("path");
const { NETS, BUILD, ENV, artifact, redact, retry, appendJsonl, ethers } = require("./did_rev_common");

const NET = process.env.NET;
const ROUNDS = Number(process.env.ROUNDS || 20);
const CONC = Number(process.env.CONC || 6);
const OUT = path.join(BUILD, "did_resolve_methods.jsonl");
// Largest range that each public endpoint accepted for a filtered eth_getLogs in our probe (Oct 2026).
const CAP = { sepolia: 10000, opSepolia: 100000, arbSepolia: 10000000 };
const RPC = { ...Object.fromEntries(Object.entries(NETS).map(([k, v]) => [k, v.rpc])),
  // the Alchemy free tier allows 10 blocks per eth_getLogs, so ranged scans on Sepolia use a public endpoint
  sepolia: ENV.SCAN_SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com" };
const START_ISO = ENV.SCAN_START_ISO || "2026-07-17T00:00:00Z"; // the day before the registries were deployed

// Must match did_history.js (same identity layout and expected document).
const SVC_NAME = ethers.encodeBytes32String("did/svc/DIDCommMessaging");
const KEY_NAME = ethers.encodeBytes32String("did/pub/Secp256k1/veriKey/hex");
const SVC_VALUE = ethers.hexlify(ethers.toUtf8Bytes("https://didcomm.example.org/inbox"));
const KEY_IDX = 31; // H = 64 events -> 31 key rotations
const keyAt = (j) => new ethers.SigningKey(ethers.keccak256(ethers.toUtf8Bytes(`history-key:${NET}:${j}`))).compressedPublicKey;

const prov = new ethers.JsonRpcProvider(RPC[NET], NETS[NET].chainId, { staticNetwork: true, batchMaxCount: 1 });
const ercI = new ethers.Interface(artifact("EthereumDIDRegistry").abi);
const sto = new ethers.Contract(NETS[NET].sto, artifact("StorageDIDRegistry").abi, prov);
const st = JSON.parse(fs.readFileSync(path.join(BUILD, `did_history_state_${NET}_v2.json`), "utf8"));
const ID = st.identity;
const idTopic = ethers.zeroPadValue(ID, 32);
const WALK_REG = st.arbL2 || NETS[NET].erc;   // registry whose pointers are usable for the walk
const SCAN_REG = NETS[NET].erc;               // the unmodified registry (also on Arbitrum)

function evaluate(evs) {          // evs: [{b, li, k, validTo}], any order
  evs.sort((a, b) => (a.b === b.b ? b.li - a.li : a.b > b.b ? -1 : 1)); // newest first
  const now = BigInt(Math.floor(Date.now() / 1000));
  const seen = new Set(), active = new Set();
  for (const e of evs) { if (seen.has(e.k)) continue; seen.add(e.k); if (e.validTo > now) active.add(e.k); }
  return active.size === 2 && active.has(SVC_NAME + SVC_VALUE) && active.has(KEY_NAME + keyAt(KEY_IDX));
}
const toEv = (lg) => {
  const p = ercI.parseLog({ topics: lg.topics, data: lg.data });
  return { p, ev: p.name === "DIDAttributeChanged" ? { b: BigInt(lg.blockNumber), li: Number(lg.logIndex), k: p.args.name + ethers.hexlify(p.args.value), validTo: p.args.validTo } : null };
};

async function specWalk() {
  const t0 = performance.now();
  let calls = 1, block = BigInt(await prov.call({ to: WALK_REG, data: ercI.encodeFunctionData("changed", [ID]) }));
  const evs = [];
  while (block !== 0n) {
    const logs = await prov.send("eth_getLogs", [{ address: WALK_REG, fromBlock: ethers.toQuantity(block), toBlock: ethers.toQuantity(block), topics: [null, idTopic] }]);
    calls++;
    if (logs.length === 0) break;
    let prev = 0n;
    for (const lg of logs) { const { p, ev } = toEv(lg); if (ev) evs.push(ev); const pc = BigInt(p.args.previousChange); if (pc < block && pc > prev) prev = pc; }
    block = prev;
  }
  return { ms: performance.now() - t0, calls, events: evs.length, ok: evaluate(evs) };
}

let CHUNKS = null;
// A resolver that scans ranges has to adapt to the endpoint: when a range is rejected as too large
// (HTTP 413, "range", "limit", "exceed", "too many"), split it in half and retry; every request,
// successful or not, is counted.
const TOO_LARGE = /413|too large|range|limit|exceed|too many|more than|response size/i;
async function fetchChunk([from, to], counter) {
  counter.n++;
  try {
    const logs = await prov.send("eth_getLogs", [{ address: SCAN_REG, fromBlock: ethers.toQuantity(from), toBlock: ethers.toQuantity(to), topics: [null, idTopic] }]);
    return logs.map((lg) => toEv(lg).ev).filter(Boolean);
  } catch (e) {
    if (to - from < 1000 || !TOO_LARGE.test(String(e.shortMessage || e.message))) throw e;
    counter.splits++;
    const mid = Math.floor((from + to) / 2);
    return [...(await fetchChunk([from, mid], counter)), ...(await fetchChunk([mid + 1, to], counter))];
  }
}
async function rangeSeq() {
  const t0 = performance.now(); const evs = []; const counter = { n: 0, splits: 0 };
  for (const c of CHUNKS) evs.push(...(await fetchChunk(c, counter)));
  return { ms: performance.now() - t0, calls: counter.n, splits: counter.splits, events: evs.length, ok: evaluate(evs) };
}
async function rangePar() {
  const t0 = performance.now(); const evs = []; const counter = { n: 0, splits: 0 }; let i = 0;
  await Promise.all(Array.from({ length: CONC }, async () => { while (i < CHUNKS.length) { const c = CHUNKS[i++]; evs.push(...(await fetchChunk(c, counter))); } }));
  return { ms: performance.now() - t0, calls: counter.n, splits: counter.splits, events: evs.length, ok: evaluate(evs) };
}
async function storageSeq3() {
  const t0 = performance.now();
  const owner = await sto.identityOwner(ID); const svc = await sto.getAttribute(ID, SVC_NAME); const key = await sto.getAttribute(ID, KEY_NAME);
  return { ms: performance.now() - t0, calls: 3, ok: owner === ID && ethers.hexlify(svc[0]) === SVC_VALUE && ethers.hexlify(key[0]) === keyAt(KEY_IDX) };
}
async function storageFull() {
  const t0 = performance.now();
  const [owner, deact, svc, key] = await Promise.all([sto.identityOwner(ID), sto.deactivated(ID), sto.getAttribute(ID, SVC_NAME), sto.getAttribute(ID, KEY_NAME)]);
  const now = BigInt(Math.floor(Date.now() / 1000));
  return { ms: performance.now() - t0, calls: 4, ok: owner === ID && !deact && svc[1] > now && key[1] > now && ethers.hexlify(svc[0]) === SVC_VALUE && ethers.hexlify(key[0]) === keyAt(KEY_IDX) };
}

async function blockAtOrAfter(tsSec, head) {   // first block with timestamp >= tsSec (binary search over block headers)
  let lo = 0, hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await retry(() => prov.send("eth_getBlockByNumber", [ethers.toQuantity(mid), false]));
    if (Number(b.timestamp) >= tsSec) hi = mid; else lo = mid + 1;
  }
  return lo;
}

async function main() {
  const head = await retry(() => prov.getBlockNumber());
  const start = await blockAtOrAfter(Math.floor(new Date(START_ISO).getTime() / 1000), head);
  CHUNKS = [];
  for (let s = start; s <= head; s += CAP[NET]) CHUNKS.push([s, Math.min(s + CAP[NET] - 1, head)]);
  const host = new URL(RPC[NET]).hostname;
  appendJsonl(OUT, { net: NET, setup: { identity: ID, walkRegistry: WALK_REG, scanRegistry: SCAN_REG, storage: NETS[NET].sto, keyIdx: KEY_IDX,
    startIso: START_ISO, startBlock: start, headBlock: head, cap: CAP[NET], chunks: CHUNKS.length, conc: CONC, host, rounds: ROUNDS }, ts: new Date().toISOString() });
  console.log(`${NET}: scan range ${start}..${head} = ${CHUNKS.length} chunks of ${CAP[NET]} blocks (${host})`);
  const methods = [["spec_walk", specWalk], ["range_seq", rangeSeq], ["range_par", rangePar], ["storage_seq3", storageSeq3], ["storage_full", storageFull]];
  await retry(() => prov.getBlockNumber());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const NETWORK = /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up|network|fetch failed/i;
  for (let round = 0; round < ROUNDS; round++) {
    let rows, attempt = 0;
    for (;;) {                       // a round hit by a network outage is repeated (up to 3 attempts), not recorded
      attempt++;
      rows = [];
      for (let i = 0; i < methods.length; i++) {
        const [name, f] = methods[(i + round) % methods.length];
        let res;
        try { res = await f(); } catch (e) { res = { ms: null, ok: false, error: redact(e.shortMessage || e.message).slice(0, 160) }; }
        rows.push({ net: NET, round, method: name, ...res, host, ts: new Date().toISOString() });
      }
      const down = rows.filter((r) => !r.ok && r.error && NETWORK.test(r.error));
      if (!down.length || attempt >= 3) break;
      console.log(`${NET} round ${round}: ${down.length} network errors, repeating the round (attempt ${attempt})`);
      await sleep(30000);
    }
    for (const r of rows) appendJsonl(OUT, { ...r, attempts: attempt });   // a round is written only when complete
    console.log(`${NET} round ${round}: ` + rows.map((r) => `${r.method}=${r.ms ? (r.ms / 1000).toFixed(2) + "s" : "ERR"}${r.ok ? "" : "!"}`).join(" "));
  }
  console.log("done", NET);
}

main().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
