// SPDX-License-Identifier: MIT
/** Read-only check that the OP Stack operator fee (Isthmus and later) was zero where we measured.
 * Receipts carry operatorFeeScalar / operatorFeeConstant only when one of them is non-zero, so the
 * script counts, among SAMPLE recent non-deposit receipts of OP Sepolia and OP Mainnet, how many
 * carry either field. Fee fields of the same receipts (l1Fee, l1GasUsed) are checked for presence.
 * It also reads operatorFeeScalar(), operatorFeeConstant() and version() from the L1Block predeploy
 * (0x4200...0015), which hold the parameters themselves.
 * Env: [SAMPLE=200] [OPMAIN_RPC]. Appends build/did_operator_fee_check.jsonl.
 */
const path = require("path");
const { ethers } = require("ethers");
const { NETS, BUILD, ENV, retry, redact, appendJsonl } = require("./did_rev_common");

const SAMPLE = Number(ENV.SAMPLE || 200);
const OUT = path.join(BUILD, "did_operator_fee_check.jsonl");
const L1BLOCK = "0x4200000000000000000000000000000000000015";
const readUint = async (prov, fn) => BigInt(await retry(() => prov.call({ to: L1BLOCK, data: ethers.id(fn).slice(0, 10) }))).toString();
async function readVersion(prov) {
  const r = await retry(() => prov.call({ to: L1BLOCK, data: ethers.id("version()").slice(0, 10) }));
  return ethers.toUtf8String(ethers.getBytes("0x" + r.slice(130, 130 + 2 * Number(BigInt("0x" + r.slice(66, 130))))));
}
const CHAINS = [{ net: "opSepolia", chainId: 11155420, rpc: NETS.opSepolia.rpc },
  { net: "opMainnet", chainId: 10, rpc: ENV.OPMAIN_RPC || "https://mainnet.optimism.io" }];

async function main() {
  const ts = new Date().toISOString();
  for (const c of CHAINS) {
    const prov = new ethers.JsonRpcProvider(c.rpc, c.chainId, { staticNetwork: true, batchMaxCount: 1 });
    let bn = await retry(() => prov.getBlockNumber()), seen = 0, withOperator = 0, withL1 = 0;
    while (seen < SAMPLE) {
      const blk = await retry(() => prov.send("eth_getBlockByNumber", [ethers.toQuantity(bn--), false]));
      for (const h of blk.transactions) {
        if (seen >= SAMPLE) break;
        const r = await retry(() => prov.send("eth_getTransactionReceipt", [h]));
        if (!r || r.type === "0x7e") continue;           // deposit transactions carry no fees
        seen++;
        if (r.operatorFeeScalar != null || r.operatorFeeConstant != null) withOperator++;
        if (r.l1Fee != null) withL1++;
      }
    }
    const predeploy = { operatorFeeScalar: await readUint(prov, "operatorFeeScalar()"), operatorFeeConstant: await readUint(prov, "operatorFeeConstant()"), version: await readVersion(prov) };
    appendJsonl(OUT, { net: c.net, sample: seen, withOperatorFeeFields: withOperator, withL1FeeField: withL1, predeploy, ts });
    console.log(`${c.net}: ${seen} receipts, ${withOperator} with operator-fee fields, ${withL1} with l1Fee; L1Block predeploy ${JSON.stringify(predeploy)}`);
  }
}

main().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
