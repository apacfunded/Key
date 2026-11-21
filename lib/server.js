// Shared helpers and settings for Key's API routes. Every setting is a Vercel environment variable:
//   RPC_URL           Solana mainnet RPC link (Helius, QuickNode...). Kept on the server.
//   PINATA_JWT        Pinata JWT, used to put coin images and details on IPFS.
//   BUYBACK_WALLET    Public address that receives 20% of every Key coin's creator rewards.
//   REGISTRY_WALLET   Public address that receives the 0 SOL note each launch sends, so the coin
//                     list can find Key coins. Can be the same as BUYBACK_WALLET.
//   KEY_MINT          The $KEY contract address, once it exists. Optional.
// Launches stay closed until the first four are set.
export const env = (k) => (process.env[k] || '').trim();
export const RPC_URL = env('RPC_URL');
export const PINATA_JWT = env('PINATA_JWT');
export const BUYBACK_WALLET = env('BUYBACK_WALLET');
export const REGISTRY_WALLET = env('REGISTRY_WALLET') || BUYBACK_WALLET;
export const KEY_MINT = env('KEY_MINT');

export const CREATOR_BPS = 8000; // creator keeps 80% of creator rewards
export const BUYBACK_BPS = 2000; // 20% goes to the buyback wallet to buy and burn $KEY
export const MAX_DEV_BUY_SOL = 10;

const B58RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isAddress = (s) => typeof s === 'string' && B58RE.test(s);
export const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f|]/g, ' ').trim().slice(0, max);
export const launchesOpen = () => Boolean(RPC_URL && PINATA_JWT && isAddress(BUYBACK_WALLET) && isAddress(REGISTRY_WALLET));

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
export const fail = (message, status = 400) => json({ error: message }, status);

export async function rpc(method, params) {
  if (!RPC_URL) throw new Error('RPC_URL is not set');
  const r = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}

// The 0 SOL note each launch sends to REGISTRY_WALLET: key1|mint|prefix|SYMBOL|creator|name
export function makeNote({ mint, prefix, symbol, creator, name }) {
  return ['key1', mint, prefix, cleanText(symbol, 10), creator, cleanText(name, 32)].join('|');
}
export function parseNote(memo) {
  const m = /key1\|([1-9A-HJ-NP-Za-km-z]{32,44})\|([1-9A-HJ-NP-Za-km-z]{1,6})\|([^|]{1,10})\|([1-9A-HJ-NP-Za-km-z]{32,44})\|(.{1,32})$/.exec(memo || '');
  if (!m) return null;
  const [, mint, prefix, symbol, creator, name] = m;
  // the address proves the prefix: drop notes whose mint doesn't start with it (in any case)
  if (!mint.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  return { mint, prefix: mint.slice(0, prefix.length), symbol: symbol.trim().toUpperCase(), creator, name: name.trim() };
}
