// SPDX-License-Identifier: MIT
/** Check that contracts/did/*.sol, compiled with hardhat.config.js (solc 0.8.24,
 * optimizer 200 runs, Paris EVM), reproduce the runtime bytecode deployed on the public
 * testnets exactly, including the metadata hash (which covers the source bytes).
 * Read-only. Run `npx hardhat compile` first. Usage: node scripts/verify_bytecode.js
 */
const { provider, artifact, redact } = require("./did_rev_common");

const DEPLOYED = [
  ["sepolia", "EthereumDIDRegistry", "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49"],
  ["sepolia", "StorageDIDRegistry", "0x3Fd09677bA5Bb0C0e1db8f90955523Db1c4a97FE"],
  ["opSepolia", "EthereumDIDRegistry", "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D"],
  ["opSepolia", "StorageDIDRegistry", "0x278612A4da3D085B0d6359e9Ba1eA442Da16b13B"],
  ["arbSepolia", "EthereumDIDRegistry", "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d"],
  ["arbSepolia", "StorageDIDRegistry", "0x54007A660AE6ebf0dAb901117CB8d9B8BF26bC8F"],
  ["arbSepolia", "EthereumDIDRegistryArbL2", "0x3b3c53ce023b43a5dfc5be10a08549ed3be71559"],
  ["arbSepolia", "EthereumDIDRegistryArbL2", "0x741a09edbf55fac1efe90f98271611ad8ff70220"],
];

(async () => {
  let ok = 0;
  for (const [net, name, addr] of DEPLOYED) {
    const onchain = (await provider(net).getCode(addr)).toLowerCase();
    const local = artifact(name).deployedBytecode.toLowerCase();
    const same = onchain === local;
    if (same) ok++;
    console.log(`${net.padEnd(10)} ${name.padEnd(26)} ${addr}  ${same ? "identical" : "DIFFERENT"}`);
  }
  console.log(`${ok}/${DEPLOYED.length} deployments match the compiled sources byte for byte`);
  process.exit(ok === DEPLOYED.length ? 0 : 1);
})().catch((e) => { console.error(redact(e.shortMessage || e.message || e)); process.exit(1); });
