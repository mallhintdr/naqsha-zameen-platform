// Fails if engine source uses float helpers (only the percent formatter in fraction.ts may format numbers).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const bad = /parseFloat|toFixed|Number\(|Math\.(round|floor|ceil)\(/;
const hits: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) readFileSync(p, 'utf8').split('\n').forEach((l, i) => { if (bad.test(l)) hits.push(`${p}:${i + 1}: ${l.trim()}`); }); } };
walk(new URL('../src', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
if (hits.length) { console.error(hits.join('\n')); process.exit(1); } else console.log('no floats in src/');
