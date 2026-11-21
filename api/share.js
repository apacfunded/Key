// Builds the creator-reward split for a Key coin: pump.fun's own fee-sharing config, with 80% to the
// creator and 20% to the buyback wallet. The creator signs it in their wallet right after the create.
// The sweeps in front are harmless when empty and stop the setup failing if a trade already left
// creator fees on the curve.
import { createRequire } from 'module';
import { json, fail, isAddress, launchesOpen, BUYBACK_WALLET, CREATOR_BPS, BUYBACK_BPS, RPC_URL } from '../lib/server.js';
const require = createRequire(import.meta.url);

export async function buildShareTx(publicKey, mint) {
  const { PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, Connection } = require('@solana/web3.js');
  const { PUMP_SDK, feeSharingConfigPda } = require('@pump-fun/pump-sdk');
  const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const creator = new PublicKey(publicKey), mintKey = new PublicKey(mint), buyback = new PublicKey(BUYBACK_WALLET);
  if (creator.equals(buyback)) throw new Error('The creator wallet cannot be the buyback wallet.');
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 }),
    await PUMP_SDK.sweepCreatorFeeInstruction({ payer: creator, mint: mintKey, creator, quoteMint: NATIVE_MINT }),
    await PUMP_SDK.createFeeSharingConfig({ creator, mint: mintKey, pool: null }),
    await PUMP_SDK.sweepCreatorFeeInstruction({ payer: creator, mint: mintKey, creator: feeSharingConfigPda(mintKey), quoteMint: NATIVE_MINT }),
    await PUMP_SDK.updateFeeShares({
      authority: creator, mint: mintKey, currentShareholders: [creator], bondingCurveComplete: false,
      newShareholders: [{ address: creator, shareBps: CREATOR_BPS }, { address: buyback, shareBps: BUYBACK_BPS }],
    }),
  ];
  const { blockhash } = await new Connection(RPC_URL, 'confirmed').getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: creator, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

export async function POST(request) {
  if (!launchesOpen()) return fail('Launches are not open yet.', 503);
  let b; try { b = await request.json(); } catch { return fail('Bad request'); }
  if (!isAddress(b?.publicKey) || !isAddress(b?.mint)) return fail('Invalid address');
  try { return json({ tx: await buildShareTx(b.publicKey, b.mint) }); }
  catch (e) { return fail(e.message || 'Could not build the reward split.', 502); }
}
