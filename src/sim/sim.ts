import { Rng, hash } from '../core/rng';
import { dist, clamp, segPointDist, angleTo } from '../core/math';
import { Difficulty, pressure, PressureProfile, bracketInfo, bracketOf, FINAL_FLOOR, REVIVE_WINDOW, SHUTDOWN_SECONDS } from '../config/difficulty';
import { weapon } from '../config/weapons';
import { BuildingPlan, StairCondition } from '../gen/building';
import { perfTime } from '../core/perf';
import { generateFloor, pointsNear, isWalkableTile, setFlightBlocked, setDoorSolid } from '../gen/floor';
import { CONTAINER_LABEL } from '../gen/loot';
import { sanitizeLook } from '../config/look';
import { AI } from './ai';
import { explode, updateGrenades, updateZones, breakVending as breakV, canSee, damagePlayer } from './combat';
import { lightLevel, lightOut, makePanels } from './lights';
import { createPlayer, updatePlayer } from './player';
import { enemyStatsFor } from './stats';
import { makeEnemy, emptyInput } from './state';
import type { FloorState, Loadout, Mode, PlayerState, SimEvent, TrapState, VendingState, Enemy } from './state';
import { currentHoliday, type Holiday } from '../config/holiday';
import type { EnemyType } from './types';

/** friendlyFire: co-op host option (bullets, knife and grenades hurt teammates); off by default */
/** holiday: the festive theme this run plays under (Halloween turns loyalists and cyborgs into melee zombies). */
export interface SimConfig { seed: number; difficulty: Difficulty; mode: Mode; friendlyFire?: boolean; holiday?: Holiday | null }
export type Phase = 'playing' | 'won' | 'lost';

export class Sim {
  readonly cfg: SimConfig;
  readonly plan: BuildingPlan;
  readonly rng: Rng;
  readonly ai: AI;
  t = 0;
  phase: Phase = 'playing';
  lostReason = '';
  players: PlayerState[] = [];
  floors = new Map<number, FloorState>();
  events: SimEvent[] = [];
  clearedFlights = new Set<string>();
  objective = { uploadStarted: false, uploadT: SHUTDOWN_SECONDS, done: false, by: -1 };
  stats = { kills: 0, maxFloor: 0, startT: 0, endT: 0 };
  /** players whose movement is authoritative on a remote client */
  external = new Set<number>();
  onTravel: ((p: PlayerState, from: number, to: number) => void) | null = null;
  private nextId = 1_000_000;
  private pcache = new Map<number, PressureProfile>();

  constructor(cfg: SimConfig) {
    this.cfg = cfg;
    this.plan = new BuildingPlan(cfg.seed, cfg.difficulty);
    this.rng = new Rng(hash(cfg.seed, 0x5eed));
    this.ai = new AI(this);
  }

  id() { return this.nextId++; }
  emit(ev: SimEvent) { this.events.push(ev); }
  drainEvents(): SimEvent[] { const e = this.events; this.events = []; return e; }
  msg(p: PlayerState | null, text: string, k: 'info' | 'warn' | 'good' | 'loot' = 'info') { this.emit({ e: 'msg', pid: p ? p.id : -1, text, k }); }
  pressure(floor: number): PressureProfile {
    let p = this.pcache.get(floor);
    if (!p) { p = pressure(this.cfg.difficulty, floor); this.pcache.set(floor, p); }
    return p;
  }

  addPlayer(id: number, name: string, lo: Loadout): PlayerState {
    let slot = 0; // lowest free slot: a co-op squad can lose a member before the tower and gain a late joiner
    while (this.players.some((q) => q.slot === slot)) slot++;
    const p = createPlayer(id, slot, name, lo);
    p.loadout = JSON.parse(JSON.stringify(lo));
    p.checkedIn = this.cfg.mode !== 'single'; // co-op squads check in through the lobby + armory
    const fs = this.floorState(0);
    const pts = pointsNear(fs.L, fs.L.anchors.start.x, fs.L.anchors.start.y, 6);
    p.x = pts[slot].x; p.y = pts[slot].y;
    p.aimX = p.x; p.aimY = p.y - 4;
    p.input.ax = p.aimX; p.input.ay = p.aimY;
    this.players.push(p);
    return p;
  }

  player(id: number) { return this.players.find((p) => p.id === id); }

  /** Halloween: loyalists and cyborgs rise as zombies, drones are bats, wardens are ogres. None of them shoot: all melee ('bite'). */
  private zombify<S extends { type: EnemyType; weapon: string }>(s: S): S {
    return this.cfg.holiday === 'halloween' && s.type !== 'dog' && s.type !== 'dogcyborg' ? { ...s, weapon: 'bite' } : s;
  }

  floorState(f: number): FloorState {
    let fs = this.floors.get(f);
    if (fs) return fs;
    const L = perfTime('generateFloor', () => generateFloor(this.plan, f));
    const enemies = L.spawns.map((s, i) => {
      const e = makeEnemy(f * 10000 + i, this.zombify(s), f, enemyStatsFor);
      e.mag = weapon(e.weapon).mag;
      e.homeFacing = e.facing;
      return e;
    });
    fs = {
      floor: f, L, enemies,
      cameras: L.cameras.map((c) => ({ id: c.id, x: c.x, y: c.y, baseAngle: c.angle, sweep: c.sweep, speed: c.speed, phase: c.phase, range: c.range, fov: c.fov, angle: c.angle, alive: true, detect: 0, alarmT: 0, hp: 1 })),
      traps: L.traps.map((t) => ({ ...t, armed: true, revealed: false, fuse: 0 })),
      containers: L.containers.map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, items: c.items.map((i) => ({ ...i })), opened: false, label: CONTAINER_LABEL[c.kind] })),
      vendings: L.vendings.map((v) => ({ id: v.id, x: v.x, y: v.y, rot: v.rot, hp: 45, broken: false, drops: v.drops.map((d) => ({ ...d })), price: v.price })),
      hazards: L.hazards.map((h) => ({ ...h })),
      grenades: [], zones: [], pings: [],
      lights: L.lights.map((l) => ({ broken: l.broken, burstT: 0 })),
      panels: makePanels(L),
      hacks: L.hacks.map((h) => ({ id: h.id, kind: h.kind, x: h.x, y: h.y, state: 'ready' as const })),
      doors: L.doors.map((d) => { setDoorSolid(L, d, d.init); return { id: d.id, state: d.init }; }), // the cached layout is shared: (re)apply
      npcHold: {}, npcTalk: [],
      lightsFixed: false,
      debris: {}, wave: null,
      scareT: 40 + new Rng(hash(this.cfg.seed, f, 0x5ca)).next() * 60,
      networkAlertT: 0,
    };
    if (f < 0) { // sandbox: show every state, nothing hostile
      for (const t of fs.traps) t.revealed = true;
      if (fs.vendings[1]) fs.vendings[1].broken = true;
      if (fs.cameras[2]) fs.cameras[2].alarmT = 1e9;
      if (fs.cameras[0]) fs.cameras[0].detect = 0.6;
    }
    for (const key of this.clearedFlights) {
      const [cf, ci] = key.split(':').map(Number);
      if (cf === f) setFlightBlocked(L, L.stairs[ci], 1, false);
      if (cf === f - 1) setFlightBlocked(L, L.stairs[ci], -1, false);
    }
    this.floors.set(f, fs);
    return fs;
  }

  // ------------------------------------------------------------------ main loop
  tick(dt: number) {
    if (this.phase !== 'playing') return;
    this.t += dt;
    for (const p of this.players) updatePlayer(this, p, dt, this.external.has(p.id));
    const active = new Set<number>();
    for (const p of this.players) if (p.life !== 'out' && p.connected) active.add(p.floor);
    for (const f of active) this.updateFloor(this.floorState(f), dt);
    this.checkEnd();
  }

  private updateFloor(fs: FloorState, dt: number) {
    // officers in conversation stand still: their routine clock stops while anyone is talking to them
    if (fs.floor === 0) {
      // Chief Hollis (npc -1) counts as in conversation for the whole check-in + armory visit
      fs.npcTalk = this.players.filter((p) => p.floor === 0 && ((p as any).panel?.kind === 'talk' || (p as any).panel?.kind === 'checkin')).map((p) => ((p as any).panel.kind === 'checkin' ? -1 : (p as any).panel.npc));
      for (const n of fs.npcTalk) fs.npcHold[n] = (fs.npcHold[n] ?? 0) + dt;
    }
    if (fs.floor < 0) { // sandbox: sweep cameras for show; no detection, traps, AI or scares
      for (const c of fs.cameras) c.angle = c.baseAngle + Math.sin(this.t * c.speed + c.phase) * c.sweep;
      updateGrenades(this, fs, dt);
      updateZones(this, fs, dt);
      return;
    }
    this.updateCameras(fs, dt);
    this.updateTraps(fs, dt);
    updateGrenades(this, fs, dt);
    updateZones(this, fs, dt);
    this.ai.update(fs, dt);
    for (const pg of fs.pings) {
      pg.t -= dt;
      if (pg.enemyId >= 0) { const e = fs.enemies.find((e) => e.id === pg.enemyId); if (e) { pg.x = e.x; pg.y = e.y; } }
    }
    fs.pings = fs.pings.filter((p) => p.t > 0);
    fs.networkAlertT -= dt;
    for (const l of fs.lights) if (l.burstT > 0) l.burstT -= dt;
    if (fs.wave?.active) this.updateWave(fs, dt);
    this.scareDirector(fs, dt);
  }

  // ------------------------------------------------------------------ stealth support
  /** How visible a player is (0..1) from ambient light, nearby lamps, torch and muzzle flash. */
  exposureOf(fs: FloorState, p: PlayerState): number {
    const L = fs.L;
    const amb = fs.floor === 0 ? 0.95 : 0.6 * (1 - L.darkness); // street is daylight
    let lamp = 0;
    for (let i = 0; i < L.lights.length; i++) {
      const l = L.lights[i];
      const d = dist(l.x, l.y, p.x, p.y);
      if (d > l.range) continue;
      const lv = lightLevel(l, lightOut(fs.lights[i], l), this.t);
      if (lv <= 0.05) continue;
      lamp = Math.max(lamp, (1 - d / l.range) * 0.9 * lv * Math.min(1, l.intensity));
    }
    let e = 1 - (1 - amb) * (1 - lamp);
    if (p.torchOn) e = Math.max(e, 0.55);
    if (p.muzzleT > -0.5) e = Math.max(e, 0.95);
    if (p.crouch) e *= 0.85;
    return clamp(e, 0.06, 1);
  }

  /** Noise event: enemies hear and react. */
  noise(fs: FloorState, x: number, y: number, r: number, src: PlayerState | null, _fromEnemy = false) {
    this.ai.hear(fs, x, y, r, src);
  }

  private updateCameras(fs: FloorState, dt: number) {
    const pr = this.pressure(fs.floor);
    for (const c of fs.cameras) {
      if (!c.alive) continue;
      c.angle = c.baseAngle + Math.sin(this.t * c.speed + c.phase) * c.sweep;
      c.alarmT -= dt;
      let seen: PlayerState | null = null;
      for (const p of this.players) {
        if (p.floor !== fs.floor || p.life !== 'alive' || !p.connected) continue;
        const d = dist(c.x, c.y, p.x, p.y);
        if (d > c.range) continue;
        const a = Math.abs(Math.atan2(Math.sin(angleTo(c.x, c.y, p.x, p.y) - c.angle), Math.cos(angleTo(c.x, c.y, p.x, p.y) - c.angle)));
        if (a > c.fov + 0.3 / Math.max(1, d)) continue;
        if (!canSee(fs, c.x, c.y, p.x, p.y)) continue;
        seen = p;
        break;
      }
      if (seen) {
        const before = c.detect;
        c.detect += dt * 1.7 * pr.perception * Math.max(0.55, seen.exposure) * (seen.crouch ? 0.8 : 1);
        if (before === 0) this.emit({ e: 'cctv', f: fs.floor, id: c.id, k: 'spot' });
        if (c.detect >= 1 && c.alarmT <= 0) {
          c.alarmT = 6;
          c.detect = 0.5;
          this.ai.networkAlert(fs, seen.x, seen.y, true, seen);
          this.emit({ e: 'cctv', f: fs.floor, id: c.id, k: 'alarm' });
          this.msg(seen, 'CCTV has you! Networked hostiles converging.', 'warn');
        }
      } else c.detect = Math.max(0, c.detect - dt * 0.5);
    }
  }

  private updateTraps(fs: FloorState, dt: number) {
    for (const t of fs.traps) {
      if (!t.armed) {
        if (t.fuse > 0) {
          t.fuse -= dt;
          if (t.fuse <= 0) { t.fuse = 0; t.revealed = true; explode(this, fs, (t.x + (t.kind === 'tripwire' ? t.x2 : t.x)) / 2, (t.y + (t.kind === 'tripwire' ? t.y2 : t.y)) / 2, 3.4, 95, 'trap', null); (t as any).spent = true; }
        }
        continue;
      }
      const cx = t.kind === 'tripwire' ? (t.x + t.x2) / 2 : t.x, cy = t.kind === 'tripwire' ? (t.y + t.y2) / 2 : t.y;
      for (const p of this.players) {
        if (p.floor !== fs.floor || p.life !== 'alive' || !p.connected) continue;
        const d = dist(cx, cy, p.x, p.y);
        if (!t.revealed) {
          const torchSees = p.torchOn && d < (p.mods.torchmod ? 15 : 11) && Math.cos(angleTo(p.x, p.y, cx, cy) - p.facing) > 0.87 && canSee(fs, p.x, p.y, cx, cy);
          const litSees = d < 4.5 && fs.L.darkness < 0.35 && canSee(fs, p.x, p.y, cx, cy);
          if (d < 1.5 || torchSees || litSees) {
            t.revealed = true;
            this.emit({ e: 'trap', f: fs.floor, id: t.id, k: 'reveal' });
            if (t.kind === 'mine') this.msg(p, 'Proximity mine spotted!', 'warn'); // tripwires reveal silently: you have to spot them yourself
          }
        }
        if (p.z > 0.18) continue; // jumping clears wires and mines
        const trig = t.kind === 'tripwire' ? segPointDist(t.x, t.y, t.x2, t.y2, p.x, p.y) < 0.3 : d < 0.65;
        if (trig) {
          t.armed = false;
          t.revealed = true;
          t.fuse = t.kind === 'mine' ? 0.45 : 0.3;
          this.emit({ e: 'trap', f: fs.floor, id: t.id, k: t.kind === 'mine' ? 'beep' : 'trigger' });
          break;
        }
      }
    }
  }

  disarmTrap(p: PlayerState, fs: FloorState, t: TrapState) {
    if (!t.armed) return;
    t.armed = false;
    if (!p.mods.bypass && this.rng.chance(0.2)) {
      t.fuse = 0.4;
      this.emit({ e: 'trap', f: fs.floor, id: t.id, k: 'beep' });
      this.msg(p, 'Botched the disarm — MOVE!', 'warn');
      return;
    }
    (t as any).spent = true;
    this.emit({ e: 'trap', f: fs.floor, id: t.id, k: 'disarm' });
    this.msg(p, 'Trap disarmed.', 'good');
  }

  breakVending(fs: FloorState, v: VendingState, p: PlayerState) { breakV(this, fs, v, p); }

  // ------------------------------------------------------------------ pings
  ping(p: PlayerState) {
    const fs = this.floorState(p.floor);
    let best: Enemy | null = null, bd = 3.2;
    for (const e of fs.enemies) {
      if (e.state === 'dead') continue;
      const d = dist(e.x, e.y, p.aimX, p.aimY);
      if (d < bd && canSee(fs, p.x, p.y, e.x, e.y)) { bd = d; best = e; }
    }
    const mine = fs.pings.filter((g) => g.by === p.id);
    if (mine.length >= 3) fs.pings.splice(fs.pings.indexOf(mine[0]), 1);
    if (best) {
      fs.pings = fs.pings.filter((g) => g.enemyId !== best!.id);
      fs.pings.push({ id: this.id(), enemyId: best.id, x: best.x, y: best.y, by: p.id, t: 12 });
      this.msg(null, `${p.name} marked a ${best.type === 'loyalist' ? 'loyalist' : best.type}`, 'warn');
    } else {
      fs.pings.push({ id: this.id(), enemyId: -1, x: p.aimX, y: p.aimY, by: p.id, t: 6 });
    }
  }

  // ------------------------------------------------------------------ traversal
  flightCondition(f: number, i: number): StairCondition {
    const c = this.plan.up(f, i);
    if (c === 'debris' && this.clearedFlights.has(`${f}:${i}`)) return 'clear';
    return c;
  }
  clearDebris(f: number, i: number) {
    this.clearedFlights.add(`${f}:${i}`);
    // reopen the flight on both floors it connects
    const a = this.floors.get(f), b = this.floors.get(f + 1);
    if (a) setFlightBlocked(a.L, a.L.stairs[i], 1, false);
    if (b) setFlightBlocked(b.L, b.L.stairs[i], -1, false);
  }

  takeStairs(p: PlayerState, i: number, dir: 1 | -1) {
    const flight = dir > 0 ? p.floor : p.floor - 1;
    const cond = this.flightCondition(flight, i);
    const to = p.floor + dir;
    if (cond === 'fire') { damagePlayer(this, p, 16, 1, 'fire'); p.burnT = 2.5; this.msg(p, 'You push through the flames!', 'warn'); if (p.life !== 'alive') return; }
    this.travel(p, to, 'stair' + i, 'stairs');
    if (cond === 'damaged') {
      const fs = this.floorState(to);
      this.noise(fs, p.x, p.y, 12, p);
      this.msg(p, 'The damaged stairwell groans loudly under you.', 'warn');
    }
  }

  startRide(p: PlayerState, elev: number, to: number) {
    const fs = this.floorState(p.floor);
    const e = fs.L.elevators[elev];
    this.emit({ e: 'elev', f: p.floor, k: 'ding', x: e.cx, y: e.cy });
    for (const o of this.players) {
      if (o.life !== 'alive' || !o.connected || o.floor !== p.floor || o.ride) continue;
      if (o !== p && dist(o.x, o.y, e.cx, e.cy) > 1.9) continue;
      o.ride = { t: 2.4, to, elev };
      (o as any).panel = null;
    }
    this.msg(p, `Elevator to floor ${to}. Doors closing...`, 'info');
  }

  completeRide(p: PlayerState) {
    const r = p.ride!;
    p.ride = null;
    this.travel(p, r.to, 'elev' + r.elev, 'elevator');
    const fs = this.floorState(r.to);
    const e = fs.L.elevators[r.elev];
    this.emit({ e: 'elev', f: r.to, k: 'ding', x: e.cx, y: e.cy });
    // The arrival chime is loud: elevators are choke points
    this.noise(fs, e.cx, e.cy, 17 * this.pressure(r.to).aggression, p);
  }

  travel(p: PlayerState, to: number, tag: string, via: string) {
    const from = p.floor;
    const fs = this.floorState(to);
    const a = fs.L.anchors[tag] ?? fs.L.anchors.stair0 ?? fs.L.anchors.start;
    const pts = pointsNear(fs.L, a.x, a.y, 8);
    const taken = this.players.filter((o) => o !== p && o.floor === to);
    const spot = pts.find((q) => taken.every((o) => dist(o.x, o.y, q.x, q.y) > 0.7)) ?? pts[0];
    p.floor = to;
    p.x = spot.x; p.y = spot.y; p.vx = p.vy = 0; p.z = 0; p.vz = 0;
    p.hold = null; (p as any).panel = null;
    (p as any).tp = ((p as any).tp ?? 0) + 1;
    (p as any).stairCd = 1.2; // don't immediately walk back onto a flight after arriving
    this.emit({ e: 'travel', pid: p.id, from, to, via });
    if (to > this.stats.maxFloor) {
      this.stats.maxFloor = to;
      const bi = bracketInfo(to);
      if (to === FINAL_FLOOR) this.msg(null, `FLOOR 200 — ${bi.name}. Find the mainframe terminal.`, 'warn');
      else if (to === 1 || bracketOf(to) !== bracketOf(to - 1)) {
        this.emit({ e: 'stinger', f: to, k: 'floor' });
        this.msg(null, `Floor ${to}: ${bi.name}. ${bi.desc}`, 'warn');
      }
    }
    this.onTravel?.(p, from, to);
  }

  // ------------------------------------------------------------------ life & death
  playerDies(p: PlayerState) {
    if (p.life !== 'alive') return;
    p.hp = 0;
    p.torchOn = false;
    p.hold = null;
    p.ride = null;
    if (this.cfg.mode === 'single') {
      p.life = 'out';
      this.emit({ e: 'out', pid: p.id });
    } else {
      p.life = 'down';
      p.downT = REVIVE_WINDOW;
      this.emit({ e: 'down', f: p.floor, pid: p.id });
      this.msg(null, `${p.name} is DOWN! 60 seconds to revive with a Health Kit.`, 'warn');
    }
    this.emit({ e: 'stinger', f: p.floor, k: 'death' });
  }
  playerOut(p: PlayerState) {
    p.life = 'out';
    p.downT = 0;
    this.emit({ e: 'out', pid: p.id });
    this.msg(null, `${p.name} bled out. They are gone.`, 'warn');
  }
  revive(by: PlayerState, o: PlayerState) {
    if (o.life !== 'down' || by.items.medkit <= 0) return;
    by.items.medkit--;
    o.life = 'alive';
    o.hp = 45;
    o.injured = true;
    o.downT = 0;
    this.emit({ e: 'revive', f: o.floor, pid: o.id, by: by.id });
    this.msg(null, `${by.name} revived ${o.name}.`, 'good');
  }

  private checkEnd() {
    if (this.phase !== 'playing' || !this.players.length) return;
    const alive = this.players.filter((p) => p.life === 'alive' && p.connected);
    const pending = this.players.filter((p) => p.life === 'down' && p.connected);
    if (!alive.length) {
      this.phase = 'lost';
      this.stats.endT = this.t;
      this.lostReason = this.cfg.mode === 'single' ? 'Killed in action. One life — the run is over.' : pending.length ? 'The whole squad is down. Nobody left to revive.' : 'Squad wiped out.';
    }
  }

  // ------------------------------------------------------------------ objective
  startUpload(p: PlayerState) {
    if (this.objective.uploadStarted || p.floor !== FINAL_FLOOR) return;
    this.objective.uploadStarted = true;
    this.objective.uploadT = SHUTDOWN_SECONDS;
    this.objective.by = p.id;
    const fs = this.floorState(FINAL_FLOOR);
    fs.wave = { active: true, t: SHUTDOWN_SECONDS, spawnT: 1.5, spawned: 0 };
    this.emit({ e: 'stinger', f: FINAL_FLOOR, k: 'upload' });
    this.msg(null, 'VIRUS UPLOADING. Hold the mainframe for 60 seconds!', 'warn');
    for (const e of fs.enemies) if (e.state !== 'dead') this.ai.becomeAlert(fs, e, p, true);
  }

  private updateWave(fs: FloorState, dt: number) {
    const w = fs.wave!;
    w.t -= dt;
    w.spawnT -= dt;
    this.objective.uploadT = Math.max(0, w.t);
    const alive = fs.enemies.filter((e) => e.state !== 'dead').length;
    if (w.spawnT <= 0 && w.t > 3) {
      w.spawnT = { normal: 3.4, hard: 2.8, insane: 2.2 }[this.cfg.difficulty];
      if (alive < 18) this.spawnWaveGroup(fs);
    }
    if (w.t <= 0) {
      w.active = false;
      this.objective.done = true;
      const anyAlive = this.players.some((p) => p.life === 'alive');
      if (anyAlive) {
        this.phase = 'won';
        this.stats.endT = this.t;
        this.emit({ e: 'stinger', f: fs.floor, k: 'victory' });
        for (const e of fs.enemies) if (e.state !== 'dead') { e.state = 'dead'; e.hp = 0; this.emit({ e: 'die', f: fs.floor, id: e.id, t: e.type, x: e.x, y: e.y }); }
      }
    }
  }

  private spawnWaveGroup(fs: FloorState) {
    const m = fs.L.mainframe!;
    const alivePlayers = this.players.filter((p) => p.life === 'alive' && p.connected && p.floor === fs.floor);
    const pts = m.spawnPoints.filter((s) => alivePlayers.every((p) => dist(p.x, p.y, s.x, s.y) > 7));
    const sp = this.rng.pick(pts.length ? pts : m.spawnPoints);
    const n = this.rng.int(1, this.cfg.difficulty === 'insane' ? 3 : 2) + (fs.wave!.spawned > 8 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const type: EnemyType = this.rng.chance(0.5) ? 'cyborg' : 'loyalist';
      const s = { type, x: sp.x + this.rng.range(-0.6, 0.6), y: sp.y + this.rng.range(-0.6, 0.6), squad: 999, behavior: 'patrol' as const, route: [{ x: sp.x, y: sp.y }], elite: this.rng.chance(0.4), weapon: type === 'cyborg' ? this.rng.pick(['sr4', 'aro', 'pdw50', 'a12']) : this.rng.pick(['sr4', 'k45', 'br12', 'fb25']) };
      if (!isWalkableTile(fs.L, Math.floor(s.x), Math.floor(s.y))) { s.x = sp.x; s.y = sp.y; }
      const e = makeEnemy(this.id(), this.zombify(s), FINAL_FLOOR, enemyStatsFor);
      e.mag = weapon(e.weapon).mag;
      e.spawnWave = true;
      fs.enemies.push(e);
      const tgt = alivePlayers.sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y))[0];
      if (tgt) { e.pushing = this.rng.chance(0.5); this.ai.becomeAlert(fs, e, tgt, true); }
      fs.wave!.spawned++;
    }
    this.emit({ e: 'stinger', f: fs.floor, k: 'wave' });
  }

  // ------------------------------------------------------------------ atmosphere
  private scareDirector(fs: FloorState, dt: number) {
    if (fs.floor < 3 || fs.wave?.active) return;
    fs.scareT -= dt;
    if (fs.scareT > 0) return;
    const pr = this.pressure(fs.floor);
    fs.scareT = this.rng.range(45, 120) / (1 + pr.bracket * 0.04);
    const here = this.players.filter((p) => p.floor === fs.floor && p.life === 'alive' && p.connected);
    if (!here.length) return;
    const p = this.rng.pick(here);
    const kind = this.rng.weighted<'lightburst' | 'slam' | 'scream' | 'shadow' | 'whisper' | 'metal' | 'dog'>([
      ['lightburst', 3], ['slam', 2], ['scream', 1 + pr.bracket * 0.1], ['shadow', 2], ['whisper', fs.floor > 40 ? 2 : 0.3], ['metal', 2], ['dog', 1.5],
    ]);
    const a = this.rng.range(0, 6.28), r = this.rng.range(7, 16);
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    if (kind === 'lightburst' && !fs.lightsFixed) { // a repaired grid doesn't pop bulbs
      let bi = -1, bd = 9;
      fs.L.lights.forEach((l, i) => { const d = dist(l.x, l.y, p.x, p.y); if (!fs.lights[i].broken && l.kind === 'ceiling' && d < bd && d > 2) { bd = d; bi = i; } });
      if (bi >= 0) {
        fs.lights[bi].broken = true;
        fs.lights[bi].burstT = 1;
        const l = fs.L.lights[bi];
        this.emit({ e: 'scare', f: fs.floor, k: 'lightburst', x: l.x, y: l.y, lid: bi });
        this.emit({ e: 'stinger', f: fs.floor, k: 'scare' });
      }
    } else if (kind === 'dog') {
      const dog = fs.enemies.find((e) => (e.type === 'dog' || e.type === 'dogcyborg') && e.state !== 'dead' && e.state !== 'alert' && dist(e.x, e.y, p.x, p.y) < 18);
      if (dog) { this.ai.becomeAlert(fs, dog, p, true); this.emit({ e: 'stinger', f: fs.floor, k: 'scare' }); }
      else this.emit({ e: 'scare', f: fs.floor, k: 'metal', x, y });
    } else {
      this.emit({ e: 'scare', f: fs.floor, k: kind, x, y });
      if (kind === 'shadow' || kind === 'scream') this.emit({ e: 'stinger', f: fs.floor, k: 'scare' });
    }
  }

  // ------------------------------------------------------------------ persistence (single player)
  exportSave(p: PlayerState) {
    return {
      v: 1, seed: this.cfg.seed, difficulty: this.cfg.difficulty, floor: p.floor, t: this.t,
      cleared: [...this.clearedFlights], stats: { ...this.stats },
      player: {
        name: p.name, hp: p.hp, armor: p.armor, helmet: p.helmet, injured: p.injured, vest: (p as any).vest,
        weapons: JSON.parse(JSON.stringify(p.weapons)), sel: p.sel, ammo: { ...p.ammo }, grenades: { ...p.grenades }, items: { ...p.items },
        mods: { ...p.mods }, battery: p.battery, kills: p.kills, checkedIn: p.checkedIn, loadout: p.loadout, coins: p.coins, keys: [...p.keys], look: p.look,
      },
    };
  }
  static fromSave(s: ReturnType<Sim['exportSave']>, id: number): Sim {
    const sim = new Sim({ seed: s.seed, difficulty: s.difficulty, mode: 'single', holiday: currentHoliday() });
    const p = sim.addPlayer(id, s.player.name, { primary: null, secondary: 'p9', armor: 'none', grenades: {}, items: {}, mods: s.player.mods });
    Object.assign(p, { hp: s.player.hp, armor: s.player.armor, helmet: s.player.helmet, injured: s.player.injured, weapons: s.player.weapons, sel: s.player.sel, ammo: s.player.ammo, grenades: s.player.grenades, items: s.player.items, battery: s.player.battery, kills: s.player.kills });
    (p as any).vest = s.player.vest;
    p.checkedIn = (s.player as any).checkedIn ?? true; // saves from before check-in existed were already kitted
    p.loadout = (s.player as any).loadout;
    if (s.player.look) p.look = sanitizeLook(s.player.look);
    p.coins = s.player.coins ?? 0; p.keys = s.player.keys ?? []; // older saves had neither
    for (const c of s.cleared) sim.clearedFlights.add(c);
    sim.stats = { ...s.stats };
    sim.t = s.t;
    const tag = s.floor === 0 ? 'start' : 'stair0';
    if (s.floor > 0) sim.travel(p, s.floor, tag, 'resume');
    return sim;
  }
}

export { emptyInput };
