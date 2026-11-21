// Minimal Ed25519 for Etch (BigInt). Classic script: defines self.EtchEd.
// Fast grinding: start from a random secret scalar s0, then walk A_i = (s0 + i)·B by adding the
// base point each step (one cheap point addition instead of a full key generation), with batched
// inversion and a numeric prefix pre-check so base58 only runs on near-matches.
// The resulting secret is an Ed25519 expanded key (scalar + nonce prefix); signatures it makes are
// standard Ed25519 signatures that verify against the address.
(function (root) {
  const P = (1n << 255n) - 19n;
  const L = (1n << 252n) + 27742317777372353535851937790883648493n;
  const MASK = (1n << 255n) - 1n;
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  // fast reduction mod 2^255-19 for non-negative inputs < 2^510
  const red = (a) => { a = (a & MASK) + (a >> 255n) * 19n; a = (a & MASK) + (a >> 255n) * 19n; return a >= P ? a - P : a; };
  const mod = (a, m = P) => { const r = a % m; return r >= 0n ? r : r + m; };
  const mul = (a, b) => red(a * b);
  function pow(b, e) { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = mul(r, b); b = mul(b, b); e >>= 1n; } return r; }
  const inv = (a) => pow(a, P - 2n);

  const D = mod(-121665n * inv(121666n));
  const D2 = mul(D, 2n);
  const SQRT_M1 = pow(2n, (P - 1n) / 4n);
  function recoverX(y, odd) {
    const yy = mul(y, y), u = mod(yy - 1n), v = mod(mul(D, yy) + 1n);
    let x = pow(mul(u, inv(v)), (P + 3n) / 8n);
    if (mod(mul(mul(x, x), v) - u) !== 0n) x = mul(x, SQRT_M1);
    if ((x & 1n) !== BigInt(odd)) x = P - x;
    return x;
  }
  const By = mul(4n, inv(5n));
  const Bx = recoverX(By, 0);
  const BASE = { X: Bx, Y: By, Z: 1n, T: mul(Bx, By) };
  const ZERO = { X: 0n, Y: 1n, Z: 1n, T: 0n };

  // unified addition, extended coordinates, a = -1 (complete; also used for doubling)
  function add(p, q) {
    const A = mul(mod(p.Y - p.X), mod(q.Y - q.X));
    const Bv = mul(p.Y + p.X, q.Y + q.X);
    const C = mul(mul(p.T, D2), q.T);
    const Dd = mul(p.Z, 2n * q.Z);
    const E = mod(Bv - A), F = mod(Dd - C), G = red(Dd + C), H = red(Bv + A);
    return { X: mul(E, F), Y: mul(G, H), T: mul(E, H), Z: mul(F, G) };
  }
  function scalarMult(k, pt = BASE) {
    let r = ZERO, q = pt;
    while (k > 0n) { if (k & 1n) r = add(r, q); q = add(q, q); k >>= 1n; }
    return r;
  }
  function encode(pt) {
    const zi = inv(pt.Z);
    const x = mul(pt.X, zi), y = mul(pt.Y, zi);
    return bigToLe(y | ((x & 1n) << 255n), 32);
  }
  function bigToLe(n, len) { const out = new Uint8Array(len); for (let i = 0; i < len; i++) { out[i] = Number(n & 255n); n >>= 8n; } return out; }
  function leToBig(b) { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; }

  function b58(bytes) {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    const digits = [];
    for (let i = zeros; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let s = '1'.repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]];
    return s;
  }

  // Ranges of the top 48 bits of the address (as a big-endian number) that can start with a target.
  function ranges(targets) {
    const out = [], TWO256 = 1n << 256n, SH = 208n;
    for (const t of targets) {
      let v = 0n; for (const c of t) v = v * 58n + BigInt(B58.indexOf(c));
      for (let len = t.length; len <= 44; len++) {
        const sc = 58n ** BigInt(len - t.length);
        let lo = v * sc, hi = (v + 1n) * sc;
        const minL = 58n ** BigInt(len - 1), maxL = 58n ** BigInt(len);
        if (lo < minL) lo = minL; if (hi > maxL) hi = maxL; if (hi > TWO256) hi = TWO256;
        if (hi > lo) out.push([Number(lo >> SH), Number((hi - 1n) >> SH)]);
      }
    }
    return out;
  }

  function randBig(bytes) { const b = new Uint8Array(bytes); crypto.getRandomValues(b); return leToBig(b); }

  // Grind loop. onBatch(tried) is called after each batch; return false to stop.
  function grind(targets, onFound, onBatch, N = 256) {
    const rg = ranges(targets);
    const s0 = mod(randBig(64), L);
    let cur = scalarMult(s0), i = 0;
    const ymx = mod(By - Bx), ypx = red(By + Bx), t2d = mul(mul(Bx, By), D2);
    const Xs = new Array(N), Ys = new Array(N), Zs = new Array(N), acc = new Array(N);
    const M48 = (1n << 48n) - 1n;
    for (;;) {
      let { X, Y, Z, T } = cur;
      for (let j = 0; j < N; j++) {
        // cur += B (precomputed base, Z2 = 1)
        const A = mul(mod(Y - X), ymx), Bv = mul(Y + X, ypx), C = mul(T, t2d), Dd = Z << 1n;
        const E = mod(Bv - A), F = mod(Dd - C), G = red(Dd + C), H = red(Bv + A);
        X = mul(E, F); Y = mul(G, H); T = mul(E, H); Z = mul(F, G);
        Xs[j] = X; Ys[j] = Y; Zs[j] = Z;
        acc[j] = j ? mul(acc[j - 1], Z) : Z;
      }
      cur = { X, Y, Z, T };
      let ia = inv(acc[N - 1]);
      for (let j = N - 1; j >= 0; j--) {
        const zi = j ? mul(ia, acc[j - 1]) : ia;
        if (j) ia = mul(ia, Zs[j]);
        const y = mul(Ys[j], zi);
        // top 48 bits of the big-endian address = first 6 little-endian bytes of y, reversed
        let lo = Number(y & M48), v = 0;
        for (let k = 0; k < 6; k++) { v = v * 256 + (lo % 256); lo = Math.floor(lo / 256); }
        let hit = false;
        for (let r = 0; r < rg.length; r++) if (v >= rg[r][0] && v <= rg[r][1]) { hit = true; break; }
        if (!hit) continue;
        const x = mul(Xs[j], zi);
        const pub = bigToLe(y | ((x & 1n) << 255n), 32);
        const addr = b58(pub);
        for (const t of targets) if (addr.startsWith(t)) {
          const s = mod(s0 + BigInt(i + j + 1), L);
          onFound({ address: addr, scalar: s.toString(16), prefix: Array.from(crypto.getRandomValues(new Uint8Array(32))), tried: j + 1 });
          return;
        }
      }
      i += N;
      if (onBatch(N) === false) return;
    }
  }

  // Ed25519 signature with an expanded key (scalar s, 32-byte nonce prefix).
  async function sign(msg, sHex, prefix, pub) {
    const s = BigInt('0x' + sHex);
    const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
    const sha = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-512', b));
    const r = mod(leToBig(await sha(cat(Uint8Array.from(prefix), msg))), L);
    const R = encode(scalarMult(r));
    const k = mod(leToBig(await sha(cat(R, pub, msg))), L);
    const S = mod(r + k * s, L);
    return cat(R, bigToLe(S, 32));
  }
  function pubFromScalar(sHex) { return encode(scalarMult(BigInt('0x' + sHex))); }

  root.EtchEd = { grind, sign, pubFromScalar, b58, ranges };
})(typeof self !== 'undefined' ? self : globalThis);
