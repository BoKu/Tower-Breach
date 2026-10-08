import { Rng, hash } from '../core/rng';
import { BOT_CLASS, BOT_CLASSES, BOT_NAMES, BOT_RANKS, type BotClass } from '../config/bots';
import { validLoadout, emptyLoadout } from './loadout';
import type { Difficulty } from '../config/difficulty';
import type { BotInfo, Loadout, PlayerState, PlayerInput, FloorState, ContainerState, Enemy } from './state';
import type { Sim } from './sim';
import type { LootItem } from './types';
import { dist, angleTo, segPointDist } from '../core/math';
import { findPath, nearestWalkable } from './nav';
import { canSee, setDoor } from './combat';
import { currentWeapon, giveLoot } from './inventory';
import { weapon, AMMO_CAP } from '../config/weapons';
import { idx, S_DOOR, pointsNear, isWalkableTile } from '../gen/floor';
import type { GrenadeType } from '../config/items';

/** A squad slot choice on the Squad screen: a class, 'random', or null (empty slot). */
export type SquadPick = BotClass | 'random' | null;

/**
 * Identities for the filled slots: surname and rank unique within the squad (own RNG stream; the run's RNG is untouched).
 * All four members' names and ranks are drawn first, so a member keeps them whatever the other slots hold
 * (the Squad screen shows them before deploy, from the same seed).
 */
export function makeSquad(seed: number, picks: SquadPick[]): BotInfo[] {
  const rng = new Rng(hash(seed, 0xb075));
  const names = [...BOT_NAMES], ranks = [...BOT_RANKS];
  const take = <T>(a: T[]) => a.splice(Math.floor(rng.next() * a.length), 1)[0];
  const ids = [0, 1, 2, 3].map(() => ({ rank: take(ranks), surname: take(names) }));
  const out: BotInfo[] = [];
  picks.slice(0, 4).forEach((pick, member) => {
    if (!pick) return;
    out.push({ cls: pick === 'random' ? rng.pick(BOT_CLASSES) : pick, ...ids[member], member });
  });
  return out;
}

/** Free kit for a class: weapons, armour and grenades from the class pools, then trimmed until it passes the armory rules. */
export function botKit(cls: BotClass, diff: Difficulty, rng: Rng): Loadout {
  const d = BOT_CLASS[cls];
  const lo: Loadout = {
    ...emptyLoadout(),
    primary: rng.pick(d.primary), secondary: rng.pick(d.secondary), armor: rng.pick(d.armor),
    grenades: { ...rng.pick(d.grenades) }, items: { ...d.items },
    mods: { bypass: false, torchmod: false, pouch: false, suppressor: d.suppressor },
  };
  // over budget: drop items, then grenades, then armour, until valid (the weapons are the class)
  const trims: (() => boolean)[] = [
    () => dec(lo.items, 'plate') || dec(lo.items, 'battery'),
    () => dec(lo.grenades, firstKey(lo.grenades)),
    () => (lo.armor === 'vesthelm' ? ((lo.armor = 'vest'), true) : false),
    () => (lo.items.medkit ?? 0) > 1 && dec(lo.items, 'medkit'),
    () => (lo.armor === 'vest' ? ((lo.armor = 'none'), true) : false),
  ];
  for (const t of trims) while (!validLoadout(lo, diff) && t());
  return lo;
}
const firstKey = (o: Partial<Record<GrenadeType, number>>) => (Object.keys(o) as GrenadeType[]).find((k) => (o[k] ?? 0) > 0);
function dec<K extends string>(o: Partial<Record<K, number>>, k: K | undefined): boolean {
  if (!k || !o[k]) return false;
  o[k] = o[k]! - 1;
  if (!o[k]) delete o[k];
  return true;
}


// ------------------------------------------------------------------ the brain
/** Per-bot working memory (not saved: rebuilt on load). */
interface Brain {
  path: { x: number; y: number }[] | null; pathT: number; gx: number; gy: number;
  progT: number; px: number; py: number; stuck: number; jumpCd: number; jumpT: number;
  anchorX: number; anchorY: number; slotX: number; slotY: number;
  reviveT: number; reviveId: number;
  /** tiles this bot got stuck on (costed up in its paths) */
  avoid: Set<number>;
  targetId: number; react: number; burst: number; nadeCd: number; pingCd: number; giftCd: number; lastShotT: number;
}
const brains = new WeakMap<PlayerState, Brain>();
function brainOf(p: PlayerState): Brain {
  let b = brains.get(p);
  if (!b) {
    b = { path: null, pathT: 0, gx: 0, gy: 0, progT: 0, px: p.x, py: p.y, stuck: 0, jumpCd: 0, jumpT: 0, anchorX: NaN, anchorY: NaN, slotX: p.x, slotY: p.y,
      reviveT: 0, reviveId: -1, avoid: new Set(), targetId: -1, react: 0, burst: 0, nadeCd: 2, pingCd: 0, giftCd: 0, lastShotT: -99 };
    brains.set(p, b);
  }
  return b;
}

const SLOTS = ['primary', 'secondary', 'knife'] as const;
function selectSlot(inp: PlayerInput, s: (typeof SLOTS)[number]) { inp.slot = SLOTS.indexOf(s); inp.slotSeq++; }

/** Path cost for bots: steer around revealed armed traps, burning ground and tiles the bot got stuck on. */
export function pathCost(fs: FloorState, avoid: Set<number>) {
  const traps = fs.traps.filter((t) => t.armed && t.revealed);
  const fires = fs.zones.filter((z) => z.kind === 'fire');
  return (tx: number, ty: number): number => {
    const x = tx + 0.5, y = ty + 0.5;
    if (avoid.has(idx(tx, ty))) return 25;
    for (const t of traps) if (segPointDist(t.x, t.y, t.x2, t.y2, x, y) < (t.kind === 'mine' ? 1.6 : 0.9)) return 60;
    for (const z of fires) if (dist(z.x, z.y, x, y) < z.r + 0.6) return 60;
    return 0;
  };
}

/** Moves along a path toward (gx, gy); opens shut doors on the way like the enemy AI. Returns true on arrival. */
function moveTo(sim: Sim, fs: FloorState, p: PlayerState, b: Brain, gx: number, gy: number, dt: number, sprint = false): boolean {
  if (dist(p.x, p.y, gx, gy) < 0.6) { b.path = null; b.stuck = 0; return true; }
  b.pathT -= dt;
  if (!b.path || b.pathT <= 0 || dist(b.gx, b.gy, gx, gy) > 1.5) {
    b.path = findPath(fs.L, p.x, p.y, gx, gy, pathCost(fs, b.avoid), 2500, true);
    b.pathT = 0.5; b.gx = gx; b.gy = gy;
  }
  while (b.path && b.path.length > 1 && dist(p.x, p.y, b.path[0].x, b.path[0].y) < 0.4) b.path.shift();
  const wp = b.path?.[0];
  const tx = wp ? wp.x : gx, ty = wp ? wp.y : gy;
  if (wp) {
    const wi = idx(Math.floor(wp.x), Math.floor(wp.y));
    if (fs.L.solid[wi] === S_DOOR && dist(p.x, p.y, wp.x, wp.y) < 1.3) {
      const di = fs.L.doors.findIndex((d) => d.tiles.includes(wi));
      if (di >= 0 && fs.doors[di].state === 'closed') setDoor(sim, fs, di, 'open', 4, p);
    }
  }
  const a = angleTo(p.x, p.y, tx, ty);
  p.input.mx = Math.cos(a); p.input.my = Math.sin(a);
  p.input.sprint = sprint;
  unstick(sim, fs, p, b, dt);
  return false;
}

/** No progress: jump (low obstacles), then re-plan, then warp beside the commander. */
function unstick(sim: Sim, fs: FloorState, p: PlayerState, b: Brain, dt: number) {
  b.jumpCd -= dt;
  b.progT += dt;
  if (b.progT < 0.4) return;
  const moved = dist(p.x, p.y, b.px, b.py);
  b.px = p.x; b.py = p.y; b.progT = 0;
  if (moved > 0.15) { b.stuck = 0; return; }
  b.stuck += 0.4;
  if (b.jumpCd <= 0) { p.input.jump++; b.jumpCd = 1; b.jumpT = 0.3; } // standing up for it: see the end of botThink
  if (b.stuck >= 1.5) { // re-plan around the blocker: the tile it is pushing into
    b.avoid.add(idx(Math.floor(p.x + p.input.mx * 0.7), Math.floor(p.y + p.input.my * 0.7)));
    if (b.avoid.size > 24) b.avoid.delete(b.avoid.values().next().value!);
    b.path = null; b.pathT = 0;
  }
  if (b.stuck >= 4) { const me = sim.human(); if (me) warpNear(fs, p, me); b.stuck = 0; }
}

function warpNear(fs: FloorState, p: PlayerState, me: PlayerState) {
  const spot = pointsNear(fs.L, me.x, me.y, 8).find((q) => dist(q.x, q.y, me.x, me.y) > 0.8) ?? { x: me.x, y: me.y };
  p.x = spot.x; p.y = spot.y; p.vx = p.vy = 0; p.z = 0; p.vz = 0;
  brainOf(p).path = null;
}

/** Formation slot around the commander, re-anchored only when they move 1.5 m (so it doesn't swing with their aim). */
function slotFor(fs: FloorState, p: PlayerState, b: Brain, me: PlayerState): { x: number; y: number } {
  if (!(dist(me.x, me.y, b.anchorX, b.anchorY) < 1.5)) {
    const heading = Number.isNaN(b.anchorX) ? me.facing : angleTo(b.anchorX, b.anchorY, me.x, me.y);
    b.anchorX = me.x; b.anchorY = me.y;
    const d = BOT_CLASS[p.bot!.cls];
    let [back, side] = ([[-2.2, 1.4], [-2.2, -1.4], [-3.4, 1.9], [-3.4, -1.9]] as const)[p.bot!.member] as [number, number];
    if (d.lead) back = 2.4; else if (d.rear) back -= 1.8;
    let x = me.x + Math.cos(heading) * back - Math.sin(heading) * side;
    let y = me.y + Math.sin(heading) * back + Math.cos(heading) * side;
    if (!isWalkableTile(fs.L, Math.floor(x), Math.floor(y))) {
      const n = nearestWalkable(fs.L, x, y, 3);
      if (n) { x = n.tx + 0.5; y = n.ty + 0.5; } else { x = me.x; y = me.y; }
    }
    b.slotX = x; b.slotY = y;
  }
  return { x: b.slotX, y: b.slotY };
}

/** Who to revive: the commander, then the bot closest to bleeding out. */
function reviveTarget(sim: Sim, p: PlayerState): PlayerState | null {
  if (p.items.medkit <= 0) return null;
  const downs = sim.players.filter((o) => o !== p && o.life === 'down' && o.floor === p.floor);
  return downs.find((o) => !o.bot) ?? downs.sort((a, c) => a.downT - c.downT)[0] ?? null;
}

/** Ammo for its own guns and medical supplies; never weapons, keys, coins or grenades. */
function wants(p: PlayerState, it: LootItem): boolean {
  if (it.k === 'ammo') return [p.weapons.primary, p.weapons.secondary].some((w) => w && weapon(w.id).ammo === it.ammo) && p.ammo[it.ammo] < AMMO_CAP[it.ammo];
  if (it.k === 'item') return (it.item === 'medkit' || it.item === 'battery' || it.item === 'plate') && p.items[it.item] < 3;
  return false;
}
function lootTarget(fs: FloorState, p: PlayerState, me: PlayerState): ContainerState | null {
  for (const c of fs.containers) {
    if (!(c.kind === 'corpse' || c.opened)) continue; // unsearched furniture is the commander's (search points)
    if (dist(c.x, c.y, me.x, me.y) > 6 || dist(c.x, c.y, p.x, p.y) > 8) continue;
    if (c.items.some((it) => wants(p, it))) return c;
  }
  return null;
}
function takeLoot(p: PlayerState, c: ContainerState) {
  const keep: LootItem[] = [];
  for (const it of c.items) {
    if (!wants(p, it)) { keep.push(it); continue; }
    const { left } = giveLoot(p, it);
    if (left) keep.push(left);
  }
  c.items = keep;
}

/** Empty gun: switch to the other one with ammo, else the knife. Quiet moment: back to the primary, top up the magazine. */
function upkeep(p: PlayerState, inp: PlayerInput, inFight: boolean) {
  const has = (s: 'primary' | 'secondary') => { const w = p.weapons[s]; return !!w && w.mag + p.ammo[weapon(w.id).ammo] > 0; };
  const wi = currentWeapon(p);
  if (!wi) { if (!inFight || !BOT_CLASS[p.bot!.cls].knife) { if (has('primary')) selectSlot(inp, 'primary'); else if (has('secondary')) selectSlot(inp, 'secondary'); } return; }
  const w = weapon(wi.id);
  if (wi.mag + p.ammo[w.ammo] <= 0) { const other = p.sel === 'primary' ? 'secondary' : 'primary'; selectSlot(inp, has(other) ? other : 'knife'); return; }
  if (p.sel === 'secondary' && has('primary') && !inFight) selectSlot(inp, 'primary');
  else if (!inFight && wi.mag < w.mag * 0.5 && p.ammo[w.ammo] > 0 && p.reloadT <= 0) inp.reload++;
}

/** Fills the bot's PlayerInput for this tick (called by Sim.tick before updatePlayer). */
export function botThink(sim: Sim, p: PlayerState, dt: number) {
  const inp = p.input;
  inp.mx = 0; inp.my = 0; inp.fire = false; inp.aim = false; inp.sprint = false; inp.interact = false; inp.crouch = false; inp.az = NaN;
  const me = sim.human();
  if (p.life !== 'alive' || p.ride || !me || me.floor !== p.floor) return;
  const b = brainOf(p);
  const d = BOT_CLASS[p.bot!.cls];
  const fs = sim.floorState(p.floor);
  b.nadeCd -= dt; b.pingCd -= dt; b.giftCd -= dt;
  if (dist(p.x, p.y, me.x, me.y) > 30) { warpNear(fs, p, me); return; }
  if (me.muzzleT > 0) b.lastShotT = sim.t;
  const weaponsFree = p.floor > 0 && (fs.enemies.some((e) => e.state === 'alert') || sim.t - b.lastShotT < 4 || p.hurtT > 0);
  // default look: the commander's arc
  inp.ax = me.x + Math.cos(me.facing) * 5; inp.ay = me.y + Math.sin(me.facing) * 5;
  // torch follows the commander's; swap a flat battery
  if (p.torchOn !== me.torchOn && (p.battery > 0 || p.torchOn)) inp.torch++;
  if (p.battery < 0.1 && p.items.battery > 0) inp.battery++;
  const foe = weaponsFree ? pickTarget(sim, fs, p, me) : null;
  upkeep(p, inp, !!foe);

  // 1. revive: the commander first; another bot only once its own health is safe
  const down = reviveTarget(sim, p);
  const threat = !!foe && dist(p.x, p.y, foe.x, foe.y) < 15;
  if (down && !(down.bot && p.hp < 40) && (!threat || down.downT < 15)) {
    if (b.reviveId !== down.id) { b.reviveId = down.id; b.reviveT = 0; }
    inp.ax = down.x; inp.ay = down.y;
    if (dist(p.x, p.y, down.x, down.y) > 1.2) { b.reviveT = 0; moveTo(sim, fs, p, b, down.x, down.y, dt, true); return; }
    inp.crouch = true;
    b.reviveT += dt;
    if (b.reviveT >= 3) { sim.revive(p, down); b.reviveT = 0; b.reviveId = -1; }
    return;
  }
  b.reviveT = 0;
  // 2. heal (no enemy within 6 m); plates when armour is low and nothing is in view
  if (p.hp < 40 && p.items.medkit > 0 && !(foe && dist(p.x, p.y, foe.x, foe.y) < 6)) inp.medkit++;
  else if (p.armor < 30 && (p as any).vest && p.items.plate > 0 && !foe) { inp.useItem = 3; inp.useItemSeq++; inp.use++; }
  // medic: a kit for a commander who is hurt and out of them
  if (d.medic && b.giftCd <= 0 && me.life === 'alive' && me.hp < 35 && me.items.medkit === 0 && p.items.medkit > 0) {
    if (dist(p.x, p.y, me.x, me.y) > 2) { moveTo(sim, fs, p, b, me.x, me.y, dt, true); return; }
    p.items.medkit--; me.items.medkit++; b.giftCd = 30;
    sim.msg(me, `${p.name} hands you a Health Kit.`, 'good');
  }
  // 3. fight (Task 6)
  if (foe) { fight(sim, fs, p, b, me, foe, dt); return; }
  b.targetId = -1;
  // 4. loot ammo and medical supplies near the commander while it is quiet
  if (!weaponsFree) {
    const c = lootTarget(fs, p, me);
    if (c) { if (moveTo(sim, fs, p, b, c.x, c.y, dt) || dist(p.x, p.y, c.x, c.y) < 1.2) takeLoot(p, c); return; }
  }
  // 5. follow: keep the formation slot; crouch-walk while the commander sneaks
  const s = slotFor(fs, p, b, me);
  const far = dist(p.x, p.y, me.x, me.y) > 8;
  if (dist(p.x, p.y, s.x, s.y) > 0.8) moveTo(sim, fs, p, b, s.x, s.y, dt, far && !me.crouch);
  else { b.path = null; b.stuck = 0; b.progT = 0; b.px = p.x; b.py = p.y; }
  if (me.crouch && !far) inp.crouch = true;
  standForJump(p, b, dt);
}

/** A jump can't happen crouched: while a jump is pending the bot stands, whatever it was doing. */
function standForJump(p: PlayerState, b: Brain, dt: number) {
  if (b.jumpT > 0) { b.jumpT -= dt; p.input.crouch = false; }
}

/** Nearest dangerous enemy in sight and in range, by class: snipers go long, commandos go for the unaware, threats to the commander first. */
function pickTarget(_sim: Sim, fs: FloorState, p: PlayerState, me: PlayerState): Enemy | null {
  const wi = currentWeapon(p);
  const range = wi ? weapon(wi.id).range : 12;
  const cls = p.bot!.cls;
  let best: Enemy | null = null, bs = Infinity;
  for (const e of fs.enemies) {
    if (e.state === 'dead') continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d > range || !canSee(fs, p.x, p.y, e.x, e.y)) continue;
    let s = cls === 'marksman' ? -d : d;
    if (cls === 'commando' && e.state !== 'alert') s -= 8;
    if (e.target === me.id) s -= 4;
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}

/** True when the commander or another squadmate stands within 0.6 m of the shot line. */
function friendInLine(sim: Sim, p: PlayerState, e: Enemy): boolean {
  const d = dist(p.x, p.y, e.x, e.y);
  return sim.players.some((o) => o !== p && o.life !== 'out' && o.floor === p.floor && dist(p.x, p.y, o.x, o.y) < d && segPointDist(p.x, p.y, e.x, e.y, o.x, o.y) < 0.6);
}

/** Class grenade use: never at its own feet or near the commander. Returns true when one was thrown. */
function throwNade(fs: FloorState, p: PlayerState, me: PlayerState, e: Enemy, d: number): boolean {
  const def = BOT_CLASS[p.bot!.cls];
  if (d < 4 || d > 13 || !def.nades.length) return false;
  const cluster = fs.enemies.filter((o) => o.state !== 'dead' && dist(o.x, o.y, e.x, e.y) < 3.5).length;
  for (const g of def.nades) {
    if (p.grenades[g] <= 0) continue;
    const lethal = g === 'frag' || g === 'incendiary';
    if (lethal && (dist(me.x, me.y, e.x, e.y) < 5 || (cluster < 2 && !e.hasCover))) continue;
    if (g === 'flash' && (e.state !== 'alert' || d > 10 || dist(me.x, me.y, e.x, e.y) < 12)) continue; // a flash blinds anyone within 10 m of it
    if (g === 'decoy' && e.state === 'alert') continue;
    p.grenadeSel = g;
    p.input.ax = e.x; p.input.ay = e.y;
    p.input.grenade++;
    return true;
  }
  return false;
}

function fight(sim: Sim, fs: FloorState, p: PlayerState, b: Brain, me: PlayerState, e: Enemy, dt: number) {
  const inp = p.input;
  const def = BOT_CLASS[p.bot!.cls];
  const d = dist(p.x, p.y, e.x, e.y);
  inp.ax = e.x; inp.ay = e.y;
  if (b.targetId !== e.id) { b.targetId = e.id; b.react = 0.35 + sim.rng.next() * 0.3; } // human-like reaction time
  // commando: knife the unaware up close
  if (def.knife && e.state !== 'alert' && d < 6) {
    if (p.sel !== 'knife') selectSlot(inp, 'knife');
    if (d > 1.3) moveTo(sim, fs, p, b, e.x, e.y, dt);
    else inp.fire = !p.triggerHeld;
    return;
  }
  // position: stay within 12 m of the commander; otherwise keep the class's range
  const [lo, hi] = def.range;
  let moving = true;
  if (dist(p.x, p.y, me.x, me.y) > 12) moveTo(sim, fs, p, b, me.x, me.y, dt);
  else if (d > hi && !def.holdFire) moveTo(sim, fs, p, b, e.x, e.y, dt);
  else if (d < lo) { const a = angleTo(e.x, e.y, p.x, p.y); inp.mx = Math.cos(a); inp.my = Math.sin(a); }
  else { moving = false; inp.aim = true; inp.crouch = d > 6 || p.hurtT > 0; b.path = null; }
  inp.ax = e.x; inp.ay = e.y;
  if (b.nadeCd <= 0 && throwNade(fs, p, me, e, d)) { b.nadeCd = 7; return; }
  if (def.pings && b.pingCd <= 0 && !fs.pings.some((g) => g.enemyId === e.id)) { inp.ping++; b.pingCd = 1.2; }
  b.react -= dt;
  if (b.react > 0 || friendInLine(sim, p, e)) return;
  if (def.aimFirst && moving && d >= lo) return; // snipers aim before firing, but defend themselves up close
  const wi = currentWeapon(p);
  if (!wi) { if (d < 1.3) inp.fire = !p.triggerHeld; return; }
  b.burst -= dt;
  if (b.burst < -def.burst[1]) b.burst = def.burst[0];
  if (b.burst > 0) inp.fire = weapon(wi.id).auto ? true : !p.triggerHeld;
}
