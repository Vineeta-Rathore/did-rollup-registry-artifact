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

## Reproduce the headline result (read-only, no keys, ~1 min)

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

**Reading the output.** The Arbitrum failure is deterministic: `error="notFound"`
with `message` = *"No logs found for block 11300426 but previousChange points
here..."*. Public RPCs are rate-limited and Sepolia log history is often pruned on
non-archive nodes, so a **transient** RPC/TLS failure also surfaces as
`error="notFound"` on Sepolia; always read the `message` field to tell a real
result from a network hiccup, and re-run (or point `SEPOLIA_RPC_URL` at an archive
node) if the Sepolia control shows a socket/timeout message. The Arbitrum result
does not depend on RPC choice.

These run against public RPC endpoints and read only on-chain state. The same
three steps are available as `npm run prod-resolver` / `pointer` / `prod-diag`.
Set `SEPOLIA_RPC_URL`, `OP_RPC`, or `ARB_RPC` to point any script at your own
endpoint (e.g. a Sepolia archive node). Recompiling the contracts to verify the
deployed bytecode is optional: `npx hardhat compile` (or `npm run compile`).

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
