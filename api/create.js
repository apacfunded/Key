// Builds the unsigned pump.fun create transaction (through PumpPortal's local-transaction API) for a
// mint address the user ground in their browser. Nothing is signed here: the wallet and the mint key
// both sign on the user's device.
import { json, fail, isAddress, cleanText, launchesOpen, MAX_DEV_BUY_SOL } from '../lib/server.js';
const MIN_BUY_SOL = 0.0001; // pump.fun needs a first buy

export async function POST(request) {
  if (!launchesOpen()) return fail('Launches are not open yet.', 503);
  let b; try { b = await request.json(); } catch { return fail('Bad request'); }
  const { publicKey, mint, uri } = b || {};
  const name = cleanText(b?.name, 32), symbol = cleanText(b?.symbol, 10).toUpperCase();
  if (!isAddress(publicKey) || !isAddress(mint)) return fail('Invalid address');
  if (!name || !/^[A-Z0-9]{1,10}$/.test(symbol)) return fail('Check the name and ticker.');
  if (typeof uri !== 'string' || !uri.startsWith('https://ipfs.io/ipfs/')) return fail('Invalid metadata');
  const devBuy = Number(b?.devBuySol ?? 0);
  if (!Number.isFinite(devBuy) || devBuy < 0 || devBuy > MAX_DEV_BUY_SOL) return fail(`Dev buy must be 0 to ${MAX_DEV_BUY_SOL} SOL.`);
  const r = await fetch('https://pumpportal.fun/api/trade-local', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey, action: 'create', tokenMetadata: { name, symbol, uri }, mint, denominatedInSol: 'true', amount: Math.max(devBuy, MIN_BUY_SOL), slippage: 10, priorityFee: 0.0005, pool: 'pump' }),
  });
  if (!r.ok) return fail('Could not build the pump.fun transaction. Try again in a moment.', 502);
  return json({ tx: Buffer.from(await r.arrayBuffer()).toString('base64') });
}
