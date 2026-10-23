/** Paper 4: DID registry ops on live networks - Sepolia (validation) and
 * OP/Arbitrum Sepolia (L1-data fee decomposition). Raw receipts are read so
 * the rollup fee fields are kept; the key stays in .env and is never printed.
 * Env: NET (sepolia|opSepolia|arbSepolia). Appends build/did_l2_measured.jsonl.
 * One funded wallet => one controllable identity per contract, so changeOwner
 * (true rotation to a fresh address) is the final op per design; deactivate is
 * covered by the local matrix (identical calldata shape to changeOwner).
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const RPCS = {
  sepolia: process.env.SEPOLIA_RPC_URL,
  opSepolia: process.env.OP_RPC || "https://sepolia.optimism.io",
  arbSepolia: process.env.ARB_RPC || "https://sepolia-rollup.arbitrum.io/rpc",
};
const NET = process.env.NET;
const OUT = path.join(__dirname, "..", "build", "did_l2_measured.jsonl");
const DAY = 86400n;

function artifact(name) {
  const base = path.join(__dirname, "..", "artifacts", "contracts", "did");
  const p = path.join(base, name + ".sol", name + ".json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
const val = (b) => "0x" + "ab".repeat(b);
const name32 = (s) => ethers.encodeBytes32String(s);
const DTYPE = ethers.encodeBytes32String("veriKey");
const FRESH = "0x00000000000000000000000000000000000f00d1";

async function send(provider, wallet, to, data, design, op, payload, note) {
  // explicit gasLimit: public-RPC estimateGas can lag behind rapid sequential
  // txs (estimate taken pre-previous-block state), causing exact-out-of-gas
  // reverts; a fixed generous limit is safe (unused gas is not charged)
  const tx = await wallet.sendTransaction({ to, data, gasLimit: 400000n });
  const rc = await tx.wait();
  // raw receipt can lag behind tx.wait() on load-balanced public RPCs
  let raw = null;
  for (let i = 0; i < 10 && !raw; i++) {
    raw = await provider.send("eth_getTransactionReceipt", [tx.hash]);
    if (!raw) await new Promise((res) => setTimeout(res, 1500));
  }
  if (!raw) throw new Error("raw receipt unavailable for " + tx.hash);
  const hex = (v) => (v == null ? null : BigInt(v).toString());
  const rec = {
    net: NET, design, op, payload, txHash: tx.hash,
    gasUsed: Number(rc.gasUsed),
    effectiveGasPriceWei: rc.gasPrice ? rc.gasPrice.toString() : hex(raw.effectiveGasPrice),
    calldataBytes: (data.length - 2) / 2,
    gasUsedForL1: hex(raw.gasUsedForL1),                                   // Arbitrum
    l1Fee: hex(raw.l1Fee), l1GasUsed: hex(raw.l1GasUsed), l1GasPrice: hex(raw.l1GasPrice), // OP
    note: note || "",
  };
  let fee = BigInt(rc.gasUsed) * BigInt(rc.gasPrice);
  if (raw.l1Fee) fee += BigInt(raw.l1Fee);
  rec.totalFeeWei = fee.toString();
  fs.appendFileSync(OUT, JSON.stringify(rec) + "\n");
  console.log(`${NET} ${design}.${op}(${payload}B) gas=${rec.gasUsed} cd=${rec.calldataBytes}B` +
    (raw.l1Fee ? ` l1Fee=${rec.l1Fee}` : "") +
    (raw.gasUsedForL1 ? ` gasUsedForL1=${rec.gasUsedForL1}` : ""));
  return rec;
}

async function runDesign(provider, wallet, label, iface, addr, isStorage) {
  const me = await wallet.getAddress();
  const enc = (fn, args) => iface.encodeFunctionData(fn, args);
  if (isStorage)
    await send(provider, wallet, addr, enc("register", [me]), label, "create", 0);
  await send(provider, wallet, addr, enc("addDelegate", [me, DTYPE, FRESH, DAY]), label, "addDelegate", 0);
  await send(provider, wallet, addr, enc("revokeDelegate", [me, DTYPE, FRESH]), label, "revokeDelegate", 0);
  await send(provider, wallet, addr, enc("setAttribute", [me, name32("svc32"), val(32), DAY]), label, "setAttribute", 32);
  await send(provider, wallet, addr, enc("setAttribute", [me, name32("svc256"), val(256), DAY]), label, "setAttribute", 256);
  if (isStorage)
    await send(provider, wallet, addr, enc("revokeAttribute", [me, name32("svc256")]), label, "revokeAttribute", 256);
  else
    await send(provider, wallet, addr, enc("revokeAttribute", [me, name32("svc256"), val(256)]), label, "revokeAttribute", 256, "sig carries value bytes");
  await send(provider, wallet, addr, enc("changeOwner", [me, FRESH]), label, "changeOwner", 0, "final op: control released");
}

async function main() {
  if (!RPCS[NET]) throw new Error("set NET to sepolia|opSepolia|arbSepolia");
  const CHAIN = { sepolia: 11155111, opSepolia: 11155420, arbSepolia: 421614 };
  const provider = new ethers.JsonRpcProvider(RPCS[NET], CHAIN[NET], { staticNetwork: true }); // never sign for another chain
  const wallet = new ethers.NonceManager(new ethers.Wallet(process.env.PRIVATE_KEY, provider));
  const me = await wallet.getAddress();
  const bal = await provider.getBalance(me);
  console.log(`net=${NET} chainId=${(await provider.getNetwork()).chainId} balance=${ethers.formatEther(bal)} ETH`);
  if (bal < ethers.parseEther("0.003")) throw new Error("balance too low; top up via faucet");

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const ercArt = artifact("EthereumDIDRegistry");
  const stoArt = artifact("StorageDIDRegistry");
  const ercF = new ethers.ContractFactory(ercArt.abi, ercArt.bytecode, wallet);
  const stoF = new ethers.ContractFactory(stoArt.abi, stoArt.bytecode, wallet);
  const erc = await ercF.deploy(); await erc.waitForDeployment();
  const sto = await stoF.deploy(); await sto.waitForDeployment();
  const ercAddr = await erc.getAddress(), stoAddr = await sto.getAddress();
  console.log("deployed erc1056:", ercAddr, "storage:", stoAddr);
  fs.appendFileSync(OUT, JSON.stringify({ net: NET, deploy: { erc1056: ercAddr, storage: stoAddr } }) + "\n");

  await runDesign(provider, wallet, "erc1056", ercF.interface, ercAddr, false);
  await runDesign(provider, wallet, "storage", stoF.interface, stoAddr, true);
  console.log("done:", NET);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
