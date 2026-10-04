import { weapon, WeaponDef } from '../config/weapons';
import { INJURY_THRESHOLD } from '../config/items';
import { rayCircle, clamp, dist } from '../core/math';
import { raycastWalls, lineOfSight } from './nav';
import { S_LOW, idx, isWalkableTile, blocksSight } from '../gen/floor';
import type { Sim } from './sim';
import type { Enemy, FloorState, PlayerState, Grenade, Zone, PanelState } from './state';
import { panelLights } from './lights';
import { ENEMY_STATS } from './stats';
import { IS_CYBORG, NETWORKED, LootItem } from './types';
import { ammoAmount } from '../gen/loot';
import { CYBORG_BATTERY_CHANCE } from '../config/items';
import { Rng } from '../core/rng';

export type HitKind = 'wall' | 'enemy' | 'player' | 'camera' | 'vending' | 'mine' | 'panel' | 'light' | 'none' | 'floor';
export interface Hit { kind: HitKind; t: number; x: number; y: number; z: number; ref: any }

/** Vertical ray for 3D-aimed shots: height z0 at the muzzle, changing by dz per horizontal metre. */
export interface VerticalRay { z0: number; dz: number }
export const LOW_COVER_TOP = 1.0;
/** Vertical extent [bottom, top] of each hittable thing, in metres. */
/** within this range (m) an enemy in the shot line is hit regardless of shot height (dogs at your feet) */
export const POINT_BLANK = 1.1;

export function enemyExtent(e: Enemy): [number, number] {
  const covering = e.hasCover && Math.hypot(e.x - e.coverX, e.y - e.coverY) < 0.6 && e.state === 'alert' && e.shotT > 0.6;
  switch (e.type) {
    case 'dog': case 'dogcyborg': return [0, 0.95];
    case 'drone': return [1.05, 1.9];
    case 'warden': return [0, 2.6];
    default: return [0, covering ? 1.4 : 1.85];
  }
}

/** Does the segment pass through any smoke cloud? */
export function smokeBlocks(fs: FloorState, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const z of fs.zones) {
    if (z.kind !== 'smoke') continue;
    const r = z.r * Math.min(1, z.t / 1.5 + 0.2);
    // distance from centre to segment
    const dx = x1 - x0, dy = y1 - y0;
    const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((z.x - x0) * dx + (z.y - y0) * dy) / l2, 0, 1);
    if (Math.hypot(x0 + dx * t - z.x, y0 + dy * t - z.y) < r) return true;
  }
  return false;
}

export function canSee(fs: FloorState, x0: number, y0: number, x1: number, y1: number): boolean {
  return lineOfSight(fs.L, x0, y0, x1, y1) && !smokeBlocks(fs, x0, y0, x1, y1);
}

/**
 * Hitscan trace. Player shots can hit enemies, cameras, vending machines, mines.
 * Enemy shots hit players. Low cover near a crouched / covering target may absorb the round.
 */
export function trace(sim: Sim, fs: FloorState, ox: number, oy: number, ang: number, range: number, src: 'p' | 'e', srcId: number, vert?: VerticalRay): Hit {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  const zAt = (t: number) => (vert ? vert.z0 + vert.dz * t : 1.1);
  // a descending 3D shot stops where it reaches the floor
  let floorT = Infinity;
  if (vert && vert.dz < 0) floorT = vert.z0 / -vert.dz;
  const reach = Math.min(range, floorT);
  const lows: number[] = [];
  let wallT = raycastWalls(fs.L, ox, oy, ox + dx * reach, oy + dy * reach, (d) => lows.push(d));
  if (wallT < 0) wallT = reach;
  let best: Hit = { kind: 'wall', t: wallT, x: ox + dx * wallT, y: oy + dy * wallT, z: zAt(wallT), ref: null };
  if (wallT >= reach) best.kind = floorT <= range && wallT >= floorT - 1e-6 ? 'floor' : 'none';
  if (best.kind === 'floor') best.z = 0;
  // geometric low cover (desks, counters, barriers) for 3D shots: blocks rounds passing below its top
  if (vert) for (const d of lows) if (d < best.t && zAt(d) < LOW_COVER_TOP) { best = { kind: 'wall', t: d, x: ox + dx * d, y: oy + dy * d, z: zAt(d), ref: 'cover' }; break; }
  const consider = (kind: HitKind, cx: number, cy: number, r: number, ref: any, covering: boolean, ext?: [number, number]) => {
    let t = rayCircle(ox, oy, dx, dy, cx, cy, r);
    if (t < 0 || t >= best.t) return;
    if (vert && ext) {
      // the ray is inside the body circle over [t, tOut]: hit at the first point there within the body's height
      const fx = ox - cx, fy = oy - cy, b = fx * dx + fy * dy;
      const tOut = -b + Math.sqrt(Math.max(0, b * b - (fx * fx + fy * fy - r * r)));
      const z0 = zAt(t), z1 = zAt(tOut);
      if (z0 >= ext[0] && z0 <= ext[1]) { /* enters at body height */ }
      else if (kind === 'enemy' && t < POINT_BLANK) { /* point blank: muzzle is over the target, you can't miss */ }
      else {
        const lim = z0 > ext[1] ? ext[1] : ext[0];
        if ((z0 - lim) * (z1 - lim) > 0) return; // never reaches the body's height inside the circle
        t += ((lim - z0) / (z1 - z0 || 1e-6)) * (tOut - t);
        if (t >= best.t) return;
      }
    }
    // low cover close in front of a covering target soaks the shot
    if (covering && lows.some((d) => d < t && d > t - 1.4) && sim.rng.chance(0.6)) {
      const d = lows.filter((d) => d < t).pop()!;
      if (d < best.t) best = { kind: 'wall', t: d, x: ox + dx * d, y: oy + dy * d, z: zAt(d), ref: 'cover' };
      return;
    }
    best = { kind, t, x: ox + dx * t, y: oy + dy * t, z: zAt(t), ref };
  };
  if (src === 'p') {
    for (const e of fs.enemies) if (e.state !== 'dead') consider('enemy', e.x, e.y, ENEMY_STATS[e.type].radius + 0.08, e, e.hasCover && Math.hypot(e.x - e.coverX, e.y - e.coverY) < 0.6, enemyExtent(e));
    for (const c of fs.cameras) if (c.alive) consider('camera', c.x, c.y, 0.28, c, false, [2.05, 2.75]);
    for (const v of fs.vendings) if (!v.broken) consider('vending', v.x, v.y, 0.5, v, false, [0, 1.95]);
    for (const m of fs.traps) if (m.armed && m.kind === 'mine') consider('mine', m.x, m.y, 0.22, m, false, [0, 0.25]);
    // ceiling fixtures: only an aimed 3D shot climbs to their height (a flat shot would clip every lamp it passes under)
    if (vert) fs.L.lights.forEach((l, i) => { if ((l.kind === 'ceiling' || l.kind === 'emergency') && !fs.lights[i].broken && !fs.lights[i].cut) consider('light', l.x, l.y, 0.45, i, false, [2.35, 2.65]); });
    for (const pn of fs.panels) if (!pn.dead) consider('panel', pn.x, pn.y, 0.62, pn, false, [0.2, 1.8]); // reaches past its solid tile's edge
    if (sim.cfg.friendlyFire && fs.floor !== 0) for (const p of sim.players) if (p.floor === fs.floor && p.life === 'alive' && p.connected && p.id !== srcId) consider('player', p.x, p.y, 0.34, p, false, p.crouch ? [0, 1.25] : [0, 1.8]);
  } else {
    for (const p of sim.players) if (p.floor === fs.floor && p.life === 'alive' && p.connected && p.id !== srcId) consider('player', p.x, p.y, 0.34, p, p.crouch);
  }
  return best;
}

/** Enemy damage mitigation. Returns true if killed. */
export function damageEnemy(sim: Sim, fs: FloorState, e: Enemy, dmg: number, pen: number, attacker: PlayerState | null, kind: 'bullet' | 'melee' | 'blast' | 'fire'): boolean {
  if (e.state === 'dead') return false;
  const st = ENEMY_STATS[e.type];
  let hpD = dmg;
  if (e.armor > 0 && kind !== 'fire') {
    hpD = dmg * (0.42 + 0.58 * pen);
    e.armor = Math.max(0, e.armor - dmg * (1 - pen * 0.5) * 0.6);
  }
  if (st.metal && kind === 'bullet') hpD *= 0.7 + 0.3 * pen;
  e.hp -= hpD;
  sim.emit({ e: 'hitE', f: fs.floor, id: e.id, x: e.x, y: e.y, metal: st.metal || e.type === 'cyborg' });
  if (e.hp <= 0) {
    killEnemy(sim, fs, e, attacker);
    return true;
  }
  // react: pain + awareness of the attacker
  if (attacker && attacker.floor === fs.floor) {
    e.aware = Math.max(e.aware, 1);
    sim.ai.becomeAlert(fs, e, attacker, true);
  } else if (e.state !== 'alert') {
    e.aware = Math.max(e.aware, 0.8);
  }
  if (e.barkT <= 0) {
    sim.emit({ e: 'bark', f: fs.floor, id: e.id, t: e.type, k: 'pain' });
    e.barkT = 1.2;
  }
  return false;
}

export function killEnemy(sim: Sim, fs: FloorState, e: Enemy, attacker: PlayerState | null) {
  e.state = 'dead';
  e.hp = 0;
  e.deadT = 0;
  e.path = null;
  sim.emit({ e: 'die', f: fs.floor, id: e.id, t: e.type, x: e.x, y: e.y });
  sim.emit({ e: 'bark', f: fs.floor, id: e.id, t: e.type, k: 'die' });
  if (attacker) { attacker.kills++; sim.stats.kills++; }
  fs.pings = fs.pings.filter((p) => p.enemyId !== e.id);
  // lootable body
  const items = enemyDrops(sim.rng, e, sim.pressure(fs.floor).loot);
  fs.containers.push({ id: e.id, kind: 'corpse', x: e.x, y: e.y, items, opened: false, label: 'Body' });
  // networked units report their own loss to the AI
  if (NETWORKED[e.type] && !fs.wave?.active) sim.ai.networkAlert(fs, e.x, e.y, false);
}

export function enemyDrops(rng: Rng, e: Enemy, loot: number): LootItem[] {
  const out: LootItem[] = [];
  const w = weapon(e.weapon);
  if (w.droppable) {
    out.push({ k: 'weapon', id: w.id, mag: Math.max(0, Math.round(w.mag * rng.range(0.15, 0.9))), reserve: Math.round(w.mag * rng.range(0, 1.2) * Math.min(1, loot)) });
    if (rng.chance(Math.min(0.95, 0.7 * loot))) out.push({ k: 'ammo', ammo: w.ammo, n: ammoAmount(rng, w.ammo, 1) });
  }
  if (e.type === 'loyalist' || e.type === 'cyborg') {
    if (!w.droppable && rng.chance(Math.min(0.95, 0.75 * loot))) { const a = rng.pick(['pistol', 'smg', 'rifle', 'shell'] as const); out.push({ k: 'ammo', ammo: a, n: ammoAmount(rng, a, 1) }); } // zombie
    if (rng.chance(0.1 * loot)) out.push({ k: 'item', item: 'plate', n: 1 });
    if (rng.chance(0.05 * loot)) out.push({ k: 'item', item: 'medkit', n: 1 });
    if (rng.chance(0.08 * loot)) out.push({ k: 'item', item: 'food', n: 1 });
    if (rng.chance(0.06 * loot)) out.push({ k: 'grenade', g: rng.pick(['frag', 'flash', 'smoke'] as const), n: 1 });
  }
  if (e.type === 'drone' || e.type === 'warden') if (rng.chance(0.2 * loot)) out.push({ k: 'item', item: 'plate', n: 1 });
  // Cyborg torch battery: flat 5% (spec).
  if (IS_CYBORG[e.type] && rng.chance(CYBORG_BATTERY_CHANCE)) out.push({ k: 'item', item: 'battery', n: 1 });
  return out;
}

/** Player damage with armour absorption and degradation. */
export function damagePlayer(sim: Sim, p: PlayerState, dmg: number, pen: number, kind: 'bullet' | 'melee' | 'blast' | 'fire' | 'shock', crit = false) {
  if (p.life !== 'alive' || !p.connected || p.cheats?.god) return;
  if (crit && !p.helmet) dmg *= 1.8;
  let hpD = dmg;
  let armorHit = false;
  if (p.armor > 0 && kind !== 'fire' && kind !== 'shock') {
    const absorb = 0.65 * (1 - pen * 0.55);
    let aD = dmg * absorb * 1.1;
    hpD = dmg * (1 - absorb);
    if (aD > p.armor) { hpD += (aD - p.armor) / 1.1; aD = p.armor; }
    p.armor = Math.max(0, p.armor - aD);
    armorHit = true;
  }
  p.hp -= hpD;
  p.hurtT = 0.35;
  sim.emit({ e: 'hurt', f: p.floor, pid: p.id, dmg: hpD, armor: armorHit });
  if (p.hp < INJURY_THRESHOLD && p.hp > 0) p.injured = true;
  if (p.hp <= 0) sim.playerDies(p);
}

/** Explosion damage with wall occlusion. */
export function explode(sim: Sim, fs: FloorState, x: number, y: number, r: number, dmg: number, kind: string, owner: PlayerState | null) {
  sim.emit({ e: 'explode', f: fs.floor, x, y, r, kind });
  sim.noise(fs, x, y, 32, null);
  for (const e of fs.enemies) {
    if (e.state === 'dead') continue;
    const d = dist(x, y, e.x, e.y);
    if (d > r || !lineOfSight(fs.L, x, y, e.x, e.y)) continue;
    damageEnemy(sim, fs, e, dmg * (1 - d / r) + 10, 0.6, owner, 'blast');
  }
  for (const p of sim.players) {
    if (p.floor !== fs.floor || p.life !== 'alive' || !p.connected) continue;
    const d = dist(x, y, p.x, p.y);
    if (d > r || !lineOfSight(fs.L, x, y, p.x, p.y)) continue;
    if (owner && owner.id !== p.id && (!sim.cfg.friendlyFire || fs.floor === 0)) continue; // teammates' blasts only hurt with friendly fire on
    const scale = owner && owner.id !== p.id ? 0.5 : 1;
    damagePlayer(sim, p, (dmg * (1 - d / r) + 10) * scale * 0.85, 0.5, 'blast');
  }
  for (const c of fs.cameras) if (c.alive && dist(x, y, c.x, c.y) < r * 0.8) destroyCamera(sim, fs, c, owner);
  for (const v of fs.vendings) if (!v.broken && dist(x, y, v.x, v.y) < r * 0.7) breakVending(sim, fs, v, owner);
  for (const t of fs.traps) if (t.armed && t.kind === 'mine' && dist(x, y, t.x, t.y) < r * 0.8) { t.armed = false; t.fuse = 0.15; }
}

export function destroyCamera(sim: Sim, fs: FloorState, c: FloorState['cameras'][number], by: PlayerState | null) {
  if (!c.alive) return;
  c.alive = false;
  sim.emit({ e: 'cctv', f: fs.floor, id: c.id, k: 'destroyed' });
  // Disabling a camera tells the AI where the shooter is: networked units converge.
  const ax = by && by.floor === fs.floor ? by.x : c.x, ay = by && by.floor === fs.floor ? by.y : c.y;
  sim.ai.networkAlert(fs, ax, ay, false);
  sim.emit({ e: 'msg', pid: by ? by.id : -1, text: 'Camera down — the AI knows where you are.', k: 'warn' });
}

/** A shot-out ceiling light: glass pops, the bulb stays dead (until a lighting-grid hack repairs it). */
export function shootLight(sim: Sim, fs: FloorState, i: number, by: PlayerState | null) {
  const ls = fs.lights[i], l = fs.L.lights[i];
  if (!ls || ls.broken) return;
  ls.broken = true;
  ls.burstT = 1;
  sim.noise(fs, l.x, l.y, 8, by);
  sim.emit({ e: 'scare', f: fs.floor, k: 'lightburst', x: l.x, y: l.y, lid: i });
}

/** A shot-out breaker panel: its rooms go dark for good, and the bang of shorting gear carries. */
export function killPanel(sim: Sim, fs: FloorState, pn: PanelState, by: PlayerState | null) {
  if (pn.dead) return;
  pn.dead = true;
  for (const i of panelLights(fs.L, pn)) fs.lights[i].cut = true;
  sim.noise(fs, pn.x, pn.y, 18, by);
  sim.emit({ e: 'explode', f: fs.floor, x: pn.x, y: pn.y, r: 0.6, kind: 'spark' });
  if (by) sim.msg(by, 'Breaker panel shorted out. Lights in this area are dead.', 'warn');
}

/** Quietly flip a breaker panel's working lights off or on. */
export function togglePanel(sim: Sim, fs: FloorState, pn: PanelState, by: PlayerState) {
  if (pn.dead) return;
  pn.off = !pn.off;
  for (const i of panelLights(fs.L, pn)) fs.lights[i].off = pn.off;
  sim.msg(by, pn.off ? 'Lights off.' : 'Lights on.', 'info');
}

export function breakVending(sim: Sim, fs: FloorState, v: FloorState['vendings'][number], by: PlayerState | null) {
  if (v.broken) return;
  v.broken = true;
  sim.emit({ e: 'vend', f: fs.floor, id: v.id, x: v.x, y: v.y });
  sim.noise(fs, v.x, v.y, 13, by);
  const off = [[0, 1], [-1, 0], [0, -1], [1, 0]][v.rot] ?? [0, 1];
  let dx = v.x + off[0] * 0.9, dy = v.y + off[1] * 0.9;
  if (!isWalkableTile(fs.L, Math.floor(dx), Math.floor(dy))) { dx = v.x; dy = v.y; }
  fs.containers.push({ id: v.id + 500000, kind: 'drop', x: dx, y: dy, items: v.drops.map((d) => ({ ...d })), opened: false, label: 'Vending Spill' });
}

// ------------------------------------------------------------------ grenades
export const FUSE: Record<string, number> = { frag: 1.7, flash: 1.4, smoke: 1.4, incendiary: 2.5, decoy: 1.3 };

export function updateGrenades(sim: Sim, fs: FloorState, dt: number) {
  for (const g of fs.grenades) {
    g.fuse -= dt;
    if (!g.rest) {
      g.vz -= 13 * dt;
      let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt;
      const tx = Math.floor(nx), ty = Math.floor(g.y);
      if (blocksSight(fs.L, tx, ty) || (g.z < 0.5 && fs.L.solid[idx(tx, ty)] === S_LOW)) { g.vx = -g.vx * 0.45; nx = g.x; sim.emit({ e: 'bounce', f: fs.floor, x: g.x, y: g.y }); }
      if (blocksSight(fs.L, Math.floor(nx), Math.floor(ny)) || (g.z < 0.5 && fs.L.solid[idx(Math.floor(nx), Math.floor(ny))] === S_LOW)) { g.vy = -g.vy * 0.45; ny = g.y; sim.emit({ e: 'bounce', f: fs.floor, x: g.x, y: g.y }); }
      g.x = nx; g.y = ny;
      g.z += g.vz * dt;
      if (g.z <= 0) {
        g.z = 0;
        if (g.kind === 'incendiary') g.fuse = Math.min(g.fuse, 0);
        if (Math.abs(g.vz) > 1.5) sim.emit({ e: 'bounce', f: fs.floor, x: g.x, y: g.y });
        g.vz = -g.vz * 0.3;
        g.vx *= 0.55; g.vy *= 0.55;
        if (Math.hypot(g.vx, g.vy) < 0.3 && Math.abs(g.vz) < 0.8) { g.rest = true; g.vx = g.vy = g.vz = 0; }
      }
    }
    if (g.fuse <= 0) detonate(sim, fs, g);
  }
  fs.grenades = fs.grenades.filter((g) => g.fuse > 0);
}

function detonate(sim: Sim, fs: FloorState, g: Grenade) {
  const owner = sim.players.find((p) => p.id === g.owner) ?? null;
  switch (g.kind) {
    case 'frag':
      explode(sim, fs, g.x, g.y, 5, 115, 'frag', owner);
      break;
    case 'flash': {
      sim.emit({ e: 'explode', f: fs.floor, x: g.x, y: g.y, r: 10, kind: 'flash' });
      sim.noise(fs, g.x, g.y, 26, null);
      for (const e of fs.enemies) {
        if (e.state === 'dead') continue;
        const d = dist(g.x, g.y, e.x, e.y);
        if (d > 12 || !lineOfSight(fs.L, g.x, g.y, e.x, e.y)) continue;
        const facing = Math.abs(Math.atan2(g.y - e.y, g.x - e.x) - e.facing);
        const f = d < 4 || Math.cos(facing) > 0 ? 4 : 1.6;
        e.flashT = Math.max(e.flashT, f * (1 - d / 14));
        e.burstLeft = 0;
      }
      for (const p of sim.players) {
        if (p.floor !== fs.floor || p.life !== 'alive' || !p.connected) continue;
        const d = dist(g.x, g.y, p.x, p.y);
        if (d > 10 || !lineOfSight(fs.L, g.x, g.y, p.x, p.y)) continue;
        const toG = Math.atan2(g.y - p.y, g.x - p.x);
        const facing = Math.cos(toG - p.facing) > 0.2;
        p.flashT = Math.max(p.flashT, (facing ? 3.2 : 1.1) * (1 - d / 12));
      }
      break;
    }
    case 'smoke':
      fs.zones.push({ id: sim.id(), kind: 'smoke', x: g.x, y: g.y, r: 3.6, t: 14, tick: 0 });
      sim.emit({ e: 'explode', f: fs.floor, x: g.x, y: g.y, r: 3.6, kind: 'smoke' });
      break;
    case 'incendiary':
      fs.zones.push({ id: sim.id(), kind: 'fire', x: g.x, y: g.y, r: 2.8, t: 7, tick: 0 });
      sim.emit({ e: 'explode', f: fs.floor, x: g.x, y: g.y, r: 2.8, kind: 'fire' });
      sim.noise(fs, g.x, g.y, 14, null);
      break;
    case 'decoy':
      fs.zones.push({ id: sim.id(), kind: 'decoy', x: g.x, y: g.y, r: 0, t: 8, tick: 0 });
      break;
  }
}

export function updateZones(sim: Sim, fs: FloorState, dt: number) {
  for (const z of fs.zones) {
    z.t -= dt;
    z.tick -= dt;
    if (z.kind === 'fire') {
      for (const e of fs.enemies) if (e.state !== 'dead' && e.type !== 'warden' && dist(z.x, z.y, e.x, e.y) < z.r) damageEnemy(sim, fs, e, 11 * dt, 1, null, 'fire');
      for (const p of sim.players) if (p.floor === fs.floor && p.life === 'alive' && p.connected && dist(z.x, z.y, p.x, p.y) < z.r && p.z < 0.3) { damagePlayer(sim, p, 9 * dt, 1, 'fire'); p.burnT = 0.5; }
    } else if (z.kind === 'decoy' && z.tick <= 0) {
      z.tick = 0.35 + sim.rng.next() * 0.7;
      const a = sim.rng.range(0, 6.28);
      sim.emit({ e: 'shot', f: fs.floor, x: z.x, y: z.y, x2: z.x + Math.cos(a) * 0.3, y2: z.y + Math.sin(a) * 0.3, w: 'sr4', src: 'p', id: -1, hit: 'none' });
      sim.noise(fs, z.x, z.y, 22, null);
    }
  }
  fs.zones = fs.zones.filter((z) => z.t > 0);
  // static hazards
  for (const h of fs.hazards) {
    for (const p of sim.players) {
      if (p.floor !== fs.floor || p.life !== 'alive' || !p.connected || p.z > 0.3) continue;
      if (dist(h.x, h.y, p.x, p.y) < h.r) {
        damagePlayer(sim, p, (h.kind === 'fire' ? 12 : 18) * dt, 1, h.kind === 'fire' ? 'fire' : 'shock');
        if (h.kind === 'fire') p.burnT = 0.5;
      }
    }
  }
}

export function weaponDef(id: string): WeaponDef {
  return weapon(id);
}
