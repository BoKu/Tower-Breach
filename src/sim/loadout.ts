import { WEAPONS } from '../config/weapons';
import { GEAR, GEAR_BY_ID, GRENADE_MAX_TOTAL, GrenadeType } from '../config/items';
import { DIFF_BASE, Difficulty } from '../config/difficulty';
import type { Loadout } from './state';
import { GRENADE_CAP } from './inventory';

/** Loadout rules shared by the armory UI, the browser host and the dedicated server (no DOM imports here). */
export function emptyLoadout(): Loadout {
  return { primary: null, secondary: 'p9', armor: 'none', grenades: {}, items: {}, mods: { bypass: false, torchmod: false, pouch: false } };
}

export function loadoutCost(lo: Loadout): number {
  let c = 0;
  if (lo.primary) c += WEAPONS.find((w) => w.id === lo.primary)!.price;
  if (lo.secondary !== 'p9') c += WEAPONS.find((w) => w.id === lo.secondary)!.price;
  if (lo.armor !== 'none') c += GEAR_BY_ID[lo.armor].price;
  for (const [g, n] of Object.entries(lo.grenades)) c += GEAR_BY_ID[g].price * (n ?? 0);
  for (const [i, n] of Object.entries(lo.items)) c += GEAR_BY_ID[i].price * (n ?? 0);
  for (const [m, on] of Object.entries(lo.mods)) if (on) c += GEAR_BY_ID[m].price;
  return c;
}

/** Validates a loadout against the budget and carry limits (also used by the multiplayer host). */
export function validLoadout(lo: Loadout, diff: Difficulty): boolean {
  if (loadoutCost(lo) > DIFF_BASE[diff].cash) return false;
  const tot = Object.values(lo.grenades).reduce((a, b) => a + (b ?? 0), 0);
  if (tot > GRENADE_MAX_TOTAL) return false;
  for (const [g, n] of Object.entries(lo.grenades)) if ((n ?? 0) > GRENADE_CAP[g as GrenadeType]) return false;
  for (const [i, n] of Object.entries(lo.items)) if ((n ?? 0) > GEAR_BY_ID[i].max) return false;
  if (lo.primary && WEAPONS.find((w) => w.id === lo.primary)?.slot !== 'primary') return false;
  if (WEAPONS.find((w) => w.id === lo.secondary)?.slot !== 'secondary') return false;
  return true;
}

/**
 * Rebuilds an untrusted (network) loadout from known ids only, so validLoadout/loadoutCost never see
 * unknown keys or non-numbers. Returns null when it is not even shaped like a loadout.
 */
export function sanitizeLoadout(x: unknown): Loadout | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as any;
  const lo = emptyLoadout();
  const wpn = (id: unknown, slot: 'primary' | 'secondary') => WEAPONS.find((w) => w.id === id && w.slot === slot)?.id;
  lo.primary = o.primary === null ? null : wpn(o.primary, 'primary') ?? null;
  lo.secondary = wpn(o.secondary, 'secondary') ?? 'p9';
  lo.armor = o.armor === 'vest' || o.armor === 'vesthelm' ? o.armor : 'none';
  const count = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  for (const g of GEAR) {
    if (g.kind === 'grenade') { const n = count(o.grenades?.[g.id], g.max); if (n) (lo.grenades as any)[g.id] = n; }
    else if (g.kind === 'item') { const n = count(o.items?.[g.id], g.max); if (n) (lo.items as any)[g.id] = n; }
    else if (g.kind === 'mod') (lo.mods as any)[g.id] = o.mods?.[g.id] === true;
  }
  return lo;
}
