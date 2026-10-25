/** Direct evidence for the Arbitrum ERC-1056 resolution failure (Sec. V-C).
 * Reads the on-chain history pointer changed[identity] live and compares it to
 * (a) the actual L2 block where the identity's events were mined and (b) the
 * chain's current L1-block estimate, then checks eth_getLogs at the pointer vs
 * at the true event block. Read-only, public RPCs, no keys.
 * Writes build/did_pointer_direct.jsonl
 */
const fs = require("fs"), path = require("path");
const { ethers } = require("ethers");

const IDENTITY = "0x7ab54d25541FD1309457eE086A06dD0a42a88555";
const NETS = {
  sepolia:    { rpc: "https://ethereum-sepolia-rpc.publicnode.com", erc: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49" },
  opSepolia:  { rpc: "https://sepolia.optimism.io",                 erc: "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D" },
  arbSepolia: { rpc: "https://sepolia-rollup.arbitrum.io/rpc",      erc: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d" },
};
const iface = new ethers.Interface(["function changed(address) view returns (uint256)"]);
const idTopic = ethers.zeroPadValue(IDENTITY, 32);

const L2_FILE = ["data", "build"].map((d) => path.join(__dirname, "..", d, "did_l2_measured.jsonl")).find((f) => fs.existsSync(f));
const l2 = fs.readFileSync(L2_FILE, "utf8")
  .split("\n").filter(Boolean).map(JSON.parse);
const setAttrTx = (net) => (l2.find(x => x.net === net && x.design === "erc1056" && x.op === "setAttribute" && x.txHash) || {}).txHash;

async function logsAt(p, addr, block) {
  return (await p.send("eth_getLogs", [{ address: addr, fromBlock: ethers.toQuantity(block),
    toBlock: ethers.toQuantity(block), topics: [null, idTopic] }])).length;
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
  fs.mkdirSync(path.join(__dirname, "..", "build"), { recursive: true });
  if (out.length) fs.writeFileSync(path.join(__dirname, "..", "build", "did_pointer_direct.jsonl"),
    out.map(x => JSON.stringify(x)).join("\n") + "\n");
})();
