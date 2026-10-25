// On-device cache for map tile pieces (PMTiles byte ranges from the tile worker).
//
// Why: a phone re-downloads the same pieces every time a mouza is opened or panned.
// Pieces are kept in IndexedDB so repeat views load from the device.
//
// Protection (raises the effort of copying; an attacker who controls the logged-in
// browser can still read what the map shows):
//   - stored encrypted (AES-GCM) with a key generated on the device as a
//     non-extractable CryptoKey: it can be used by this site only and cannot be exported,
//     so copying the IndexedDB files elsewhere gives nothing readable
//   - keyed per user (uid from the signed URL) and per file path + byte range, never
//     by token; entries expire after 7 days; total size capped (oldest dropped first)
//   - cleared on logout (clearTileCache)

const DB_NAME = 'nz-tile-cache';
const STORE = 'pieces';
const META = 'meta';
const TTL_MS = 7 * 24 * 3600e3;
const MAX_BYTES = 150 * 1024 * 1024;

let dbPromise = null;
let keyPromise = null;
let disabled = typeof indexedDB === 'undefined' || typeof crypto === 'undefined' || !crypto.subtle;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE).createIndex('t', 't');
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((e) => { disabled = true; throw e; });
  }
  return dbPromise;
}

const tx = (db, stores, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(stores, mode);
  let out;
  t.oncomplete = () => resolve(out);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
  out = fn(t);
});
const reqP = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

async function getKey() {
  if (!keyPromise) {
    keyPromise = (async () => {
      const db = await openDb();
      const existing = await tx(db, [META], 'readonly', (t) => reqP(t.objectStore(META).get('key')));
      const stored = await existing;
      if (stored) return stored;
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await tx(db, [META], 'readwrite', (t) => t.objectStore(META).put(key, 'key'));
      return key;
    })().catch((e) => { keyPromise = null; throw e; });
  }
  return keyPromise;
}

/** Cache key for a worker URL + Range header, or null if not cacheable. */
export function tileCacheKey(url, range) {
  if (disabled || !range || !/^bytes=\d+-\d+$/.test(range)) return null;
  try {
    const u = new URL(url, window.location.href);
    const uid = u.searchParams.get('uid');
    if (!uid) return null;
    return `${uid}|${decodeURIComponent(u.pathname)}|${range}`;
  } catch { return null; }
}

/** Returns a Response rebuilt from the device cache, or null. */
export async function readTile(key) {
  if (!key || disabled) return null;
  try {
    const db = await openDb();
    const rec = await (await tx(db, [STORE], 'readonly', (t) => reqP(t.objectStore(STORE).get(key))));
    if (!rec) return null;
    if (Date.now() - rec.t > TTL_MS) { deleteTile(key); return null; }
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, await getKey(), rec.data);
    const headers = { 'Content-Type': 'application/octet-stream', 'Content-Length': String(plain.byteLength), 'X-Device-Cache': 'HIT' };
    if (rec.contentRange) headers['Content-Range'] = rec.contentRange;
    if (rec.etag) headers.ETag = rec.etag;
    return new Response(plain, { status: 206, headers });
  } catch { return null; }
}

/** Stores a successful 206 response (call with a clone). */
export async function writeTile(key, response) {
  if (!key || disabled || response.status !== 206) return;
  try {
    const buf = await response.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 4 * 1024 * 1024) return;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), buf);
    const db = await openDb();
    await tx(db, [STORE], 'readwrite', (t) => t.objectStore(STORE).put({
      t: Date.now(), iv, data, size: data.byteLength,
      contentRange: response.headers.get('Content-Range'), etag: response.headers.get('ETag'),
    }, key));
    trimSoon();
  } catch { /* quota or private mode: just don't cache */ }
}

export async function deleteTile(key) {
  try {
    const db = await openDb();
    await tx(db, [STORE], 'readwrite', (t) => t.objectStore(STORE).delete(key));
  } catch { /* ignore */ }
}

// Keep the total under MAX_BYTES, dropping the oldest pieces first (at most every 30 s).
let trimTimer = null;
function trimSoon() {
  if (trimTimer) return;
  trimTimer = setTimeout(async () => {
    trimTimer = null;
    try {
      const db = await openDb();
      await tx(db, [STORE], 'readwrite', (t) => {
        const idx = t.objectStore(STORE).index('t');
        const rows = [];
        idx.openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (c) { rows.push([c.primaryKey, c.value.size || 0, c.value.t]); c.continue(); return; }
          let total = rows.reduce((n, r) => n + r[1], 0);
          const now = Date.now();
          for (const [k, size, ts] of rows) { // oldest first
            if (total <= MAX_BYTES && now - ts <= TTL_MS) break;
            t.objectStore(STORE).delete(k);
            total -= size;
          }
        };
      });
    } catch { /* ignore */ }
  }, 30000);
}

/** Removes every cached piece and the device key (logout, account switch). */
export async function clearTileCache() {
  keyPromise = null;
  try {
    const db = await openDb();
    await tx(db, [STORE, META], 'readwrite', (t) => { t.objectStore(STORE).clear(); t.objectStore(META).clear(); });
  } catch { /* ignore */ }
}
