/** Hardhat config. Local EVM (Paris) for deterministic gas measurement.
 *  `.env` (not committed) supplies a testnet key + RPC URLs for did_l2.js. */
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
};
