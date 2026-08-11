/** Hardhat configuration for compiling the registry contracts
 *  (Solidity 0.8.24, optimizer enabled, Paris EVM). */
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" },
  },
};
