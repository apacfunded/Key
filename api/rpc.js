// JSON-RPC proxy so the RPC link (and any API key in it) stays on the server. Only the calls the site uses.
import { fail, RPC_URL } from '../lib/server.js';
const ALLOWED = new Set(['getLatestBlockhash', 'getBalance', 'sendTransaction', 'getSignatureStatuses', 'getAccountInfo', 'getMultipleAccounts', 'simulateTransaction', 'getBlockHeight', 'getSlot', 'getVersion', 'getEpochInfo', 'getMinimumBalanceForRentExemption', 'getFeeForMessage', 'getTokenSupply']);
export async function POST(request) {
  if (!RPC_URL) return fail('Launches are not open yet.', 503);
  let body; try { body = await request.json(); } catch { return fail('Bad request'); }
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 10 || calls.some(c => !c || !ALLOWED.has(c.method))) return fail('Method not allowed', 403);
  const r = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json' } });
}
