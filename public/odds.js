// Exact odds that a random Solana public key (32 bytes, base58) starts with a prefix.
export const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const TWO256 = 1n << 256n;

export function isValidPrefix(p) {
  if (!p || p.length < 1 || p.length > 6) return false;
  if (p[0] === '1') return false;
  for (const c of p) if (!B58.includes(c)) return false;
  return true;
}

function probExact(p) {
  let v = 0n;
  for (const c of p) v = v * 58n + BigInt(B58.indexOf(c));
  const k = p.length;
  let count = 0n;
  for (let L = k; L <= 44; L++) {
    const scale = 58n ** BigInt(L - k);
    let lo = v * scale, hi = (v + 1n) * scale;
    const minL = 58n ** BigInt(L - 1), maxL = 58n ** BigInt(L);
    if (lo < minL) lo = minL;
    if (hi > maxL) hi = maxL;
    if (hi > TWO256) hi = TWO256;
    if (hi > lo) count += hi - lo;
  }
  return Number(count * 1000000000000n / TWO256) / 1e12;
}

function caseVariants(p) {
  let out = [''];
  for (const c of p) {
    const opts = new Set([c, c.toUpperCase(), c.toLowerCase()].filter(x => B58.includes(x)));
    out = out.flatMap(s => [...opts].map(o => s + o));
  }
  return out;
}

export function probability(prefix, matchCase = true) {
  if (!isValidPrefix(prefix)) return 0;
  if (matchCase) return probExact(prefix);
  return caseVariants(prefix).filter(isValidPrefix).reduce((a, v) => a + probExact(v), 0);
}

export function expectedTries(prefix, matchCase = true) {
  const p = probability(prefix, matchCase);
  return p > 0 ? Math.round(1 / p) : Infinity;
}

export function fmtDuration(s) {
  if (!isFinite(s)) return 'too long';
  if (s < 1) return 'under a second';
  if (s < 60) return Math.round(s) + ' sec';
  if (s < 3600) return Math.round(s / 60) + ' min';
  if (s < 86400) return (s / 3600).toFixed(1) + ' hours';
  return Math.round(s / 86400) + ' days';
}
