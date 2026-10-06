import { Rng } from '../core/rng';
import type { AmmoType } from '../config/weapons';
import { WEAPONS, weapon } from '../config/weapons';
import type { LootItem } from '../sim/types';

export type ContainerKind = 'medcab' | 'crate' | 'locker' | 'desk' | 'safe' | 'toolbox' | 'fridge' | 'corpse' | 'drop';

export const CONTAINER_LABEL: Record<ContainerKind, string> = {
  medcab: 'Medical Cabinet', crate: 'Supply Crate', locker: 'Locker', desk: 'Desk Drawer', safe: 'Executive Safe',
  toolbox: 'Toolbox', fridge: 'Fridge', corpse: 'Body', drop: 'Dropped Gear',
};

const AMMO_ROLL: Record<AmmoType, [number, number]> = {
  pistol: [12, 24], heavy: [6, 10], smg: [15, 30], rifle: [15, 30], sniper: [4, 8], shell: [5, 10], internal: [0, 0],
};

export function ammoAmount(rng: Rng, a: AmmoType, mult = 1): number {
  const [lo, hi] = AMMO_ROLL[a];
  return Math.max(1, Math.round(rng.int(lo, hi) * mult));
}

function randomAmmoType(rng: Rng): AmmoType {
  return rng.weighted<AmmoType>([['pistol', 4], ['smg', 3], ['rifle', 4], ['shell', 2], ['heavy', 1], ['sniper', 1]]);
}

const LOCKER_GUNS = WEAPONS.filter((w) => w.droppable && ['pistol', 'smg', 'shotgun', 'heavy_pistol'].includes(w.category)).map((w) => w.id);
const SAFE_GUNS = WEAPONS.filter((w) => w.droppable && ['rifle', 'sniper', 'smg'].includes(w.category)).map((w) => w.id);

export function weaponLoot(rng: Rng, id: string, fill = 0.5): LootItem {
  const w = weapon(id);
  return { k: 'weapon', id, mag: Math.max(1, Math.round(w.mag * rng.range(fill * 0.5, fill + 0.3))), reserve: Math.round(w.mag * rng.range(0, 1)) };
}

/** Deterministic container contents. `loot` is the difficulty/floor loot multiplier (<1 = scarce). */
export function containerLoot(kind: ContainerKind, rng: Rng, loot: number): LootItem[] {
  const out: LootItem[] = [];
  const c = (p: number) => rng.chance(Math.min(0.95, p * loot));
  switch (kind) {
    case 'medcab':
      if (c(0.55)) out.push({ k: 'item', item: 'medkit', n: 1 });
      if (c(0.4)) out.push({ k: 'item', item: 'food', n: 1 });
      if (c(0.1)) out.push({ k: 'item', item: 'battery', n: 1 });
      break;
    case 'crate': {
      const a = randomAmmoType(rng);
      if (c(0.85)) out.push({ k: 'ammo', ammo: a, n: ammoAmount(rng, a, 1.3) });
      if (c(0.3)) { const b = randomAmmoType(rng); out.push({ k: 'ammo', ammo: b, n: ammoAmount(rng, b) }); }
      if (c(0.2)) out.push({ k: 'item', item: 'plate', n: 1 });
      if (c(0.1)) out.push({ k: 'grenade', g: rng.pick(['frag', 'flash', 'smoke', 'incendiary'] as const), n: 1 });
      break;
    }
    case 'locker': {
      const a = randomAmmoType(rng);
      if (c(0.6)) out.push({ k: 'ammo', ammo: a, n: ammoAmount(rng, a) });
      if (c(0.14)) out.push(weaponLoot(rng, rng.pick(LOCKER_GUNS)));
      if (c(0.2)) out.push({ k: 'item', item: 'plate', n: 1 });
      if (c(0.1)) out.push({ k: 'item', item: 'battery', n: 1 });
      if (c(0.08)) out.push({ k: 'item', item: 'medkit', n: 1 });
      break;
    }
    case 'desk':
      if (c(0.35)) out.push({ k: 'item', item: 'food', n: 1 });
      if (c(0.18)) out.push({ k: 'item', item: 'battery', n: 1 });
      if (c(0.22)) out.push({ k: 'ammo', ammo: 'pistol', n: ammoAmount(rng, 'pistol', 0.7) });
      if (c(0.08)) out.push({ k: 'item', item: 'drink', n: 1 });
      if (rng.chance(0.5)) out.push({ k: 'coin', n: rng.int(1, 3) }); // loose change for the vending machines
      break;
    case 'safe':
      out.push(weaponLoot(rng, rng.pick(SAFE_GUNS), 0.8));
      if (c(0.7)) out.push({ k: 'item', item: 'medkit', n: 1 });
      if (c(0.6)) out.push({ k: 'item', item: 'plate', n: 1 });
      if (c(0.5)) out.push({ k: 'item', item: 'battery', n: 1 });
      if (c(0.4)) out.push({ k: 'grenade', g: rng.pick(['frag', 'flash', 'incendiary'] as const), n: 1 });
      out.push({ k: 'coin', n: rng.int(3, 6) });
      break;
    case 'toolbox':
      if (c(0.35)) out.push({ k: 'item', item: 'battery', n: 1 });
      if (c(0.3)) out.push({ k: 'item', item: 'plate', n: 1 });
      if (c(0.1)) out.push({ k: 'grenade', g: 'frag', n: 1 });
      break;
    case 'fridge':
      if (c(0.7)) out.push({ k: 'item', item: 'food', n: rng.int(1, 2) });
      if (c(0.3)) out.push({ k: 'item', item: 'drink', n: 1 });
      break;
    default:
      break;
  }
  return out;
}

/** Vending machine payload when broken open. */
export function vendingLoot(rng: Rng, loot: number): LootItem[] {
  const out: LootItem[] = [];
  const drinks = rng.chance(Math.min(0.95, 0.75 * loot)) ? rng.int(1, 2) : 0;
  const food = rng.chance(Math.min(0.95, 0.85 * loot)) ? rng.int(1, 2) : 0;
  if (drinks) out.push({ k: 'item', item: 'drink', n: drinks });
  if (food) out.push({ k: 'item', item: 'food', n: food });
  if (!out.length) out.push({ k: 'item', item: 'food', n: 1 });
  return out;
}

export function describeLoot(it: LootItem): string {
  switch (it.k) {
    case 'ammo': return `${it.n} ${it.ammo} ammo`;
    case 'item': return `${it.n}x ${it.item}`;
    case 'grenade': return `${it.n}x ${it.g}`;
    case 'weapon': return weapon(it.id).name;
    case 'key': return `Master key (floor ${it.f})`;
    case 'coin': return `${it.n} coin${it.n > 1 ? 's' : ''}`;
  }
}
