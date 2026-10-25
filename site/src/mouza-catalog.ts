// Build-time catalog of tehsil and mouza NAMES for the /maps/ SEO pages.
// Source: the dashboard's public endpoints (no login):
//   GET {dashboardUrl}/api/public/catalog            -> { tehsils: [{ tehsil, mouzas[] }] } (one request, if available)
//   GET {dashboardUrl}/api/tehsil-list               -> string[]
//   GET {dashboardUrl}/api/mauza-list/{tehsil}       -> string[]
// Only names are used; no map data ever reaches these pages.
//
// The public API is rate limited (100 requests / 15 min per IP) and there are 160+ tehsils,
// so results are also kept in a disk cache (node_modules/.cache, git-ignored). Fresh cache
// entries are reused; on HTTP 429 we wait for Retry-After (up to CATALOG_MAX_WAIT seconds in
// total, default 60) and otherwise fall back to the cached (possibly stale) list.
// If the API is unreachable and there is no cache, the build still succeeds with no /maps/ pages.
//
// Env knobs: CATALOG_MAX_AGE_HOURS (default 24), CATALOG_MAX_WAIT (seconds, default 60),
//            CATALOG_OFFLINE=1 (use cache only, no network).
import fs from 'node:fs';
import path from 'node:path';
import { SITE } from './site';

export interface Mouza { name: string; slug: string }
export interface Tehsil { name: string; slug: string; mouzas: Mouza[] }

const CACHE_FILE = path.resolve('node_modules/.cache/naqsha-mouza-catalog.json');
const MAX_AGE_MS = Number(process.env.CATALOG_MAX_AGE_HOURS || 24) * 3600_000;
const OFFLINE = process.env.CATALOG_OFFLINE === '1';
// Short by default: never stall a build waiting on the rate limit; stale cache is used instead.
let waitBudgetMs = Number(process.env.CATALOG_MAX_WAIT || 60) * 1000;
const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;

type CacheFile = { tehsils?: string[]; mouzas: Record<string, { at: number; names: string[] }> };

/** URL slug: lowercase, spaces/underscores/slashes -> '-', keeps letters (incl. Urdu) and digits. */
export function slugify(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_/\\.]+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const JUNK_TEHSIL = /^(demo|test|index|unknown.*|.*_tehsil)$/i;
const isJunk = (n: string) => {
  const s = n.trim();
  return !s || /complete/i.test(s) || /^(index|test|demo|null|undefined|unknown)$/i.test(s) || !/[\p{L}\p{N}]/u.test(s);
};

const clean = (names: unknown): string[] =>
  Array.isArray(names) ? [...new Set(names.filter((n): n is string => typeof n === 'string').map((n) => n.trim().replace(/\s+/g, ' ')))] : [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pause: Promise<void> | null = null;

class RateLimited extends Error { constructor(public retryMs: number) { super('rate limited'); } }

async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (res.status === 429) throw new RateLimited((Number(res.headers.get('retry-after')) || 60) * 1000 + 2000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** One retry on ordinary errors; waits out a 429 while the wait budget lasts. */
async function fetchNames(url: string): Promise<string[] | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (pause) await pause;
    try {
      const j = await getJson(url);
      if (!Array.isArray(j)) throw new Error('unexpected response shape');
      return clean(j);
    } catch (e) {
      if (e instanceof RateLimited) {
        // All workers share one pause, so the wait budget is spent once per rate-limit window.
        if (!pause) {
          if (e.retryMs > waitBudgetMs) return null;
          waitBudgetMs -= e.retryMs;
          console.warn(`[maps] API rate limit hit; waiting ${Math.round(e.retryMs / 1000)}s…`);
          pause = sleep(e.retryMs).then(() => { pause = null; });
        }
        await pause;
        continue;
      }
      if (attempt >= 1) return null;
      await sleep(1000);
    }
  }
  return null;
}

function readCache(): CacheFile {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return { mouzas: {} }; }
}
function writeCache(c: CacheFile) {
  try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(c)); } catch { /* cache is optional */ }
}

function uniqueSlugs<T extends { name: string }>(items: T[], fallback: string): (T & { slug: string })[] {
  const used = new Set<string>();
  return items.map((it) => {
    const base = slugify(it.name) || fallback;
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    used.add(slug);
    return { ...it, slug };
  });
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

async function load(): Promise<Tehsil[]> {
  const started = Date.now();
  const base = SITE.dashboardUrl;
  const cache = readCache();

  // Fast path: one request for the whole catalog (dashboard GET /api/public/catalog).
  if (!OFFLINE) {
    try {
      const j: any = await getJson(`${base}/api/public/catalog`);
      if (Array.isArray(j?.tehsils) && j.tehsils.length) {
        cache.tehsils = j.tehsils.map((x: any) => String(x.tehsil));
        for (const x of j.tehsils) cache.mouzas[String(x.tehsil)] = { at: Date.now(), names: clean(x.mouzas) };
        writeCache(cache);
        console.log('[maps] catalog fetched in one request.');
      }
    } catch (e) {
      console.warn(`[maps] /api/public/catalog unavailable (${(e as Error).message}); falling back to per-tehsil lists / cache.`);
    }
  }

  let tehsils = OFFLINE ? null : cache.tehsils?.length && Date.now() - (cache.mouzas[cache.tehsils[0]]?.at ?? 0) < MAX_AGE_MS
    ? cache.tehsils
    : await fetchNames(`${base}/api/tehsil-list`);
  if (tehsils) cache.tehsils = tehsils;
  else if (cache.tehsils?.length) {
    console.warn('[maps] tehsil list unavailable; using cached catalog.');
    tehsils = cache.tehsils;
  } else {
    console.warn(`[maps] WARNING: ${base}/api/tehsil-list unreachable and no cache; no tehsil/mouza pages will be generated.`);
    return [];
  }
  tehsils = tehsils.filter((t) => !isJunk(t) && !JUNK_TEHSIL.test(t)).sort(byName);

  const result = new Map<string, string[]>();
  let fetched = 0, cached = 0, missing = 0;
  const queue = [...tehsils];
  const worker = async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) {
      const hit = cache.mouzas[t];
      if (hit && (OFFLINE || Date.now() - hit.at < MAX_AGE_MS)) { result.set(t, hit.names); cached++; continue; }
      const names = OFFLINE ? null : await fetchNames(`${base}/api/mauza-list/${encodeURIComponent(t)}`);
      if (names) { cache.mouzas[t] = { at: Date.now(), names }; result.set(t, names); fetched++; }
      else if (hit) { result.set(t, hit.names); cached++; }
      else missing++;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  writeCache(cache);

  const out = uniqueSlugs(
    tehsils
      .map((name) => ({ name, mouzas: (result.get(name) ?? []).filter((m) => !isJunk(m)).sort(byName) }))
      .filter((t) => t.mouzas.length > 0),
    'tehsil',
  ).map((t) => ({ ...t, mouzas: uniqueSlugs(t.mouzas.map((name) => ({ name })), 'mouza') }));

  const total = out.reduce((n, t) => n + t.mouzas.length, 0);
  console.log(`[maps] catalog: ${out.length} tehsils, ${total} mouzas (${fetched} fetched, ${cached} from cache, ${missing} unavailable) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (missing) console.warn(`[maps] WARNING: ${missing} tehsil(s) could not be fetched; their pages are skipped this build.`);
  return out;
}

let promise: Promise<Tehsil[]> | undefined;
/** Fetched once per build and shared by every page. */
export const getCatalog = () => (promise ??= load());

/** Dashboard deep link that opens the public preview on this mouza. */
export const previewUrl = (tehsil: string, mouza: string) =>
  `${SITE.dashboardUrl}/?browse=all&t=${encodeURIComponent(tehsil)}&m=${encodeURIComponent(mouza)}`;
