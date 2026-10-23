# Changelog

## v1.0.0 (2026-10-24): camera-ready release

- Full measurement pipeline: lifecycle gas (local EVM), lifecycle runs on Sepolia,
  OP Sepolia and Arbitrum Sepolia, payload compressibility, resolution latency versus
  history length, resolver-release comparison, mainnet fee sampling.
- All raw measurement data (`data/`, CC BY 4.0) with a data dictionary and SHA256SUMS.
- ArbSys-pointer registry variant (`contracts/did/EthereumDIDRegistryArbL2.sol`).
- Analysis and figure scripts sharing one set of documented filters (`analysis/`).
- Bytecode check: all deployed registries equal the compiled sources byte for byte.
- Pinned dependencies, citation metadata, NOTICE for the upstream ERC-1056 code,
  security, ethics and AI-use statements.
- Repository made public; the resolver failure reported as
  decentralized-identity/ethr-did-resolver#328.

## v0.1 (2026-08-11): review-time subset

- Anonymous verification subset for double-blind review: the two registry contracts,
  the on-chain transaction trail and three read-only scripts reproducing the Arbitrum
  resolution failure. Raw data and measurement scripts were added in v1.0.0.
