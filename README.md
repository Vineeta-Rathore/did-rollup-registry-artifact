# Anchoring DIDs on Ethereum Rollups - Verification Artifact (review-time)

Anonymous artifact for the paper *"Anchoring Decentralized Identifiers on
Ethereum Rollups: A Gas-Level Comparison of Event-Based and Storage-Based
Registry Designs"* (double-blind submission; author identity omitted).

**Scope.** This is a *review-time* artifact: it provides the two registry
contracts, the complete **on-chain verification trail** (every deployment
address and transaction hash - see [`TRANSACTIONS.md`](TRANSACTIONS.md)), and
**read-only scripts that reproduce the paper's headline result from the public
chains with no keys**. It is meant to let reviewers independently confirm that
the experiments were really run and that the central Arbitrum finding holds.
The **complete raw measurement data and the full measurement pipeline
(local-gas, L2-fee, and resolution-latency scripts) will be released on
acceptance.**

Everything here is independently verifiable: the deployments and their
lifecycle transactions live on public testnets, and the two read-only scripts
re-derive the Arbitrum resolution failure live.

## Layout

```
contracts/did/
  EthereumDIDRegistry.sol   # unmodified ERC-1056 reference registry (event-carried)
  StorageDIDRegistry.sol    # minimal storage-based counterpart (state-carried)
scripts/
  did_pointer_direct.js     # reads changed[identity] live vs the true L2 event block
  did_prod_resolver.js      # runs the PRODUCTION ethr-did-resolver on all 3 networks
  did_prod_diag.js          # attribute-expiry + Arbitrum-error diagnostic
deployments.json            # canonical registry addresses + key tx hashes (machine-readable)
TRANSACTIONS.md             # full human-readable on-chain trail + explorer links
hardhat.config.js           # solc 0.8.24, optimizer on, Paris EVM (to recompile the contracts)
```

## Reproduce the headline result (read-only, no keys, ~30 s)

```bash
npm install

# The production ethr-did-resolver: resolves on Sepolia/OP, FAILS on Arbitrum.
node scripts/did_prod_resolver.js
#   -> sepolia/opsep: error=null ;  arbsep: error="notFound"

# Why: the on-chain pointer holds an L1 block estimate, not the L2 event height.
node scripts/did_pointer_direct.js
#   -> arbSepolia: pointer_changed ~11.30M (L1 scale), event_L2_block ~288.8M,
#      logs_at_pointer=0, logs_at_event_block=1

node scripts/did_prod_diag.js       # shows the verbatim resolver error + expiry
```

These run against public RPC endpoints and read only on-chain state. To inspect
or recompile the contracts: `npm install && npx hardhat compile`.

## On-chain trail

See [`TRANSACTIONS.md`](TRANSACTIONS.md) for every deployment address and
lifecycle transaction hash with block-explorer links. The gas and (on rollups)
L1-data-fee figures in the paper are recoverable directly from those receipts.
Test identity: `0x7ab54d25541FD1309457eE086A06dD0a42a88555`.

## Environment

Node 18+; `ethers` v6, `ethr-did-resolver` v14, `did-resolver` v5.
Contracts: Solidity 0.8.24 (optimizer on, Paris EVM).

## License

MIT (see `LICENSE`).
