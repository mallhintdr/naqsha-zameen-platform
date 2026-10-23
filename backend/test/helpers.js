// Shared setup for node --test files. Must be required before app modules.
process.env.REDIS_ENABLED = 'false';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.SECRET_KEY = process.env.SECRET_KEY || 'test-secret-key';

const mongoose = require('mongoose');
mongoose.set('bufferCommands', false); // audit writes fail fast instead of hanging without a DB

/**
 * Synthetic mouza: a grid of murabbas, each split into 5×5 killas that share
 * edges exactly (like the real data). ~100 bytes of JSON per vertex.
 */
function syntheticMouza({ murabbas = 100, origin = [71.123456789, 30.987654321], killaDeg = 0.0006, jitter = true } = {}) {
    const features = [];
    const side = Math.ceil(Math.sqrt(murabbas));
    // Vertex grid shared by all killas; jitter makes coordinates non-trivial.
    const n = side * 5 + 1;
    const vx = (i, j) => origin[0] + i * killaDeg + (jitter ? Math.sin(i * 12.9898 + j * 78.233) * 1e-5 : 0);
    const vy = (i, j) => origin[1] + j * killaDeg + (jitter ? Math.cos(i * 39.425 + j * 11.135) * 1e-5 : 0);
    let m = 0;
    for (let mi = 0; mi < side && m < murabbas; mi++) {
        for (let mj = 0; mj < side && m < murabbas; mj++, m++) {
            for (let k = 0; k < 25; k++) {
                const i = mi * 5 + (k % 5), j = mj * 5 + Math.floor(k / 5);
                // Each killa edge gets 3 intermediate vertices (shared with the neighbour).
                const ring = [];
                const edge = (a, b, c, d) => {
                    for (let t = 0; t < 4; t++) {
                        const f = t / 4;
                        ring.push([vx(a, b) + (vx(c, d) - vx(a, b)) * f, vy(a, b) + (vy(c, d) - vy(a, b)) * f]);
                    }
                };
                edge(i, j, i + 1, j); edge(i + 1, j, i + 1, j + 1); edge(i + 1, j + 1, i, j + 1); edge(i, j + 1, i, j);
                ring.push(ring[0].slice());
                features.push({
                    type: 'Feature',
                    properties: { Murabba_No: String(m + 1), Killa: String(k + 1), Mouza: 'Test Mouza', Area_K: 7.5 + (k % 3) * 0.25 },
                    geometry: { type: 'Polygon', coordinates: [ring] },
                });
            }
        }
    }
    void n;
    return { type: 'FeatureCollection', name: 'Test Mouza', features };
}

module.exports = { syntheticMouza };
