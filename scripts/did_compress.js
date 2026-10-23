/** Paper 4 revision (reviewer R1, Sec. V.B): does the rollup L1 data fee scale
 * with attribute payload? The original sweep used the repetitive payload
 * 0xabab..ab, which OP Stack's FastLZ-based size estimate (Fjord) compresses to
 * near the 100-byte floor. Here each setAttribute is sent twice per size: once
 * with that repetitive payload ("rep") and once with random, incompressible
 * bytes ("rnd", like real public keys). Fresh attribute names keep storage on
 * the first-write path, matching Table I.
 *
 * Env: NET=local|opSepolia|arbSepolia|sepolia  [REPS=3]
 * Appends build/did_compress.jsonl. On OP it also asks the GasPriceOracle for
 * getL1GasUsed(signedTx) as an independent check of the receipt's l1GasUsed.
 */
const path = require("path");
const { NETS, BUILD, artifact, provider, derivedWallet, ensureFunded, sendTx, retry, redact, appendJsonl, ethers } = require("./did_rev_common");

const NET = process.env.NET;
const REPS = Number(process.env.REPS || 3);
const SIZES = [32, 64, 128, 256];
const OUT = path.join(BUILD, "did_compress.jsonl");
const DAY = 86400n;
const GPO = "0x420000000000000000000000000000000000000F";
const GPO_ABI = [
  "function getL1GasUsed(bytes) view returns (uint256)",
  "function l1BaseFee() view returns (uint256)", "function blobBaseFee() view returns (uint256)",
  "function baseFeeScalar() view returns (uint32)", "function blobBaseFeeScalar() view returns (uint32)",
];

// Deterministic per (size, rep) so a rerun regenerates the same "random" bytes.
const rnd = (b, rep) => {
  let out = "0x";
  for (let i = 0; out.length < 2 + 2 * b; i++)
    out += ethers.keccak256(ethers.toUtf8Bytes(`rnd-payload:${b}:${rep}:${i}`)).slice(2);
  return out.slice(0, 2 + 2 * b);
};
const rep = (b) => "0x" + "ab".repeat(b);

async function main() {
  if (!NETS[NET]) throw new Error("set NET to local|sepolia|opSepolia|arbSepolia");
  const prov = provider(NET);
  const id = derivedWallet("compress-v1", prov);
  const me = id.address;
  await ensureFunded(NET, prov, me, NET === "sepolia" ? ethers.parseEther("0.002") : ethers.parseEther("0.0005"));
  const signer = id; // plain Wallet: sendTx signs locally and tracks the nonce

  const ercArt = artifact("EthereumDIDRegistry"), stoArt = artifact("StorageDIDRegistry");
  let ercAddr = NETS[NET].erc, stoAddr = NETS[NET].sto;
  if (NET === "local") { // no canonical deployment on a fresh local chain
    ercAddr = (await sendTx(NET, prov, signer, null, ercArt.bytecode, { op: "deploy" })).contractAddress;
    stoAddr = (await sendTx(NET, prov, signer, null, stoArt.bytecode, { op: "deploy" })).contractAddress;
  }
  const ercI = new ethers.Interface(ercArt.abi), stoI = new ethers.Interface(stoArt.abi);
  const sto = new ethers.Contract(stoAddr, stoArt.abi, prov);
  console.log(`net=${NET} identity=${me} erc=${ercAddr} sto=${stoAddr}`);
  appendJsonl(OUT, { net: NET, setup: { identity: me, erc1056: ercAddr, storage: stoAddr, reps: REPS, sizes: SIZES } });

  if (!(await retry(() => sto.registered(me))))
    await sendTx(NET, prov, signer, stoAddr, stoI.encodeFunctionData("register", [me]), { design: "storage", op: "create" });

  const gpo = NET === "opSepolia" ? new ethers.Contract(GPO, GPO_ABI, prov) : null;
  const snap = async (tag) => {
    if (!gpo) return;
    const [a, b, c, d] = await retry(() => Promise.all([gpo.l1BaseFee(), gpo.blobBaseFee(), gpo.baseFeeScalar(), gpo.blobBaseFeeScalar()]));
    appendJsonl(OUT, { net: NET, priceSnapshot: tag, l1BaseFee: a.toString(), blobBaseFee: b.toString(),
      baseFeeScalar: c.toString(), blobBaseFeeScalar: d.toString(), ts: new Date().toISOString() });
  };
  await snap("start");

  // Interleave kinds and designs inside each (rep, size) cell so price drift hits all four alike.
  const run = Date.now().toString(36);
  let firstErc = true;   // the first ERC-1056 write of a fresh identity also initialises changed[identity]
  for (let r = 0; r < REPS; r++) {
    for (const b of SIZES) {
      for (const kind of ["rep", "rnd"]) {
        const value = kind === "rep" ? rep(b) : rnd(b, r);
        for (const design of ["erc1056", "storage"]) {
          const name = ethers.encodeBytes32String(`c${run}-${kind}${b}-${r}`.slice(0, 31));
          const data = design === "erc1056"
            ? ercI.encodeFunctionData("setAttribute", [me, name, value, DAY])
            : stoI.encodeFunctionData("setAttribute", [me, name, value, DAY]);
          const rec = await sendTx(NET, prov, signer, design === "erc1056" ? ercAddr : stoAddr, data,
            { design, op: "setAttribute", payload: b, kind, rep: r, run, firstWrite: design === "erc1056" && firstErc });
          if (design === "erc1056") firstErc = false;
          if (gpo) { // independent oracle estimate; getL1GasUsed adds 68 B for the signature itself
            const tx = await retry(() => prov.getTransaction(rec.txHash));
            rec.gpoL1GasUsed = (await retry(() => gpo.getL1GasUsed(ethers.Transaction.from(tx).unsignedSerialized))).toString();
          }
          appendJsonl(OUT, rec);
          console.log(`${NET} ${design} ${kind}${b} r${r} gas=${rec.gasUsed} signed=${rec.signedTxBytes}B` +
            (rec.l1GasUsed ? ` l1GasUsed=${rec.l1GasUsed} gpo=${rec.gpoL1GasUsed}` : "") +
            (rec.gasUsedForL1 != null ? ` gasUsedForL1=${rec.gasUsedForL1}` : ""));
        }
      }
    }
  }
  await snap("end");
  console.log("done", NET);
}

main().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
