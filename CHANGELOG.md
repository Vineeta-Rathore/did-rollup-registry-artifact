# Changelog

## v1.0.1 (2026-10-25): matches the camera-ready paper

Same data as v1.0.0. The analysis now reproduces the final paper exactly: Table IV labels a silent wrong result
"wrong", figure heights match the paper, the report prints the October replacement parts and the one-transaction
estimate, the tip share is computed against each block's base fee, Table III request counts come from the same rows as
the latencies, and the checksum test covers every data file. README security notes, filter description and commands
were corrected after a final review.

## v1.0.0 (2026-10-25): camera-ready release

Measurements and analysis behind the camera-ready version of the paper.

- Third-party fix (`resver/pr329_live_check.mjs`, `pr329_live_check_version.mjs`, `pr329_results.jsonl`): head commit
  c6452e4 of ethr-did-resolver pull request 329 run once on each of the two 64-event Arbitrum Sepolia identities (current
  document) and once with `versionId`; correct results, 657 to 659 requests and 338 to 359 s per resolution.
- Model and data checks (`analysis/test_model.py`): Eq. (3) against Eq. (1) summed directly, the Fjord size rule on the raw
  receipts, the quoted slopes, the October Sepolia replacement and break-even figures, and the data checksums.
- Gas by phase (`did_gas_steady.js`): every operation on a fresh identity, on an initialized identity and on a
  slot already in use, plus true value replacement (ERC-1056: set + revoke; storage: overwrite). Replaces the first
  matrix (`did_gas.js`), which mixed one-time slot initialization with per-operation costs.
- Rollup data fee (`did_compress.js`, `did_mainnet_snapshot.js`): repeated and random payloads on OP Sepolia and
  Arbitrum Sepolia; real 33-byte keys from the history run; a read-only sample of OP Mainnet and Arbitrum One
  fees (63 half-hourly rounds, 60 returned a block, over 43 hours, 23 of 24 hours of the day), at most five transactions per sender; the fee ratio of storage to ERC-1056 as a
  function of the effective gas price (Fig. 2b).
- Resolution (`did_history.js`, `did_resolve_methods.js`): latency for 2 to 64 events with the specification walk,
  the production resolver (cold and warm cache) and storage reads; at 64 events also ranged log scans (sequential and
  parallel) and a complete parallel storage read (two sessions of 20 rounds per network, pooled).
- Resolver releases (`resver/did_resolver_versions.js`): ethr-did-resolver 11.0.4, 14.1.2 and 14.1.4 on eight
  cases, compared by content with ground truth from `identityOwner()` and a pointer-independent ranged scan, with
  owner-rotated controls on Sepolia and OP Sepolia.
- On-chain checks: `verify_bytecode.js` (all eight deployments equal the compiled sources), `did_arb_l1price.js`
  (Arbitrum L1 price estimate), `did_operator_fee_check.js` (OP Stack operator-fee fields in receipts and the
  operator-fee scalar and constant of the L1Block predeploy).
- Stability of the price points (`paper_numbers.py`): block-level bootstrap intervals and a split of the mainnet
  sample in time for the L1 price and the fee ratios.
- ArbSys-pointer registry variant (`contracts/did/EthereumDIDRegistryArbL2.sol`), deployed twice on Arbitrum Sepolia.
- Analysis scripts share one set of documented filters (`analysis/common.py`) and generate every number, figure and
  table of the paper. Block numbers are sent as minimal hex quantities (some endpoints reject leading zeros).
- Failure handling: transient endpoint failures are retried and classified, rounds hit by a network outage are repeated,
  RPC URLs (which may carry API keys) are stripped from logged and saved error text, `.env` is parsed without
  exposing the private key to dependencies, chain IDs are pinned.
- Data, license (CC BY 4.0), data dictionary and `SHA256SUMS`; pinned dependencies; citation metadata; NOTICE for the
  upstream ERC-1056 code; security, ethics and AI-use statements.
- Repository made public; the resolver failure was reported as decentralized-identity/ethr-did-resolver#328.

## v0.1 (2026-08-11): review-time subset

- Anonymous verification subset for double-blind review: the two registry contracts, the on-chain transaction trail
  and three read-only scripts reproducing the Arbitrum resolution failure. Raw data and measurement scripts were
  added in v1.0.0.
