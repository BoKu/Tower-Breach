/** Shared resources by key with reference counts: made on first take, freed when the last user releases them. */
export class RefCache<K, V> {
  private m = new Map<K, { v: V; n: number }>();
  constructor(private make: (k: K) => V, private free: (v: V, k: K) => void) {}
  take(k: K): V {
    let e = this.m.get(k);
    if (!e) this.m.set(k, (e = { v: this.make(k), n: 0 }));
    e.n++;
    return e.v;
  }
  release(k: K) {
    const e = this.m.get(k);
    if (!e || --e.n > 0) return;
    this.m.delete(k);
    this.free(e.v, k);
  }
  get size() { return this.m.size; }
}
