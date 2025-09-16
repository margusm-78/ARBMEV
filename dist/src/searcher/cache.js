"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TTLCache = void 0;
class TTLCache {
    ttlMs;
    now;
    store = new Map();
    constructor(ttlMs, now = () => Date.now()) {
        this.ttlMs = ttlMs;
        this.now = now;
    }
    get(key) {
        const hit = this.store.get(key);
        if (!hit)
            return;
        if (this.now() > hit.exp) {
            this.store.delete(key);
            return;
        }
        return hit.v;
    }
    set(key, val) {
        this.store.set(key, { v: val, exp: this.now() + this.ttlMs });
    }
    getOrSet(key, compute) {
        const v = this.get(key);
        if (v !== undefined)
            return v;
        const res = compute();
        this.set(key, res);
        return res;
    }
    clear() { this.store.clear(); }
}
exports.TTLCache = TTLCache;
