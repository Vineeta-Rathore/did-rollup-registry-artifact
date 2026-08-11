# On-chain verification trail

Public, independently verifiable record of every canonical deployment and
lifecycle transaction behind this paper. Inspect any address/hash on its block
explorer - no data file needed. All operations act on the test identity `0x7ab54d25541FD1309457eE086A06dD0a42a88555`.

Only transactions sent to the **canonical** registry pair on each network are
listed (development re-deployments on OP Sepolia are omitted).

## Registry deployments (canonical)

| Network | chainId | ERC-1056 registry | Storage registry |
|---|---|---|---|
| sepolia | 11155111 | [`0xB38D5Ce0197293A596015BbCa7E7A2C864033d49`](https://sepolia.etherscan.io/address/0xB38D5Ce0197293A596015BbCa7E7A2C864033d49) | [`0x3Fd09677bA5Bb0C0e1db8f90955523Db1c4a97FE`](https://sepolia.etherscan.io/address/0x3Fd09677bA5Bb0C0e1db8f90955523Db1c4a97FE) |
| opSepolia | 11155420 | [`0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D`](https://sepolia-optimism.etherscan.io/address/0x98C8d0dF99E0D4C599fe69242aE4daD95b9A148D) | [`0x278612A4da3D085B0d6359e9Ba1eA442Da16b13B`](https://sepolia-optimism.etherscan.io/address/0x278612A4da3D085B0d6359e9Ba1eA442Da16b13B) |
| arbSepolia | 421614 | [`0xa8d4a9222e40D3049297F88494f8F06A654F9c5d`](https://sepolia.arbiscan.io/address/0xa8d4a9222e40D3049297F88494f8F06A654F9c5d) | [`0x54007A660AE6ebf0dAb901117CB8d9B8BF26bC8F`](https://sepolia.arbiscan.io/address/0x54007A660AE6ebf0dAb901117CB8d9B8BF26bC8F) |

Opening a registry address on its explorer lists every lifecycle transaction
sent to it, with the exact gas and (on rollups) L1-data fee reported in the paper.

## Lifecycle transactions

### sepolia
- erc1056 `addDelegate`: [`0xf3e1465b5deda5b7...`](https://sepolia.etherscan.io/tx/0xf3e1465b5deda5b7699e0adb02c5c0a8d25a68a1e5159b61ba8d0f4dada74134)
- erc1056 `revokeDelegate`: [`0xa460970e493b6e29...`](https://sepolia.etherscan.io/tx/0xa460970e493b6e29cf07f9623d81f886e62b38cdd38b2cb1053c807908095399)
- erc1056 `setAttribute` (32B): [`0xb26b68af7dd28a86...`](https://sepolia.etherscan.io/tx/0xb26b68af7dd28a86e0d0f4860b02b7c3e7b8a4998359ef3b10a7e90906b2d2d7)
- erc1056 `setAttribute` (256B): [`0x2d88f682508031f4...`](https://sepolia.etherscan.io/tx/0x2d88f682508031f46fd4266d91cd7b7e8b9155738afc37232aacb57ccc0b88a4)
- erc1056 `revokeAttribute` (256B): [`0xc46f116f176a7e8d...`](https://sepolia.etherscan.io/tx/0xc46f116f176a7e8d29c45d9d6b4e5aaced8e469b48a6f17a746761067ff5c94c)
- erc1056 `changeOwner`: [`0x1724fad570052273...`](https://sepolia.etherscan.io/tx/0x1724fad57005227307bbb2ad5f2e7f735b3fd47c7c2a63869bfdf8ddf7e736ec)
- storage `create`: [`0xa943d0b6824b8626...`](https://sepolia.etherscan.io/tx/0xa943d0b6824b86263661aff8d9d3c83bcde046c384f1d39e719a9bac618fe7de)
- storage `addDelegate`: [`0x22909a6ae586c845...`](https://sepolia.etherscan.io/tx/0x22909a6ae586c845e0a6a5f11f1decfc0ef980ddfe23363cdde4e05bbda9dc1e)
- storage `revokeDelegate`: [`0x3f24a3b3f4e8e396...`](https://sepolia.etherscan.io/tx/0x3f24a3b3f4e8e396e346f9a8d845e9649299c570ab5a101d89b8f1d044baf1b7)
- storage `setAttribute` (32B): [`0x0ed3ec840215ae5e...`](https://sepolia.etherscan.io/tx/0x0ed3ec840215ae5e85aacb9eed5f903cddda89aed4cb5320580692b1e6b15613)
- storage `setAttribute` (256B): [`0x1971ce4bf13d83a7...`](https://sepolia.etherscan.io/tx/0x1971ce4bf13d83a7efec798ec3f9fb87c187bdc993f4f8ada799c22f6a3a7264)
- storage `revokeAttribute` (256B): [`0x54079d792ca5f4bd...`](https://sepolia.etherscan.io/tx/0x54079d792ca5f4bda89550a27647593e9089fb73f8a5018ad684b9fce766e322)
- storage `changeOwner`: [`0x6eda2884c53ab0e0...`](https://sepolia.etherscan.io/tx/0x6eda2884c53ab0e0ce0c61a295514dfcddb8c3be06ba1b13841c18cddcba7305)

### opSepolia
- erc1056 `addDelegate`: [`0xd737346210f42efa...`](https://sepolia-optimism.etherscan.io/tx/0xd737346210f42efa0e32d3addf139d2bdaea5f5fe4eee103132d9edc4fb629f1)
- erc1056 `revokeDelegate`: [`0x178fe13b76538271...`](https://sepolia-optimism.etherscan.io/tx/0x178fe13b7653827167c06ea92ee0803ca6bc8aab4e52e52f0c87637b26db6f53)
- erc1056 `setAttribute` (32B): [`0xe52c7720178da614...`](https://sepolia-optimism.etherscan.io/tx/0xe52c7720178da61401d8f00f6b33a73dbd5011cb39da6804ab143887cd8064dd)
- erc1056 `setAttribute` (256B): [`0xab5454655f2384af...`](https://sepolia-optimism.etherscan.io/tx/0xab5454655f2384af8fe6e5b8a7c8ee5fc80c619ad8f819b20e77c4b360fbec2a)
- erc1056 `revokeAttribute` (256B): [`0xc29cf3a4036544a9...`](https://sepolia-optimism.etherscan.io/tx/0xc29cf3a4036544a91a6e5604430baba2ac2b09b9ca1601753b5ae6a24d39435b)
- erc1056 `changeOwner`: [`0xee0d256fe83032d6...`](https://sepolia-optimism.etherscan.io/tx/0xee0d256fe83032d61b25e439e70f924df8011d700786dec6ffb7e09b71244125)
- storage `create`: [`0x7f72f0cbcee35c44...`](https://sepolia-optimism.etherscan.io/tx/0x7f72f0cbcee35c4492c586339cdcc89b0cc2770e4e3d271295e6a5887f42c1bc)
- storage `addDelegate`: [`0x0bd24600346b1bae...`](https://sepolia-optimism.etherscan.io/tx/0x0bd24600346b1baee19a242d24b8cd523af1a8d8e76d0c94ccb356332d7d7a60)
- storage `revokeDelegate`: [`0xa7bfb217291c45e4...`](https://sepolia-optimism.etherscan.io/tx/0xa7bfb217291c45e4a715dde08793dddea2158255bcd5e6158f141f4869778252)
- storage `setAttribute` (32B): [`0xa6dd093e39b632ac...`](https://sepolia-optimism.etherscan.io/tx/0xa6dd093e39b632acbd323af54e4c202a3a64a66df442ab4fa312cf6bcc807262)
- storage `setAttribute` (256B): [`0xd84a7ae94142da20...`](https://sepolia-optimism.etherscan.io/tx/0xd84a7ae94142da20d69b0807e109f4239c912f7e5ddbd638625c5aa7c87d1050)
- storage `revokeAttribute` (256B): [`0x109b3c1c39683c91...`](https://sepolia-optimism.etherscan.io/tx/0x109b3c1c39683c911891687321bcd7b4c8cff7299c8342080e5774087873746d)
- storage `changeOwner`: [`0x679e9b2f01493804...`](https://sepolia-optimism.etherscan.io/tx/0x679e9b2f014938043bd25b095b05b64eed3dca5088fa5c6db7021b94856a0924)

### arbSepolia
- erc1056 `addDelegate`: [`0xe156451a7d31ff74...`](https://sepolia.arbiscan.io/tx/0xe156451a7d31ff74b536f508555c3dfab013f036ad6ad2e86f51652b5883468b)
- erc1056 `revokeDelegate`: [`0xddd42b9e0f77a09f...`](https://sepolia.arbiscan.io/tx/0xddd42b9e0f77a09f32635dde45d4429a4633dc79dea662622319f8dbb8293942)
- erc1056 `setAttribute` (32B): [`0x81a86ea90e7c4b1f...`](https://sepolia.arbiscan.io/tx/0x81a86ea90e7c4b1fff95e2edf3233da9834c9aae8ceaf1aefd3713a8a50ac261)
- erc1056 `setAttribute` (256B): [`0xd4411991a5e8b5d5...`](https://sepolia.arbiscan.io/tx/0xd4411991a5e8b5d56d04eef5b2e2b832bd3855d87ae3f18e540d39f4d729fb7d)
- erc1056 `revokeAttribute` (256B): [`0x576cf340f01875d7...`](https://sepolia.arbiscan.io/tx/0x576cf340f01875d78dfc8f8d563387d2f9cfe6f1752dbdbf566c7904362dfb52)
- erc1056 `changeOwner`: [`0x4fb87f363bf8dbb3...`](https://sepolia.arbiscan.io/tx/0x4fb87f363bf8dbb3a706dbd59c5ce3ec54d9b23759f633884539807f411e6481)
- storage `create`: [`0xf5dd23b7b4da1203...`](https://sepolia.arbiscan.io/tx/0xf5dd23b7b4da1203ce7ebb88b6706991e04b7a05e6d4637d4b9ebf97a6d43cc1)
- storage `addDelegate`: [`0x079d60f6d8aae6d6...`](https://sepolia.arbiscan.io/tx/0x079d60f6d8aae6d69bba3dd676af633290550a3b62b9951a032ab70b57b5a48a)
- storage `revokeDelegate`: [`0x980b22c4fff9cea9...`](https://sepolia.arbiscan.io/tx/0x980b22c4fff9cea9c91f7c618de8822eb355943d879a2a6f850d48a64fef1338)
- storage `setAttribute` (32B): [`0x1e22ce459db5e77b...`](https://sepolia.arbiscan.io/tx/0x1e22ce459db5e77b5abd439fa03064aa349f4cafefa8e6636fdc374fa59023c0)
- storage `setAttribute` (256B): [`0xa347f84094e48f92...`](https://sepolia.arbiscan.io/tx/0xa347f84094e48f9268399ee0bc38bee67c37ce15abfd2d6c06d15972eecabd06)
- storage `revokeAttribute` (256B): [`0xf67f980d1323ec96...`](https://sepolia.arbiscan.io/tx/0xf67f980d1323ec96c3ad8acfc902c91c346b3afc0dff4be3371d525042da8c79)
- storage `changeOwner`: [`0x120b7e67d856a685...`](https://sepolia.arbiscan.io/tx/0x120b7e67d856a68583de79cb0225486ceb4512af5f073f206c4a89442032a4df)

## Reproduce the Arbitrum resolution failure (read-only, no keys)

```bash
npm install
node scripts/did_pointer_direct.js   # changed[identity] (L1 estimate) vs true L2 event block
node scripts/did_prod_resolver.js    # production ethr-did-resolver: OK on Sepolia/OP, notFound on Arbitrum
```
