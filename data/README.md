# Measurement data

All files are JSON Lines (one JSON object per line), written by the scripts in
`scripts/` and `resver/`. Gas and fee amounts are integers in gas units or wei,
stored as strings where they can exceed 2^53. Times are ISO-8601 UTC. Networks:
`local` (Hardhat, chainId 31337), `sepolia` (11155111), `opSepolia` (11155420),
`arbSepolia` (421614); the snapshot also has `opMainnet` (10) and `arbOne` (42161).
`SHA256SUMS` lists a checksum per file. License: CC BY 4.0 (see `LICENSE`).

| File | Script | When | What |
|---|---|---|---|
| `did_gas_steady.jsonl` | `did_gas_steady.js` | 23 Oct 2026 | Local-EVM gas by phase (`fresh`, `init`, `again`, `replace`) for every operation, 3 runs on separate identities. Table I and Fig. 1. |
| `did_gas_local.jsonl` | `did_gas.js` | Jul 2026 | First local lifecycle matrix (superseded by `did_gas_steady.jsonl`, which repeats it with explicit phases; the two agree within 0.04% for first writes). |
| `did_l2_measured.jsonl` | `did_l2.js` | Jul 2026 | Lifecycle transactions on Sepolia, OP Sepolia, Arbitrum Sepolia with raw receipt fee fields. Rows with `deploy` record deployments; the last deployment per network is the canonical pair (earlier OP Sepolia pairs were superseded). July receipts in Fig. 2a and Table II. |
| `did_resolution.jsonl` | `did_resolve.js` | Jul 2026 | Original six-event resolution timings (superseded in the paper by the history sweep, Fig. 3). |
| `did_pointer_direct.jsonl`, `did_prod_resolver.jsonl` | `did_pointer_direct.js`, `did_prod_resolver.js` | Aug 2026 | Direct read of `changed[identity]` on Arbitrum and the first production-resolver test. |
| `did_compress.jsonl` | `did_compress.js` | 22 Oct 2026 (predates the `run` and `firstWrite` fields; the pointer-initialising write is identified by its gas) | `setAttribute` with repetitive (`rep`, byte 0xab) and random (`rnd`) payloads, 32-256 B, 3 reps, both designs, on OP Sepolia, Arbitrum Sepolia and the local EVM. Fields: `l1GasUsed` (= 16 x charged size on OP), `l1Fee`, `gpoL1GasUsed` (GasPriceOracle estimate for the unsigned tx; secondary check only), `gasUsedForL1` (Arbitrum), `signedTxBytes`. `priceSnapshot` rows hold the OP oracle parameters. Fig. 2a. |
| `did_mainnet_snapshot_24h.jsonl` | `did_mainnet_snapshot.js` | 23-25 Oct 2026 | Read-only: one recent block per chain every 30 min in 63 rounds (48 planned, 0-47, and two continuations, 48-61 and 62, that restore the per-sender counts and continue the round numbers; a header row opens each run); 60 OP Mainnet and 59 Arbitrum One rounds returned a block (600 and 173 rows). All user-transaction receipts, at most 5 rows per sender over the whole sample (`sender` is a short hash). OP Mainnet: `l1GasUsed`, `l1Fee`, `effectiveGasPriceWei`, `baseFeeWei`; Arbitrum One: `gasUsedForL1`. `missed` rows record samples an endpoint failed to serve. Two laptop-sleep gaps (7.4 h on 23 Oct, 5.6 h on 23-24 Oct) and three consecutive failed rounds (2 h) stretch the sample over 42.6 hours. |
| `did_mainnet_snapshot.jsonl` | earlier version of the script | 22 Oct 2026 | Superseded 36-second snapshot (300 receipts from 18 consecutive blocks per chain); kept for transparency, not used in the paper. |
| `did_history.jsonl`, `did_history_tx.jsonl` | `did_history.js` (RUN=v1) | 22-23 Oct 2026 | First history sweep (identity `0xd3401C...3DfC`). Spec-walk and storage timings are valid. The `production` rows used the resolver's default in-memory cache (finalized blocks only), so they mix cold and warm resolutions and are NOT used in the paper. `_tx` holds every receipt. |
| `did_history_v2.jsonl`, `did_history_tx_v2.jsonl` | `did_history.js` (RUN=v2) | 23 Oct 2026 | History sweep used in Fig. 3 (identity `0x89b7aE...25f0`): `spec_walk`, `production_cold` (cache disabled), `view_calls`, and `production_warm` (default cache, after finality). Every row has `ok` (document matched the expected service and current key). |
| `did_resolve_methods.jsonl` | `did_resolve_methods.js` | 23-24 Oct 2026 | Table III: pointer walk, ranged scans (sequential and parallel), storage reads at 64 events; two sessions of 20 interleaved rounds per network, 40 minutes apart, merged and ordered by timestamp. A `setup` row records endpoint host, scan range and chunk size and opens a session (`analysis/common.py` assigns each row to its session from these rows; the last OP Sepolia round of session 1 sits after the second session's start of the file, which the timestamp order resolves); `attempts` > 1 marks a round repeated after a network outage. |
| `did_arb_l1price.jsonl` | `did_arb_l1price.js` | 23 Oct 2026 | `ArbGasInfo.getL1BaseFeeEstimate()` now and at the July receipt blocks (12 of 13 historical states are pruned by the public endpoint). |
| `did_operator_fee_check.jsonl` | `did_operator_fee_check.js` | 23-24 Oct 2026 | Count of OP Stack receipts (200 per chain) that carry operator-fee fields (none); the rows of 24 Oct also hold `predeploy`, the operator-fee scalar and constant read from the L1Block predeploy (both 0). |
| `did_resolver_versions.jsonl` | `resver/did_resolver_versions.js` | 23-24 Oct 2026 | ethr-did-resolver 11.0.4 / 14.1.2 / 14.1.4 on eight cases vs on-chain truth (identityOwner() and a pointer-independent ranged scan), with the registry pointer. Table IV. Only the final complete run is kept (earlier development runs used another row format). |
| `../resver/pr329_results.jsonl` | `resver/pr329_live_check.mjs`, `pr329_live_check_version.mjs` | 24 Oct 2026 | Kept next to its scripts, not in this directory: one run of ethr-did-resolver pull request 329 (head commit c6452e4) per identity on the two 64-event Arbitrum Sepolia identities, and one with `versionId`; per row the expected entries from a pointer-free scan, the outcome, wall-clock time and HTTP requests. |

## Resolution rows (`did_history*.jsonl`)

`net`, `H` (events in the identity's history at measurement time), `round` (0-19;
methods are interleaved in rotating order within a round), `method`, `design`
(`erc1056`, `erc1056_arbL2`, `storage`), `ms` (wall-clock latency), `calls` (RPC
requests, for the spec walk and view calls), `events` (events found by the walk),
`ok`, `error`/`message` (resolver error, if any), `emptyAt` (block at which the
walk found no logs), `ts`.
