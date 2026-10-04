/**
 * Original tactical weapon catalogue. Categories mirror a modern counter-terror loadout
 * (pistols, heavy pistols, SMGs, shotguns, rifles, marksman/sniper rifles, machine guns)
 * but names, stats and descriptions are original to TOWER BREACH.
 */
export type AmmoType = 'pistol' | 'heavy' | 'smg' | 'rifle' | 'sniper' | 'shell' | 'internal';
export type WeaponCategory = 'pistol' | 'heavy_pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'machine_gun' | 'integrated';
export type WeaponSlot = 'primary' | 'secondary';

export interface WeaponDef {
  id: string;
  name: string;
  category: WeaponCategory;
  slot: WeaponSlot;
  price: number;
  ammo: AmmoType;
  mag: number;
  /** reserve rounds granted on purchase */
  reserve: number;
  damage: number;
  pellets: number;
  /** rounds per second */
  rps: number;
  auto: boolean;
  /** shots per trigger pull for burst weapons */
  burst?: number;
  /** hip-fire cone half-angle (radians) */
  spread: number;
  /** aimed cone half-angle */
  aimSpread: number;
  /** bloom added per shot */
  recoil: number;
  /** bloom recovery per second */
  recover: number;
  reload: number;
  range: number;
  /** armour penetration 0..1 (1 ignores armour) */
  pen: number;
  /** noise radius in metres */
  noise: number;
  /** movement speed multiplier while held */
  move: number;
  /** aim-zoom camera extension (metres of look-ahead) */
  lookAhead: number;
  desc: string;
  droppable: boolean;
}

const W = (d: Omit<WeaponDef, 'droppable'> & { droppable?: boolean }): WeaponDef => ({ droppable: true, ...d });

export const WEAPONS: WeaponDef[] = [
  // ---- Pistols
  W({ id: 'p9', name: 'P9 Service', category: 'pistol', slot: 'secondary', price: 200, ammo: 'pistol', mag: 12, reserve: 48, damage: 26, pellets: 1, rps: 5, auto: false, spread: 0.05, aimSpread: 0.018, recoil: 0.03, recover: 0.5, reload: 2.1, range: 30, pen: 0.5, noise: 16, move: 1, lookAhead: 3, desc: 'Issued sidearm. Reliable, quiet-ish, forgiving.' }),
  W({ id: 'm18', name: 'M-18 Compact', category: 'pistol', slot: 'secondary', price: 300, ammo: 'pistol', mag: 15, reserve: 60, damage: 23, pellets: 1, rps: 6, auto: false, spread: 0.055, aimSpread: 0.02, recoil: 0.028, recover: 0.55, reload: 2.0, range: 28, pen: 0.48, noise: 15, move: 1, lookAhead: 3, desc: 'High-capacity compact frame. Fast follow-ups.' }),
  W({ id: 'fs7', name: 'FS-7 Penetrator', category: 'pistol', slot: 'secondary', price: 500, ammo: 'pistol', mag: 20, reserve: 60, damage: 25, pellets: 1, rps: 5.5, auto: false, spread: 0.048, aimSpread: 0.016, recoil: 0.026, recover: 0.55, reload: 2.2, range: 34, pen: 0.9, noise: 17, move: 1, lookAhead: 3.5, desc: 'Small-calibre armour-piercing pistol. Shreds vests and plating.' }),
  W({ id: 'ap18', name: 'AP-18 Machine Pistol', category: 'pistol', slot: 'secondary', price: 500, ammo: 'pistol', mag: 18, reserve: 72, damage: 20, pellets: 1, rps: 12, auto: true, spread: 0.08, aimSpread: 0.04, recoil: 0.035, recover: 0.6, reload: 2.3, range: 22, pen: 0.45, noise: 17, move: 1, lookAhead: 2.5, desc: 'Select-fire pistol. Panic button at close range.' }),
  // ---- Heavy pistols
  W({ id: 'hc50', name: 'HC-50 Hand Cannon', category: 'heavy_pistol', slot: 'secondary', price: 700, ammo: 'heavy', mag: 7, reserve: 28, damage: 58, pellets: 1, rps: 2.4, auto: false, spread: 0.07, aimSpread: 0.012, recoil: 0.09, recover: 0.6, reload: 2.2, range: 40, pen: 0.93, noise: 24, move: 0.97, lookAhead: 4, desc: 'Brutal magnum automatic. One clean hit staggers anything organic.' }),
  W({ id: 'r357', name: 'R-357 Revolver', category: 'heavy_pistol', slot: 'secondary', price: 600, ammo: 'heavy', mag: 6, reserve: 24, damage: 66, pellets: 1, rps: 1.6, auto: false, spread: 0.04, aimSpread: 0.008, recoil: 0.07, recover: 0.7, reload: 2.6, range: 42, pen: 0.9, noise: 23, move: 0.98, lookAhead: 4, desc: 'Six rounds, no jams. Precise and punishing.' }),
  // ---- SMGs
  W({ id: 'k45', name: 'K-45 Compact SMG', category: 'smg', slot: 'primary', price: 1200, ammo: 'smg', mag: 25, reserve: 100, damage: 29, pellets: 1, rps: 11, auto: true, spread: 0.07, aimSpread: 0.035, recoil: 0.022, recover: 0.8, reload: 2.4, range: 26, pen: 0.55, noise: 18, move: 1, lookAhead: 3.5, desc: 'Heavy-slug SMG. Stops loyalists cold at room distance.' }),
  W({ id: 'mpx9', name: 'MPX-9 Carbine', category: 'smg', slot: 'primary', price: 1300, ammo: 'smg', mag: 30, reserve: 120, damage: 25, pellets: 1, rps: 13, auto: true, spread: 0.062, aimSpread: 0.03, recoil: 0.018, recover: 0.85, reload: 2.2, range: 28, pen: 0.6, noise: 17, move: 1, lookAhead: 3.5, desc: 'Balanced entry SMG with mild recoil.' }),
  W({ id: 'pdw50', name: 'PDW-50 Bullpup', category: 'smg', slot: 'primary', price: 2000, ammo: 'smg', mag: 50, reserve: 100, damage: 24, pellets: 1, rps: 14, auto: true, spread: 0.068, aimSpread: 0.032, recoil: 0.016, recover: 0.85, reload: 3.1, range: 28, pen: 0.72, noise: 18, move: 0.98, lookAhead: 3.5, desc: 'Top-fed 50-round personal defence weapon.' }),
  W({ id: 'vx45', name: 'VX-45 Recoil-Damped', category: 'smg', slot: 'primary', price: 1450, ammo: 'smg', mag: 25, reserve: 100, damage: 26, pellets: 1, rps: 17, auto: true, spread: 0.066, aimSpread: 0.03, recoil: 0.012, recover: 1.0, reload: 2.4, range: 24, pen: 0.52, noise: 18, move: 1, lookAhead: 3.2, desc: 'Absurd cyclic rate, tamed by a linear recoil system.' }),
  // ---- Shotguns
  W({ id: 'br12', name: 'Breacher-12 Pump', category: 'shotgun', slot: 'primary', price: 1050, ammo: 'shell', mag: 8, reserve: 24, damage: 20, pellets: 9, rps: 1.1, auto: false, spread: 0.13, aimSpread: 0.1, recoil: 0.05, recover: 0.8, reload: 3.0, range: 16, pen: 0.35, noise: 22, move: 0.97, lookAhead: 2.5, desc: 'Door-breaching pump gun. Devastating around corners.' }),
  W({ id: 'a12', name: 'Auto-12 Tactical', category: 'shotgun', slot: 'primary', price: 1800, ammo: 'shell', mag: 7, reserve: 28, damage: 16, pellets: 8, rps: 3.6, auto: false, spread: 0.14, aimSpread: 0.11, recoil: 0.05, recover: 0.9, reload: 3.1, range: 15, pen: 0.35, noise: 22, move: 0.96, lookAhead: 2.5, desc: 'Semi-automatic combat shotgun.' }),
  W({ id: 'mag12', name: 'Mag-12 Box-Fed', category: 'shotgun', slot: 'primary', price: 1300, ammo: 'shell', mag: 5, reserve: 25, damage: 21, pellets: 8, rps: 1.4, auto: false, spread: 0.12, aimSpread: 0.09, recoil: 0.05, recover: 0.8, reload: 2.4, range: 17, pen: 0.4, noise: 22, move: 0.97, lookAhead: 2.5, desc: 'Magazine-fed shotgun with fast reloads.' }),
  // ---- Rifles
  W({ id: 'sr4', name: 'SR-4 Carbine', category: 'rifle', slot: 'primary', price: 2900, ammo: 'rifle', mag: 30, reserve: 90, damage: 33, pellets: 1, rps: 11, auto: true, spread: 0.055, aimSpread: 0.014, recoil: 0.02, recover: 0.9, reload: 3.0, range: 45, pen: 0.72, noise: 24, move: 0.95, lookAhead: 5, desc: 'The operator standard. Accurate, controllable, lethal.' }),
  W({ id: 'sr4s', name: 'SR-4S Suppressed', category: 'rifle', slot: 'primary', price: 2900, ammo: 'rifle', mag: 20, reserve: 80, damage: 36, pellets: 1, rps: 9.5, auto: true, spread: 0.05, aimSpread: 0.012, recoil: 0.017, recover: 0.95, reload: 3.0, range: 45, pen: 0.7, noise: 7, move: 0.95, lookAhead: 5, desc: 'Integrally suppressed carbine. Keeps patrols guessing.' }),
  W({ id: 'aro', name: 'AR-Optic Bullpup', category: 'rifle', slot: 'primary', price: 3300, ammo: 'rifle', mag: 30, reserve: 90, damage: 31, pellets: 1, rps: 11, auto: true, spread: 0.056, aimSpread: 0.009, recoil: 0.019, recover: 0.9, reload: 3.4, range: 52, pen: 0.8, noise: 24, move: 0.93, lookAhead: 8, desc: 'Magnified optic rifle. Aiming extends your sightline.' }),
  W({ id: 'fb25', name: 'FB-25 Burst Rifle', category: 'rifle', slot: 'primary', price: 2050, ammo: 'rifle', mag: 25, reserve: 75, damage: 30, pellets: 1, rps: 13, auto: false, burst: 3, spread: 0.058, aimSpread: 0.016, recoil: 0.018, recover: 0.95, reload: 3.1, range: 42, pen: 0.7, noise: 24, move: 0.96, lookAhead: 4.5, desc: 'Three-round burst. Economical and precise.' }),
  // ---- Sniper / marksman
  W({ id: 'scout8', name: 'Scout-8 Light Bolt', category: 'sniper', slot: 'primary', price: 1700, ammo: 'sniper', mag: 10, reserve: 30, damage: 88, pellets: 1, rps: 0.8, auto: false, spread: 0.09, aimSpread: 0.003, recoil: 0.05, recover: 1.2, reload: 2.9, range: 70, pen: 0.85, noise: 28, move: 1, lookAhead: 10, desc: 'Featherweight bolt-action. Move fast, shoot once.' }),
  W({ id: 'vg338', name: 'Vanguard .338 Magnum', category: 'sniper', slot: 'primary', price: 3500, ammo: 'sniper', mag: 5, reserve: 20, damage: 160, pellets: 1, rps: 0.68, auto: false, spread: 0.14, aimSpread: 0.002, recoil: 0.08, recover: 1.1, reload: 3.6, range: 80, pen: 0.97, noise: 34, move: 0.84, lookAhead: 12, desc: 'Magnum bolt rifle. Deletes cyborg plating in one shot.' }),
  W({ id: 'dmr20', name: 'DMR-20 Marksman', category: 'sniper', slot: 'primary', price: 3600, ammo: 'sniper', mag: 20, reserve: 40, damage: 72, pellets: 1, rps: 4, auto: false, spread: 0.09, aimSpread: 0.005, recoil: 0.06, recover: 0.8, reload: 3.6, range: 70, pen: 0.88, noise: 30, move: 0.86, lookAhead: 10, desc: 'Semi-auto battle marksman rifle.' }),
  // ---- Machine guns
  W({ id: 'lmg249', name: 'Suppressor-249 LMG', category: 'machine_gun', slot: 'primary', price: 3800, ammo: 'rifle', mag: 100, reserve: 100, damage: 32, pellets: 1, rps: 13, auto: true, spread: 0.075, aimSpread: 0.03, recoil: 0.012, recover: 0.7, reload: 5.7, range: 45, pen: 0.75, noise: 26, move: 0.8, lookAhead: 5, desc: 'Belt-fed squad automatic. Suppress the hallway.' }),
  W({ id: 'gp762', name: 'Bulwark GPMG', category: 'machine_gun', slot: 'primary', price: 3400, ammo: 'rifle', mag: 120, reserve: 120, damage: 29, pellets: 1, rps: 14, auto: true, spread: 0.085, aimSpread: 0.035, recoil: 0.011, recover: 0.7, reload: 5.2, range: 42, pen: 0.7, noise: 26, move: 0.82, lookAhead: 5, desc: 'Light general-purpose MG. Accurate after the first burst.' }),
  // ---- Enemy integrated (not droppable)
  W({ id: 'drone_gun', name: 'Drone Carbine', category: 'integrated', slot: 'primary', price: 0, ammo: 'internal', mag: 999, reserve: 0, damage: 12, pellets: 1, rps: 6, auto: true, spread: 0.07, aimSpread: 0.07, recoil: 0, recover: 1, reload: 1, range: 22, pen: 0.4, noise: 14, move: 1, lookAhead: 0, desc: '', droppable: false }),
  W({ id: 'warden_mg', name: 'Warden Rotary', category: 'integrated', slot: 'primary', price: 0, ammo: 'internal', mag: 999, reserve: 0, damage: 18, pellets: 1, rps: 9, auto: true, spread: 0.09, aimSpread: 0.09, recoil: 0, recover: 1, reload: 1, range: 30, pen: 0.6, noise: 30, move: 1, lookAhead: 0, desc: '', droppable: false }),
  W({ id: 'bite', name: 'Bite', category: 'integrated', slot: 'primary', price: 0, ammo: 'internal', mag: 999, reserve: 0, damage: 14, pellets: 1, rps: 1.4, auto: true, spread: 0, aimSpread: 0, recoil: 0, recover: 1, reload: 1, range: 1.4, pen: 0.2, noise: 6, move: 1, lookAhead: 0, desc: '', droppable: false }),
];

export const WEAPON_BY_ID: Record<string, WeaponDef> = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export function weapon(id: string): WeaponDef {
  const w = WEAPON_BY_ID[id];
  if (!w) throw new Error(`unknown weapon ${id}`);
  return w;
}

export const AMMO_NAMES: Record<AmmoType, string> = {
  pistol: '9mm', heavy: '.50 Magnum', smg: '.45 ACP', rifle: '5.56 NATO', sniper: '.338 Mag', shell: '12 Gauge', internal: '-',
};
/** Base reserve carry caps per ammo type (Ammo Pouch adds 50%). */
export const AMMO_CAP: Record<AmmoType, number> = {
  pistol: 120, heavy: 42, smg: 200, rifle: 240, sniper: 40, shell: 40, internal: 0,
};

export const KNIFE = { damage: 55, backstab: 400, range: 1.7, arc: 1.2, cooldown: 0.55, noise: 2 };

export const CATEGORY_LABEL: Record<WeaponCategory, string> = {
  pistol: 'Pistols', heavy_pistol: 'Heavy Pistols', smg: 'SMGs', shotgun: 'Shotguns', rifle: 'Rifles', sniper: 'Sniper / Marksman', machine_gun: 'Machine Guns', integrated: '',
};
