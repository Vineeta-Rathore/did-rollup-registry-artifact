# Event-based vs storage-based DID registries on Ethereum rollups: artifact

Artifact for the paper *"Anchoring Decentralized Identifiers on Ethereum Rollups: A
Gas-Level Comparison of Event-Based and Storage-Based Registry Designs"*, V. Rathore and
M. K. Rawat, IEEE INDICON 2026.

It contains the registry contracts, every measurement script, the raw data behind each
table and figure, the analysis and figure scripts, and the on-chain transaction trail.
All deployments are on public testnets, so every measured transaction can be checked on
a block explorer.

Archived on Zenodo: release v1.0.0, [doi:10.5281/zenodo.23629516](https://doi.org/10.5281/zenodo.23629516);
all versions, [doi:10.5281/zenodo.23629515](https://doi.org/10.5281/zenodo.23629515).

## Layout

```
contracts/did/
  EthereumDIDRegistry.sol        ERC-1056 reference registry, code unmodified (see NOTICE)
  StorageDIDRegistry.sol         storage-based registry with the same functions
  EthereumDIDRegistryArbL2.sol   ERC-1056 storing ArbSys.arbBlockNumber() as pointer (Arbitrum only)
scripts/
  did_gas_steady.js     gas by phase (fresh / initialised / repeated), incl. replacement  (Table I, Fig. 1)
  did_gas.js            first lifecycle matrix on the local EVM (superseded by did_gas_steady.js)
  did_l2.js             lifecycle transactions on the three testnets     (July receipts)
  did_compress.js       repetitive vs random payloads, rollup data fee   (Fig. 2a)
  did_mainnet_snapshot.js  read-only OP Mainnet / Arbitrum One fee levels, 63 rounds (Table II, Fig. 2b)
  did_history.js        resolution latency vs history length, ArbSys fix (Fig. 3)
  did_resolve_methods.js  read-only: walk vs ranged scans vs storage reads at 64 events (Table III)
  did_arb_l1price.js    read-only: Arbitrum L1 price estimate at the July receipt blocks
  did_operator_fee_check.js  read-only: OP Stack operator-fee fields in receipts
  did_rev_common.js     shared helpers (derived identities, signing, receipts)
  did_pointer_direct.js read-only: changed[identity] vs true L2 event block on Arbitrum
  did_prod_resolver.js  read-only: production resolver on the three networks
  did_prod_diag.js      read-only: resolver error text and attribute expiry
  did_resolve.js        original six-event resolution timing (superseded by did_history.js)
  verify_bytecode.js    read-only: compiled sources == deployed bytecode
resver/                 isolated install of ethr-did-resolver 11.0.4, 14.1.2, 14.1.4;
                        pr329_live_check*.mjs + pr329_results.jsonl: run of a third party's fix (PR 329)
  did_resolver_versions.js                                                (Table IV)
analysis/
  common.py             data filters shared by the scripts below (one definition each)
  paper_numbers.py      recomputes every number quoted in the paper from data/
  make_figures.py       regenerates Figs. 1-3 from data/
  make_tables.py        regenerates the LaTeX tables I-IV from data/
  vendor_data.py        copies build/*.jsonl into data/, strips URLs from error text, writes SHA256SUMS
  test_model.py         consistency checks: Eq. (1)-(3), Fjord size rule, quoted slopes, data checksums
data/                   raw JSONL measurements (see data/README.md), CC BY 4.0
deployments.json, TRANSACTIONS.md   addresses and transaction hashes
```

## Reproduce the paper's numbers and figures (no network, about 1 min)

```bash
pip install -r analysis/requirements.txt          # matplotlib 3.10.x (Python 3.10+)
python3 analysis/paper_numbers.py data            # prints every quoted number
python3 analysis/make_figures.py data             # writes analysis/figs/*.pdf
python3 analysis/make_tables.py data              # writes analysis/tables/*.tex
python3 analysis/test_model.py data               # checks Eq. (1)-(3), the Fjord size rule, the quoted slopes and the data checksums
sha256sum -c data/SHA256SUMS                       # optional: check the data files (run inside data/)
```

On Windows use `py` instead of `python3`. Filters (for example, dropping the first
ERC-1056 write of each run, which also initialises the registry pointer) are defined
once in `analysis/common.py` and documented there.

## Check the on-chain claims (read-only, no keys)

Requires Node 22 and `npm ci` (versions pinned in `package-lock.json`;
ethr-did-resolver is pinned to 14.1.2, the release used in the paper).

```bash
npm ci
npm run verify-bytecode   # all 8 deployments equal the compiled sources, metadata hash included
npm run prod-resolver     # Sepolia and OP Sepolia resolve; Arbitrum Sepolia returns notFound
npm run pointer           # Arbitrum: changed[identity] holds an L1 block estimate
cd resver && npm ci && node did_resolver_versions.js    # Table IV (11.0.4 / 14.1.2 / 14.1.4)
cd .. && node scripts/did_resolve_methods.js            # Table III: needs NET=sepolia|opSepolia|arbSepolia and the state files of did_history.js
```

Each run of `did_resolve_methods.js` appends one session of 20 interleaved rounds. Table III pools
two sessions per network (the paper's data hold both, ordered by timestamp; `analysis/common.py`
assigns each row to its session from the `setup` rows, and `paper_numbers.py` prints the session medians).

Releases 14.1.3 and later report the same Arbitrum failure as `internalError`
instead of `notFound`; 11.0.4 returns no error and an incomplete document.
Table IV compares each resolution with on-chain truth at run time (identityOwner() and a
ranged log scan that does not use the pointer), so verdicts follow attribute expiry: the revision identities' entries are valid until
about October 2027. Endpoint failures are retried and reported as `INFRA ERROR`,
never as a resolver result.

Public RPC endpoints are rate-limited. A transient failure (socket error, HTTP 429,
"no backend is currently healthy") can also surface as a resolver error, so read the
`message` field and rerun. Set `SEPOLIA_RPC_URL`, `OP_RPC` and `ARB_RPC` to use your own
endpoints. The Arbitrum result does not depend on the endpoint.

## Rerun the measurements (sends testnet transactions)

Copy `.env.example` to `.env` and set `PRIVATE_KEY` to a funded **testnet-only** key.
The revision scripts derive fresh identities from it (`keccak256(key || label)`), so
reruns do not touch the identities used in the paper. Outputs go to `build/`, which is
not tracked; the published data are in `data/`.

```bash
npx hardhat run scripts/did_gas_steady.js              # Table I, Fig. 1: local EVM, deterministic
npx hardhat run scripts/did_gas.js                     # first matrix (superseded by did_gas_steady.js)
NET=opSepolia REPS=3 node scripts/did_compress.js      # also arbSepolia; NET=local needs `npx hardhat node` running
NET=sepolia node scripts/did_history.js                # also opSepolia, arbSepolia; resumable (RUN=v2 is the default)
node scripts/did_mainnet_snapshot.js                   # read-only; 48 rounds, one every 30 min
SAMPLES=14 START_ROUND=48 node scripts/did_mainnet_snapshot.js   # continuation, appends to the same file
```

In PowerShell set variables first, e.g. `$env:NET="opSepolia"; node scripts/did_compress.js`.
Do not run two measurement scripts on the same network at the same time: they share
the funding wallet.

`did_history.js` stores its progress in `build/did_history_state_<net>_v2.json` (no
suffix for the first run) and
records each transaction hash before broadcasting it, so an interrupted run can be
restarted without losing or duplicating history events; timing rows of a checkpoint are
written only when the checkpoint completes.

## Notes on the data

- The July lifecycle runs used the repeated byte `0xab` as attribute payload. It
  compresses almost entirely under the OP Stack's FastLZ size estimate, so it
  understates the rollup data fee for real (incompressible) key material.
  `did_compress.jsonl` measures both.
- In the first history run (`did_history.jsonl`) the production resolver used its
  default in-memory cache, which stores logs of finalized blocks. Those production
  timings mix cold and warm resolutions and are not used in the paper; the v2 run
  measures both conditions separately.
- Fees on testnets change by orders of magnitude over time. The stable quantities
  are gas and charged bytes.
- Table III pools two sessions of the same protocol, run 40 minutes apart on 23 October 2026.
  The second was started by a chained script while the first was finishing; both are complete
  and both are kept. Because that script moved the first session's file while its last OP
  Sepolia round was still running, that round was written to the second file; sorting all rows
  by timestamp restores the order. An earlier attempt of the same experiment hit a local DNS
  outage and was discarded (its failures were network errors, not endpoint answers); the script
  now repeats a round that is hit by a network error.
- The OP Mainnet / Arbitrum One sample (`did_mainnet_snapshot_24h.jsonl`) has 63 rounds, one block every 30 minutes:
  48 planned rounds (0-47) and two continuations, 48-61 and 62, run to cover the evening hours and a Sunday block. Sixty OP
  Mainnet rounds (59 for Arbitrum One) returned a block, 600 and 173 transactions. The rounds took 42.6 hours (23 Oct
  05:34Z to 25 Oct 00:13Z) because the sampling laptop slept twice (gaps of 7.4 and 5.6 hours) and three consecutive
  rounds failed (2 hours; `missed` rows). 23 of the 24 hours of the day are covered, Friday to Sunday (UTC).
  `paper_numbers.py` prints the coverage and block-level bootstrap intervals; the ratio for the median sender is the
  least stable figure, and the sample says nothing about other weeks or fee spikes.
- `did_operator_fee_check.jsonl` counts, in recent receipts of OP Sepolia and OP Mainnet, those
  that carry OP Stack operator-fee fields (Isthmus), and reads the operator-fee scalar and constant
  from the L1Block predeploy (both 0 on 24 October 2026); the fee model of the paper omits that term.

## Security notes

- The revision DIDs are public test material. The secp256k1 verification keys set on
  the history identities (`did_history.js`, `keyAt`) are derived from public strings, so
  anyone can compute their private keys. Never accept these DIDs as credential issuers.
  The keys stay valid until about October 2027 so that Table IV can be rerun.
- `StorageDIDRegistry.changeOwner(identity, address(0))` hands control back to the
  identity key, as in ERC-1056; use `deactivate()` to end an identity. The contract is
  kept as deployed (changing the source would change the bytecode checked by
  `verify_bytecode.js`); do not reuse it in production without hardening.
- Use a testnet-only key. Scripts never print it, read it from `.env` without exposing it
  to dependencies, pin each network's chain ID, and strip RPC URLs (which may carry API
  keys) from logged and saved error messages.

## Provenance and versions

- Lifecycle gas and testnet lifecycle runs: July 2026. Payload, resolution-history,
  resolver-release and mainnet-fee experiments: 22-25 October 2026. Each JSONL row
  carries its own timestamp; `data/README.md` lists script, date and content per file.
- Toolchain: Node 22, Hardhat 2.28.6, ethers 6.17.0, Solidity 0.8.24 (optimizer 200
  runs, Paris EVM), ethr-did-resolver 14.1.2 (Table IV also 11.0.4 and 14.1.4),
  Python 3.12 with matplotlib 3.10.5.
- `data/SHA256SUMS` fixes the exact data the paper's numbers and figures were computed
  from. Changes between releases are listed in `CHANGELOG.md`.

## Research ethics and privacy

All transactions were sent on public test networks from test accounts created for this
study; the mainnet data are read-only samples of public fee fields. No personal data are
collected. Blockchain addresses are pseudonymous public data. One third-party identity
on the canonical ERC-1056 deployment on Arbitrum Sepolia is resolved (read-only) to show
that the failure is not specific to our deployments; the paper does not name it and we
make no attempt to identify its owner. Mainnet senders are stored only as truncated
hashes, used to cap rows per sender. The resolver failure was reported to its
maintainers before publication of the paper: [ethr-did-resolver issue #328](https://github.com/decentralized-identity/ethr-did-resolver/issues/328).

## Use of AI tools

In line with IEEE policy on AI-generated content (text, figures, images and code), we disclose that Claude
(Anthropic), an AI assistant, was used in preparing this artifact and the paper. It drafted and edited the text of the paper and wrote the
storage-registry contract, the ArbSys-pointer variant of ERC-1056, the measurement, analysis and plotting scripts and the
documentation, and it ran these scripts under the authors' direction. Every reported
value comes from the records these scripts made of EVM executions and RPC queries; the assistant did not invent
or edit any measurement. The authors directed the work, reviewed the
results and take full responsibility for the artifact. The paper carries the same disclosure in its
Acknowledgment. The ERC-1056 registry itself is third-party code.

## How to cite

Please cite the paper and, when you use the code or data, this artifact
(machine-readable metadata: `CITATION.cff`).

```bibtex
@inproceedings{rathore2026anchoring,
  author    = {Rathore, Vineeta and Rawat, Manoj Kumar},
  title     = {Anchoring Decentralized Identifiers on Ethereum Rollups: A Gas-Level
               Comparison of Event-Based and Storage-Based Registry Designs},
  booktitle = {Proc. 23rd IEEE India Council Int. Conf. (INDICON)},
  address   = {Chennai, India},
  year      = {2026}
}
@software{rathore2026artifact,
  author  = {Rathore, Vineeta and Rawat, Manoj Kumar},
  title   = {did-rollup-registry-artifact: event-based vs storage-based DID registries on Ethereum rollups},
  version = {1.0.0},
  year    = {2026},
  doi     = {10.5281/zenodo.23629516},
  url     = {https://github.com/Vineeta-Rathore/did-rollup-registry-artifact}
}
```

## Contact

Vineeta Rathore (corresponding author), Department of Computer Science and Engineering,
Medicaps University, Indore, India: rathore.vineeta1@gmail.com. Bug reports and questions
about the artifact: GitHub issues on this repository.

## License

Code: MIT (`LICENSE`). Data: CC BY 4.0 (`data/LICENSE`). Third-party code: see `NOTICE`.
