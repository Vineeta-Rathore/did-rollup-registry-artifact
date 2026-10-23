// SPDX-License-Identifier: MIT
/**
 * Direct on-chain evidence for the Arbitrum did:ethr resolution failure.
 *
 * Reads the ERC-1056 history pointer `changed[identity]` live and compares it
 * to (a) the L2 block where the identity's events were actually mined and (b)
 * the chain's current L1-block estimate, then queries `eth_getLogs` at the
 * pointer block versus at the true event block. On Arbitrum the pointer holds
 * an L1 estimate while the events sit at a much larger L2 height, so the query
 * at the pointer block returns zero logs.
 *
 * Usage:   node scripts/did_pointer_direct.js   (reads deployments.json)
 * Access:  read-only calls to public RPC endpoints; no private key required.
 * Output:  one JSON line per network; also written to build/did_pointer_direct.jsonl.
 */
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");

const IDENTITY = "0x7ab54d25541FD1309457eE086A06dD0a42a88555";
const NETS = {
  sepolia:    { rpc: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", erc: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49" },
  opSepolia:  { rpc: process.env.OP_RPC || "https://sepolia.optimism.io",                 erc: "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D" },
  arbSepolia: { rpc: process.env.ARB_RPC || "https://sepolia-rollup.arbitrum.io/rpc",      erc: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d" },
};
const iface = new ethers.Interface(["function changed(address) view returns (uint256)"]);
const idTopic = ethers.zeroPadValue(IDENTITY, 32);

const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments.json"), "utf8"));
const setAttrTx = (net) => (dep.networks[net] || {}).setAttributeTx;

async function logsAt(p, addr, block) {
  return (await p.send("eth_getLogs", [{ address: addr, fromBlock: ethers.toBeHex(block),
    toBlock: ethers.toBeHex(block), topics: [null, idTopic] }])).length;
}

async function probe(net, cfg) {
  const p = new ethers.JsonRpcProvider(cfg.rpc);
  const V = BigInt(await p.call({ to: cfg.erc, data: iface.encodeFunctionData("changed", [IDENTITY]) }));
  const headL2 = BigInt(await p.getBlockNumber());
  let l1est = null;
  try { const b = await p.send("eth_getBlockByNumber", ["latest", false]); if (b && b.l1BlockNumber) l1est = BigInt(b.l1BlockNumber).toString(); } catch (e) {}
  const logsAtPointer = await logsAt(p, cfg.erc, V);
  const tx = setAttrTx(net);
  let eventBlock = null, logsAtEvent = null;
  if (tx) { const rc = await p.getTransactionReceipt(tx);
    if (rc) { eventBlock = BigInt(rc.blockNumber); logsAtEvent = await logsAt(p, cfg.erc, eventBlock); } }
  return { net, pointer_changed: V.toString(), head_L2: headL2.toString(), latest_l1_estimate: l1est,
    logs_at_pointer: logsAtPointer, event_L2_block: eventBlock ? eventBlock.toString() : null,
    logs_at_event_block: logsAtEvent,
    eventblock_over_pointer_ratio: eventBlock && V > 0n ? Number(eventBlock) / Number(V) : null };
}

(async () => {
  const out = [];
  for (const [net, cfg] of Object.entries(NETS)) {
    try { const r = await probe(net, cfg); out.push(r); console.log(JSON.stringify(r, null, 0)); }
    catch (e) { console.log(net, "ERR", e.message || e); }
  }
  if (out.length) {
    fs.mkdirSync(path.join(__dirname, "..", "build"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "..", "build", "did_pointer_direct.jsonl"),
      out.map(x => JSON.stringify(x)).join("\n") + "\n");
  }
})();
