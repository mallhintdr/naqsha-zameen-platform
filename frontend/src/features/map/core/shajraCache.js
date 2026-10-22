// IndexedDB cache for Shajra raster tiles (legacy MapComponent helpers, `idb` package).
import { openDB } from 'idb';

let dbPromise = null;
const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB('rasterDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles');
      },
    });
  }
  return dbPromise;
};

export const storeTileInIndexedDB = async (key, blob) => {
  const db = await getDb();
  await db.put('tiles', blob, key);
};

export const getTileFromIndexedDB = async (key) => {
  const db = await getDb();
  return db.get('tiles', key);
};

/** Clears every cached shajra tile (used by the navigation menu's shajra toggle / clear cache). */
export const deleteCachedTiles = async () => {
  const db = await getDb();
  const tx = db.transaction('tiles', 'readwrite');
  const store = tx.objectStore('tiles');
  const keys = await store.getAllKeys();
  for (const key of keys) await store.delete(key);
  await tx.done;
  console.log('All cached tiles have been deleted.');
};
