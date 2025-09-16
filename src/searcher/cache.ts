// src/searcher/cache.ts
export type Clock = () => number;

export class TTLCache<K, V> {
  private store = new Map<K, { v: V; exp: number }>();
  constructor(private ttlMs: number, private now: Clock = () => Date.now()) {}

  get(key: K): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return;
    if (this.now() > hit.exp) { this.store.delete(key); return; }
    return hit.v;
  }

  set(key: K, val: V): void {
    this.store.set(key, { v: val, exp: this.now() + this.ttlMs });
  }

  getOrSet(key: K, compute: () => V): V {
    const v = this.get(key);
    if (v !== undefined) return v;
    const res = compute();
    this.set(key, res);
    return res;
  }

  clear() { this.store.clear(); }
}
