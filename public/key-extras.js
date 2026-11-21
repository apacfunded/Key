// Key additions on top of Etch's app: the "try a prefix" box in the hero, the scrolling address
// tape, and the mobile launch button. Uses Etch's own odds maths.
import { B58, isValidPrefix, probability, fmtDuration } from './odds.js';

const $ = (id) => document.getElementById(id);
const rand = (n) => Array.from({ length: n }, () => B58[Math.floor(Math.random() * 58)]).join('');
const fmtNum = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n)));
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TYPICAL = 400000; // keys per second on a typical laptop, the same figure the grinder demo uses

// ---------- try a prefix ----------
function problem(t) {
  if ([...t].some(c => !B58.includes(c))) return "Solana addresses can't contain 0, capital O, capital I or lowercase l. Try another character.";
  if (t[0] === '1') return "A prefix can't start with 1. Try another first character.";
  return isValidPrefix(t) && t.length <= 5 ? '' : 'Use 1 to 5 characters.';
}
function draw() {
  const text = $('tryText').value.trim() || 'KEY', bad = problem(text), shown = bad ? '' : text;
  const ca = $('tryCa'); ca.textContent = '';
  if (shown) { const b = document.createElement('span'); b.className = 'e-pre'; b.textContent = shown; ca.append(b); }
  const tail = document.createElement('span'); tail.className = 'e-mid'; tail.textContent = rand(44 - shown.length); ca.append(tail);
  const v = $('tryVerdict'); v.textContent = '';
  if (bad) { v.textContent = bad; return; }
  const tries = 1 / probability(text, true), any = 1 / probability(text, false);
  const lead = document.createElement('b'); lead.textContent = `About 1 in ${fmtNum(tries)} addresses start with ${text}.`;
  v.append(lead, ` That is roughly ${fmtDuration(tries / TYPICAL)} of grinding on a typical laptop` + (any < tries / 1.5 ? `, or ${fmtDuration(any / TYPICAL)} if any mix of upper and lower case is fine.` : '.'));
}
$('tryText').addEventListener('input', draw);
$('tryGo').addEventListener('click', () => {
  const t = $('tryText').value.trim() || 'KEY';
  if (problem(t)) return;
  const f = $('fPrefix'); f.value = t; f.dispatchEvent(new Event('input', { bubbles: true }));
});
draw();
if (!calm) setInterval(() => { if (!document.hidden && !$('forge').closest('[hidden]') && document.activeElement !== $('tryText')) draw(); }, 2200);

// ---------- mobile launch button: hidden while the launch form is open ----------
const onRoute = () => document.body.classList.toggle('on-launch', location.hash === '#launch');
addEventListener('hashchange', onRoute); onRoute();
