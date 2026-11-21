// Public settings the site reads on load.
import { json, rpc, launchesOpen, REGISTRY_WALLET, BUYBACK_WALLET, KEY_MINT, CREATOR_BPS, BUYBACK_BPS } from '../lib/server.js';
const PUMP_SUPPLY = 1e9; // every pump.fun coin starts with 1B tokens; burns lower the supply

export async function GET() {
  let supply = null, burned = null;
  if (KEY_MINT) {
    try { const s = await rpc('getTokenSupply', [KEY_MINT, { commitment: 'confirmed' }]); supply = Number(s.value.uiAmountString); burned = Math.max(0, PUMP_SUPPLY - supply); } catch { /* optional */ }
  }
  return json({
    feeSol: 0, normalFeeSol: 0, freeUntil: null, teamShare: 0.5,
    tradeShare: { buybackBps: BUYBACK_BPS, teamBps: 0, creatorBps: CREATOR_BPS },
    teamWallet: REGISTRY_WALLET, buybackWallet: BUYBACK_WALLET,
    etchMint: KEY_MINT || null, etchSupply: supply, etchBurned: burned,
    launchesOpen: launchesOpen(),
  }, 200, { 'cache-control': 'public, s-maxage=60' });
}
