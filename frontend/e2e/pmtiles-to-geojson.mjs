// Builds a GeoJSON FeatureCollection for a mouza from its real PMTiles (read from the public
// tile worker), for local reproduction of map loading issues. Output: <outDir>/<mouza>.geojson
// Usage (in frontend/): node e2e/pmtiles-to-geojson.mjs <outDir> <tehsil> <mouza> [zoom]
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import fs from 'node:fs';

const [, , OUT = 'e2e/geo', TEHSIL = 'Lodhran', MOUZA = '100 M', Z = '14'] = process.argv;
const WORKER = 'https://pmtiles-worker.mallhintdr.workers.dev';
const url = `${WORKER}/${encodeURIComponent(TEHSIL)}/${encodeURIComponent(MOUZA)}.pmtiles`;
const pm = new PMTiles(url);
const h = await pm.getHeader();
const z = Math.min(Number(Z), h.maxZoom);
const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
const features = [];
const seen = new Set();
for (let x = lon2x(h.minLon); x <= lon2x(h.maxLon); x++) {
  for (let y = lat2y(h.maxLat); y <= lat2y(h.minLat); y++) {
    const t = await pm.getZxy(z, x, y);
    if (!t) continue;
    const vt = new VectorTile(new PbfReader(new Uint8Array(t.data)));
    for (const name of Object.keys(vt.layers)) {
      const layer = vt.layers[name];
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i).toGeoJSON(x, y, z);
        const key = `${name}|${JSON.stringify(f.properties)}`;
        if (seen.has(key)) continue; // tiles repeat features cut at tile edges; keep one piece
        seen.add(key);
        f.properties = { ...f.properties, layer_type: f.properties.layer_type || 'murabba' };
        features.push(f);
      }
    }
  }
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/${MOUZA}.geojson`, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`${MOUZA}: ${features.length} features, ${(fs.statSync(`${OUT}/${MOUZA}.geojson`).size / 1024).toFixed(0)} KB`);
