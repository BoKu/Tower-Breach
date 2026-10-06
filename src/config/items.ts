export type GrenadeType = 'frag' | 'flash' | 'smoke' | 'incendiary' | 'decoy';
export type ItemType = 'medkit' | 'battery' | 'plate' | 'drink' | 'food';

export interface GearDef {
  id: string;
  name: string;
  kind: 'armor' | 'grenade' | 'item' | 'mod';
  price: number;
  max: number;
  desc: string;
}

/** Grenades carried in total: any mix, including 3 of one type. */
export const GRENADE_MAX_TOTAL = 3;

export const GEAR: GearDef[] = [
  { id: 'vest', name: 'Kevlar Vest', kind: 'armor', price: 650, max: 1, desc: '100 armour. Absorbs most bullet damage but degrades with every hit.' },
  { id: 'vesthelm', name: 'Vest + Ballistic Helmet', kind: 'armor', price: 1000, max: 1, desc: '100 armour plus helmet: negates critical head hits.' },
  { id: 'frag', name: 'Frag Grenade', kind: 'grenade', price: 300, max: 3, desc: 'Lethal blast radius. Loud.' },
  { id: 'flash', name: 'Flashbang', kind: 'grenade', price: 200, max: 3, desc: 'Blinds anything with eyes or lenses in line of sight.' },
  { id: 'smoke', name: 'Smoke Grenade', kind: 'grenade', price: 300, max: 3, desc: 'Blocks sight lines and camera beams for 14s.' },
  { id: 'incendiary', name: 'Incendiary Grenade', kind: 'grenade', price: 500, max: 3, desc: 'Floods an area with fire. Denies pushes and chokepoints.' },
  { id: 'decoy', name: 'Decoy Grenade', kind: 'grenade', price: 50, max: 3, desc: 'Emits fake gunfire. Pulls patrols away.' },
  { id: 'medkit', name: 'Health Kit', kind: 'item', price: 350, max: 3, desc: 'Restores full health and ends injury. Required to revive teammates.' },
  { id: 'battery', name: 'Torch Battery', kind: 'item', price: 200, max: 3, desc: 'Refills gun-torch power to full.' },
  { id: 'plate', name: 'Armour Repair Plate', kind: 'item', price: 250, max: 3, desc: 'Restores 45 armour (needs a vest).' },
  { id: 'bypass', name: 'Bypass Kit', kind: 'mod', price: 400, max: 1, desc: 'Defusal-style toolkit: disarm booby traps 3x faster and safely.' },
  { id: 'torchmod', name: 'High-Lumen Torch Mod', kind: 'mod', price: 600, max: 1, desc: 'Wider, longer beam and +50% battery capacity.' },
  { id: 'pouch', name: 'Ammo Pouch', kind: 'mod', price: 300, max: 1, desc: '+50% ammo carry capacity and an extra reserve load.' },
  { id: 'suppressor', name: 'Suppressor', kind: 'mod', price: 350, max: 1, desc: 'Fits 9mm pistols and SMGs: shots carry about 4 m (pistol) or 6 m (SMG) instead of 11-17 m. -8% damage.' },
];
export const GEAR_BY_ID: Record<string, GearDef> = Object.fromEntries(GEAR.map((g) => [g.id, g]));

export const ITEM_MAX: Record<ItemType, number> = { medkit: 3, battery: 3, plate: 3, drink: 2, food: 3 };
export const ITEM_NAMES: Record<ItemType, string> = {
  medkit: 'Health Kit', battery: 'Battery', plate: 'Armour Plate', drink: 'Energy Drink', food: 'Snack',
};
export const GRENADE_NAMES: Record<GrenadeType, string> = {
  frag: 'Frag', flash: 'Flash', smoke: 'Smoke', incendiary: 'Incendiary', decoy: 'Decoy',
};

export const DRINK_DURATION = 60;
export const DRINK_SPEED = 1.3;
export const FOOD_HEAL = 25;
export const PLATE_REPAIR = 45;
export const INJURY_THRESHOLD = 75;
export const INJURY_SPEED = 0.75;
export const TORCH_DRAIN_PER_SEC = 1 / 240; // 4 minutes of beam per battery
export const CYBORG_BATTERY_CHANCE = 0.05;
