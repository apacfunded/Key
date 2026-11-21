// Quick status check: can the server reach Solana through RPC_URL, and does $KEY exist? Shows no secrets.
import { json, rpc, RPC_URL, KEY_MINT, PINATA_JWT, BUYBACK_WALLET } from '../lib/server.js';
const short = (e) => String(e?.message || e).replace(/https?:\/\/\S+/g, '[rpc]').slice(0, 160);
export async function GET() {
  const out = { rpcSet: Boolean(RPC_URL), pinataSet: Boolean(PINATA_JWT), buybackSet: Boolean(BUYBACK_WALLET) };
  try { out.slot = await rpc('getSlot', []); out.rpc = 'ok'; } catch (e) { out.rpc = 'error: ' + short(e); }
  if (KEY_MINT) {
    try { const a = await rpc('getAccountInfo', [KEY_MINT, { encoding: 'base64' }]); out.keyMint = a?.value ? `exists (owner ${a.value.owner})` : 'not found on chain'; }
    catch (e) { out.keyMint = 'error: ' + short(e); }
    try { const s = await rpc('getTokenSupply', [KEY_MINT]); out.keySupply = s.value.uiAmountString; } catch (e) { out.keySupply = 'error: ' + short(e); }
  }
  return json(out, 200, { 'cache-control': 'no-store' });
}
