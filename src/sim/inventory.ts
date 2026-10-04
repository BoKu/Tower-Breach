import { AMMO_CAP, AmmoType, weapon } from '../config/weapons';
import { GRENADE_MAX_TOTAL, ITEM_MAX, GrenadeType, ItemType, ITEM_NAMES, GRENADE_NAMES } from '../config/items';
import type { PlayerState, WeaponInst } from './state';
import type { LootItem } from './types';

/** Per-type cap: only the shared total limits grenades, so any type can fill all slots. */
export const GRENADE_CAP: Record<GrenadeType, number> = { frag: GRENADE_MAX_TOTAL, flash: GRENADE_MAX_TOTAL, smoke: GRENADE_MAX_TOTAL, incendiary: GRENADE_MAX_TOTAL, decoy: GRENADE_MAX_TOTAL };

export function ammoCap(p: PlayerState, a: AmmoType): number {
  return Math.round(AMMO_CAP[a] * (p.mods.pouch ? 1.5 : 1));
}
export function grenadeTotal(p: PlayerState): number {
  return Object.values(p.grenades).reduce((a, b) => a + b, 0);
}
export function currentWeapon(p: PlayerState): WeaponInst | null {
  return p.sel === 'knife' ? null : p.weapons[p.sel];
}

/** Try to add a loot item. Returns the leftover (null if fully taken) and a message. */
export function giveLoot(p: PlayerState, it: LootItem): { left: LootItem | null; msg: string | null } {
  switch (it.k) {
    case 'ammo': {
      const cap = ammoCap(p, it.ammo);
      const take = Math.min(it.n, cap - p.ammo[it.ammo]);
      if (take <= 0) return { left: it, msg: null };
      p.ammo[it.ammo] += take;
      return { left: take < it.n ? { ...it, n: it.n - take } : null, msg: `+${take} ${it.ammo} ammo` };
    }
    case 'item': {
      const take = Math.min(it.n, ITEM_MAX[it.item] - p.items[it.item]);
      if (take <= 0) return { left: it, msg: null };
      p.items[it.item] += take;
      return { left: take < it.n ? { ...it, n: it.n - take } : null, msg: `+${take} ${ITEM_NAMES[it.item]}` };
    }
    case 'grenade': {
      const room = Math.min(GRENADE_CAP[it.g] - p.grenades[it.g], GRENADE_MAX_TOTAL - grenadeTotal(p));
      const take = Math.min(it.n, room);
      if (take <= 0) return { left: it, msg: null };
      p.grenades[it.g] += take;
      return { left: take < it.n ? { ...it, n: it.n - take } : null, msg: `+${take} ${GRENADE_NAMES[it.g]}` };
    }
    case 'weapon': {
      const w = weapon(it.id);
      if (p.weapons[w.slot]) {
        // take its loose rounds, keep the gun in the container
        if (it.reserve > 0) {
          const take = Math.min(it.reserve, ammoCap(p, w.ammo) - p.ammo[w.ammo]);
          if (take > 0) { p.ammo[w.ammo] += take; it.reserve -= take; return { left: it, msg: `+${take} ${w.ammo} ammo` }; }
        }
        return { left: it, msg: null };
      }
      p.weapons[w.slot] = { id: w.id, mag: it.mag };
      p.ammo[w.ammo] = Math.min(ammoCap(p, w.ammo), p.ammo[w.ammo] + it.reserve);
      return { left: null, msg: `Picked up ${w.name}` };
    }
  }
}

/** Swap the held gun in `slot` for a weapon item. Returns the dropped weapon as loot. */
export function swapWeapon(p: PlayerState, it: Extract<LootItem, { k: 'weapon' }>): LootItem | null {
  const w = weapon(it.id);
  const cur = p.weapons[w.slot];
  p.weapons[w.slot] = { id: w.id, mag: it.mag };
  p.ammo[w.ammo] = Math.min(ammoCap(p, w.ammo), p.ammo[w.ammo] + it.reserve);
  p.sel = w.slot;
  if (!cur) return null;
  return { k: 'weapon', id: cur.id, mag: cur.mag, reserve: 0 };
}

export function nextItem(p: PlayerState): ItemType {
  const order: ItemType[] = ['medkit', 'battery', 'plate', 'drink', 'food'];
  const i = order.indexOf(p.itemSel);
  for (let k = 1; k <= order.length; k++) {
    const c = order[(i + k) % order.length];
    if (p.items[c] > 0) return c;
  }
  return p.itemSel;
}
export function nextGrenade(p: PlayerState): GrenadeType {
  const order: GrenadeType[] = ['frag', 'flash', 'smoke', 'incendiary', 'decoy'];
  const i = order.indexOf(p.grenadeSel);
  for (let k = 1; k <= order.length; k++) {
    const c = order[(i + k) % order.length];
    if (p.grenades[c] > 0) return c;
  }
  return p.grenadeSel;
}
