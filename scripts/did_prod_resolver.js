/** Paper 4 (RQ3, reviewer Priority-1): run the PRODUCTION ethr-did-resolver
 * (DIF/Veramo, npm ethr-did-resolver@14) against the same did:ethr identity on
 * Sepolia (L1), OP Sepolia, and Arbitrum Sepolia. Tests whether the deployed
 * production library - not our spec-faithful walk - reconstructs the full DID
 * document, or silently returns an empty one on Arbitrum. Read-only, public RPCs.
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
      const extra = s.verificationMethod - 1 + s.service; // 1 default controller VM
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
