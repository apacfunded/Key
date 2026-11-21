# Key

Custom contract addresses for pump.fun coins. Built on Etch's site: the visitor picks a prefix, their
browser grinds a matching mint key, and the coin launches on pump.fun.

## How the 20% works
Every launch signs three transactions in one wallet prompt:
1. the pump.fun create (built by PumpPortal),
2. the creator-reward split, using pump.fun's own fee sharing: 80% to the creator, 20% to `BUYBACK_WALLET`,
3. a 0 SOL note to `REGISTRY_WALLET` so the coin shows on Key.

The 20% arrives in `BUYBACK_WALLET` as SOL. Buying $KEY with it and burning the $KEY is **not automated**:
someone with that wallet's key has to do it.

The creator stays the authority of their coin's split, so pump.fun lets them change it later. Key cannot
lock it yet.

## Settings (Vercel → Project → Settings → Environment Variables)
| Name | What it is | Needed |
|---|---|---|
| `RPC_URL` | Solana mainnet RPC link | Yes |
| `PINATA_JWT` | Pinata JWT for image and metadata uploads | Yes |
| `BUYBACK_WALLET` | Public address that receives the 20% | Yes |
| `REGISTRY_WALLET` | Public address for the 0 SOL launch notes (defaults to `BUYBACK_WALLET`) | No |
| `KEY_MINT` | The $KEY contract address, once it exists | No |

Launches stay closed ("Launches open soon") until the first three are set.

## Files
- `public/` the site (Etch's front end, rebranded). `key-extras.js` adds the try-a-prefix box.
- `api/` server routes: `config`, `rpc`, `upload` (Pinata), `create` (PumpPortal), `share` (80/20 split), `coins`, `pairs`.
- `dev-server.js` runs it locally: `RPC_URL=... PINATA_JWT=... BUYBACK_WALLET=... node dev-server.js`
