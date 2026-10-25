/** Table II price points: read-only sample of MAINNET fee conditions, used only to place
 * operating points on the fee model (nothing is sent on mainnet).
 * Every INTERVAL_MIN minutes, for SAMPLES rounds (default: 48 rounds, one every 30 min), the script
 * reads one recent block on each chain (head - 5) and the receipts of all its user
 * transactions. Public endpoints serve receipts only for recent blocks, so the sample is
 * collected forward in time. At most MAX_PER_SENDER rows are kept per sender over the whole
 * run, so that a few bots cannot dominate; senders are stored only as a short hash.
 *  - OP Mainnet: l1GasUsed (= 16 x charged size), l1Fee, effectiveGasPrice, block base fee;
 *    the L1 price per charged byte is l1Fee / (l1GasUsed / 16) for each transaction.
 *  - Arbitrum One: gasUsedForL1, gasUsed, effectiveGasPrice, block base fee.
 * A later run can continue an earlier one: it restores the per-sender counts from the output file and
 * numbers its rounds from START_ROUND (the first run used 0..47, the continuations 48..61 and 62).
 * Env: [SAMPLES=48] [START_ROUND=0] [INTERVAL_MIN=30] [MAX_PER_SENDER=5] [OPMAIN_RPC] [ARB1_RPC]
 * Appends build/did_mainnet_snapshot_24h.jsonl (a header row per chain, then one row per tx).
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { BUILD, ENV, retry, redact, appendJsonl } = require("./did_rev_common");

const SAMPLES = Number(ENV.SAMPLES || 48);
const START_ROUND = Number(ENV.START_ROUND || 0);
const INTERVAL_MIN = Number(ENV.INTERVAL_MIN || 30);
const MAX_PER_SENDER = Number(ENV.MAX_PER_SENDER || 5);
const OUT = path.join(BUILD, "did_mainnet_snapshot_24h.jsonl");
const CHAINS = [
  { net: "opMainnet", chainId: 10, rpc: ENV.OPMAIN_RPC || "https://mainnet.optimism.io", skipType: "0x7e",
    pick: (r) => (BigInt(r.l1GasUsed || 0) > 0n ? { l1GasUsed: BigInt(r.l1GasUsed).toString(), l1Fee: BigInt(r.l1Fee || 0).toString() } : null) },
  { net: "arbOne", chainId: 42161, rpc: ENV.ARB1_RPC || "https://arb1.arbitrum.io/rpc", skipType: "0x6a",
    pick: (r) => ({ gasUsedForL1: BigInt(r.gasUsedForL1 || 0).toString() }) },
];
const senderTag = (a) => ethers.keccak256(ethers.toUtf8Bytes(String(a).toLowerCase())).slice(2, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sampleOnce(c, prov, perSender, round) {
  const bn = (await retry(() => prov.getBlockNumber())) - 5;
  const blk = await retry(() => prov.send("eth_getBlockByNumber", [ethers.toQuantity(bn), false]));
  if (!blk) throw new Error(`block ${bn} unavailable`);
  // one call per block where the endpoint supports it, otherwise one receipt per transaction
  let rcs = await prov.send("eth_getBlockReceipts", [ethers.toQuantity(bn)]).catch(() => null);
  if (!Array.isArray(rcs)) {
    rcs = [];
    for (const h of blk.transactions) rcs.push(await retry(() => prov.send("eth_getTransactionReceipt", [h])));
    rcs = rcs.filter(Boolean);
  }
  let kept = 0, users = 0;
  for (const r of rcs) {
    if (r.type === c.skipType) continue;                         // system / deposit txs carry no user fee
    users++;
    const extra = c.pick(r);
    if (!extra) continue;
    const tag = senderTag(r.from);
    const n = perSender.get(tag) || 0;
    if (n >= MAX_PER_SENDER) continue;
    perSender.set(tag, n + 1);
    appendJsonl(OUT, { net: c.net, round, block: Number(blk.number), blockTime: new Date(Number(blk.timestamp) * 1000).toISOString(),
      baseFeeWei: BigInt(blk.baseFeePerGas).toString(), sender: tag, gasUsed: BigInt(r.gasUsed).toString(),
      effectiveGasPriceWei: BigInt(r.effectiveGasPrice).toString(), ...extra });
    kept++;
  }
  return { block: Number(blk.number), users, kept };
}

async function main() {
  const provs = CHAINS.map((c) => new ethers.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true, batchMaxCount: 1 }));
  const perSender = CHAINS.map(() => new Map());
  if (fs.existsSync(OUT))                                         // continuation: keep the cap over the whole sample
    for (const line of fs.readFileSync(OUT, "utf8").split(/\r?\n/)) {
      if (!line) continue;
      const r = JSON.parse(line), i = CHAINS.findIndex((c) => c.net === r.net);
      if (i >= 0 && r.sender) perSender[i].set(r.sender, (perSender[i].get(r.sender) || 0) + 1);
    }
  for (const c of CHAINS)
    appendJsonl(OUT, { net: c.net, header: { samples: SAMPLES, startRound: START_ROUND, intervalMin: INTERVAL_MIN, maxPerSender: MAX_PER_SENDER, start: new Date().toISOString() } });
  for (let round = START_ROUND; round < START_ROUND + SAMPLES; round++) {
    const t0 = Date.now();
    for (let i = 0; i < CHAINS.length; i++) {
      try {
        const s = await sampleOnce(CHAINS[i], provs[i], perSender[i], round);
        console.log(`${new Date().toISOString()} round ${round} ${CHAINS[i].net} block ${s.block}: ${s.users} user txs, ${s.kept} kept`);
      } catch (e) {
        appendJsonl(OUT, { net: CHAINS[i].net, round, missed: redact(e.shortMessage || e.message).slice(0, 160) });
        console.log(`round ${round} ${CHAINS[i].net}: missed (${redact(e.shortMessage || e.message).slice(0, 80)})`);
      }
    }
    if (round < START_ROUND + SAMPLES - 1) await sleep(Math.max(0, INTERVAL_MIN * 60000 - (Date.now() - t0)));
  }
  console.log("done");
}

main().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
