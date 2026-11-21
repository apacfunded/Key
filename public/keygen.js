// "Generate key": grinds a standard Solana keypair whose address starts with your text, and shows the
// private key so it can be imported into another launcher. Everything happens in this browser.
import { B58, isValidPrefix, probability, fmtDuration } from './odds.js';
import './ed-core.js';

const $ = (id) => document.getElementById(id);
const fmtNum = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n)));
const WORKERS = Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 12) - 1);
let workers = [], rate = 0, result = null;

function variants(p, anyCase) {
  if (!anyCase) return [p];
  let out = [''];
  for (const c of p) { const o = [...new Set([c, c.toUpperCase(), c.toLowerCase()])].filter(x => B58.includes(x)); out = out.flatMap(s => o.map(x => s + x)); }
  return out.filter(isValidPrefix);
}
function problem(p) {
  if (!p) return 'Type 1 to 5 characters.';
  if ([...p].some(c => !B58.includes(c))) return "Solana addresses can't contain 0, capital O, capital I or lowercase l.";
  if (p[0] === '1') return "The text can't start with 1.";
  return p.length > 5 ? 'Use 1 to 5 characters.' : '';
}
function odds() {
  const p = $('gkText').value.trim(), bad = problem(p);
  $('gkErr').hidden = !bad || !p; $('gkErr').textContent = bad;
  if (bad) { $('gkOdds').textContent = '—'; $('gkEta').textContent = '—'; return; }
  const n = 1 / probability(p, !$('gkAny').checked);
  $('gkOdds').textContent = `1 in ${fmtNum(n)}`;
  $('gkEta').textContent = rate ? `about ${fmtDuration(n / rate)}` : 'starts measuring when you press Generate';
}
function stop() { workers.forEach(w => w.terminate()); workers = []; $('gkGo').hidden = false; $('gkStop').hidden = true; }
function generate() {
  const p = $('gkText').value.trim();
  if (problem(p)) { odds(); return; }
  stop(); result = null; $('gkResult').hidden = true; $('gkSecret').textContent = ''; $('gkShow').textContent = 'Show private key';
  const targets = variants(p, $('gkAny').checked), expected = 1 / probability(p, !$('gkAny').checked);
  const t0 = performance.now(); let total = 0;
  $('gkGo').hidden = true; $('gkStop').hidden = false; $('gkStat').textContent = 'Starting…';
  for (let i = 0; i < WORKERS; i++) {
    const w = new Worker('/keygen-worker.js');
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        total += m.tried; rate = total / ((performance.now() - t0) / 1000);
        $('gkStat').textContent = `${fmtNum(total)} tried · ${fmtNum(rate)}/s · ~${fmtDuration(Math.max(expected - total, expected * 0.1) / rate)} left`;
      } else if (m.type === 'found' && workers.length) {
        stop(); show(m.address, Uint8Array.from(m.secret), p.length, total + m.tried);
      }
    };
    w.postMessage({ type: 'start', targets }); workers.push(w);
  }
}
function show(address, secret, len, tried) {
  // check the key really belongs to the address before showing it
  const kp = nacl.sign.keyPair.fromSecretKey(secret);
  if (window.EtchEd.b58(kp.publicKey) !== address) { $('gkStat').textContent = "The key didn't pass its check. Press Generate again."; return; }
  result = { address, b58: window.EtchEd.b58(secret), json: JSON.stringify(Array.from(secret)) };
  $('gkStat').textContent = `Found after ${fmtNum(tried)} tries.`;
  $('gkAddr').innerHTML = `<span class="e-pre"></span><span class="e-mid"></span>`;
  $('gkAddr').firstChild.textContent = address.slice(0, len); $('gkAddr').lastChild.textContent = address.slice(len);
  $('gkResult').hidden = false;
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = o), 1500); }
  catch { btn.textContent = "Couldn't copy. Select it by hand."; }
}
$('gkText').addEventListener('input', odds);
$('gkAny').addEventListener('change', odds);
$('gkGo').addEventListener('click', generate);
$('gkStop').addEventListener('click', () => { stop(); $('gkStat').textContent = 'Stopped.'; });
$('gkCopyAddr').addEventListener('click', (e) => result && copy(result.address, e.currentTarget));
$('gkShow').addEventListener('click', () => {
  if (!result) return;
  const open = !$('gkSecret').textContent;
  $('gkSecret').textContent = open ? result.b58 : '';
  $('gkShow').textContent = open ? 'Hide private key' : 'Show private key';
});
$('gkCopyKey').addEventListener('click', (e) => result && copy(result.b58, e.currentTarget));
$('gkCopyJson').addEventListener('click', (e) => result && copy(result.json, e.currentTarget));
odds();
