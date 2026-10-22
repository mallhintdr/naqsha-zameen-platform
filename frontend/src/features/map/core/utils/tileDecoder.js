import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader as Pbf } from 'pbf';
import { fetchMurabbaJson } from '@/shared/lib/mouzaApi';
import { getSignedPMTilesUrl } from '@/features/map/config/pmtiles';

// Extract murabba numbers directly from PMTiles
export const extractMurabbaNumbersFromPMTiles = async (pmtiles, header, onProgress, tehsil, mouza) => {
  try {
    // OPTIMIZATION 1: Try to fetch separate JSON metadata file first with local caching (fastest method)
    if (tehsil && mouza) {
      const cacheKey = `murabba_list_${tehsil}_${mouza}`;
      const cacheTimestamp = localStorage.getItem(`${cacheKey}_timestamp`);
      const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

      // Check localStorage cache first
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData && cacheTimestamp) {
        const age = Date.now() - parseInt(cacheTimestamp);
        if (age < CACHE_DURATION) {
          try {
            const murabbaList = JSON.parse(cachedData);
            // An empty cached list is not trusted (e.g. killa-bandi mouzas cached before
            // their killas were used as murabbas) — fall through and fetch again.
            if (!Array.isArray(murabbaList) || murabbaList.length === 0) throw new Error('empty cached list');
            console.log('✅ INSTANT load from LOCAL CACHE:', murabbaList.length, 'murabbas');

            if (onProgress) {
              onProgress({
                processed: 1,
                total: 1,
                found: murabbaList.length,
                percentage: 100,
                complete: true,
                fromCache: true
              });
            }

            return murabbaList;
          } catch (e) {
            console.warn('Failed to parse cached murabba list:', e);
          }
        }
      }

      // Fetch from server if not in cache
      // Try Metadata folder first (local in dev, remote in prod)
      try {
        const metadataJson = await fetchMurabbaJson(tehsil, mouza);
        if (metadataJson && metadataJson.murabba_list && Array.isArray(metadataJson.murabba_list)) {
          console.log('✅ INSTANT load from Metadata folder:', metadataJson.murabba_list.length, 'murabbas');

          // Cache for future use
          try {
            localStorage.setItem(cacheKey, JSON.stringify(metadataJson.murabba_list));
            localStorage.setItem(`${cacheKey}_timestamp`, Date.now().toString());
            console.log('💾 Cached murabba list for:', mouza);
          } catch (cacheError) {
            console.warn('Failed to cache murabba list (localStorage full?):', cacheError);
          }

          // Store centroids for tooltip usage
          window.murabbaCentroids = metadataJson.murabba_centroids || {};

          if (onProgress) {
            onProgress({
              processed: 1,
              total: 1,
              found: metadataJson.murabba_list.length,
              percentage: 100,
              complete: true,
              fromMetadata: true
            });
          }

          return metadataJson.murabba_list;
        }
      } catch (metadataError) {
        console.log('📋 Metadata folder not available, trying R2/backend fallback');
      }

      // Fallback: Try Cloudflare/frontend for JSON metadata
      try {
        const jsonUrl = await getSignedPMTilesUrl(tehsil, mouza, null, `${mouza}-Murabba.json`);
        console.log('🔍 Attempting to fetch metadata JSON:', jsonUrl);

        const response = await fetch(jsonUrl);
        if (response.ok) {
          const jsonMetadata = await response.json();

          if (jsonMetadata.murabba_list && Array.isArray(jsonMetadata.murabba_list)) {
            console.log('✅ INSTANT load from JSON metadata:', jsonMetadata.murabba_list.length, 'murabbas');

            // Cache for future use
            try {
              localStorage.setItem(cacheKey, JSON.stringify(jsonMetadata.murabba_list));
              localStorage.setItem(`${cacheKey}_timestamp`, Date.now().toString());
              console.log('💾 Cached murabba list for:', mouza);
            } catch (cacheError) {
              console.warn('Failed to cache murabba list (localStorage full?):', cacheError);
            }

            // Store centroids for tooltip usage
            window.murabbaCentroids = jsonMetadata.murabba_centroids || {};

            if (onProgress) {
              onProgress({
                processed: 1,
                total: 1,
                found: jsonMetadata.murabba_list.length,
                percentage: 100,
                complete: true,
                fromJSON: true
              });
            }

            return jsonMetadata.murabba_list;
          }
        }
      } catch (jsonError) {
        console.log('📋 JSON metadata not available, falling back to PMTiles metadata');
      }
    }

    // OPTIMIZATION 2: Check PMTiles metadata for instant loading (fallback)
    const metadata = await pmtiles.getMetadata();

    if (metadata) {
      // Try to parse metadata from description field first (new method)
      let parsedMetadata = null;
      if (metadata.description) {
        try {
          parsedMetadata = JSON.parse(metadata.description);
        } catch (e) {
          // description is not JSON, ignore
        }
      }

      // Check for murabba_list in parsed description or direct metadata
      const metadataSource = parsedMetadata || metadata;

      if (metadataSource.murabba_list && Array.isArray(metadataSource.murabba_list)) {
        console.log('✅ Instant load from PMTiles metadata:', metadataSource.murabba_list.length, 'murabbas');

        // Store centroids if available
        if (metadataSource.murabba_centroids) {
          window.murabbaCentroids = metadataSource.murabba_centroids;
        }

        // Report completion with metadata flag
        if (onProgress) {
          onProgress({
            processed: 1,
            total: 1,
            found: metadataSource.murabba_list.length,
            percentage: 100,
            complete: true,
            fromMetadata: true
          });
        }

        return metadataSource.murabba_list;
      }

      // Legacy format checks
      if (metadataSource.murabba_numbers && Array.isArray(metadataSource.murabba_numbers)) {
        console.log('✅ Instant load from PMTiles metadata (legacy):', metadataSource.murabba_numbers.length, 'murabbas');
        if (onProgress) {
          onProgress({
            processed: 1,
            total: 1,
            found: metadataSource.murabba_numbers.length,
            percentage: 100,
            complete: true,
            fromMetadata: true
          });
        }
        return metadataSource.murabba_numbers;
      }

      if (metadataSource.murabbas && Array.isArray(metadataSource.murabbas)) {
        console.log('✅ Instant load from PMTiles metadata (legacy):', metadataSource.murabbas.length, 'murabbas');
        if (onProgress) {
          onProgress({
            processed: 1,
            total: 1,
            found: metadataSource.murabbas.length,
            percentage: 100,
            complete: true,
            fromMetadata: true
          });
        }
        return metadataSource.murabbas;
      }
    }

    // FALLBACK: If metadata doesn't have murabba list, extract from tiles
    console.log('⚠️ No metadata found, scanning tiles (slower method)...');
    console.log('📊 [v3] Extracting murabba numbers with parallel batch processing...');

    const murabbaSet = new Set();
    const scannedCentroids = new Map(); // Store [lat, lon] points for each murabba
    // Prioritize zoom levels 15, 16, 14 (sweet spot for feature detail vs tile count)
    const zoomsToTry = [];
    [15, 16, 14, Math.floor((header.minZoom + header.maxZoom) / 2), header.minZoom].forEach(z => {
      if (z >= header.minZoom && z <= header.maxZoom && !zoomsToTry.includes(z)) {
        zoomsToTry.push(z);
      }
    });
    // Only add maxZoom as an absolute last resort, but capped to avoid freezing
    if (!zoomsToTry.includes(header.maxZoom) && header.maxZoom <= 18) {
      zoomsToTry.push(header.maxZoom);
    }

    // Helper function to extract murabbas and centroids from a single tile
    const extractFromTile = async (sampleZoom, x, y) => {
      try {
        const tileData = await pmtiles.getZxy(sampleZoom, x, y);

        if (!tileData) return { murabbas: [], centroids: {}, success: false };

        // Convert to ArrayBuffer
        let arrayBuffer;
        if (tileData instanceof ArrayBuffer) {
          arrayBuffer = tileData;
        } else if (tileData instanceof Uint8Array) {
          arrayBuffer = tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
        } else if (tileData.buffer) {
          arrayBuffer = tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
        } else if (typeof tileData === 'object' && tileData.data) {
          arrayBuffer = tileData.data;
        }

        if (!arrayBuffer) return { murabbas: [], centroids: {}, success: false };

        // Parse vector tile
        const pbf = new Pbf(arrayBuffer);
        const vectorTile = new VectorTile(pbf);

        const tileMurabbas = [];
        const tileCentroids = {};
        const extent = 4096;

        // Extract Murabba_No from all layers
        Object.keys(vectorTile.layers).forEach(layerName => {
          const layer = vectorTile.layers[layerName];
          for (let i = 0; i < layer.length; i++) {
            const feature = layer.feature(i);
            if (feature.properties && feature.properties.Murabba_No) {
              const mNo = String(feature.properties.Murabba_No);
              tileMurabbas.push(mNo);

              const geometry = feature.loadGeometry();
              let sumX = 0, sumY = 0, count = 0;
              geometry.forEach(ring => {
                ring.forEach(point => {
                  sumX += point.x;
                  sumY += point.y;
                  count++;
                });
              });

              if (count > 0) {
                if (!tileCentroids[mNo]) {
                  tileCentroids[mNo] = { sumX: 0, sumY: 0, count: 0 };
                }
                tileCentroids[mNo].sumX += sumX / count;
                tileCentroids[mNo].sumY += sumY / count;
                tileCentroids[mNo].count += 1;
              }
            }
          }
        });

        const centroidsLatLng = {};
        Object.entries(tileCentroids).forEach(([mNo, data]) => {
          const avgX = data.sumX / data.count;
          const avgY = data.sumY / data.count;
          const lon = (x + avgX / extent) / Math.pow(2, sampleZoom) * 360 - 180;
          const n = Math.PI - 2 * Math.PI * (y + avgY / extent) / Math.pow(2, sampleZoom);
          const lat = (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
          centroidsLatLng[mNo] = [lat, lon];
        });

        return { murabbas: tileMurabbas, centroids: centroidsLatLng, success: true };
      } catch (tileError) {
        // Skip tiles that fail to load (they might not exist)
        return { murabbas: [], centroids: {}, success: false };
      }
    };

    for (const sampleZoom of zoomsToTry) {
      if (murabbaSet.size > 0) break; // Stop if we already found murabbas

      console.log(`📍 Trying zoom level ${sampleZoom}...`);

      // Calculate tile range for the bounds at sample zoom
      const minX = Math.floor((header.minLon + 180) / 360 * Math.pow(2, sampleZoom));
      const maxX = Math.floor((header.maxLon + 180) / 360 * Math.pow(2, sampleZoom));
      
      const y1 = Math.floor((1 - Math.log(Math.tan(header.minLat * Math.PI / 180) + 1 / Math.cos(header.minLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, sampleZoom));
      const y2 = Math.floor((1 - Math.log(Math.tan(header.maxLat * Math.PI / 180) + 1 / Math.cos(header.maxLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, sampleZoom));
      
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);

      // Build list of all tile coordinates
      const tileCoords = [];
      for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
          tileCoords.push({ x, y });
        }
      }

      const minTile = { x: minX, y: minY };
      const maxTile = { x: maxX, y: maxY };

      const totalTiles = tileCoords.length;
      console.log(`  Tile range: ${totalTiles} tiles (x[${minTile.x}-${maxTile.x}] y[${minTile.y}-${maxTile.y}])`);

      let samplesProcessed = 0;
      let successfulTiles = 0;

      // Process tiles in parallel batches of 10 for performance
      const BATCH_SIZE = 10;

      for (let i = 0; i < tileCoords.length; i += BATCH_SIZE) {
        const batch = tileCoords.slice(i, i + BATCH_SIZE);

        // Process batch in parallel
        const results = await Promise.all(
          batch.map(({ x, y }) => extractFromTile(sampleZoom, x, y))
        );

        // Collect murabbas and centroids from batch
        results.forEach(result => {
          if (result.success) successfulTiles++;
          result.murabbas.forEach(m => murabbaSet.add(m));
          if (result.centroids) {
            Object.entries(result.centroids).forEach(([mNo, latlng]) => {
              if (!scannedCentroids.has(mNo)) {
                scannedCentroids.set(mNo, []);
              }
              scannedCentroids.get(mNo).push(latlng);
            });
          }
        });

        samplesProcessed += batch.length;

        // Report progress to parent component
        if (onProgress) {
          onProgress({
            processed: samplesProcessed,
            total: totalTiles,
            found: murabbaSet.size,
            percentage: Math.round((samplesProcessed / totalTiles) * 100)
          });
        }

        // Log progress every 50 tiles or at the end
        if (samplesProcessed % 50 === 0 || samplesProcessed === totalTiles) {
          console.log(`  Progress: ${samplesProcessed}/${totalTiles} tiles processed, ${murabbaSet.size} murabbas found`);
        }
      }

      console.log(`  ✅ Found ${successfulTiles}/${samplesProcessed} tiles with ${murabbaSet.size} unique murabbas`);
    }

    // Compute final centroids by averaging the centroids from all tiles
    const finalCentroids = {};
    scannedCentroids.forEach((list, mNo) => {
      let sumLat = 0, sumLng = 0;
      list.forEach(c => {
        sumLat += c[0];
        sumLng += c[1];
      });
      finalCentroids[mNo] = [sumLat / list.length, sumLng / list.length];
    });

    window.scannedMurabbaCentroids = finalCentroids;

    // Convert Set to sorted array
    const murabbaNumbers = Array.from(murabbaSet).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

    console.log(`✨ Extracted ${murabbaNumbers.length} unique murabba numbers total`);
    if (murabbaNumbers.length > 0) {
      console.log('   Murabba numbers:', murabbaNumbers.slice(0, 10).join(', ') + (murabbaNumbers.length > 10 ? '...' : ''));
    }

    // Final progress notification
    if (onProgress) {
      onProgress({
        processed: -1, // -1 indicates completion
        total: -1,
        found: murabbaNumbers.length,
        percentage: 100,
        complete: true
      });
    }

    return murabbaNumbers;

  } catch (error) {
    console.error('Error extracting murabba numbers from PMTiles:', error);
    return [];
  }
};

// Extract murabba bounds directly from PMTiles for zoom functionality
export const extractMurabbaBoundsFromPMTiles = async (pmtiles, header, murabbaNumber) => {
  try {
    console.log('Extracting bounds for murabba:', murabbaNumber);

    // Use a higher zoom level for more precise bounds
    const sampleZoom = Math.min(header.maxZoom, 15);

    // Calculate tile range
    const minTile = {
      x: Math.floor((header.minLon + 180) / 360 * Math.pow(2, sampleZoom)),
      y: Math.floor((1 - Math.log(Math.tan(header.minLat * Math.PI / 180) + 1 / Math.cos(header.minLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, sampleZoom))
    };

    const maxTile = {
      x: Math.floor((header.maxLon + 180) / 360 * Math.pow(2, sampleZoom)),
      y: Math.floor((1 - Math.log(Math.tan(header.maxLat * Math.PI / 180) + 1 / Math.cos(header.maxLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, sampleZoom))
    };

    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;
    let foundFeature = false;

    // Search tiles for the specific murabba
    for (let x = minTile.x; x <= maxTile.x; x++) {
      for (let y = minTile.y; y <= maxTile.y; y++) {
        try {
          const tileData = await pmtiles.getZxy(sampleZoom, x, y);

          if (tileData) {
            let arrayBuffer;
            if (tileData instanceof ArrayBuffer) {
              arrayBuffer = tileData;
            } else if (tileData instanceof Uint8Array) {
              arrayBuffer = tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
            } else if (tileData.buffer) {
              arrayBuffer = tileData.buffer.slice(tileData.byteOffset, tileData.byteOffset + tileData.byteLength);
            } else if (typeof tileData === 'object' && tileData.data) {
              arrayBuffer = tileData.data;
            }

            if (arrayBuffer) {
              const pbf = new Pbf(arrayBuffer);
              const vectorTile = new VectorTile(pbf);
              const extent = 4096;

              Object.keys(vectorTile.layers).forEach(layerName => {
                const layer = vectorTile.layers[layerName];

                for (let i = 0; i < layer.length; i++) {
                  const feature = layer.feature(i);

                  if (feature.properties && String(feature.properties.Murabba_No) === String(murabbaNumber)) {
                    foundFeature = true;

                    // Get feature geometry and calculate bounds
                    const geometry = feature.loadGeometry();
                    geometry.forEach(ring => {
                      ring.forEach(point => {
                        // Convert tile coordinates to lat/lon
                        const lon = (x + point.x / extent) / Math.pow(2, sampleZoom) * 360 - 180;
                        const n = Math.PI - 2 * Math.PI * (y + point.y / extent) / Math.pow(2, sampleZoom);
                        const lat = (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));

                        minLat = Math.min(minLat, lat);
                        maxLat = Math.max(maxLat, lat);
                        minLon = Math.min(minLon, lon);
                        maxLon = Math.max(maxLon, lon);
                      });
                    });
                  }
                }
              });
            }
          }
        } catch (tileError) {
          // Skip tiles that fail
        }
      }
    }

    if (foundFeature) {
      const bounds = [[minLat, minLon], [maxLat, maxLon]];
      console.log('📍 Extracted bounds for murabba', murabbaNumber, ':', bounds);
      return bounds;
    }

    console.warn('⚠️ Could not find bounds for murabba:', murabbaNumber);
    return null;

  } catch (error) {
    console.error('Error extracting murabba bounds:', error);
    return null;
  }
};

// Get murabba centroids from PMTiles metadata for instant tooltip placement
export const getMurabbaCentroidsFromMetadata = async (pmtiles) => {
  try {
    const metadata = await pmtiles.getMetadata();

    if (metadata) {
      // Try parsing from description field first
      let parsedMetadata = null;
      if (metadata.description) {
        try {
          parsedMetadata = JSON.parse(metadata.description);
        } catch (e) {
          // Not JSON, ignore
        }
      }

      const metadataSource = parsedMetadata || metadata;

      if (metadataSource.murabba_centroids) {
        console.log('✅ Loaded murabba centroids from metadata:', Object.keys(metadataSource.murabba_centroids).length, 'centroids');
        return metadataSource.murabba_centroids;
      }
    }

    console.log('⚠️ No centroids in metadata, will calculate from tiles');
    return null;
  } catch (error) {
    console.warn('Error reading centroids from metadata:', error);
    return null;
  }
};
