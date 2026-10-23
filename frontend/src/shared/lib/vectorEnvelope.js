// Decoder for the backend's obfuscated vector-data envelope.
// Byte-compatible with backend/services/vectorCodec.js — change both together.
// No imports: also loaded by the backend's node --test round-trip tests.
//
// Envelope: "NZV1" | iv(12) | AES-256-GCM(ciphertext||tag)
// Plain:    u8 version(1) | u8 kind (0 = JSON text, 1 = geo) | kind 1: u32le skeletonLen | skeleton JSON | varint stream

const XY_SCALE = 1e7;
const Z_SCALE = 1e3;
const DEPTH = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };

export const ENVELOPE_TYPE = 'application/x-nz-vector';

/** True when this browser can decrypt envelopes (WebCrypto needs https or localhost). */
export function envelopeSupported() {
  return typeof globalThis.crypto !== 'undefined' && !!globalThis.crypto.subtle && typeof TextDecoder !== 'undefined';
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Imports a raw base64 AES key as a non-extractable CryptoKey. */
export function importEnvelopeKey(b64) {
  return globalThis.crypto.subtle.importKey('raw', base64ToBytes(b64), { name: 'AES-GCM' }, false, ['decrypt']);
}

/** Decrypts an envelope (ArrayBuffer) to the plain payload bytes. */
export async function openEnvelope(buffer, cryptoKey) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x4e || bytes[1] !== 0x5a || bytes[2] !== 0x56 || bytes[3] !== 0x31) throw new Error('Not a vector envelope');
  const iv = bytes.subarray(4, 16);
  const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, bytes.subarray(16));
  return new Uint8Array(plain);
}

/** Decodes plain payload bytes into the original JSON / GeoJSON object. */
export function decodePlain(bytes) {
  if (bytes[0] !== 1) throw new Error('Unsupported vector payload version');
  const td = new TextDecoder();
  if (bytes[1] === 0) return JSON.parse(td.decode(bytes.subarray(2)));
  const len = bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24);
  const skeleton = JSON.parse(td.decode(bytes.subarray(6, 6 + len)));

  let o = 6 + len;
  let px = 0, py = 0, pz = 0;
  const get = () => {
    let r = 0, s = 0, b;
    do { b = bytes[o++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
    r >>>= 0;
    return (r >>> 1) ^ -(r & 1);
  };
  const pos = (d) => {
    px = (px + get()) | 0; py = (py + get()) | 0;
    if (d === 3) { pz = (pz + get()) | 0; return [px / XY_SCALE, py / XY_SCALE, pz / Z_SCALE]; }
    return [px / XY_SCALE, py / XY_SCALE];
  };
  const build = (n, lvl, d) => {
    if (lvl === 0) return pos(d);
    if (lvl === 1) { const a = new Array(n); for (let i = 0; i < n; i++) a[i] = pos(d); return a; }
    const a = new Array(n.length);
    for (let i = 0; i < n.length; i++) a[i] = build(n[i], lvl - 1, d);
    return a;
  };
  const geom = (g) => {
    if (!g || typeof g !== 'object') return g;
    if (g.type === 'GeometryCollection' && Array.isArray(g.geometries)) { g.geometries = g.geometries.map(geom); return g; }
    if (g.__n === undefined) return g;
    const n = g.__n, d = g.__d;
    delete g.__n; delete g.__d;
    g.coordinates = build(n, DEPTH[g.type], d);
    return g;
  };
  const node = (x) => {
    if (!x || typeof x !== 'object') return x;
    if (x.type === 'FeatureCollection' && Array.isArray(x.features)) { for (let i = 0; i < x.features.length; i++) node(x.features[i]); return x; }
    if (x.type === 'Feature') { x.geometry = geom(x.geometry); return x; }
    return geom(x);
  };
  return node(skeleton);
}
