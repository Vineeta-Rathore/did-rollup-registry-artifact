/** Diagnose the production ethr-did-resolver result: (a) are the identity's
 * attributes/delegates EXPIRED (validTo < now)? (b) what exactly happens on
 * Arbitrum? Read-only, public RPCs. */
const { ethers } = require("ethers");
const { getResolver } = require("ethr-did-resolver");
const { Resolver } = require("did-resolver");

const IDENTITY = "0x7ab54d25541FD1309457eE086A06dD0a42a88555";
const NETS = {
  sepolia: { rpc: "https://ethereum-sepolia-rpc.publicnode.com", erc: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49", chainId: 11155111 },
  arbsep:  { rpc: "https://sepolia-rollup.arbitrum.io/rpc",      erc: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d", chainId: 421614 },
};
const ABI = ["function changed(address) view returns (uint256)"];
const idTopic = ethers.zeroPadValue(IDENTITY, 32);

(async () => {
  const now = Math.floor(Date.now() / 1000);
  console.log("now (unix):", now, "\n");
  for (const [net, cfg] of Object.entries(NETS)) {
    const p = new ethers.JsonRpcProvider(cfg.rpc);
    const iface = new ethers.Interface(ABI);
    const V = BigInt(await p.call({ to: cfg.erc, data: iface.encodeFunctionData("changed", [IDENTITY]) }));
    // walk one hop: get logs at the pointer block
    let events = [];
    try {
      const logs = await p.send("eth_getLogs", [{ address: cfg.erc, fromBlock: ethers.toQuantity(V), toBlock: ethers.toQuantity(V), topics: [null, idTopic] }]);
      events = logs;
    } catch (e) { console.log(net, "getLogs at pointer err:", e.message); }
    // decode validTo from DIDAttributeChanged / DIDDelegateChanged (validTo is 4th indexed-less arg)
    const fullAbi = new ethers.Interface([
      "event DIDAttributeChanged(address indexed identity, bytes32 name, bytes value, uint validTo, uint previousChange)",
      "event DIDDelegateChanged(address indexed identity, bytes32 delegateType, address delegate, uint validTo, uint previousChange)",
    ]);
    const validTos = [];
    for (const lg of events) {
      try { const pl = fullAbi.parseLog({ topics: lg.topics, data: lg.data }); validTos.push(Number(pl.args.validTo)); } catch (e) {}
    }
    console.log(`[${net}] changed[identity]=${V}  logs_at_pointer=${events.length}  validTo(s)=${JSON.stringify(validTos)}  allExpired=${validTos.length>0 && validTos.every(v=>v<now)}`);
  }
  console.log("\n=== production resolver full output ===");
  const resolver = new Resolver(getResolver({ networks: [
    { name: "sepolia", chainId: 11155111, rpcUrl: NETS.sepolia.rpc, registry: NETS.sepolia.erc },
    { name: "arbsep",  chainId: 421614,   rpcUrl: NETS.arbsep.rpc,  registry: NETS.arbsep.erc },
  ]}));
  for (const net of ["sepolia", "arbsep"]) {
    const res = await resolver.resolve(`did:ethr:${net}:${IDENTITY}`);
    console.log(`\n--- ${net} ---`);
    console.log("resolutionMetadata:", JSON.stringify(res.didResolutionMetadata));
    console.log("didDocumentMetadata:", JSON.stringify(res.didDocumentMetadata));
    console.log("doc.service:", JSON.stringify((res.didDocument||{}).service||[]));
    console.log("doc.verificationMethod count:", ((res.didDocument||{}).verificationMethod||[]).length);
  }
})().catch(e => console.error("FATAL", e));
