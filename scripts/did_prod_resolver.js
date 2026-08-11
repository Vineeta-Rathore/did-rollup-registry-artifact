/**
 * Production did:ethr resolver check.
 *
 * Runs the reference ethr-did-resolver library (npm ethr-did-resolver v14,
 * did-resolver v5) against the same did:ethr identity on Ethereum Sepolia, OP
 * Sepolia, and Arbitrum Sepolia, and reports the resolution outcome for each.
 * The resolver returns a valid DID document on Sepolia and OP Sepolia but
 * aborts with a "notFound" error on Arbitrum, where the on-chain history
 * pointer references an L1 block estimate rather than the L2 log index.
 *
 * Usage:   node scripts/did_prod_resolver.js
 * Access:  read-only calls to public RPC endpoints; no private key required.
 */
const { getResolver } = require("ethr-did-resolver");
const { Resolver } = require("did-resolver");

const IDENTITY = "0x7ab54d25541FD1309457eE086A06dD0a42a88555";
const providerConfig = {
  networks: [
    { name: "sepolia",   chainId: 11155111, rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", registry: "0xB38D5Ce0197293A596015BbCa7E7A2C864033d49" },
    { name: "opsep",     chainId: 11155420, rpcUrl: "https://sepolia.optimism.io",                  registry: "0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D" },
    { name: "arbsep",    chainId: 421614,   rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",       registry: "0xa8d4a9222e40D3049297F88494f8F06A654F9c5d" },
  ],
};

function summarize(doc) {
  const vm = (doc.verificationMethod || []).length;
  const svc = (doc.service || []).length;
  const asr = (doc.assertionMethod || []).length;
  const auth = (doc.authentication || []).length;
  return { verificationMethod: vm, service: svc, assertionMethod: asr, authentication: auth };
}

(async () => {
  const resolver = new Resolver(getResolver(providerConfig));
  for (const net of ["sepolia", "opsep", "arbsep"]) {
    const did = `did:ethr:${net}:${IDENTITY}`;
    try {
      const t0 = Date.now();
      const res = await resolver.resolve(did);
      const ms = Date.now() - t0;
      const doc = res.didDocument || {};
      const s = summarize(doc);
      // Non-default entries = still-valid document material from setAttribute/addDelegate
      const extra = Math.max(0, s.verificationMethod - 1 + s.service); // valid entries beyond the default controller VM
      const err = (res.didResolutionMetadata && res.didResolutionMetadata.error) || null;
      const msg = (res.didResolutionMetadata && res.didResolutionMetadata.message) || null;
      console.log(JSON.stringify({
        net, did, ms, error: err, message: msg,
        ...s, valid_entries_beyond_default: extra,
        verdict: err
          ? `FAILED (${err})`
          : `RESOLVED OK (valid document, no error; ${extra} still-valid entries beyond default controller)`,
      }));
    } catch (e) {
      console.log(JSON.stringify({ net, did, error: String(e.message || e) }));
    }
  }
})();
