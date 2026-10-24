// Check of ethr-did-resolver pull request 329 (head commit c6452e4ca06fcc038c375887db3324e03550559e), run on 24 October 2026.
// Setup: git clone the resolver repository, fetch pull/329/head, pnpm install --frozen-lockfile --ignore-scripts, pnpm run build
// (on Windows rewrite lib.esm/package.json as {"type":"module"}), copy this file into packages/ethr-did-resolver and run
//   node pr329_live_check.mjs 1            (both identities)   or   node FILE 1 0xd340   (one identity, matched by address prefix)
// Read-only: public Arbitrum Sepolia endpoint, no keys. Results of the run behind the paper: pr329_results.jsonl.
// Live check of ethr-did-resolver PR 329 against two public Arbitrum Sepolia identities (read-only, no keys).
// Run from packages/ethr-did-resolver so that `ethers` resolves. Output: one JSON line per resolution.
import { JsonRpcProvider, Interface, id, getBytes, hexlify, toUtf8String, encodeBase64 } from 'ethers'
import { Resolver } from 'did-resolver'
import { getResolver } from './lib.esm/index.js'

const RPC = 'https://sepolia-rollup.arbitrum.io/rpc'
const REGISTRY = '0xa8d4a9222e40D3049297F88494f8F06A654F9c5d'
const IDENTITIES = ['0xd3401C1030aB8800CB89f2694F66f0D0f4853DfC', '0x89b7aE28C9469B58ca48a53ED8C8CE178Cef25f0']
const ROUNDS = Number(process.argv[2] ?? 1)

class CountingProvider extends JsonRpcProvider {
  http = 0
  items = 0
  async _send(payload) {
    this.http += 1
    this.items += Array.isArray(payload) ? payload.length : 1
    return super._send(payload)
  }
}

const iface = new Interface([
  'event DIDAttributeChanged(address indexed identity, bytes32 name, bytes value, uint validTo, uint previousChange)',
])

// Ground truth without the pointer: ranged scan of the identity's attribute events, replayed in (block, logIndex) order.
async function truth(identity) {
  const p = new JsonRpcProvider(RPC)
  const latest = await p.getBlockNumber()
  const logs = await p.getLogs({
    address: REGISTRY,
    topics: [id('DIDAttributeChanged(address,bytes32,bytes,uint256,uint256)'), '0x' + '0'.repeat(24) + identity.slice(2).toLowerCase()],
    fromBlock: latest - 10_000_000,
    toBlock: latest,
  })
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)
  const live = new Map()
  for (const l of logs) {
    const e = iface.parseLog(l)
    const name = toUtf8String(e.args.name).replace(/\0+$/, '')
    const key = name + '|' + e.args.value
    if (e.args.validTo > BigInt(Math.floor(Date.now() / 1000))) live.set(key, { name, value: e.args.value })
    else live.delete(key)
  }
  return { events: logs.length, live: [...live.values()] }
}

for (const identity of IDENTITIES.filter((i) => !process.argv[3] || i.toLowerCase().startsWith(process.argv[3].toLowerCase()))) {
  const t = await truth(identity)
  const keys = t.live.filter((x) => x.name.startsWith('did/pub/Secp256k1/veriKey'))
  const services = t.live.filter((x) => x.name.startsWith('did/svc/'))
  console.log(JSON.stringify({ identity, truthEvents: t.events, truthKeys: keys.length, truthServices: services.length }))
  for (let r = 1; r <= ROUNDS; r++) {
    const provider = new CountingProvider(RPC, 421614, { staticNetwork: true })
    const resolver = new Resolver(getResolver({ networks: [{ name: 'arbsep', chainId: 421614, provider, registry: REGISTRY }], cache: null }))
    const t0 = Date.now()
    let out
    try {
      const res = await resolver.resolve(`did:ethr:arbsep:${identity}`)
      const doc = JSON.stringify(res.didDocument ?? {})
      const err = res.didResolutionMetadata?.error
      const keyMatches = keys.map((k) => {
        const x = getBytes(k.value).slice(1, 33)
        return doc.toLowerCase().includes(hexlify(x).slice(2)) || doc.includes(encodeBase64(x).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))
      })
      const vm = res.didDocument?.verificationMethod?.length ?? 0
      out = { identity, round: r, ms: Date.now() - t0, error: err ?? null, verificationMethods: vm, services: res.didDocument?.service?.length ?? 0,
              currentKeyPresent: keyMatches.every(Boolean) && keys.length > 0, http: provider.http, rpcItems: provider.items }
    } catch (e) {
      out = { identity, round: r, ms: Date.now() - t0, thrown: String(e.message).slice(0, 160), http: provider.http, rpcItems: provider.items }
    }
    console.log(JSON.stringify(out))
  }
}
