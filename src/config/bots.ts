import type { PlayerLook } from './look';
import type { GrenadeType, ItemType } from './items';
import type { Loadout } from '../sim/state';

/** Single-player squadmates (sim/bot.ts). Data only: classes, kit pools, names, ranks, the four squad members. */
export type BotClass = 'rifleman' | 'breacher' | 'gunner' | 'commando' | 'marksman' | 'grenadier' | 'medic' | 'recon';
export const BOT_CLASSES: BotClass[] = ['rifleman', 'breacher', 'gunner', 'commando', 'marksman', 'grenadier', 'medic', 'recon'];

/**
 * primary/secondary/armor/grenades: pools the kit is picked from (RNG); null primary = sidearm only.
 * range: preferred fighting distance [min, max] in metres. nades: grenade types it throws in a fight, in order.
 * lead: moves ahead of the commander; rear: hangs back. holdFire: stays put while firing.
 * aimFirst: only fires while stationary and aiming. burst: [seconds firing, seconds pause].
 * pings: marks every enemy it sees. medic: revives first and hands the commander Health Kits. knife: knifes unaware enemies.
 */
export interface BotClassDef {
  name: string; desc: string;
  primary: (string | null)[]; secondary: string[]; armor: Loadout['armor'][]; suppressor: boolean;
  grenades: Partial<Record<GrenadeType, number>>[]; items: Partial<Record<ItemType, number>>;
  range: [number, number]; nades: GrenadeType[];
  lead: boolean; rear: boolean; holdFire: boolean; aimFirst: boolean; burst: [number, number];
  pings: boolean; medic: boolean; knife: boolean;
}
const base = { suppressor: false, lead: false, rear: false, holdFire: false, aimFirst: false, burst: [0.8, 0.35] as [number, number], pings: false, medic: false, knife: false };
export const BOT_CLASS: Record<BotClass, BotClassDef> = {
  rifleman: { ...base, name: 'Rifleman', desc: 'All-rounder. Stays close and covers your arc at mid range.', primary: ['sr4', 'fb25', 'aro'], secondary: ['p9', 'm18'], armor: ['vesthelm', 'vest'], grenades: [{ frag: 2 }, { frag: 1, smoke: 1 }], items: { medkit: 1, battery: 1 }, range: [6, 18], nades: ['frag'] },
  breacher: { ...base, name: 'Breacher', desc: 'Goes through doors first. Shotgun and flashbangs, heavy armour.', primary: ['br12', 'mag12', 'a12'], secondary: ['p9', 'm18'], armor: ['vesthelm'], grenades: [{ flash: 2, frag: 1 }, { flash: 3 }], items: { medkit: 1, plate: 1 }, range: [1.5, 7], nades: ['flash', 'frag'], lead: true },
  gunner: { ...base, name: 'Gunner', desc: 'Machine gun. Holds a spot and pins enemies with long bursts.', primary: ['lmg249', 'gp762'], secondary: ['p9'], armor: ['vesthelm'], grenades: [{ frag: 1 }], items: { medkit: 1, plate: 1 }, range: [5, 20], nades: ['frag'], holdFire: true, burst: [1.8, 0.6] },
  commando: { ...base, name: 'Commando', desc: 'Suppressed and quiet. Flanks, knifes unaware targets.', primary: [null, 'k45', 'mpx9', 'vx45'], secondary: ['m18', 'fs7', 'ap18'], armor: ['vest', 'none'], suppressor: true, grenades: [{ decoy: 1, smoke: 1 }, { smoke: 2 }], items: { medkit: 1, battery: 1 }, range: [2, 10], nades: ['decoy'], knife: true },
  marksman: { ...base, name: 'Marksman', desc: 'Sniper. Hangs back, holds long sight lines, shots pierce.', primary: ['scout8', 'vg338', 'dmr20'], secondary: ['m18', 'hc50'], armor: ['vest'], grenades: [{ smoke: 1 }], items: { medkit: 1 }, range: [12, 40], nades: [], rear: true, aimFirst: true, burst: [0.2, 0.9] },
  grenadier: { ...base, name: 'Grenadier', desc: 'Frags and incendiaries for groups and enemies behind cover.', primary: ['fb25', 'br12', 'k45'], secondary: ['p9'], armor: ['vest'], grenades: [{ frag: 2, incendiary: 1 }, { frag: 1, incendiary: 2 }], items: { medkit: 1 }, range: [6, 16], nades: ['incendiary', 'frag'] },
  medic: { ...base, name: 'Medic', desc: 'Extra Health Kits. Revives first and hands you a kit when you run low.', primary: ['k45', 'mpx9'], secondary: ['p9', 'm18'], armor: ['vest'], grenades: [{ smoke: 2 }], items: { medkit: 3 }, range: [5, 14], nades: [], medic: true },
  recon: { ...base, name: 'Recon', desc: 'Scouts ahead and marks every enemy it sees. Decoys and smoke.', primary: ['sr4s', 'fb25'], secondary: ['m18'], armor: ['vest', 'none'], suppressor: true, grenades: [{ decoy: 2, smoke: 1 }], items: { medkit: 1, battery: 2 }, range: [8, 22], nades: ['decoy'], lead: true, pings: true },
};

export const BOT_RANKS = ['Major', 'Captain', 'Lieutenant', 'Warrant Officer', 'Sergeant Major', 'Sergeant', 'Corporal', 'Private', 'Marine', 'Trooper', 'Operator'];

export const BOT_NAMES = [
  'Vance', 'Okafor', 'Moreau', 'Kaminski', 'Delgado', 'Sato', 'Mensah', 'Holt', 'Volkov', 'Achebe', 'Lindgren', 'Navarro', 'Tanaka', 'Mwangi',
  'Brennan', 'Kovac', 'Silva', 'Osei', 'Larsen', 'Quinn', 'Rahman', 'Ortega', 'Fischer', 'Nkemelu', 'Doyle', 'Takahashi', 'Bianchi', 'Asante',
  'Kerr', 'Moreno', 'Yilmaz', 'Okonkwo', 'Strand', 'Patel', 'Rourke', 'Dubois', 'Kim', 'Varga', 'Abiodun', 'Hale', 'Romero', 'Novotny', 'Eze',
  'Sorensen', 'Kaur', 'Maddox', 'Ruiz', 'Hoffmann', 'Boateng', 'Grady', 'Ishikawa', 'Pereira', 'Mbatha', 'Kessler', 'Shah', 'Fontaine', 'Cruz',
  'Nowak', 'Adeyemi', 'Rhodes', 'Bergstrom', 'Mendes', 'Okoye', 'Byrne', 'Kuznetsov', 'Vargas', 'Tembo', 'Archer', 'Yamamoto', 'Costa', 'Kariuki',
  'Vasquez', 'Hartmann', 'Owusu', 'Locke', 'Jansen', 'Morales', 'Diallo', 'Pryce', 'Horvat', 'Ibarra', 'Nakata', 'Wilde', 'Ndlovu', 'Sinclair',
  'Kurtz', 'Salazar', 'Amadi', 'Falk', 'Oyelaran', 'Reid', 'Marchetti', 'Ulloa', 'Banda', 'Thorne', 'Halvorsen', 'Acosta', 'Obi', 'Keane', 'Calloway',
];

/** The four squad members: fixed photo portrait (public/portraits/) and a matching in-game look. 1 and 3 men, 2 and 4 women. */
export const SQUAD_MEMBERS: { portrait: string; look: PlayerLook }[] = [
  { portrait: 'squad1.png', look: { skin: 6, h: 75, s: 0.18, l: 0.26, camo: 'woodland', contrast: 0.6, balaclava: false } },
  { portrait: 'squad2.png', look: { skin: 1, h: 210, s: 0.06, l: 0.34, camo: 'urban', contrast: 0.5, balaclava: false } },
  { portrait: 'squad3.png', look: { skin: 0, h: 38, s: 0.3, l: 0.42, camo: 'desert', contrast: 0.45, balaclava: false } },
  { portrait: 'squad4.png', look: { skin: 4, h: 95, s: 0.25, l: 0.28, camo: 'tiger', contrast: 0.6, balaclava: false } },
];
