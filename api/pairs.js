// Key launches SOL-paired coins only, so the pair picker shows SOL alone.
import { json } from '../lib/server.js';
export function GET() { return json({ pairs: [] }, 200, { 'cache-control': 'public, s-maxage=3600' }); }
