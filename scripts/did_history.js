// SPDX-License-Identifier: MIT
/** Fig. 4 (Sec. V-C): resolution latency versus history length,
 * and the ArbSys.arbBlockNumber() pointer fix on Arbitrum.
 *
 * One fresh identity per network keeps a constant DID document - one service
 * endpoint and one secp256k1 verification key - while its key is rotated
 * repeatedly. In ERC-1056 a rotation is setAttribute(new key) followed by
 * revokeAttribute(old key), i.e. two events, so the event history grows while
 * the document does not. In the storage registry a rotation overwrites one slot.
 * At event-history checkpoints H in {2,4,8,16,32,64} each resolver is timed
 * ROUNDS times, interleaved with a rotating order, and every resolution is
 * checked for correctness (exactly the service and the CURRENT key):
 *   spec walk  - changed() then one eth_getLogs per history block (did:ethr spec)
 *   production - npm ethr-did-resolver (getLogs + getBlock per history block)
 *   storage    - three view calls (identityOwner + two getAttribute)
 * On arbSepolia the same operations also go, in lockstep, to a registry that
 * stores ArbSys.arbBlockNumber() as its pointer (EthereumDIDRegistryArbL2).
 *
 * Env: NET=sepolia|opSepolia|arbSepolia [ROUNDS=20] [MAX_H=64] [RUN=v1|v2] [SMOKE=1 for a trial run]
 *
 * RUN=v2 (revision): ethr-did-resolver v14 enables an in-memory cache by default that stores
 * getLogs/getBlock results for FINALIZED blocks, so repeated resolutions in one process get
 * progressively cheaper. v1 used that default, so its production timings mix cold and warm
 * resolutions. v2 uses a fresh identity, times the production resolver with the cache disabled
 * (cache: null, "production_cold"), and after the last checkpoint waits until the history is
 * finalized and times warm repeat resolutions with the default cache ("production_warm").
 * State (resumable): build/did_history_state_<NET>.json
 * Output: build/did_history.jsonl (timings), build/did_history_tx.jsonl (receipts)
 */
const fs = require("fs");
const path = require("path");
const { Resolver } = require("did-resolver");
const { getResolver } = require("ethr-did-resolver");
const { NETS, BUILD, artifact, provider, derivedWallet, ensureFunded, sendTx, waitReceipt, receiptRecord, retry, redact, appendJsonl, ethers } = require("./did_rev_common");

const NET = process.env.NET;
const ROUNDS = Number(process.env.ROUNDS || 20);
const MAX_H = Number(process.env.MAX_H || 64);
const CHECKPOINTS = [2, 4, 8, 16, 32, 64].filter((h) => h <= MAX_H);
const SMOKE = process.env.SMOKE === "1"; // tiny trial run: separate identity and files
const RUN = process.env.RUN || "v2";   // v1 = first run (production timings used the default cache)
const SFX = (SMOKE ? "_smoke" : "") + (RUN === "v1" ? "" : `_${RUN}`);
const STATE = path.join(BUILD, `did_history_state_${NET}${SFX}.json`);
const OUT = path.join(BUILD, `did_history${SFX}.jsonl`);
const TXOUT = path.join(BUILD, `did_history_tx${SFX}.jsonl`);
const YEAR = 365n * 86400n;
const SVC_NAME = ethers.encodeBytes32String("did/svc/DIDCommMessaging");
const KEY_NAME = ethers.encodeBytes32String("did/pub/Secp256k1/veriKey/hex");
const SVC_URL = "https://didcomm.example.org/inbox";
const SVC_VALUE = ethers.hexlify(ethers.toUtf8Bytes(SVC_URL));
// Real 33-byte compressed secp256k1 public keys, deterministic per index (the resolver
// decompresses them into publicKeyJwk, so they must be valid curve points).
const keyAt = (j) => new ethers.SigningKey(ethers.keccak256(ethers.toUtf8Bytes(`history-key:${NET}:${j}`))).compressedPublicKey;
const xOf = (compressed) => compressed.slice(4).toLowerCase(); // drop 0x and the 02/03 parity byte

const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : null);
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

// ERC-1056 op k (0-based): 0 set svc, 1 set key0, then rotation j>=1 = ops 2j (set key j), 2j+1 (revoke key j-1).
function ercOp(k) {
  if (k === 0) return { fn: "setAttribute", name: SVC_NAME, value: SVC_VALUE, validity: YEAR, tag: "set-svc" };
  if (k === 1) return { fn: "setAttribute", name: KEY_NAME, value: keyAt(0), validity: YEAR, tag: "set-key0" };
  const j = Math.floor(k / 2);
  return k % 2 === 0
    ? { fn: "setAttribute", name: KEY_NAME, value: keyAt(j), validity: YEAR, tag: `set-key${j}` }
    : { fn: "revokeAttribute", name: KEY_NAME, value: keyAt(j - 1), tag: `revoke-key${j - 1}` };
}

async function specWalk(prov, iface, reg, identity, keyIdx) {
  const t0 = performance.now();
  let calls = 1;
  let block = BigInt(await prov.call({ to: reg, data: iface.encodeFunctionData("changed", [identity]) }));
  const idTopic = ethers.zeroPadValue(identity, 32);
  const evs = [];
  let emptyAt = null;
  while (block !== 0n) {
    const logs = await prov.send("eth_getLogs", [{ address: reg, fromBlock: ethers.toBeHex(block),
      toBlock: ethers.toBeHex(block), topics: [null, idTopic] }]);
    calls++;
    if (logs.length === 0) { emptyAt = block.toString(); break; } // the walk silently ends here
    let prev = 0n;
    for (const lg of logs) {
      const p = iface.parseLog({ topics: lg.topics, data: lg.data });
      if (p.name === "DIDAttributeChanged")
        evs.push({ b: BigInt(lg.blockNumber), li: Number(lg.logIndex), k: p.args.name + ethers.hexlify(p.args.value), validTo: p.args.validTo });
      const pc = BigInt(p.args.previousChange);
      if (pc < block && pc > prev) prev = pc;
    }
    block = prev;
  }
  const ms = performance.now() - t0;
  evs.sort((a, b) => (a.b === b.b ? b.li - a.li : a.b > b.b ? -1 : 1)); // newest first
  const now = BigInt(Math.floor(Date.now() / 1000));
  const seen = new Set(), active = new Set();
  for (const e of evs) { if (seen.has(e.k)) continue; seen.add(e.k); if (e.validTo > now) active.add(e.k); }
  const ok = active.size === 2 && active.has(SVC_NAME + SVC_VALUE) && active.has(KEY_NAME + keyAt(keyIdx));
  return { ms, calls, events: evs.length, ok, emptyAt };
}

async function prodResolve(resolver, did, keyIdx) {
  const t0 = performance.now();
  const res = await resolver.resolve(did);
  const ms = performance.now() - t0;
  const err = res.didResolutionMetadata?.error || null;
  const doc = res.didDocument || {};
  // v14 emits secp256k1 keys as publicKeyJwk (or publicKeyHex); compare by x-coordinate
  const xs = (doc.verificationMethod || []).map((v) =>
    v.publicKeyJwk?.x ? Buffer.from(v.publicKeyJwk.x, "base64url").toString("hex")
      : v.publicKeyHex ? v.publicKeyHex.toLowerCase().slice(-64) : null).filter(Boolean);
  const pks = xs;
  const cur = xOf(keyAt(keyIdx));
  const stale = Array.from({ length: keyIdx }, (_, j) => xOf(keyAt(j))).some((k) => pks.includes(k));
  const svcOk = (doc.service || []).length === 1 && doc.service[0].serviceEndpoint === SVC_URL;
  // exactly one key beyond the default #controller method, as for the spec walk
  const nonController = (doc.verificationMethod || []).filter((v) => !/#controller(Key)?$/.test(v.id)).length;
  return { ms, ok: !err && pks.includes(cur) && !stale && svcOk && nonController === 1, error: err,
    message: err ? redact(res.didResolutionMetadata.message || "").slice(0, 200) : null };
}

async function viewCalls(prov, sto, identity, keyIdx) {
  const t0 = performance.now();
  const owner = await sto.identityOwner(identity);
  const svc = await sto.getAttribute(identity, SVC_NAME);
  const key = await sto.getAttribute(identity, KEY_NAME);
  const ms = performance.now() - t0;
  const ok = owner === identity && ethers.hexlify(svc[0]) === SVC_VALUE && ethers.hexlify(key[0]) === keyAt(keyIdx);
  return { ms, calls: 3, ok };
}

async function main() {
  if (!["sepolia", "opSepolia", "arbSepolia"].includes(NET)) throw new Error("set NET to sepolia|opSepolia|arbSepolia");
  const cfg = NETS[NET];
  const prov = provider(NET);
  const id = derivedWallet(SMOKE ? (process.env.SMOKE_LABEL || "history-smoke") : `history-${RUN}`, prov);
  const me = id.address;
  await ensureFunded(NET, prov, me, NET === "sepolia" ? ethers.parseEther("0.003") : ethers.parseEther("0.001"));
  const signer = id; // plain Wallet: sendTx tracks the nonce and persists each tx hash before broadcast
  const ercArt = artifact("EthereumDIDRegistry"), stoArt = artifact("StorageDIDRegistry");
  const ercI = new ethers.Interface(ercArt.abi), stoI = new ethers.Interface(stoArt.abi);
  const sto = new ethers.Contract(cfg.sto, stoArt.abi, prov);

  let st = loadState() || { identity: me, arbL2: null, events: {}, sto: { registered: false, svc: false, key: -1 }, measured: [] };
  if (st.identity !== me) throw new Error("state file belongs to a different identity");
  // Every state-changing tx: persist {hash, effect} before broadcast, apply the effect only after
  // a successful receipt. On restart a pending entry is resolved from its receipt, so a crash
  // between broadcast and bookkeeping can neither lose nor duplicate a history event.
  const apply = (eff, rec) => {
    if (eff.kind === "event") st.events[eff.label] = eff.k + 1;
    else if (eff.kind === "stoReg") st.sto.registered = true;
    else if (eff.kind === "stoSvc") st.sto.svc = true;
    else if (eff.kind === "stoKey") st.sto.key = eff.j;
    else if (eff.kind === "deployArbL2") st.arbL2 = rec.contractAddress;
    if (rec && rec.block) st.lastBlock = Math.max(st.lastBlock || 0, rec.block);
  };
  const tx = async (to, data, meta, eff) => {
    const r = await sendTx(NET, prov, signer, to, data, meta, (hash) => { st.pending = { hash, eff, meta }; saveState(st); });
    appendJsonl(TXOUT, r); apply(eff, r); st.pending = null; saveState(st);
    return r;
  };
  if (st.pending) {
    const raw = await retry(() => prov.send("eth_getTransactionReceipt", [st.pending.hash]));
    const known = raw || (await retry(() => prov.getTransaction(st.pending.hash)));
    if (known) {
      const r = raw && raw.blockNumber ? raw : await waitReceipt(prov, st.pending.hash);
      if (Number(r.status) === 1) {
        appendJsonl(TXOUT, receiptRecord(NET, r, null, null, { ...st.pending.meta, recovered: true }));
        apply(st.pending.eff, { contractAddress: r.contractAddress, block: Number(r.blockNumber) });
      }
    }
    console.log(`recovered pending ${st.pending.hash}: ${known ? "mined" : "never broadcast"}`);
    st.pending = null; saveState(st);
  }

  if (NET === "arbSepolia" && !st.arbL2) {
    const fixArt = artifact("EthereumDIDRegistryArbL2");
    const r = await tx(null, fixArt.bytecode, { design: "erc1056_arbL2", op: "deploy" }, { kind: "deployArbL2" });
    console.log("deployed EthereumDIDRegistryArbL2 at", st.arbL2, "tx", r.txHash);
  }
  const eventRegs = [{ label: "erc1056", addr: cfg.erc }];
  if (st.arbL2) eventRegs.push({ label: "erc1056_arbL2", addr: st.arbL2 });
  for (const r of eventRegs) st.events[r.label] = st.events[r.label] || 0;
  console.log(`net=${NET} identity=${me} regs=${eventRegs.map((r) => r.label + ":" + r.addr).join(" ")} sto=${cfg.sto}`);

  // v1: library default (in-memory cache of finalized blocks ON). v2: cache disabled for cold timings.
  const mkResolver = (addr, cold) => new Resolver(getResolver({ networks: [{ name: "net", chainId: cfg.chainId, rpcUrl: cfg.rpc, registry: addr }],
    ...(cold ? { cache: null } : {}) }));
  const PROD = RUN === "v1" ? "production" : "production_cold";
  const resolvers = {};
  for (const r of eventRegs) resolvers[r.label] = mkResolver(r.addr, RUN !== "v1");
  const did = `did:ethr:net:${me}`;

  for (const H of CHECKPOINTS) {
    const keyIdx = (H - 2) / 2;
    for (const r of eventRegs) {           // advance each event registry to H events
      while (st.events[r.label] < H) {
        const k = st.events[r.label], op = ercOp(k);
        const args = op.fn === "setAttribute" ? [me, op.name, op.value, op.validity] : [me, op.name, op.value];
        await tx(r.addr, ercI.encodeFunctionData(op.fn, args), { design: r.label, op: op.fn, tag: op.tag, eventIndex: k },
          { kind: "event", label: r.label, k });
      }
    }
    if (!st.sto.registered) {
      if (await retry(() => sto.registered(me))) { st.sto.registered = true; saveState(st); }
      else await tx(cfg.sto, stoI.encodeFunctionData("register", [me]), { design: "storage", op: "create" }, { kind: "stoReg" });
    }
    if (!st.sto.svc)
      await tx(cfg.sto, stoI.encodeFunctionData("setAttribute", [me, SVC_NAME, SVC_VALUE, YEAR]),
        { design: "storage", op: "setAttribute", tag: "set-svc" }, { kind: "stoSvc" });
    while (st.sto.key < keyIdx) {          // storage rotation = overwrite one attribute
      const j = st.sto.key + 1;
      await tx(cfg.sto, stoI.encodeFunctionData("setAttribute", [me, KEY_NAME, keyAt(j), YEAR]),
        { design: "storage", op: "setAttribute", tag: `set-key${j}` }, { kind: "stoKey", j });
    }
    if (st.measured.includes(H)) continue;

    const methods = [];
    for (const r of eventRegs) {
      methods.push({ m: "spec_walk", design: r.label, f: () => specWalk(prov, ercI, r.addr, me, keyIdx) });
      methods.push({ m: PROD, design: r.label, f: () => prodResolve(resolvers[r.label], did, keyIdx) });
    }
    methods.push({ m: "view_calls", design: "storage", f: () => viewCalls(prov, sto, me, keyIdx) });
    await retry(() => prov.getBlockNumber()); // warm the connection outside timing
    const buf = [];                           // written only when the checkpoint completes, so a crash
    for (let round = 0; round < ROUNDS; round++) {   // and restart cannot leave duplicate rounds behind
      for (let i = 0; i < methods.length; i++) {
        const x = methods[(i + round) % methods.length];
        let res;
        try { res = await x.f(); } catch (e) { res = { ms: null, ok: false, error: redact(e.shortMessage || e.message).slice(0, 200) }; }
        buf.push({ net: NET, H, round, method: x.m, design: x.design, ...res, ts: new Date().toISOString() });
      }
    }
    for (const row of buf) appendJsonl(OUT, row);
    st.measured.push(H); saveState(st);
    console.log(`${NET} H=${H} measured (${ROUNDS} rounds x ${methods.length} methods)`);
  }

  // Warm repeat resolutions with the library-default cache, once the whole history is finalized.
  if (RUN !== "v1" && !st.warmDone && CHECKPOINTS.includes(64)) {
    const keyIdx = 31;
    const deadline = Date.now() + 90 * 60 * 1000;
    let fin = 0;
    while (Date.now() < deadline) {
      const b = await retry(() => prov.getBlock("finalized")).catch(() => null);
      fin = b ? b.number : 0;
      if (fin >= st.lastBlock) break;
      console.log(`${NET} waiting for finality: finalized ${fin} < last event block ${st.lastBlock}`);
      await new Promise((res) => setTimeout(res, 60000));
    }
    if (fin < st.lastBlock) {
      console.log(`${NET} history not finalized within 90 min; rerun later to measure the warm cache`);
    } else {
      const warm = {};
      for (const r of eventRegs) {
        warm[r.label] = mkResolver(r.addr, false);
        const w = await prodResolve(warm[r.label], did, keyIdx).catch((e) => ({ ms: null, ok: false, error: redact(e.message).slice(0, 200) }));
        appendJsonl(OUT, { net: NET, H: 64, round: -1, method: "production_warmup", design: r.label, ...w, ts: new Date().toISOString() });
      }
      for (let round = 0; round < ROUNDS; round++)
        for (const r of eventRegs) {
          let res;
          try { res = await prodResolve(warm[r.label], did, keyIdx); } catch (e) { res = { ms: null, ok: false, error: redact(e.shortMessage || e.message).slice(0, 200) }; }
          appendJsonl(OUT, { net: NET, H: 64, round, method: "production_warm", design: r.label, ...res, ts: new Date().toISOString() });
        }
      st.warmDone = true; saveState(st);
      console.log(`${NET} warm-cache resolutions done`);
    }
  }
  console.log("done", NET);
}

main().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
