// Puts the coin image, then its metadata, on IPFS through Pinata. Returns the metadata link.
import { json, fail, cleanText, PINATA_JWT } from '../lib/server.js';
const GATEWAY = 'https://ipfs.io/ipfs/';
const TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

async function pin(body, path) {
  const r = await fetch(`https://api.pinata.cloud/pinning/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${PINATA_JWT}`, ...(typeof body === 'string' ? { 'content-type': 'application/json' } : {}) }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.IpfsHash) throw new Error('IPFS upload failed. Try again in a moment.');
  return GATEWAY + j.IpfsHash;
}
const link = (v) => { const s = cleanText(v, 200); return /^https:\/\//i.test(s) ? s : ''; };

export async function POST(request) {
  if (!PINATA_JWT) return fail('Launches are not open yet.', 503);
  let fd; try { fd = await request.formData(); } catch { return fail('Bad upload'); }
  const image = fd.get('image');
  if (!image || typeof image === 'string') return fail('Add an image.');
  if (!TYPES.has(image.type)) return fail('Use a PNG, JPG, GIF or WEBP image.');
  if (image.size > 4 * 1024 * 1024) return fail('Image must be under 4 MB.');
  const name = cleanText(fd.get('name'), 32), symbol = cleanText(fd.get('symbol'), 10).toUpperCase();
  if (!name || !symbol) return fail('Name and ticker are required.');
  try {
    const out = new FormData();
    out.append('file', image, image.name || 'coin.png');
    const imageUrl = await pin(out, 'pinFileToIPFS');
    const meta = { name, symbol, description: cleanText(fd.get('description'), 280), image: imageUrl, showName: true, createdOn: 'https://pump.fun' };
    for (const k of ['twitter', 'telegram', 'website']) { const v = link(fd.get(k)); if (v) meta[k] = v; }
    const uri = await pin(JSON.stringify({ pinataContent: meta, pinataMetadata: { name: `${symbol}.json` } }), 'pinJSONToIPFS');
    return json({ uri, image: imageUrl });
  } catch (e) { return fail(e.message, 502); }
}
