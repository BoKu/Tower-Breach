import { describe, it, expect, beforeEach } from 'vitest';
import { load, save, remove, storageAvailable, _resetMemory } from '../src/save/storage';
import { validLoadout, loadoutCost, emptyLoadout } from '../src/ui/shop';
import { encodePlayer, decodePlayer, encodeFloor } from '../src/net/protocol';
import { createPlayer } from '../src/sim/player';
import { pressure, DIFF_BASE, bracketOf } from '../src/config/difficulty';
import { WEAPONS } from '../src/config/weapons';
import { setup, addEnemy, LOADOUT } from './helpers';
import { giveLoot } from '../src/sim/inventory';

describe('storage (graceful failure)', () => {
  beforeEach(() => _resetMemory());
  it('falls back to memory when localStorage is missing or throws', () => {
    (globalThis as any).localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('x'); } };
    expect(storageAvailable()).toBe(false);
    expect(save('k', { a: 1 })).toBe(false);
    expect(load('k', null)).toEqual({ a: 1 });
    remove('k');
    expect(load('k', 'fb')).toBe('fb');
  });
  it('round-trips through working storage and tolerates corrupt data', () => {
    const m: Record<string, string> = {};
    (globalThis as any).localStorage = { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => (m[k] = v), removeItem: (k: string) => delete m[k] };
    expect(storageAvailable()).toBe(true);
    save('settings', { quality: 'high' });
    expect(load<any>('settings', {}).quality).toBe('high');
    m['towerbreach.bad'] = '{not json';
    expect(load('bad', 42)).toBe(42);
  });
});

describe('armory rules', () => {
  it('prices, budget and carry limits are enforced', () => {
    const lo = emptyLoadout();
    expect(loadoutCost(lo)).toBe(0); // issued sidearm is free
    lo.primary = 'sr4'; lo.armor = 'vesthelm'; lo.items.medkit = 2;
    expect(loadoutCost(lo)).toBe(2900 + 1000 + 700);
    expect(validLoadout(lo, 'normal')).toBe(true);
    lo.primary = 'lmg249'; lo.items = { medkit: 3, plate: 3 }; lo.mods = { bypass: true, torchmod: true, pouch: true };
    expect(loadoutCost(lo)).toBeGreaterThan(DIFF_BASE.insane.cash);
    expect(validLoadout(lo, 'insane')).toBe(false); // over budget
    // a top-tier primary plus armour and kits fits even the insane budget (no second trip to the armory)
    const top = emptyLoadout(); top.primary = 'dmr20'; top.armor = 'vesthelm'; top.items = { medkit: 2 };
    expect(validLoadout(top, 'insane')).toBe(true);
    // grenades: 3 in total, any mix (3 of one type is fine)
    for (const ok of [{ frag: 3 }, { flash: 3 }, { frag: 1, flash: 1, smoke: 1 }, { decoy: 2, incendiary: 1 }]) {
      const g = emptyLoadout(); g.grenades = ok;
      expect(validLoadout(g, 'normal')).toBe(true);
    }
    for (const bad of [{ frag: 4 }, { frag: 2, flash: 2 }, { frag: 1, flash: 1, smoke: 1, decoy: 1 }]) {
      const g = emptyLoadout(); g.grenades = bad;
      expect(validLoadout(g, 'normal')).toBe(false);
    }
    const w = emptyLoadout(); (w as any).primary = 'p9';
    expect(validLoadout(w, 'normal')).toBe(false); // pistol in primary slot
  });
  it('catalogue covers every tactical category with original names', () => {
    const cats = new Set(WEAPONS.filter((w) => w.droppable).map((w) => w.category));
    for (const c of ['pistol', 'heavy_pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'machine_gun']) expect(cats.has(c as any)).toBe(true);
  });
  it('carry caps: ammo and items stop at the limit', () => {
    const p = createPlayer(1, 0, 'x', LOADOUT);
    p.ammo.rifle = 230;
    const r = giveLoot(p, { k: 'ammo', ammo: 'rifle', n: 30 });
    expect(p.ammo.rifle).toBe(240);
    expect(r.left).toEqual({ k: 'ammo', ammo: 'rifle', n: 20 });
    p.items.medkit = 3;
    expect(giveLoot(p, { k: 'item', item: 'medkit', n: 1 }).left).not.toBeNull();
  });
});

describe('difficulty escalation', () => {
  it('each 10-floor bracket strictly increases pressure; hard > normal > insane budget order', () => {
    for (const d of ['normal', 'hard', 'insane'] as const) {
      for (let f = 11; f <= 200; f += 10) {
        const a = pressure(d, f - 10), b = pressure(d, f);
        expect(bracketOf(f)).toBe(bracketOf(f - 10) + 1);
        expect(b.perception).toBeGreaterThan(a.perception);
        expect(b.damage).toBeGreaterThan(a.damage);
        expect(b.aggression).toBeGreaterThan(a.aggression);
        expect(b.hazard).toBeGreaterThan(a.hazard);
        expect(b.loot).toBeLessThanOrEqual(a.loot);
      }
    }
    expect(pressure('insane', 50).damage).toBeGreaterThan(pressure('hard', 50).damage);
    expect(DIFF_BASE.normal.cash).toBeGreaterThan(DIFF_BASE.insane.cash);
  });
});

describe('replication protocol', () => {
  it('player encode/decode round-trip (full for recipient, public for others)', () => {
    const p = createPlayer(3, 1, 'Bravo', LOADOUT);
    p.hp = 63.2; p.items.medkit = 2; p.torchOn = true; p.floor = 42; (p as any).tp = 5;
    const q = createPlayer(3, 0, '?', { ...LOADOUT, primary: null });
    decodePlayer(q, JSON.parse(JSON.stringify(encodePlayer(p, true))), false);
    expect(q.hp).toBeCloseTo(63.2, 1);
    expect(q.items.medkit).toBe(2);
    expect(q.floor).toBe(42);
    expect(q.torchOn).toBe(true);
    const pub = encodePlayer(p, false);
    expect(pub.ammo).toBeUndefined(); // others don't receive your inventory
  });
  it('floor encoding contains enemies, pings and revealed traps', () => {
    const { sim, fs } = setup();
    const e = addEnemy(sim, fs, 'cyborg', 20, 20);
    fs.pings.push({ id: 1, enemyId: e.id, x: 20, y: 20, by: 1, t: 5 });
    fs.traps.push({ id: 2, kind: 'mine', x: 3, y: 3, x2: 0, y2: 0, armed: true, revealed: true, fuse: 0 });
    const enc = JSON.parse(JSON.stringify(encodeFloor(fs, true)));
    expect(enc.en[0][0]).toBe(e.id);
    expect(enc.pg[0][1]).toBe(e.id);
    expect(enc.tr[0][2]).toBe(1);
    expect(Array.isArray(enc.ct)).toBe(true);
  });
});
