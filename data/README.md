# Measurement data

All files are JSON Lines (one JSON object per line), written by the scripts in
`scripts/` and `resver/`. Gas and fee amounts are integers in gas units or wei,
stored as strings where they can exceed 2^53. Times are ISO-8601 UTC. Networks:
`local` (Hardhat, chainId 31337), `sepolia` (11155111), `opSepolia` (11155420),
`arbSepolia` (421614); the snapshot also has `opMainnet` (10) and `arbOne` (42161).
`SHA256SUMS` lists a checksum per file. License: CC BY 4.0 (see `LICENSE`).

| File | Script | When | What |
|---|---|---|---|
| `did_gas_local.jsonl` | `did_gas.js` | Jul 2026 | Lifecycle gas on the local EVM, 3 runs per (design, op, payload). Table I and Fig. 1. |
| `did_l2_measured.jsonl` | `did_l2.js` | Jul 2026 | Lifecycle transactions on Sepolia, OP Sepolia, Arbitrum Sepolia with raw receipt fee fields. Rows with `deploy` record deployments; the last deployment per network is the canonical pair (earlier OP Sepolia pairs were superseded). July points in Figs. 2-3. |
| `did_resolution.jsonl` | `did_resolve.js` | Jul 2026 | Original six-event resolution timings (superseded in the paper by the history sweep). |
| `did_pointer_direct.jsonl`, `did_prod_resolver.jsonl` | `did_pointer_direct.js`, `did_prod_resolver.js` | Aug 2026 | Direct read of `changed[identity]` on Arbitrum and the first production-resolver test. |
| `did_compress.jsonl` | `did_compress.js` | 22 Oct 2026 | `setAttribute` with repetitive (`rep`, byte 0xab) and random (`rnd`) payloads, 32-256 B, 3 reps, both designs, on OP Sepolia, Arbitrum Sepolia and the local EVM. Fields: `l1GasUsed` (= 16 x charged size on OP), `l1Fee`, `gpoL1GasUsed` (GasPriceOracle estimate for the unsigned tx; secondary check only), `gasUsedForL1` (Arbitrum), `signedTxBytes`. `priceSnapshot` rows hold the OP oracle parameters. Fig. 2. |
| `did_mainnet_snapshot_24h.jsonl` | `did_mainnet_snapshot.js` | 23-24 Oct 2026 | Read-only: one recent block per chain every 30 min for 24 h, all user-transaction receipts, at most 5 rows per sender (`sender` is a short hash). OP Mainnet: `l1GasUsed`, `l1Fee`, `effectiveGasPriceWei`, `baseFeeWei`; Arbitrum One: `gasUsedForL1`. `missed` rows record samples an endpoint failed to serve. Fig. 3 points C-E. |
| `did_mainnet_snapshot.jsonl` | earlier version of the script | 22 Oct 2026 | Superseded 36-second snapshot (300 receipts from 18 consecutive blocks per chain); kept for transparency, not used in the paper. |
| `did_history.jsonl`, `did_history_tx.jsonl` | `did_history.js` (RUN=v1) | 22-23 Oct 2026 | First history sweep (identity `0xd3401C...3DfC`). Spec-walk and storage timings are valid. The `production` rows used the resolver's default in-memory cache (finalized blocks only), so they mix cold and warm resolutions and are NOT used in the paper. `_tx` holds every receipt. |
| `did_history_v2.jsonl`, `did_history_tx_v2.jsonl` | `did_history.js` (RUN=v2) | 23 Oct 2026 | History sweep used in Fig. 4 (identity `0x89b7aE...25f0`): `spec_walk`, `production_cold` (cache disabled), `view_calls`, and `production_warm` (default cache, after finality). Every row has `ok` (document matched the expected service and current key). |
| `did_resolver_versions.jsonl` | `resver/did_resolver_versions.js` | 23 Oct 2026 | ethr-did-resolver 11.0.4 / 14.1.2 / 14.1.4 on six cases vs on-chain truth. Table II. |

## Resolution rows (`did_history*.jsonl`)

`net`, `H` (events in the identity's history at measurement time), `round` (0-19;
methods are interleaved in rotating order within a round), `method`, `design`
(`erc1056`, `erc1056_arbL2`, `storage`), `ms` (wall-clock latency), `calls` (RPC
requests, for the spec walk and view calls), `events` (events found by the walk),
`ok`, `error`/`message` (resolver error, if any), `emptyAt` (block at which the
walk found no logs), `ts`.
