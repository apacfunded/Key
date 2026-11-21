// Key front end. Grinds the mint key in Web Workers, builds and signs the pump.fun create
// transaction with the user's wallet, then sends a 0 SOL registration so the coin shows on Key.
// Key takes no launch fee. 20% of each coin's creator rewards buys back and burns $KEY; the creator keeps 80%.
import { B58, isValidPrefix, probability, fmtDuration } from './odds.js';
import './ed-core.js'; // defines window.EtchEd
import { Buffer } from 'https://cdn.jsdelivr.net/npm/buffer@6.0.3/+esm';
if (!window.Buffer) window.Buffer = Buffer; // web3.js's browser build needs a global Buffer

const { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, LAMPORTS_PER_SOL } = window.solanaWeb3;
const $ = (id) => document.getElementById(id);
const conn = new Connection(`${location.origin}/api/rpc`, 'confirmed');
let CFG = { feeSol: 0, teamShare: 0.5, launchesOpen: false };
let wallet = null, walletKey = null;
let coins = [];

// ---------- small helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = (a) => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
const fmtNum = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n));
function toast(msg) {
  const t = document.createElement('div'); t.className = 'e-toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed'); } }
const randTail = (n) => Array.from({ length: n }, () => B58[Math.floor(Math.random() * 58)]).join('');

// ---------- routing ----------
function route() {
  const r = (location.hash || '#home').slice(1);
  const coinMint = /^coin\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(r)?.[1];
  const name = coinMint ? 'coin' : ['home', 'launch', 'etch', 'me'].includes(r) ? r : 'home';
  if (coinMint) showCoin(coinMint);
  document.querySelectorAll('[data-route]').forEach(el => { el.hidden = el.dataset.route !== name; });
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === (name === 'coin' ? 'home' : name)));
  if (r === 'coins') { document.querySelector('[data-route="home"]').hidden = false; $('coins').scrollIntoView({ behavior: 'smooth' }); }
  else window.scrollTo(0, 0);
  if (name === 'launch') benchmark();
  if (name === 'me') renderMine();
  if (name === 'etch') renderEtch();
}
document.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.nav; }));
addEventListener('hashchange', route);

// ---------- home: grinder animation ----------
(function rollRows() {
  const box = $('rollRows');
  const fill = () => { box.innerHTML = Array.from({ length: 24 }, () => `<span>${randTail(44)}</span>`).join(''); };
  fill(); setInterval(fill, 1600);
  // cycle example coins through the match card
  const EX = ['KEY', 'PUG', 'CAT', 'HYPE', 'DEGEN', 'APE', 'FREN', 'test', 'CHAD', 'MEME', 'JEET', 'GM'];
  const tail = $('demoTail'), pre = tail.previousElementSibling, badge = tail.parentElement.nextElementSibling;
  const oddsLbl = $('demoOdds').previousElementSibling, timeVal = $('demoOdds').parentElement.nextElementSibling.lastElementChild;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let ei = 0;
  const lock = (x) => {
    const n = 1 / probability(x, true);
    pre.textContent = x; tail.textContent = randTail(44 - x.length);
    badge.textContent = `Match · ${x}`; badge.style.opacity = 1;
    oddsLbl.textContent = `Odds for ${x}`; $('demoOdds').textContent = `1 in ${fmtNum(n)}`;
    const d = fmtDuration(n / 400000); timeVal.textContent = d.startsWith('under') ? d : `~${d}`;
  };
  const show = (x) => {
    if (calm) return lock(x);
    let k = 0; badge.style.opacity = .35;
    const t = setInterval(() => {
      pre.textContent = randTail(x.length); tail.textContent = randTail(44 - x.length);
      if (++k > 9) { clearInterval(t); lock(x); }
    }, 60);
  };
  show(EX[0]);
  setInterval(() => show(EX[++ei % EX.length]), 2600);
})();

// ---------- data ----------
const ago = (t) => { if (!t) return ''; const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };
function coinCard(c) {
  const img = c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : `<span class="ph"></span>`;
  const n = (c.prefix || '').length;
  const pre = esc(c.mint.slice(0, n)), rest = esc(c.mint.slice(n, 18));
  return `<a class="e-coin" href="#coin/${esc(c.mint)}">${img}
    <span class="meta" style="display:flex;flex-direction:column;gap:4px;min-width:0;flex:1">
      <b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)} <span style="font-weight:500;color:#3B4A63">$${esc(c.symbol)}</span></b>
      <span class="e-ca ca"><span class="e-pre">${pre}</span><span class="e-mid">${rest}…</span></span>
      <span class="e-sub">${n ? `${n}-letter CA · ` : ''}${c.quote ? `${esc(pairTicker(c.quote))} pair · ` : ''}${c.main ? '<span class="main-tag">Main coin</span>' : ago(c.at)}</span>
    </span></a>`;
}
// search / sort / filter state for the coin list
const view = { q: '', sort: 'new', len: 0 };
function setupExplore() {
  const list = $('coinList'); if (!list || $('coinTools')) return;
  const bar = document.createElement('div'); bar.id = 'coinTools'; bar.className = 'e-tools';
  bar.innerHTML = `<input id="coinQ" class="e-input" type="search" placeholder="Search name, ticker or CA" aria-label="Search coins" autocomplete="off" spellcheck="false">
    <select id="coinSort" class="e-input" aria-label="Sort coins"><option value="new">Newest</option><option value="old">Oldest</option><option value="len">Longest prefix</option><option value="az">A–Z</option></select>
    <div class="e-chips" role="group" aria-label="Prefix length">${[['All', 0], ['1', 1], ['2', 2], ['3', 3], ['4', 4], ['5', 5]].map(([l, v]) => `<button type="button" data-len="${v}"${v ? '' : ' class="on"'}>${v ? l + '-letter' : l}</button>`).join('')}</div>
    <span id="coinCount" class="e-sub"></span>`;
  list.before(bar);
  $('coinQ').addEventListener('input', e => { view.q = e.target.value.trim().toLowerCase(); renderCoins(); });
  $('coinSort').addEventListener('change', e => { view.sort = e.target.value; renderCoins(); });
  bar.querySelector('.e-chips').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    view.len = +b.dataset.len; bar.querySelectorAll('.e-chips button').forEach(x => x.classList.toggle('on', x === b)); renderCoins();
  });
}
function renderCoins() {
  setupExplore();
  let rows = coins.filter(c => {
    if (view.len && (c.prefix || '').length !== view.len) return false;
    if (!view.q) return true;
    return [c.name, c.symbol, '$' + c.symbol, c.mint].some(x => String(x || '').toLowerCase().includes(view.q));
  });
  const by = { new: (a, b) => b.at - a.at, old: (a, b) => a.at - b.at, len: (a, b) => (b.prefix || '').length - (a.prefix || '').length || b.at - a.at, az: (a, b) => String(a.name).localeCompare(String(b.name)) }[view.sort];
  rows = rows.sort((x, y) => (y.main ? 1 : 0) - (x.main ? 1 : 0) || by(x, y));
  $('coinList').innerHTML = rows.map(coinCard).join('');
  $('coinTools').hidden = coins.length === 0;
  $('coinEmpty').hidden = coins.length > 0;
  const filtered = coins.length > 0 && (view.q || view.len);
  $('coinCount').textContent = coins.length ? (filtered ? `${rows.length} of ${coins.length} coins` : `${coins.length} coin${coins.length === 1 ? '' : 's'}`) : '';
  let none = $('coinNone');
  if (!none) { none = document.createElement('div'); none.id = 'coinNone'; none.className = 'e-none'; $('coinList').after(none); }
  none.hidden = !(coins.length && !rows.length);
  none.innerHTML = 'No coins match. <button type="button" class="e-link">Clear search</button>';
  none.querySelector('button').onclick = () => { view.q = ''; view.len = 0; $('coinQ').value = ''; $('coinTools').querySelectorAll('.e-chips button').forEach(x => x.classList.toggle('on', x.dataset.len === '0')); renderCoins(); };
}
async function loadCoins() {
  try {
    const d = await (await fetch('/api/coins')).json();
    coins = d.coins || [];
    $('statTotal').textContent = (d.total || 0).toLocaleString();
    $('statLongest').textContent = d.longest || '—';
    renderCoins();
  } catch { /* list is optional */ }
}
function renderMine() {
  if (!walletKey) { $('meEmpty').hidden = false; $('meEmpty').textContent = 'Connect a wallet to see coins you launched on Key. Connecting only shares your public address.'; $('meList').innerHTML = ''; return; }
  const mine = coins.filter(c => c.creator === walletKey);
  $('meEmpty').hidden = mine.length > 0;
  $('meEmpty').textContent = 'No coins from this wallet yet.';
  $('meList').innerHTML = mine.map(coinCard).join('');
}
async function loadConfig() {
  try { CFG = { ...CFG, ...(await (await fetch('/api/config')).json()), feeSol: 0, freeUntil: null }; } catch { }
  const ca = CFG.etchMint;
  if (ca && $('coinCa')) { const n = /^key/i.test(ca) ? 3 : 0; $('coinCa').innerHTML = `<span class="e-pre">${esc(ca.slice(0, n))}</span>${esc(ca.slice(n))}`; if (!n) $('coinCa').firstChild.remove(); $('coinCopy').hidden = false; $('coinCopy').onclick = () => copy(ca); $('coinBuy').hidden = false; $('coinBuy').href = `https://pump.fun/coin/${ca}`; }
  document.querySelectorAll('.etchCa').forEach(el => {
    el.innerHTML = ca
      ? `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center"><span class="e-ca" style="font-size:14px;word-break:break-all;background:#EEF3FA;border-radius:12px;padding:12px 14px">${esc(ca)}</span>
         <button class="e-pill e-cream sm" type="button" data-copy="${esc(ca)}">Copy CA</button>
         <a class="e-pill e-gloss sm" href="https://pump.fun/coin/${esc(ca)}" target="_blank" rel="noopener">Buy on pump.fun</a></div>`
      : `<span style="font-size:15px;color:#3B4A63">The $KEY contract address will be posted here at launch. Ignore any address sent in DMs or replies.</span>`;
  });
  if (location.hash === '#etch') renderEtch();
  applyFreeWindow();
  if (!CFG.launchesOpen) {
    $('goBtn').disabled = true; $('goBtn').textContent = 'Launches open soon';
    $('statusChip').textContent = 'Launches open soon';
  }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-copy]'); if (b) copy(b.dataset.copy); });

// ---------- coin page ----------
let coinsLoaded = null; // promise
const fmtUsd = (n) => n == null || isNaN(n) ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : n >= 1 ? `$${n.toFixed(2)}` : `$${Number(n).toPrecision(3)}`;
function coinPageEl() {
  let el = document.querySelector('[data-route="coin"]');
  if (!el) { el = document.createElement('div'); el.dataset.route = 'coin'; el.hidden = true; $('main').appendChild(el); }
  return el;
}
async function showCoin(mint) {
  const el = coinPageEl();
  el.innerHTML = `<section class="e-card" style="padding:28px;display:flex;flex-direction:column;gap:22px"><a class="e-back" href="#coins">← All coins</a><span class="e-sub">Loading coin…</span></section>`;
  if (coinsLoaded) await coinsLoaded.catch(() => { });
  if (location.hash !== `#coin/${mint}`) return;
  const c = coins.find(x => x.mint === mint) || { mint, name: 'Unknown coin', symbol: '', prefix: '', image: `https://images.pump.fun/coin-image/${mint}?variant=256x256` };
  const n = (c.prefix || '').length;
  const img = c.image ? `<img src="${esc(c.image.replace('86x86', '256x256'))}" alt="">` : '<span class="ph"></span>';
  el.innerHTML = `<section class="e-card" style="padding:28px;display:flex;flex-direction:column;gap:22px">
    <a class="e-back" href="#coins">← All coins</a>
    <div class="e-cd-head">${img}
      <div style="display:flex;flex-direction:column;gap:8px;min-width:0;flex:1 1 320px">
        <h1 style="margin:0;font-stretch:112%;font-size:clamp(30px,4vw,44px);font-weight:700;letter-spacing:-.03em;line-height:1.05">${esc(c.name)} <span style="color:#3B4A63;font-weight:600">$${esc(c.symbol)}</span></h1>
        <span class="e-sub">${n ? `${n}-letter custom CA` : 'Launched on Key'} · paired with ${esc(c.quote ? pairTicker(c.quote) : 'SOL')}${c.at ? ` · launched ${ago(c.at)}` : ''}</span>
        <div class="e-cd-ca"><span class="e-pre">${esc(mint.slice(0, n))}</span><span class="e-mid">${esc(mint.slice(n))}</span></div>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px">
      <a class="e-pill e-gloss sm" href="https://pump.fun/coin/${esc(mint)}" target="_blank" rel="noopener">Trade on pump.fun</a>
      <button class="e-pill e-cream sm" type="button" data-copy="${esc(mint)}">Copy CA</button>
      <a class="e-pill e-cream sm" href="https://dexscreener.com/solana/${esc(mint)}" target="_blank" rel="noopener">DexScreener</a>
      <a class="e-pill e-cream sm" href="https://solscan.io/token/${esc(mint)}" target="_blank" rel="noopener">Solscan</a>
    </div>
    <div class="e-stats" id="cdStats">${['Price', 'Market cap', '24h volume', '24h change', 'Liquidity', 'Trades (24h)'].map(l => `<div class="e-stat"><span>${l}</span><b>…</b></div>`).join('')}</div>
    <div class="e-chart" id="cdChart"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9FB0CB;font-size:15px">Loading chart…</div></div>
    ${c.creator ? `<span class="e-sub">Creator <a href="https://solscan.io/account/${esc(c.creator)}" target="_blank" rel="noopener" class="e-ca" style="color:#3B4A63">${esc(short(c.creator))}</a></span>` : ''}
  </section>`;
  window.scrollTo(0, 0);
  loadMarket(mint);
}
async function loadMarket(mint, ui = { stats: '#cdStats', chart: 'cdChart', live: () => location.hash === `#coin/${mint}` }) {
  let pair = null;
  try {
    const d = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)).json();
    pair = (d.pairs || []).filter(p => p.chainId === 'solana').sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0) || (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0] || null;
  } catch { }
  if (!ui.live()) return;
  const ch = pair?.priceChange?.h24, tx = pair?.txns?.h24;
  const vals = [pair ? fmtUsd(+pair.priceUsd) : '—', fmtUsd(pair?.marketCap ?? pair?.fdv), fmtUsd(pair?.volume?.h24),
    ch == null ? '—' : `<span class="${ch >= 0 ? 'e-up' : 'e-down'}">${ch >= 0 ? '+' : ''}${ch.toFixed(1)}%</span>`,
    pair?.liquidity?.usd ? fmtUsd(pair.liquidity.usd) : (pair ? 'Bonding curve' : '—'), tx ? `${tx.buys} buys · ${tx.sells} sells` : '—'];
  document.querySelectorAll(`${ui.stats} .e-stat b`).forEach((b, i) => { if (i >= vals.length) return; b.innerHTML = vals[i]; if (i === 5 || (i === 4 && !pair?.liquidity?.usd)) b.style.fontSize = '15px'; });
  const box = $(ui.chart);
  if (pair) {
    box.innerHTML = `<iframe title="Price chart" loading="lazy" src="https://dexscreener.com/solana/${esc(pair.pairAddress)}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=1&chartType=usd&interval=5"></iframe>`;
  } else {
    box.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;text-align:center;padding:24px;color:#DBE7FF;font-size:15px;line-height:1.5"><span>The chart shows up once the first trades are indexed. That usually takes a few minutes after launch.</span><a class="e-pill e-cream sm" href="https://pump.fun/coin/${esc(mint)}" target="_blank" rel="noopener">See it live on pump.fun</a></div>`;
  }
}

// ---------- $KEY tab ----------
// Before launch the tab shows the "CA drops at launch" note; once ETCH_MINT is set it shows the
// live coin: image, CA, market stats, chart, buy links and how much $KEY has been burned.
let etchShown = null;
function renderEtch() {
  const mint = CFG.etchMint;
  const sec = document.querySelector('[data-route="etch"] section');
  if (!mint || !sec) return;
  const old = sec.querySelector('.etchCa'); if (old) old.hidden = true; // the panel below has the CA and buy links
  let el = $('etchLive');
  if (!el) { el = document.createElement('div'); el.id = 'etchLive'; el.style.cssText = 'display:flex;flex-direction:column;gap:20px'; sec.appendChild(el); sec.style.maxWidth = '1100px'; }
  if (etchShown !== mint) {
    etchShown = mint;
    const n = mint.toUpperCase().startsWith('KEY') ? 3 : 0;
    const burned = CFG.etchBurned, supply = CFG.etchSupply;
    el.innerHTML = `
      <div class="e-cd-head"><img src="/pfp.webp" alt="$KEY">
        <div style="display:flex;flex-direction:column;gap:8px;min-width:0;flex:1 1 320px">
          <span class="e-sub">Live on pump.fun</span>
          <div class="e-cd-ca"><span class="e-pre">${esc(mint.slice(0, n))}</span><span class="e-mid">${esc(mint.slice(n))}</span></div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        <a class="e-pill e-gloss sm" href="https://pump.fun/coin/${esc(mint)}" target="_blank" rel="noopener">Buy $KEY on pump.fun</a>
        <button class="e-pill e-cream sm" type="button" data-copy="${esc(mint)}">Copy CA</button>
        <a class="e-pill e-cream sm" href="https://dexscreener.com/solana/${esc(mint)}" target="_blank" rel="noopener">DexScreener</a>
        <a class="e-pill e-cream sm" href="https://solscan.io/token/${esc(mint)}" target="_blank" rel="noopener">Solscan</a>
      </div>
      <div class="e-stats" id="etchStats">${['Price', 'Market cap', '24h volume', '24h change', 'Liquidity', 'Trades (24h)'].map(l => `<div class="e-stat"><span>${l}</span><b>…</b></div>`).join('')}
        <div class="e-stat"><span>$KEY burned</span><b>${burned == null ? '—' : fmtNum(burned)}</b></div>
        <div class="e-stat"><span>Supply left</span><b>${supply == null ? '—' : fmtNum(supply)}</b></div>
      </div>
      <div class="e-chart" id="etchChart"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#9FB0CB;font-size:15px">Loading chart…</div></div>`;
  }
  loadMarket(mint, { stats: '#etchStats', chart: 'etchChart', live: () => (location.hash || '#home') === '#etch' });
}

// ---------- wallet ----------
function providers() {
  const out = [];
  if (window.phantom?.solana?.isPhantom) out.push(['Phantom', window.phantom.solana]);
  if (window.solflare?.isSolflare) out.push(['Solflare', window.solflare]);
  if (window.backpack?.isBackpack) out.push(['Backpack', window.backpack]);
  if (!out.length && window.solana) out.push(['Wallet', window.solana]);
  return out;
}
async function connectWallet() {
  if (wallet) return wallet;
  const list = providers();
  if (!list.length) {
    // On mobile, open the site inside Phantom's in-app browser.
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
      location.href = `https://phantom.app/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}`;
    }
    throw new Error('No Solana wallet found. Install Phantom, Solflare or Backpack.');
  }
  let [, p] = list[0];
  if (list.length > 1) p = await pickWallet(list);
  const res = await p.connect();
  const pk = (res?.publicKey || p.publicKey).toString();
  wallet = p; walletKey = pk;
  $('walletBtn').textContent = short(pk);
  p.on?.('disconnect', () => { wallet = null; walletKey = null; $('walletBtn').textContent = 'Connect wallet'; renderMine(); });
  renderMine();
  return p;
}
function pickWallet(list) {
  return new Promise((resolve, reject) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(12,22,38,.45);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px';
    wrap.innerHTML = `<div class="e-card" style="padding:24px;display:flex;flex-direction:column;gap:10px;min-width:260px"><b style="font-size:18px">Choose a wallet</b>
      ${list.map(([n], i) => `<button class="e-pill e-cream" data-i="${i}" type="button">${n}</button>`).join('')}
      <button class="e-pill sm" data-x type="button" style="background:transparent">Cancel</button></div>`;
    wrap.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b?.dataset.i) { wrap.remove(); resolve(list[+b.dataset.i][1]); }
      else if (b?.hasAttribute('data-x') || e.target === wrap) { wrap.remove(); reject(new Error('Wallet not selected')); }
    });
    document.body.appendChild(wrap);
  });
}
$('walletBtn').addEventListener('click', async () => {
  if (wallet) { try { await wallet.disconnect(); } catch { } wallet = null; walletKey = null; $('walletBtn').textContent = 'Connect wallet'; renderMine(); return; }
  try { await connectWallet(); } catch (e) { toast(e.message); }
});

// ---------- launch form: preview, odds, ETA ----------
const WORKERS = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
let ratePerSec = 0, prefixTouched = false;

function targetsFor(prefix, anyCase) {
  if (!anyCase) return [prefix];
  let out = [''];
  for (const c of prefix) {
    const opts = [...new Set([c, c.toUpperCase(), c.toLowerCase()])].filter(x => B58.includes(x));
    out = out.flatMap(s => opts.map(o => s + o));
  }
  return out.filter(isValidPrefix);
}
function prefixProblem(p) {
  if (!p) return 'Pick a prefix.';
  if (p.length > 5) return 'Up to 5 characters.';
  const bad = [...p].filter(c => !B58.includes(c));
  if (bad.length) return `Can't use "${[...new Set(bad)].join('", "')}". Solana addresses never contain 0, O, I or l.`;
  if (p[0] === '1') return "Can't start with 1.";
  return '';
}
function updateOdds() {
  const p = $('fPrefix').value.trim(), any = $('fAnyCase').checked;
  const err = prefixProblem(p);
  $('prefixErr').hidden = !err || !p; $('prefixErr').textContent = err;
  $('pvPre').textContent = err ? '' : p;
  $('pvTail').textContent = randTailFor(p);
  const w = $('longWarn'); w.hidden = true;
  if (err) { $('oddsVal').textContent = '—'; $('etaVal').textContent = '—'; return; }
  const prob = probability(p, !any);
  $('oddsVal').textContent = `1 in ${fmtNum(1 / prob)}`;
  if (ratePerSec < 0) $('etaVal').textContent = 'unknown on this browser';
  else if (ratePerSec) {
    const secs = 1 / prob / ratePerSec;
    $('etaVal').textContent = `~${fmtDuration(secs)} avg (${fmtNum(ratePerSec)} keys/s)`;
    if (secs > 3 * 3600) { w.hidden = false; w.textContent = /^[K-Za-z]/.test(p) ? `Prefixes starting with "${p[0]}" are rare in Solana addresses, so this takes much longer. Try one starting with A–H, J or 1–9, a shorter prefix, or "any case".` : 'This would take hours on this device. Try a shorter prefix or turn on "any case".'; }
    else if (secs > 600) { w.hidden = false; w.textContent = 'This could take a while. Keep this tab open and your device awake.'; }
  } else $('etaVal').textContent = 'measuring…';
}
let tailCache = '';
function randTailFor(p) { if (tailCache.length !== 44 - p.length) tailCache = randTail(Math.max(0, 44 - p.length)); return tailCache; }

$('fName').addEventListener('input', () => { $('pvName').textContent = $('fName').value || 'Your coin'; });
$('fTicker').addEventListener('input', () => {
  const t = $('fTicker').value.replace(/\s/g, '');
  $('pvTicker').textContent = '$' + (t.toUpperCase() || 'TICKER');
  if (!prefixTouched) { $('fPrefix').value = [...t].filter(c => B58.includes(c)).join('').slice(0, 4); updateOdds(); }
});
$('fPrefix').addEventListener('input', () => { prefixTouched = true; updateOdds(); });
$('fAnyCase').addEventListener('change', updateOdds);
$('fDesc').addEventListener('input', () => { $('descLeft').textContent = `· ${280 - $('fDesc').value.length} left`; });
$('fBuy').addEventListener('input', () => {
  const b = Math.max(0, Number($('fBuy').value) || 0);
  const t = CFG.feeSol + b;
  $('totalCost').textContent = t ? `${t.toFixed(b ? 3 : 2).replace(/0+$/, '').replace(/\.$/, '')} SOL` : 'Free';
});
$('fImage').addEventListener('change', () => {
  const f = $('fImage').files[0];
  if (!f) return;
  if (f.size > 4 * 1024 * 1024) { toast('Image must be under 4 MB'); $('fImage').value = ''; return; }
  const url = URL.createObjectURL(f);
  $('imgPreview').src = url; $('imgPreview').style.display = 'block'; $('pvImg').src = url;
  $('imgLabel').textContent = f.name;
});

// Measure this device's grind speed. Runs until it has real numbers (2.5s+), up to 12s.
let benchDone = false;
function benchmark() {
  if (benchDone) return; benchDone = true;
  const ws = [], start = performance.now(); let tried = 0;
  for (let i = 0; i < WORKERS; i++) {
    const w = new Worker('/grind-worker.js');
    w.onmessage = (e) => { if (e.data.type === 'progress') tried += e.data.tried; };
    w.postMessage({ type: 'start', targets: ['1111111111'] }); // never matches
    ws.push(w);
  }
  const check = () => {
    const el = (performance.now() - start) / 1000;
    if ((tried > 0 && el >= 2.5) || el >= 12) {
      ws.forEach(w => w.terminate());
      ratePerSec = tried > 0 ? tried / el : -1;
      updateOdds();
    } else setTimeout(check, 250);
  };
  setTimeout(check, 250);
}

// ---------- grinding ----------
let grind = null;          // active grind {workers, stop}
let found = null;          // {address, scalar, nonce, pub, prefix, anyCase} kept for retries
function runGrind(targets, expected) {
  return new Promise((resolve, reject) => {
    const workers = [], t0 = performance.now(); let total = 0, done = false;
    const stopAll = () => workers.forEach(w => w.terminate());
    grind = { stop: () => { if (!done) { done = true; stopAll(); reject(new Error('Cancelled')); } } };
    for (let i = 0; i < WORKERS; i++) {
      const w = new Worker('/grind-worker.js');
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') {
          total += m.tried;
          const rate = total / ((performance.now() - t0) / 1000);
          ratePerSec = rate;
          $('grindStat').textContent = `· ${fmtNum(total)} tried · ${fmtNum(rate)}/s · ~${fmtDuration(Math.max(expected - total, expected * 0.1) / rate)} left`;
        } else if (m.type === 'found' && !done) {
          done = true; stopAll();
          resolve({ address: m.address, scalar: m.scalar, prefix: m.prefix, tried: total + m.tried });
        }
      };
      w.onerror = (err) => { if (!done) { done = true; stopAll(); reject(new Error('Grinder crashed: ' + (err.message || 'unknown'))); } };
      w.postMessage({ type: 'start', targets });
      workers.push(w);
    }
  });
}

// ---------- pair picker (pump.fun custom pairs) ----------
const SOL_PAIR = { mint: 'So11111111111111111111111111111111111111112', ticker: 'SOL', name: 'Solana', kind: 'crypto', image: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' };
let PAIRS = [SOL_PAIR], pair = SOL_PAIR, pairView = { q: '', kind: 'all' };
const pairsLoaded = fetch('/api/pairs').then(r => r.json()).then(j => { if (j.pairs?.length) PAIRS = j.pairs; }).catch(() => { });
const pairByMint = (m) => PAIRS.find(p => p.mint === m);
function pairTicker(m) { return pairByMint(m)?.ticker || 'custom'; }
function pairIcon(p, size = 28) {
  return p.image ? `<img src="${esc(p.image)}" alt="" width="${size}" height="${size}" loading="lazy" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;background:#EEF3FA;flex:none" onerror="this.style.visibility='hidden'">`
    : `<span style="width:${size}px;height:${size}px;border-radius:50%;background:#EEF3FA;flex:none"></span>`;
}
(function setupPairs() {
  const st = document.createElement('style');
  st.textContent = `/* pair picker */
.e-pair{position:relative}
.e-pair-btn{display:flex;align-items:center;gap:10px;text-align:left;cursor:pointer}
.e-pair-btn b{font-family:'Geist Mono',ui-monospace,monospace;font-size:17px}
.e-pair-btn .e-pair-n{color:#3B4A63;font-size:15px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.e-pair-c{color:#3B4A63;font-size:14px}
.e-pair-panel{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;background:#fff;border:1px solid #D6E0EE;border-radius:18px;box-shadow:0 18px 50px rgba(12,22,38,.18);padding:12px;display:flex;flex-direction:column;gap:10px}
.e-pair-panel[hidden]{display:none}
.e-pair-list{max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;overscroll-behavior:contain}
.e-pair-row{display:flex;align-items:center;gap:12px;width:100%;min-height:52px;padding:8px 10px;border:0;border-radius:12px;background:transparent;cursor:pointer;text-align:left;font:inherit;color:#0A0A0A}
.e-pair-row:hover,.e-pair-row:focus-visible{background:#EEF3FA}
.e-pair-row.on{background:#DBE7FF}
.e-pair-t{display:flex;flex-direction:column;min-width:0;flex:1}
.e-pair-t b{font-family:'Geist Mono',ui-monospace,monospace;font-size:15px}
.e-pair-t span{font-size:13px;color:#3B4A63;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.e-pair-k{font-size:12px;color:#3B4A63;background:#EEF3FA;border-radius:999px;padding:3px 8px;flex:none}
.e-pair-p{font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;color:#3B4A63;min-width:64px;text-align:right;flex:none}
#fBuy:disabled{opacity:.5;cursor:not-allowed}
@media (max-width:520px){.e-pair-k{display:none}.e-pair-p{min-width:0}}`;
  document.head.appendChild(st);
  const buyField = $('fBuy').closest('.e-field');
  const wrap = document.createElement('div');
  wrap.className = 'e-field e-pair';
  wrap.innerHTML = `
    <label for="pairBtn">Pair with <span class="hint">· what people trade your coin for on pump.fun</span></label>
    <button type="button" id="pairBtn" class="e-input e-pair-btn" aria-haspopup="listbox" aria-expanded="false"></button>
    <div id="pairPanel" class="e-pair-panel" hidden>
      <input id="pairQ" class="e-input" type="search" placeholder="Search SOL, USDC, TSLA, BTC…" autocomplete="off">
      <div class="e-chips" id="pairTabs">${[['all', 'All'], ['crypto', 'Crypto'], ['stocks', 'Stocks'], ['memes', 'Memes']].map(([k, l]) => `<button type="button" data-k="${k}"${k === 'all' ? ' class="on"' : ''}>${l}</button>`).join('')}</div>
      <div id="pairList" class="e-pair-list" role="listbox"></div>
    </div>
    <span class="e-sub" id="pairNote" hidden></span>`;
  buyField.parentNode.insertBefore(wrap, buyField);
  const pv = document.createElement('span'); pv.id = 'pvPair'; pv.style.cssText = 'font-size:13px;color:#2563EB;font-weight:600';
  $('pvTicker').after(pv);
  const btn = $('pairBtn'), panel = $('pairPanel');
  const open = (v) => { panel.hidden = !v; btn.setAttribute('aria-expanded', String(v)); if (v) { renderPairs(); $('pairQ').focus(); } };
  btn.onclick = () => pairsLoaded.then(() => open(panel.hidden));
  $('pairQ').oninput = (e) => { pairView.q = e.target.value.trim().toLowerCase(); renderPairs(); };
  $('pairTabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    pairView.kind = b.dataset.k; $('pairTabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderPairs();
  };
  $('pairList').onclick = (e) => { const b = e.target.closest('[data-mint]'); if (!b) return; setPair(pairByMint(b.dataset.mint) || SOL_PAIR); open(false); };
  document.addEventListener('click', (e) => { if (!panel.hidden && !wrap.contains(e.target)) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) open(false); });
  setPair(SOL_PAIR);
})();
function renderPairs() {
  const q = pairView.q;
  const list = PAIRS.filter(p => (pairView.kind === 'all' || p.kind === pairView.kind) &&
    (!q || p.ticker.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q) || p.mint === pairView.q));
  $('pairList').innerHTML = list.length ? list.slice(0, 120).map(p => `
    <button type="button" class="e-pair-row${p.mint === pair.mint ? ' on' : ''}" role="option" aria-selected="${p.mint === pair.mint}" data-mint="${esc(p.mint)}">
      ${pairIcon(p)}<span class="e-pair-t"><b>${esc(p.ticker)}</b><span>${esc(p.name)}</span></span>
      <span class="e-pair-k">${p.kind === 'stocks' ? 'Stock' : p.kind === 'memes' ? 'Meme' : 'Crypto'}</span>
      <span class="e-pair-p">${p.price == null ? '' : fmtUsd(p.price)}</span>
    </button>`).join('') : `<span class="e-sub" style="padding:14px">No pairs match "${esc(pairView.q)}".</span>`;
}
function setPair(p) {
  pair = p;
  $('pairBtn').innerHTML = `${pairIcon(p, 26)}<b>${esc(p.ticker)}</b><span class="e-pair-n">${esc(p.name)}</span><span class="e-pair-c" aria-hidden="true">▾</span>`;
  const isSol = p.mint === SOL_PAIR.mint;
  const buy = $('fBuy');
  buy.disabled = !isSol; if (!isSol) { buy.value = '0'; buy.dispatchEvent(new Event('input')); }
  const note = $('pairNote');
  note.hidden = isSol;
  note.textContent = isSol ? '' : `Your coin trades against ${p.ticker} on pump.fun. Dev buy is SOL-pair only for now, so buy right after launch on pump.fun if you want a bag.`;
  const pv = $('pvPair'); if (pv) pv.textContent = `Paired with ${p.ticker}`;
}

// ---------- launch flow ----------
const STEP_ORDER = ['grind', 'upload', 'build', 'sign', 'create', 'fee'];
function step(name, state) {
  const li = document.querySelector(`#steps li[data-s="${name}"]`);
  li.classList.remove('active', 'done', 'fail');
  if (state) li.classList.add(state);
  li.querySelector('.dot').textContent = state === 'done' ? '✓' : state === 'fail' ? '!' : '';
}
function resetSteps() { STEP_ORDER.forEach(s => step(s, null)); $('grindStat').textContent = ''; }
const msg = (t) => { $('progressMsg').textContent = t; };

async function waitForSig(sig, label, timeoutMs = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const s = value[0];
    if (s?.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return;
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error(`${label} not confirmed in time. Check your wallet before trying again.`);
}

function readForm() {
  const v = (id) => $(id).value.trim();
  const f = {
    name: v('fName'), symbol: v('fTicker').replace(/\s/g, ''), prefix: v('fPrefix'), anyCase: $('fAnyCase').checked,
    description: v('fDesc'), twitter: v('fX'), telegram: v('fTg'), website: v('fWeb'),
    devBuy: Math.max(0, Number($('fBuy').value) || 0), image: $('fImage').files[0],
  };
  if (!f.name) return [null, 'Add a coin name.'];
  if (!f.symbol) return [null, 'Add a ticker.'];
  const pe = prefixProblem(f.prefix); if (pe) return [null, pe];
  if (!f.image) return [null, 'Add an image.'];
  for (const u of [f.twitter, f.telegram, f.website]) if (u && !/^https:\/\//i.test(u)) return [null, 'Links must start with https://'];
  if (f.devBuy > 10) return [null, 'Dev buy is capped at 10 SOL.'];
  return [f, ''];
}

let busy = false, uploaded = null;
let pending = null; // a created coin whose registration still has to finish

function feeTxFor(owner, p, blockhash) {
  const feeLamports = 0; // Key takes no launch fee; this is only a 0 SOL registration
  const teamLamports = Math.round(feeLamports * CFG.teamShare);
  return new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(CFG.teamWallet), lamports: teamLamports }),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(CFG.buybackWallet), lamports: feeLamports - teamLamports }),
    // memo tags the launch so the coin list knows the etched prefix
    new TransactionInstruction({ keys: [], programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from(['key1', p.mint, p.prefix, p.symbol, owner.toBase58(), String(p.name).replace(/[|\u0000-\u001f]/g, ' ').slice(0, 32)].join('|'), 'utf8') }),
  );
}
const b64tx = (b) => VersionedTransaction.deserialize(Uint8Array.from(atob(b), c => c.charCodeAt(0)));

// Steps after the coin exists: send the 0 SOL registration, show success.
async function finishLaunch(p, setCurrent) {
  // The 80/20 creator-reward split (20% buys back and burns $KEY). Required: a failure here stops
  // the launch flow so Try again can finish it.
  if (!p.shareDone) {
    setCurrent('share'); step('share', 'active'); msg('Setting up the 80/20 creator-reward split…');
    let sShare = p.sShare; p.sShare = null;
    if (!sShare) {
      const sr = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicKey: walletKey, mint: p.mint }) });
      const sj = await sr.json().catch(() => ({}));
      if (!sr.ok) throw new Error(sj.error || "Couldn't build the reward split. Hit Try again.");
      sShare = await wallet.signTransaction(b64tx(sj.tx));
    }
    await waitForSig(await conn.sendRawTransaction(sShare.serialize(), { maxRetries: 3 }), 'Reward split');
    p.shareDone = true; step('share', 'done');
  }

  // Registration (0 SOL). The coin is live either way, so a failed registration doesn't block the user.
  setCurrent('fee'); step('fee', 'active'); msg('Registering your launch on Key…');
  try {
    let sFee = p.sFee; p.sFee = null;
    if (!sFee) {
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      sFee = await wallet.signTransaction(feeTxFor(new PublicKey(walletKey), p, blockhash));
    }
    await waitForSig(await conn.sendRawTransaction(sFee.serialize(), { maxRetries: 3 }), 'Fee');
    step('fee', 'done');
  } catch (e) { step('fee', 'fail'); console.warn('fee', e); }

  pending = null;
  loadCoins();
  msg('');
  $('successCa').innerHTML = `<b style="color:#2563EB">${esc(p.mint.slice(0, p.prefix.length))}</b>${esc(p.mint.slice(p.prefix.length))}`;
  $('pumpLink').href = `https://pump.fun/coin/${p.mint}`;
  $('txLink').href = `https://solscan.io/tx/${p.createSig}`;
  $('copyCa').onclick = () => copy(p.mint);
  $('progressCard').hidden = true; $('successCard').hidden = false;
  $('successCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function resumeLaunch() {
  if (busy || !pending) return;
  busy = true; $('retryBtn').hidden = true;
  let current = pending.shareDone ? 'fee' : 'share';
  try { await connectWallet(); await finishLaunch(pending, (c) => { current = c; }); }
  catch (e) {
    const m = e?.message || String(e);
    step(current, 'fail');
    msg(/User rejected|rejected the request/i.test(m) ? 'You declined in your wallet. Your coin is live; hit Try again to finish setting it up on Key.' : m);
    $('retryBtn').hidden = false;
  } finally { busy = false; }
}
async function launch() {
  if (busy) return;
  const [f, err] = readForm();
  $('formErr').hidden = !err; $('formErr').textContent = err;
  if (err) return;
  if (!CFG.launchesOpen) return toast('Launches open soon');
  busy = true; $('goBtn').disabled = true;
  $('progressCard').hidden = false; $('successCard').hidden = true; $('retryBtn').hidden = true; $('cancelBtn').hidden = false;
  $('progressCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  resetSteps();
  let current = 'grind';
  try {
    // 1. Connect first so the user isn't surprised after a long grind.
    msg('Connect your wallet…');
    await connectWallet();
    const owner = new PublicKey(walletKey);
    const bal = await conn.getBalance(owner);
    const need = (CFG.feeSol + f.devBuy + 0.03) * LAMPORTS_PER_SOL;
    if (bal < need) throw new Error(`You need about ${(need / LAMPORTS_PER_SOL).toFixed(3)} SOL in this wallet (dev buy + pump.fun costs). It has ${(bal / LAMPORTS_PER_SOL).toFixed(3)}.`);

    // 2. Grind (reuse a key from a failed attempt with the same prefix).
    step('grind', 'active');
    const sameAsFound = found && found.prefix === f.prefix && found.anyCase === f.anyCase;
    if (!sameAsFound) {
      found = null;
      msg('Your device is grinding keys. Keep this tab open.');
      const r = await runGrind(targetsFor(f.prefix, f.anyCase), 1 / probability(f.prefix, !f.anyCase));
      const pub = window.EtchEd.pubFromScalar(r.scalar);
      if (window.EtchEd.b58(pub) !== r.address) throw new Error('Key check failed. Try again.');
      found = { address: r.address, scalar: r.scalar, nonce: r.prefix, pub, prefix: f.prefix, anyCase: f.anyCase };
      $('grindStat').textContent = `· found after ${fmtNum(r.tried)} tries`;
    }
    grind = null; $('cancelBtn').hidden = true;
    const plen = found.prefix.length;
    $('foundCa').hidden = false;
    $('foundCa').innerHTML = `<b style="color:#4F86FF">${esc(found.address.slice(0, plen))}</b><span style="color:#9FB0CB">${esc(found.address.slice(plen))}</span>`;
    step('grind', 'done');

    // 3. Upload image + metadata to IPFS (once per form state).
    current = 'upload'; step('upload', 'active'); msg('Uploading image and details…');
    const upKey = [f.name, f.symbol, f.description, f.twitter, f.telegram, f.website, f.image.name, f.image.size].join('|');
    if (!uploaded || uploaded.key !== upKey) {
      const fd = new FormData();
      fd.append('image', f.image); fd.append('name', f.name); fd.append('symbol', f.symbol);
      fd.append('description', f.description); fd.append('twitter', f.twitter); fd.append('telegram', f.telegram); fd.append('website', f.website);
      const ur = await fetch('/api/upload', { method: 'POST', body: fd });
      const uj = await ur.json().catch(() => ({}));
      if (!ur.ok) throw new Error(uj.error || 'Upload failed');
      uploaded = { key: upKey, ...uj };
    }
    step('upload', 'done');

    // 4. Build the create tx and the 0 SOL registration tx.
    current = 'build'; step('build', 'active'); msg(pair.mint === SOL_PAIR.mint ? 'Building the pump.fun transaction…' : `Building the pump.fun ${pair.ticker}-pair transaction…`);
    const cr = await fetch('/api/create', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publicKey: walletKey, mint: found.address, name: f.name, symbol: f.symbol, uri: uploaded.uri, devBuySol: pair.mint === SOL_PAIR.mint ? f.devBuy : 0, quoteMint: pair.mint }),
    });
    const cj = await cr.json().catch(() => ({}));
    if (!cr.ok) throw new Error(cj.error || 'Could not build the transaction');
    const createTx = b64tx(cj.tx);

    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const meta = { mint: found.address, prefix: found.address.slice(0, found.prefix.length), symbol: f.symbol, name: f.name };
    const feeTx = feeTxFor(owner, meta, blockhash);
    const sr = await fetch('/api/share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicKey: walletKey, mint: found.address }) });
    const sj = await sr.json().catch(() => ({}));
    if (!sr.ok) throw new Error(sj.error || "Couldn't build the reward split. Try again.");
    const shareTx = b64tx(sj.tx);
    step('build', 'done');

    // 5. One wallet prompt for both. The registration is only sent if the create succeeds.
    current = 'sign'; step('sign', 'active'); msg("Approve in your wallet. You'll see three transactions: the pump.fun create, the 80/20 creator-reward split (20% buys back and burns $KEY), and a 0 SOL note that lists your coin on Key.");
    let signed;
    if (wallet.signAllTransactions) signed = await wallet.signAllTransactions([createTx, shareTx, feeTx]);
    else signed = [await wallet.signTransaction(createTx), await wallet.signTransaction(shareTx), await wallet.signTransaction(feeTx)];
    const [sCreate, sShare, sFee] = signed;
    const mintSig = await window.EtchEd.sign(sCreate.message.serialize(), found.scalar, found.nonce, found.pub);
    sCreate.addSignature(new PublicKey(found.address), mintSig);
    step('sign', 'done');

    // 6. Create the coin.
    current = 'create'; step('create', 'active'); msg('Creating your coin on pump.fun…');
    const createSig = await conn.sendRawTransaction(sCreate.serialize(), { skipPreflight: false, maxRetries: 3 });
    await waitForSig(createSig, 'Create');
    step('create', 'done');
    const mint = found.address, prefix = found.prefix, image = uploaded.image;
    found = null; uploaded = null; // a used mint can't be reused
    // From here the coin exists; if a later step fails, Retry resumes here instead of launching again.
    pending = { mint, prefix: meta.prefix, image, createSig, name: f.name, symbol: f.symbol, quote: pair.mint, sFee, sShare, shareDone: false };
    await finishLaunch(pending, (c) => { current = c; });
  } catch (e) {
    const m = e?.message || String(e);
    step(current, 'fail');
    msg(/User rejected|rejected the request/i.test(m) ? (pending ? 'You declined in your wallet. Your coin is live; hit Try again to finish setting it up on Key.' : 'You declined in your wallet. Nothing was sent.') : m);
    $('cancelBtn').hidden = true; $('retryBtn').hidden = false;
    if (m === 'Cancelled') { $('progressCard').hidden = true; }
  } finally {
    grind = null; busy = false; $('goBtn').disabled = !CFG.launchesOpen;
  }
}
$('launchForm').addEventListener('submit', (e) => { e.preventDefault(); launch(); });
$('cancelBtn').addEventListener('click', () => grind?.stop());
$('retryBtn').addEventListener('click', () => (pending ? resumeLaunch() : launch()));

// ---------- fees ----------
// No launch fee. The 20% buyback share comes out of creator rewards, not out of the launch.
$('totalCost').textContent = 'Free';

// ---------- free-launch window ----------
// While /api/config reports freeUntil, launches skip the 0.01 SOL fee (a 0 SOL registration
// payment is still sent so the coin shows on Key). A banner counts down to the end.
let freeTimer = null;
function applyFreeWindow() {
  const until = CFG.freeUntil;
  let bar = $('freeBar');
  if (!until || until <= Date.now()) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'freeBar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 12px;text-align:center;background:#0C1626;color:#DBE7FF;border-radius:18px;padding:12px 18px;font-size:15px;line-height:1.4';
    $('main').prepend(bar);
  }
  const end = new Date(until).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const tick = () => {
    const left = until - Date.now();
    if (left <= 0) { clearInterval(freeTimer); location.reload(); return; }
    const h = Math.floor(left / 3600e3), m = Math.floor(left / 60e3) % 60;
    bar.innerHTML = `<b style="color:#fff">Free launches</b><span>No ${CFG.normalFeeSol || 0.01} SOL Key fee for the next <b style="color:#4F86FF;font-family:'Geist Mono',ui-monospace,monospace">${h}h ${String(m).padStart(2, '0')}m</b> (until ${esc(end)})</span><a href="#launch" class="e-pill e-cream sm" style="min-height:36px">Launch free</a>`;
  };
  tick(); clearInterval(freeTimer); freeTimer = setInterval(tick, 30000);
  $('totalCost').textContent = 'Free';
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) if (n.nodeValue.startsWith('The 0.01 SOL Key fee is only sent after your coin is created.')) n.nodeValue = "No Key launch fee right now. Key still takes 30% of your coin's creator fees on every trade; you keep 70%.";
  const feeLi = document.querySelector('#steps li[data-s="fee"] span:last-child');
  if (feeLi) feeLi.textContent = 'Register launch on Key (free)';
  document.querySelectorAll('span').forEach(el => { if (el.textContent === 'Launch fee') { const v = el.nextElementSibling; if (v) { v.textContent = 'Free'; if (v.nextElementSibling) v.nextElementSibling.textContent = 'for now · + 30% of creator fees'; } } });
}

// ---------- X (Twitter) links ----------
const X_HANDLE = 'Key_CustomCA'; // Key's X handle without the @. Leave empty to hide the X links.
const X_URL = 'https://x.com/' + X_HANDLE;
(function addXLinks() {
  if (!X_HANDLE) return;
  const xIcon = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M18.9 2H22l-6.8 7.8L23 22h-6.1l-4.8-6.3L6.6 22H3.5l7.3-8.3L1 2h6.3l4.3 5.7L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z"/></svg>';
  const wb = $('walletBtn');
  if (wb && !$('xHeader')) {
    const a = document.createElement('a');
    a.id = 'xHeader'; a.href = X_URL; a.target = '_blank'; a.rel = 'noopener';
    a.className = 'e-pill e-cream sm'; a.setAttribute('aria-label', 'Key on X'); a.title = 'Key on X';
    a.style.cssText = 'display:inline-flex;align-items:center;gap:8px';
    a.innerHTML = xIcon + '<span class="xh">X</span>';
    // keep the header's item count the same: group the X link with the wallet button
    const grp = document.createElement('div');
    grp.style.cssText = 'display:flex;align-items:center;gap:10px';
    wb.before(grp); grp.append(a, wb);
    const st = document.createElement('style');
    st.textContent = '@media (max-width:640px){#xHeader .xh{display:none}#xHeader{padding:0 14px}}';
    document.head.appendChild(st);
  }
  const foot = document.querySelector('footer span');
  if (foot && !$('xFooter')) {
    const a = document.createElement('a');
    a.id = 'xFooter'; a.href = X_URL; a.target = '_blank'; a.rel = 'noopener';
    a.textContent = 'Key on X'; a.style.cssText = 'color:inherit;font-weight:600;margin-left:10px';
    foot.append(' · ', a);
  }
})();

// ---------- boot ----------
coinsLoaded = loadConfig().then(loadCoins);
pairsLoaded.then(() => { if (coins.some(c => c.quote)) { renderCoins(); if (location.hash.startsWith('#coin/')) route(); } });
route();
updateOdds();
