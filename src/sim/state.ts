import type { AmmoType } from '../config/weapons';
import type { GrenadeType, ItemType } from '../config/items';
import type { FloorLayout, SpawnSpec } from '../gen/floor';
import type { ContainerKind } from '../gen/loot';
import type { EnemyType, LootItem } from './types';

export type Mode = 'single' | 'coop';
export type PlayerLife = 'alive' | 'down' | 'out';
export type SlotName = 'primary' | 'secondary' | 'knife';

export interface WeaponInst { id: string; mag: number }

/** Input for one player for one tick. Held states are booleans; presses are monotonic counters. */
export interface PlayerInput {
  mx: number; my: number;
  ax: number; ay: number;
  /** aim point height in metres (0 = floor). NaN = flat shot at gun height (gamepad / legacy). */
  az: number;
  fire: boolean; aim: boolean; sprint: boolean; crouch: boolean; interact: boolean;
  jump: number; reload: number; melee: number; use: number; swap: number; grenade: number;
  cycleGrenade: number; cycleItem: number; torch: number; ping: number; medkit: number; battery: number;
  slot: number; slotSeq: number;
  /** elevator destination chosen from the panel (0 = none) */
  elevTo: number; elevSeq: number;
  /** belt quick-use: item index 1..5 (medkit, battery, plate, drink, food) */
  useItem: number; useItemSeq: number;
  /** belt selection from the mouse wheel: index 0..4 */
  selItem: number; selItemSeq: number;
  /** stair choice: 1 = up, -1 = down */
  stairDir: number; stairSeq: number;
  /** hacking minigame result for terminal hackId: 1 = access granted, 0 = traced (seq = press counter) */
  hackId: number; hackOk: number; hackSeq: number;
  /** closes a UI panel the sim opened (NPC conversation) */
  closeSeq: number;
}
export function emptyInput(): PlayerInput {
  return {
    mx: 0, my: 0, ax: 0, ay: 0, az: NaN, fire: false, aim: false, sprint: false, crouch: false, interact: false,
    jump: 0, reload: 0, melee: 0, use: 0, swap: 0, grenade: 0, cycleGrenade: 0, cycleItem: 0, torch: 0, ping: 0, medkit: 0, battery: 0,
    slot: -1, slotSeq: 0, useItem: 0, useItemSeq: 0, selItem: 0, selItemSeq: 0, elevTo: 0, elevSeq: 0, stairDir: 0, stairSeq: 0, hackId: 0, hackOk: 0, hackSeq: 0, closeSeq: 0,
  };
}

export interface Loadout {
  primary: string | null;
  secondary: string;
  armor: 'none' | 'vest' | 'vesthelm';
  grenades: Partial<Record<GrenadeType, number>>;
  items: Partial<Record<ItemType, number>>;
  mods: { bypass: boolean; torchmod: boolean; pouch: boolean };
}

export interface PlayerState {
  id: number;
  slot: number; // join order 0..4
  name: string;
  connected: boolean;
  floor: number;
  x: number; y: number; vx: number; vy: number;
  z: number; vz: number;
  facing: number;
  aimX: number; aimY: number; aimZ: number;
  hp: number; armor: number; helmet: boolean;
  injured: boolean;
  life: PlayerLife;
  downT: number;
  crouch: boolean; sprinting: boolean; aiming: boolean; moving: boolean;
  weapons: { primary: WeaponInst | null; secondary: WeaponInst | null };
  sel: SlotName; lastSel: SlotName;
  ammo: Record<AmmoType, number>;
  grenades: Record<GrenadeType, number>;
  grenadeSel: GrenadeType;
  items: Record<ItemType, number>;
  itemSel: ItemType;
  mods: { bypass: boolean; torchmod: boolean; pouch: boolean };
  torchOn: boolean; battery: number;
  boostT: number;
  fireCd: number; reloadT: number; /** length of the current reload (auto-reload is shorter than the weapon's) */ reloadDur?: number; burstLeft: number; bloom: number; meleeCd: number; triggerHeld: boolean;
  muzzleT: number; stepT: number;
  burnT: number; flashT: number; hurtT: number;
  /** current hold-interaction */
  hold: { key: string; t: number; need: number; label: string } | null;
  /** elevator ride pending */
  ride: { t: number; to: number; elev: number } | null;
  exposure: number;
  kills: number;
  input: PlayerInput;
  last: PlayerInput; // last processed press counters
  prompt: string;
  /** developer test flags (?dev=1&god=1&ammo=1) */
  cheats?: { god?: boolean; ammo?: boolean; torch?: boolean };
  /** single player: checked in with Police Chief Hollis at the street tent (name registered, armory unlocked, tower open) */
  checkedIn?: boolean;
  /** the loadout bought at the armory (re-editable while still on the street) */
  loadout?: Loadout;
}

export type AiState = 'idle' | 'patrol' | 'guard' | 'sleep' | 'wander' | 'suspicious' | 'investigate' | 'alert' | 'search' | 'dead';

export interface Enemy {
  id: number;
  type: EnemyType;
  elite: boolean;
  x: number; y: number; facing: number;
  vx: number; vy: number;
  hp: number; maxHp: number; armor: number;
  state: AiState;
  prevState: AiState;
  aware: number;
  target: number; // player id or -1
  lastKnownX: number; lastKnownY: number; lastSeenT: number;
  interestX: number; interestY: number;
  path: { x: number; y: number }[] | null;
  pathGoalX: number; pathGoalY: number; pathT: number;
  route: { x: number; y: number }[]; routeI: number;
  homeX: number; homeY: number; homeFacing: number;
  squad: number;
  weapon: string; mag: number;
  fireCd: number; reloadT: number; burstLeft: number;
  stateT: number; thinkT: number;
  coverX: number; coverY: number; hasCover: boolean;
  flankSide: number;
  flashT: number; stunT: number;
  pushing: boolean;
  barkT: number;
  deadT: number;
  anim: number; // walk cycle phase
  shotT: number; // time since last shot (render muzzle)
  seenBy: number; // bitmask of player slots that currently see it (for replication hints)
  spawnWave: boolean;
}

export interface CameraState {
  id: number; x: number; y: number; baseAngle: number; sweep: number; speed: number; phase: number; range: number; fov: number;
  angle: number; alive: boolean; detect: number; alarmT: number; hp: number;
}
export interface TrapState { id: number; kind: 'tripwire' | 'mine'; x: number; y: number; x2: number; y2: number; armed: boolean; revealed: boolean; fuse: number }
export interface ContainerState { id: number; kind: ContainerKind; x: number; y: number; items: LootItem[]; opened: boolean; label: string }
export interface VendingState { id: number; x: number; y: number; rot: number; hp: number; broken: boolean; drops: LootItem[] }
export interface HazardState { id: number; kind: 'fire' | 'shock'; x: number; y: number; r: number }
export interface Grenade { id: number; kind: GrenadeType; x: number; y: number; z: number; vx: number; vy: number; vz: number; fuse: number; owner: number; rest: boolean }
export interface Zone { id: number; kind: 'smoke' | 'fire' | 'decoy'; x: number; y: number; r: number; t: number; tick: number }
export interface Ping { id: number; enemyId: number; x: number; y: number; by: number; t: number }
/** off: switched off at a breaker panel (E toggles it); cut: the panel was shot out, dark for good. */
export interface LightState { broken: boolean; burstT: number; off?: boolean; cut?: boolean }
/** Wall breaker panel. rooms = its own room plus every adjacent room; dead once shot. */
export interface PanelState { id: number; x: number; y: number; rooms: number[]; dead: boolean; off: boolean }
export interface HackState { id: number; kind: 'security' | 'lights'; x: number; y: number; state: 'ready' | 'done' | 'locked' }

export interface FloorState {
  floor: number;
  L: FloorLayout;
  enemies: Enemy[];
  cameras: CameraState[];
  traps: TrapState[];
  containers: ContainerState[];
  vendings: VendingState[];
  hazards: HazardState[];
  grenades: Grenade[];
  zones: Zone[];
  pings: Ping[];
  lights: LightState[];
  panels: PanelState[];
  hacks: HackState[];
  /** lighting computer hacked: no flicker, no dead bulbs, no darkness */
  lightsFixed: boolean;
  /** street NPCs: seconds each officer (by npc index) has spent paused in conversation, and who is talking now */
  npcHold: Record<number, number>;
  npcTalk: number[];
  /** accumulated progress for debris clearing keyed by stairwell index */
  debris: Record<number, number>;
  wave: { active: boolean; t: number; spawnT: number; spawned: number } | null;
  scareT: number;
  networkAlertT: number;
}

export type SimEvent =
  | { e: 'shot'; f: number; x: number; y: number; x2: number; y2: number; z?: number; z2?: number; w: string; src: 'p' | 'e'; id: number; hit: 'wall' | 'flesh' | 'metal' | 'none' | 'glass' | 'floor' }
  | { e: 'explode'; f: number; x: number; y: number; r: number; kind: string }
  | { e: 'die'; f: number; id: number; t: string; x: number; y: number }
  | { e: 'hurt'; f: number; pid: number; dmg: number; armor: boolean }
  | { e: 'hitE'; f: number; id: number; x: number; y: number; metal: boolean }
  | { e: 'bark'; f: number; id: number; t: string; k: 'alert' | 'suspicious' | 'search' | 'pain' | 'die' | 'idle' }
  | { e: 'cctv'; f: number; id: number; k: 'alarm' | 'destroyed' | 'spot' }
  | { e: 'vend'; f: number; id: number; x: number; y: number }
  | { e: 'msg'; pid: number; text: string; k: 'info' | 'warn' | 'good' | 'loot' }
  | { e: 'travel'; pid: number; from: number; to: number; via: string }
  | { e: 'melee'; f: number; x: number; y: number; hit: boolean; pid: number }
  | { e: 'reload'; f: number; pid: number; w: string }
  | { e: 'hack'; f: number; id: number; kind: 'security' | 'lights'; ok: boolean; x: number; y: number }
  | { e: 'dry'; f: number; pid: number }
  | { e: 'throw'; f: number; pid: number; x: number; y: number }
  | { e: 'bounce'; f: number; x: number; y: number }
  | { e: 'stinger'; f: number; k: 'alert' | 'scare' | 'upload' | 'victory' | 'death' | 'floor' | 'wave' }
  | { e: 'scare'; f: number; k: 'lightburst' | 'slam' | 'scream' | 'shadow' | 'whisper' | 'metal'; x: number; y: number; lid?: number }
  | { e: 'trap'; f: number; id: number; k: 'reveal' | 'trigger' | 'disarm' | 'beep' }
  | { e: 'elev'; f: number; k: 'ding' | 'dead' | 'open'; x: number; y: number }
  | { e: 'use'; f: number; pid: number; item: string }
  | { e: 'revive'; f: number; pid: number; by: number }
  | { e: 'down'; f: number; pid: number }
  | { e: 'out'; pid: number }
  | { e: 'noise'; f: number; x: number; y: number; r: number };

export function makeEnemy(id: number, s: SpawnSpec, floor: number, statsFor: (s: SpawnSpec, floor: number) => { hp: number; armor: number }): Enemy {
  const st = statsFor(s, floor);
  const state = s.behavior === 'sleep' ? 'sleep' : s.behavior === 'guard' ? 'guard' : s.behavior === 'wander' ? 'wander' : 'patrol';
  return {
    id, type: s.type, elite: s.elite, x: s.x, y: s.y, facing: ((id * 2.39996) % 6.283) - Math.PI, vx: 0, vy: 0,
    hp: st.hp, maxHp: st.hp, armor: st.armor, state, prevState: state, aware: 0, target: -1,
    lastKnownX: s.x, lastKnownY: s.y, lastSeenT: -99, interestX: s.x, interestY: s.y,
    path: null, pathGoalX: 0, pathGoalY: 0, pathT: 0, route: s.route, routeI: 0,
    homeX: s.x, homeY: s.y, homeFacing: 0, squad: s.squad, weapon: s.weapon, mag: 0,
    fireCd: 0, reloadT: 0, burstLeft: 0, stateT: 0, thinkT: (id % 10) * 0.05, coverX: 0, coverY: 0, hasCover: false,
    flankSide: id % 2 ? 1 : -1, flashT: 0, stunT: 0, pushing: false, barkT: 0, deadT: 0, anim: 0, shotT: 9, seenBy: 0, spawnWave: false,
  };
}
