// The coin list. No database: every launch sends a 0 SOL note (a Memo) to REGISTRY_WALLET, and this
// route reads the notes back from the chain.
import { json, rpc, parseNote, REGISTRY_WALLET, RPC_URL, isAddress } from '../lib/server.js';
export async function GET() {
  if (!RPC_URL || !isAddress(REGISTRY_WALLET)) return json({ coins: [], total: 0, longest: 0 });
  try {
    const sigs = await rpc('getSignaturesForAddress', [REGISTRY_WALLET, { limit: 1000 }]);
    const seen = new Set(), coins = [];
    for (const s of sigs) {
      if (s.err || !s.memo) continue;
      const n = parseNote(s.memo);
      if (!n || seen.has(n.mint)) continue;
      seen.add(n.mint);
      coins.push({ ...n, at: (s.blockTime || 0) * 1000, image: `https://images.pump.fun/coin-image/${n.mint}?variant=256x256` });
    }
    return json({ coins, total: coins.length, longest: coins.reduce((m, c) => Math.max(m, c.prefix.length), 0) }, 200, { 'cache-control': 'public, s-maxage=20, stale-while-revalidate=60' });
  } catch { return json({ coins: [], total: 0, longest: 0 }); }
}
