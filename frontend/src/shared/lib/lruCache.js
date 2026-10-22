// Ported from legacy src/utils/lruCache.js
/**
 * Simple Least Recently Used (LRU) Cache implementation.
 * Used to limit memory usage by caching only the most recently used items.
 */
class LRUCache {
    constructor(maxSize = 20) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    get(key) {
        if (!this.cache.has(key)) return undefined;

        // Refresh item: remove and re-insert to mark as recently used
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        // If key exists, delete it first to update position
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Evict oldest (first inserted)
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            console.log(`[LRUCache] Evicted ${oldestKey} to free memory.`);
        }

        this.cache.set(key, value);
    }

    has(key) {
        return this.cache.has(key);
    }

    delete(key) {
        return this.cache.delete(key);
    }

    clear() {
        this.cache.clear();
    }

    get size() {
        return this.cache.size;
    }
}

export default LRUCache;
