// Key generator worker: grinds STANDARD Solana keypairs (random seed -> Ed25519 keypair), so the
// result can be imported anywhere. Uses the browser's built-in Ed25519 (fast) when it has one, and
// tweetnacl otherwise. Runs only in this browser; nothing is sent over the network.
importScripts('/vendor/nacl-fast.min.js', '/ed-core.js');
const E = self.EtchEd;

let rg = [], targets = [];
const top48 = (pk) => ((((pk[0] * 256 + pk[1]) * 256 + pk[2]) * 256 + pk[3]) * 256 + pk[4]) * 256 + pk[5];
function matches(pk) {
  const v = top48(pk);
  let hit = false;
  for (let r = 0; r < rg.length; r++) if (v >= rg[r][0] && v <= rg[r][1]) { hit = true; break; }
  if (!hit) return null;
  const addr = E.b58(pk);
  return targets.some(t => addr.startsWith(t)) ? addr : null;
}
function report(addr, seed, tried) {
  const kp = nacl.sign.keyPair.fromSeed(seed); // standard 64-byte secret key: seed + public key
  if (E.b58(kp.publicKey) !== addr) return false;
  postMessage({ type: 'found', address: addr, secret: Array.from(kp.secretKey), tried });
  return true;
}

async function nativeLoop() {
  const alg = { name: 'Ed25519' }, BATCH = 256;
  let tried = 0, last = performance.now();
  for (;;) {
    const pairs = await Promise.all(Array.from({ length: BATCH }, () => crypto.subtle.generateKey(alg, true, ['sign'])));
    const pubs = await Promise.all(pairs.map(p => crypto.subtle.exportKey('raw', p.publicKey)));
    for (let i = 0; i < BATCH; i++) {
      const addr = matches(new Uint8Array(pubs[i]));
      if (!addr) continue;
      const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pairs[i].privateKey));
      if (report(addr, pkcs8.slice(-32), tried + i + 1)) return;
    }
    tried += BATCH;
    const now = performance.now();
    if (now - last > 250) { postMessage({ type: 'progress', tried }); tried = 0; last = now; }
  }
}
function naclLoop() {
  const seed = new Uint8Array(32);
  let tried = 0, last = performance.now();
  for (;;) {
    for (let n = 0; n < 64; n++) {
      crypto.getRandomValues(seed);
      const addr = matches(nacl.sign.keyPair.fromSeed(seed).publicKey);
      if (addr && report(addr, seed.slice(), tried + n + 1)) return;
    }
    tried += 64;
    const now = performance.now();
    if (now - last > 250) { postMessage({ type: 'progress', tried }); tried = 0; last = now; }
  }
}
async function hasNative() {
  try { const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign']); await crypto.subtle.exportKey('pkcs8', k.privateKey); return true; } catch { return false; }
}
onmessage = async (e) => {
  const m = e.data;
  if (m.type !== 'start') return;
  targets = m.targets; rg = E.ranges(targets);
  if (await hasNative()) await nativeLoop(); else naclLoop();
};
