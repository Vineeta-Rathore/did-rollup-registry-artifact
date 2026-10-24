// SPDX-License-Identifier: MIT
/** Read-only check of the Arbitrum L1 data price behind gasUsedForL1 = 0 on Arbitrum Sepolia.
 * For every July 2026 Arbitrum Sepolia transaction in data/did_l2_measured.jsonl, reads the block
 * number from its receipt and calls ArbGasInfo.getL1BaseFeeEstimate() (precompile 0x6C) at that
 * block, as far as the endpoint still serves that historical state; also reads the current value on
 * Arbitrum Sepolia and Arbitrum One. Appends build/did_arb_l1price.jsonl.
 * Env: [DATA_DIR] (default ../data, then ../build)
 */
const fs = require("fs");
const path = require("path");
const { NETS, BUILD, redact, retry, appendJsonl, ethers } = require("./did_rev_common");

const OUT = path.join(BUILD, "did_arb_l1price.jsonl");
const ABI = ["function getL1BaseFeeEstimate() view returns (uint256)",
  "function getL1PricingSurplus() view returns (int256)"];
const GAS_INFO = "0x000000000000000000000000000000000000006C";

function julyHashes() {
  for (const d of [process.env.DATA_DIR, path.join(__dirname, "..", "data"), BUILD].filter(Boolean)) {
    const f = path.join(d, "did_l2_measured.jsonl");
    if (fs.existsSync(f))
      return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((r) => r.net === "arbSepolia" && r.txHash).map((r) => r.txHash);
  }
  throw new Error("did_l2_measured.jsonl not found");
}

async function main() {
  const ts = new Date().toISOString();
  const sep = new ethers.JsonRpcProvider(NETS.arbSepolia.rpc, 421614, { staticNetwork: true, batchMaxCount: 1 });
  const one = new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc", 42161, { staticNetwork: true, batchMaxCount: 1 });
  const gi = (p) => new ethers.Contract(GAS_INFO, ABI, p);
  for (const [name, p] of [["arbSepolia", sep], ["arbOne", one]]) {
    const head = await retry(() => p.getBlockNumber());
    const v = await retry(() => gi(p).getL1BaseFeeEstimate({ blockTag: head }));
    appendJsonl(OUT, { net: name, kind: "current", block: head, l1BaseFeeEstimateWei: v.toString(), ts });
    console.log(name, "current block", head, "getL1BaseFeeEstimate =", v.toString());
  }
  let ok = 0, unavailable = 0;
  for (const h of julyHashes()) {
    const rc = await retry(() => sep.send("eth_getTransactionReceipt", [h]));
    const bn = Number(rc.blockNumber);
    try {
      const v = await gi(sep).getL1BaseFeeEstimate({ blockTag: bn });
      appendJsonl(OUT, { net: "arbSepolia", kind: "at_receipt_block", txHash: h, block: bn, gasUsedForL1: String(BigInt(rc.gasUsedForL1 || 0)), l1BaseFeeEstimateWei: v.toString(), ts });
      ok++;
    } catch (e) {
      appendJsonl(OUT, { net: "arbSepolia", kind: "at_receipt_block", txHash: h, block: bn, gasUsedForL1: String(BigInt(rc.gasUsedForL1 || 0)), unavailable: redact(e.shortMessage || e.message).slice(0, 100), ts });
      unavailable++;
    }
  }
  console.log(`July receipt blocks: ${ok} read, ${unavailable} historical states unavailable`);
}

main().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
