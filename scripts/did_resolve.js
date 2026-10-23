/** Paper 4: DID resolution latency - event-walk (ERC-1056, the linked-list
 * eth_getLogs traversal ethr-did-resolver performs) vs view-call reads
 * (StorageDIDRegistry). Read-only; no key. Interleaved runs to spread public
 * RPC jitter fairly; n runs per design per network; wall-clock ms.
 * Targets = contracts deployed by did_l2.js with realistic state
 * (ERC-1056 identity history: 6 linked events; storage: owner+attr+delegate).
 * Appends build/did_resolution.jsonl
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config();

const RUNS = 20;
const OUT = path.join(__dirname, "..", "build", "did_resolution.jsonl");
const IDENTITY = "0x7ab54d25541FD1309457eE086A06dD0a42a88555"; // measurement identity (public address)
const NETS = {
  sepolia: { rpc: process.env.SEPOLIA_RPC_URL,
    erc: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49", sto: "0x3Fd09677bA5Bb0C0e1db8f90955523Db1c4a97FE" },
  opSepolia: { rpc: process.env.OP_RPC || "https://sepolia.optimism.io",
    erc: "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D", sto: "0x278612A4da3D085B0d6359e9Ba1eA442Da16b13B" },
  arbSepolia: { rpc: process.env.ARB_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
    erc: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d", sto: "0x54007A660AE6ebf0dAb901117CB8d9B8BF26bC8F" },
};

function art(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "artifacts",
    "contracts", "did", name + ".sol", name + ".json"), "utf8"));
}

// ERC-1056 resolution: read changed[identity], then walk the event linked list
// (each event carries previousChange), one eth_getLogs per history block.
async function resolveErc(provider, iface, addr) {
  const t0 = performance.now();
  let calls = 1, events = 0;
  const changedData = iface.encodeFunctionData("changed", [IDENTITY]);
  let block = BigInt(await provider.call({ to: addr, data: changedData }));
  const idTopic = ethers.zeroPadValue(IDENTITY, 32);
  while (block !== 0n) {
    const logs = await provider.send("eth_getLogs", [{
      address: addr, fromBlock: ethers.toBeHex(block), toBlock: ethers.toBeHex(block),
      topics: [null, idTopic] }]);
    calls++;
    let prev = 0n;
    for (const lg of logs) {
      events++;
      const parsed = iface.parseLog({ topics: lg.topics, data: lg.data });
      const pc = parsed.args[parsed.args.length - 1]; // previousChange is last arg
      if (BigInt(pc) < block) prev = BigInt(pc) > prev ? BigInt(pc) : prev;
    }
    block = prev;
  }
  return { ms: performance.now() - t0, calls, events };
}

// Storage resolution: three view calls, constant regardless of history.
async function resolveSto(provider, iface, addr) {
  const t0 = performance.now();
  await provider.call({ to: addr, data: iface.encodeFunctionData("identityOwner", [IDENTITY]) });
  await provider.call({ to: addr, data: iface.encodeFunctionData("getAttribute", [IDENTITY, ethers.encodeBytes32String("svc32")]) });
  await provider.call({ to: addr, data: iface.encodeFunctionData("validDelegate", [IDENTITY, ethers.encodeBytes32String("veriKey"), "0x00000000000000000000000000000000000f00d1"]) });
  return { ms: performance.now() - t0, calls: 3, events: 0 };
}

async function main() {
  const ercIface = new ethers.Interface(art("EthereumDIDRegistry").abi);
  const stoIface = new ethers.Interface(art("StorageDIDRegistry").abi);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  for (const [net, cfg] of Object.entries(NETS)) {
    if (!cfg.rpc) { console.log("skip", net, "(no RPC)"); continue; }
    const provider = new ethers.JsonRpcProvider(cfg.rpc);
    await provider.getBlockNumber(); // warm the connection outside timing
    const rows = [];
    for (let r = 0; r < RUNS; r++) {   // interleaved: erc, sto, erc, sto ...
      const e = await resolveErc(provider, ercIface, cfg.erc);
      rows.push({ net, design: "erc1056_eventwalk", run: r, ...e });
      const s = await resolveSto(provider, stoIface, cfg.sto);
      rows.push({ net, design: "storage_viewcalls", run: r, ...s });
    }
    for (const row of rows) fs.appendFileSync(OUT, JSON.stringify(row) + "\n");
    for (const d of ["erc1056_eventwalk", "storage_viewcalls"]) {
      const ms = rows.filter((x) => x.design === d).map((x) => x.ms).sort((a, b) => a - b);
      const med = ms[Math.floor(ms.length / 2)].toFixed(0);
      const p95 = ms[Math.floor(ms.length * 0.95)].toFixed(0);
      console.log(`${net} ${d}: median=${med}ms p95=${p95}ms n=${ms.length}`);
    }
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
