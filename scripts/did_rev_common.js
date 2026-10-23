/** Paper 4 revision: shared helpers for did_compress.js and did_history.js.
 * Fresh measurement identities are derived deterministically from PRIVATE_KEY
 * (keccak256(key || label)), so no new secret is stored and runs are resumable.
 * The funding wallet (PRIVATE_KEY) only tops these identities up. Keys are never
 * printed or written to disk.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
// Parse .env into a private object instead of process.env, so third-party packages loaded
// by the read-only scripts never see PRIVATE_KEY. Real environment variables still win.
const ENV = { ...(require("dotenv").config({ path: path.join(__dirname, "..", ".env"), processEnv: {} }).parsed || {}), ...process.env };

/** Remove RPC URLs (which may embed API keys) from any string before it is logged or saved. */
function redact(s) {
  let out = String(s ?? "");
  for (const u of [ENV.SEPOLIA_RPC_URL, ENV.OP_RPC, ENV.ARB_RPC, ENV.OPMAIN_RPC, ENV.ARB1_RPC].filter(Boolean)) out = out.split(u).join("<rpc-url>");
  return out.replace(/https?:\/\/[^\s"',)}]+/g, "<url>");
}

const NETS = {
  local: { rpc: ENV.LOCAL_RPC || "http://127.0.0.1:8545", chainId: 31337 },
  sepolia: { rpc: ENV.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", chainId: 11155111,
    erc: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49", sto: "0x3Fd09677bA5Bb0C0e1db8f90955523Db1c4a97FE" },
  opSepolia: { rpc: ENV.OP_RPC || "https://sepolia.optimism.io", chainId: 11155420,
    erc: "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D", sto: "0x278612A4da3D085B0d6359e9Ba1eA442Da16b13B" },
  arbSepolia: { rpc: ENV.ARB_RPC || "https://sepolia-rollup.arbitrum.io/rpc", chainId: 421614,
    erc: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d", sto: "0x54007A660AE6ebf0dAb901117CB8d9B8BF26bC8F" },
};
const BUILD = path.join(__dirname, "..", "build");

function artifact(name) {
  const p = path.join(__dirname, "..", "artifacts", "contracts", "did", name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function provider(net) {
  const cfg = NETS[net];
  if (!cfg || !cfg.rpc) throw new Error(`unknown net or missing RPC: ${net}`);
  // staticNetwork: never hang on network auto-detection against a dead endpoint
  return new ethers.JsonRpcProvider(cfg.rpc, cfg.chainId, { staticNetwork: true });
}

function rootKey() {
  const k = ENV.PRIVATE_KEY;
  if (!k) throw new Error("PRIVATE_KEY missing in .env");
  return k.startsWith("0x") ? k : "0x" + k;
}

function derivedWallet(label, prov) {
  const pk = ethers.keccak256(ethers.concat([rootKey(), ethers.toUtf8Bytes("paper4-revision:" + label)]));
  return new ethers.Wallet(pk, prov);
}

/** Top up `who` to at least `minWei` from the funding wallet (or hardhat_setBalance locally). */
async function ensureFunded(net, prov, who, minWei) {
  const bal = await retry(() => prov.getBalance(who));
  if (bal >= minWei) return bal;
  if (net === "local") {
    await prov.send("hardhat_setBalance", [who, ethers.toBeHex(ethers.parseEther("10"))]);
    return prov.getBalance(who);
  }
  const funder = new ethers.Wallet(rootKey(), prov);
  const rec = await sendTx(net, prov, funder, who, "0x", { op: "fund" }, null, minWei - bal);
  console.log(`funded ${who} with ${ethers.formatEther(minWei - bal)} ETH (tx ${rec.txHash})`);
  return retry(() => prov.getBalance(who));
}

// Arbitrum gasUsed includes L1 gas units, so a fixed 400k limit could be too tight there.
const GAS_LIMIT = { local: 3_000_000n, sepolia: 600_000n, opSepolia: 600_000n, arbSepolia: 2_000_000n };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Errors that cannot succeed on retry (bad call, bad argument): fail fast instead of backing off.
const PERMANENT = new Set(["CALL_EXCEPTION", "INVALID_ARGUMENT", "UNSUPPORTED_OPERATION", "BAD_DATA", "NUMERIC_FAULT"]);
/** Retry a read-only RPC call through transient failures (ECONNRESET, 429, timeouts). */
async function retry(fn, tries = 8) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (PERMANENT.has(e && e.code) || i >= tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

const nonces = new Map(); // address -> next nonce; every tx is confirmed before the next is signed
/** Poll a receipt by hash until mined (or give up after ~6 min). */
async function waitReceipt(prov, hash) {
  for (let i = 0; i < 180; i++) {
    let raw = null;
    try { raw = await prov.send("eth_getTransactionReceipt", [hash]); } catch (_) { /* transient */ }
    if (raw && raw.blockNumber) return raw;
    await sleep(2000);
  }
  throw new Error("no receipt after 6 min for " + hash);
}

/** Send one tx and return a flat record. The tx is signed locally and its hash handed to
 * onSigned BEFORE broadcast, so a caller can persist it and recover after a crash;
 * rebroadcasting the same signed bytes is idempotent. `wallet` must be a plain Wallet. */
async function sendTx(net, prov, wallet, to, data, meta, onSigned, value = 0n) {
  const from = wallet.address;
  if (!nonces.has(from)) nonces.set(from, await retry(() => prov.getTransactionCount(from, "latest")));
  const fee = await retry(() => prov.getFeeData());
  const req = { to, data, value, gasLimit: GAS_LIMIT[net], nonce: nonces.get(from), chainId: NETS[net].chainId, type: 2,
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n, maxFeePerGas: (fee.maxFeePerGas ?? fee.gasPrice) * 2n };
  let signed = await wallet.signTransaction(req);
  let hash = ethers.keccak256(signed);
  if (onSigned) onSigned(hash);
  for (let i = 0; ; i++) {
    try { await prov.broadcastTransaction(signed); break; } catch (e) {
      const m = String(e.shortMessage || e.message);
      if (/already known|known transaction|already imported/i.test(m)) break;
      if (/nonce too low|nonce has already been used/i.test(m)) {
        // Our own earlier broadcast may have landed; if not, the nonce was used by another tx: re-sign.
        if (await retry(() => prov.getTransaction(hash))) break;
        req.nonce = await retry(() => prov.getTransactionCount(from, "pending"));
        signed = await wallet.signTransaction(req);
        hash = ethers.keccak256(signed);
        if (onSigned) onSigned(hash);
        continue;
      }
      if (i >= 7) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  const raw = await waitReceipt(prov, hash);
  nonces.set(from, req.nonce + 1);
  if (Number(raw.status) !== 1) throw new Error(`reverted: ${hash}`);
  return receiptRecord(net, raw, signed, data, meta);
}

/** Flatten a raw receipt (plus the signed bytes, when known) into one JSONL row. */
function receiptRecord(net, raw, signed, data, meta) {
  const big = (v) => (v == null ? null : BigInt(v).toString());
  const hash = raw.transactionHash;
  const serialized = signed;
  const gasPrice = BigInt(raw.effectiveGasPrice);
  let total = BigInt(raw.gasUsed) * gasPrice;
  if (raw.l1Fee) total += BigInt(raw.l1Fee);
  return {
    net, ...meta, txHash: hash, block: Number(raw.blockNumber), contractAddress: raw.contractAddress || null,
    gasUsed: Number(BigInt(raw.gasUsed)), effectiveGasPriceWei: gasPrice.toString(),
    calldataBytes: data ? (data.length - 2) / 2 : null, signedTxBytes: serialized ? (serialized.length - 2) / 2 : null,
    // OP Stack (Ecotone/Fjord) receipt fields; l1GasUsed = 16 * FastLZ-estimated size post-Fjord
    l1GasUsed: big(raw.l1GasUsed), l1Fee: big(raw.l1Fee), l1BaseFeeWei: big(raw.l1GasPrice),
    l1BlobBaseFeeWei: big(raw.l1BlobBaseFee), l1BaseFeeScalar: big(raw.l1BaseFeeScalar),
    l1BlobBaseFeeScalar: big(raw.l1BlobBaseFeeScalar),
    // Arbitrum Nitro receipt fields
    gasUsedForL1: big(raw.gasUsedForL1), l1BlockNumber: big(raw.l1BlockNumber),
    totalFeeWei: total.toString(),
    ts: new Date().toISOString(),
  };
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + "\n");
}

module.exports = { NETS, BUILD, ENV, artifact, provider, derivedWallet, ensureFunded, sendTx, waitReceipt, receiptRecord,
  retry, redact, appendJsonl, ethers };
