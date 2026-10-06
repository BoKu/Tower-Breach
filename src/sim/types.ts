import type { AmmoType } from '../config/weapons';
import type { GrenadeType, ItemType } from '../config/items';

export type EnemyType = 'loyalist' | 'dog' | 'cyborg' | 'dogcyborg' | 'drone' | 'warden';
export const ENEMY_NAMES: Record<EnemyType, string> = {
  loyalist: 'Loyalist', dog: 'Attack Dog', cyborg: 'Human-Cyborg', dogcyborg: 'Cyber-Hound', drone: 'Patrol Drone', warden: 'Warden Mech',
};
/** Linked to the AI's collective network (responds to CCTV / AI alerts). Human loyalists and plain dogs are not. */
export const NETWORKED: Record<EnemyType, boolean> = {
  loyalist: false, dog: false, cyborg: true, dogcyborg: true, drone: true, warden: true,
};
export const IS_CYBORG: Record<EnemyType, boolean> = {
  loyalist: false, dog: false, cyborg: true, dogcyborg: true, drone: false, warden: false,
};

export type LootItem =
  | { k: 'ammo'; ammo: AmmoType; n: number }
  | { k: 'item'; item: ItemType; n: number }
  | { k: 'grenade'; g: GrenadeType; n: number }
  | { k: 'weapon'; id: string; mag: number; reserve: number }
  /** the master key for floor f: opens (and locks) every locked door on that floor */
  | { k: 'key'; f: number }
  | { k: 'coin'; n: number };

export type Vec2 = { x: number; y: number };
