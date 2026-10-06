import { fixFloorLights } from '../sim/hack';
import { makePanels } from '../sim/lights';
import { Transport, RelayMsg } from './transport';
import { decodePlayer, encodeInput, NET_VERSION, DOOR_MODES } from './protocol';
import { stockLeft, takeStock } from '../sim/inventory';
import { unpackVoice, VOICE_UP } from './voice';
import { BuildingPlan, StairCondition } from '../gen/building';
import { generateFloor, setFlightBlocked, setDoorSolid } from '../gen/floor';
import { CONTAINER_LABEL } from '../gen/loot';
import { createPlayer, movePlayer } from '../sim/player';
import { weapon } from '../config/weapons';
import type { FloorState, PlayerState, SimEvent, Loadout, Enemy } from '../sim/state';
import type { ViewSource } from '../render/view';
import type { Difficulty } from '../config/difficulty';
import { emptyLoadout } from '../sim/loadout';
import type { PlayerLook } from '../config/look';
import { setHolidayOverride, type Holiday } from '../config/holiday';

type Sample = { t: number; x: number; y: number; fa: number };
/** Remote entities are drawn this far behind the newest snapshot, so there is (almost) always a pair to interpolate. */
const INTERP_DELAY = 0.12;

/** Client-side mirror of the host's world, built from deterministic generation + snapshots. */
export class ClientView implements ViewSource {
  t = 0;
  players: PlayerState[] = [];
  plan: BuildingPlan;
  cfg: { mode: 'coop'; difficulty: Difficulty; seed: number };
  objective = { uploadStarted: false, uploadT: 60, done: false };
  phase: 'playing' | 'won' | 'lost' = 'playing';
  lostReason = '';
  stats = { kills: 0, maxFloor: 0, startT: 0, endT: 0 };
  cleared = new Set<string>();
  private floors = new Map<number, FloorState>();
  /** timestamped positions of remote players ('p'+id) and enemies ('e'+id), drawn INTERP_DELAY in the past */
  private hist = new Map<string, Sample[]>();
  /** local estimate of the authority's sim clock */
  private clock = NaN;
  private histFloor = -1;
  events: SimEvent[] = [];
  /** the first snapshot has placed the local player (until then it has no real position to predict from) */
  placed = false;

  constructor(seed: number, difficulty: Difficulty, roster: { id: number; name: string; slot: number }[]) {
    this.cfg = { mode: 'coop', difficulty, seed };
    this.plan = new BuildingPlan(seed, difficulty);
    for (const r of roster) {
      const p = createPlayer(r.id, r.slot, r.name, emptyLoadout());
      this.players.push(p);
    }
  }

  floorState(f: number): FloorState {
    let fs = this.floors.get(f);
    if (fs) return fs;
    const L = generateFloor(this.plan, f);
    fs = {
      floor: f, L, enemies: [], cameras: L.cameras.map((c) => ({ id: c.id, x: c.x, y: c.y, baseAngle: c.angle, sweep: c.sweep, speed: c.speed, phase: c.phase, range: c.range, fov: c.fov, angle: c.angle, alive: true, detect: 0, alarmT: 0, hp: 1 })),
      traps: L.traps.map((t) => ({ ...t, armed: true, revealed: false, fuse: 0 })),
      containers: L.containers.map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, items: c.items.map((i) => ({ ...i })), opened: false, label: CONTAINER_LABEL[c.kind] })),
      vendings: L.vendings.map((v) => ({ id: v.id, x: v.x, y: v.y, rot: v.rot, hp: 45, broken: false, drops: v.drops.map((d) => ({ ...d })), price: v.price })),
      doors: L.doors.map((d) => { setDoorSolid(L, d, d.init); return { id: d.id, state: d.init }; }), // the cached layout is shared: (re)apply
      hazards: L.hazards.map((h) => ({ ...h })), grenades: [], zones: [], pings: [],
      lights: L.lights.map((l) => ({ broken: l.broken, burstT: 0 })), panels: makePanels(L), debris: {}, wave: null, scareT: 1e9, networkAlertT: 0,
      hacks: L.hacks.map((h) => ({ id: h.id, kind: h.kind, x: h.x, y: h.y, state: 'ready' as const })), lightsFixed: false, npcHold: {}, npcTalk: [],
    };
    for (const key of this.cleared) this.unblock(key, fs);
    this.floors.set(f, fs);
    return fs;
  }

  private unblock(key: string, only?: FloorState) {
    const [cf, ci] = key.split(':').map(Number);
    for (const fs of only ? [only] : [...this.floors.values()]) {
      if (fs.floor === cf) setFlightBlocked(fs.L, fs.L.stairs[ci], 1, false);
      if (fs.floor === cf + 1) setFlightBlocked(fs.L, fs.L.stairs[ci], -1, false);
    }
  }

  flightCondition(f: number, i: number): StairCondition {
    const c = this.plan.up(f, i);
    return c === 'debris' && this.cleared.has(`${f}:${i}`) ? 'clear' : c;
  }

  player(id: number) { return this.players.find((p) => p.id === id); }

  apply(s: any, localId: number) {
    this.t = s.t;
    // follow the authority's clock: snap when far off, otherwise nudge (absorbs network jitter)
    this.clock = Math.abs(s.t - this.clock) < 0.5 ? this.clock + (s.t - this.clock) * 0.15 : s.t;
    this.phase = s.ph; this.lostReason = s.why; this.objective = s.obj; this.stats = s.st;
    for (const k of s.cl as string[]) if (!this.cleared.has(k)) { this.cleared.add(k); this.unblock(k); }
    for (const o of s.pl) {
      let p = this.player(o.id);
      if (!p) { p = createPlayer(o.id, o.slot, o.name, emptyLoadout()); this.players.push(p); }
      const local = o.id === localId;
      const tpChanged = local && o.tp !== ((p as any).tp ?? 0);
      decodePlayer(p, o, local);
      // first snapshot: take the spawn point (prediction starts from createPlayer's default otherwise)
      const first = local && !this.placed;
      if (local) this.placed = true;
      if (local && (first || tpChanged || p.life !== 'alive' || p.ride)) { p.x = o.x; p.y = o.y; p.z = o.z; (p as any).tp = o.tp; p.vx = p.vy = 0; }
      if (!local) this.push('p' + p.id, s.t, o.x, o.y, o.fa);
    }
    this.players = this.players.filter((p) => s.pl.some((o: any) => o.id === p.id));
    const F = s.fl;
    const fs = this.floorState(F.f);
    if (F.f !== this.histFloor) { this.histFloor = F.f; for (const k of [...this.hist.keys()]) if (k[0] === 'e') this.hist.delete(k); }
    const byId = new Map(fs.enemies.map((e) => [e.id, e]));
    const next: Enemy[] = [];
    for (const a of F.en) {
      const [id, type, elite, x, y, facing, hp, maxHp, state, shotT, flashT, hasCover, coverX, coverY, target, wpn] = a;
      let e = byId.get(id);
      if (!e) {
        e = { id, type, elite: !!elite, x, y, facing, vx: 0, vy: 0, hp, maxHp, armor: 0, state, prevState: state, aware: 0, target, lastKnownX: x, lastKnownY: y, lastSeenT: 0, interestX: x, interestY: y, path: null, pathGoalX: 0, pathGoalY: 0, pathT: 0, route: [], routeI: 0, homeX: x, homeY: y, homeFacing: 0, squad: 0, weapon: wpn, mag: weapon(wpn).mag, fireCd: 0, reloadT: 0, burstLeft: 0, stateT: 0, thinkT: 0, coverX, coverY, hasCover: !!hasCover, flankSide: 1, flashT, stunT: 0, pushing: false, barkT: 0, deadT: 0, anim: 0, shotT, seenBy: 0, spawnWave: false } as Enemy;
      }
      Object.assign(e, { hp, maxHp, state, shotT, flashT, hasCover: !!hasCover, coverX, coverY, target });
      this.push('e' + id, s.t, x, y, facing);
      next.push(e);
    }
    fs.enemies = next;
    for (const [id, angle, alive, detect, alarmT] of F.cam) { const c = fs.cameras.find((c) => c.id === id); if (c) Object.assign(c, { angle, alive: !!alive, detect, alarmT }); }
    for (const [id, armed, revealed, fuse, spent] of F.tr) { const t = fs.traps.find((t) => t.id === id); if (t) { Object.assign(t, { armed: !!armed, revealed: !!revealed, fuse }); (t as any).spent = !!spent; } }
    for (const v of fs.vendings) v.broken = F.vd.includes(v.id);
    for (const [id, left] of F.vs ?? []) { const v = fs.vendings.find((q) => q.id === id); while (v && v.drops.length && stockLeft(v.drops) > left) takeStock(v.drops); }
    // doors change collision: the local L must agree so own-movement prediction and line of sight match the host
    for (const [id, m] of F.dr ?? []) { const i = fs.doors.findIndex((d) => d.id === id); if (i >= 0 && fs.doors[i].state !== DOOR_MODES[m]) { fs.doors[i].state = DOOR_MODES[m]; setDoorSolid(fs.L, fs.L.doors[i], DOOR_MODES[m]); } }
    fs.grenades = F.gr.map(([id, kind, x, y, z]: any) => ({ id, kind, x, y, z, vx: 0, vy: 0, vz: 0, fuse: 1, owner: 0, rest: false }));
    fs.zones = F.zn.map(([id, kind, x, y, r, t]: any) => ({ id, kind, x, y, r, t, tick: 0 }));
    fs.pings = F.pg.map(([id, enemyId, x, y, by, t]: any) => ({ id, enemyId, x, y, by, t }));
    const lb = new Set<number>(F.lb);
    fs.lights.forEach((l, i) => (l.broken = lb.has(i)));
    const lo = new Set<number>(F.lo ?? []);
    fs.lights.forEach((l, i) => (l.off = lo.has(i)));
    for (const [id, dead, off] of F.pn ?? []) { const pn = fs.panels.find((q) => q.id === id); if (pn) { pn.dead = !!dead; pn.off = !!off; } }
    for (const [id, st] of F.hk ?? []) { const h = fs.hacks.find((h) => h.id === id); if (h) h.state = st; }
    if (F.lf && !fs.lightsFixed) fixFloorLights(fs);
    if (F.nh) { fs.npcHold = F.nh; fs.npcTalk = F.nt ?? []; }
    if (F.ct) fs.containers = F.ct.map(([id, kind, x, y, opened, items, label]: any) => ({ id, kind, x, y, opened: !!opened, items, label }));
    fs.wave = F.wave;
    for (const ev of s.ev) this.events.push(ev);
  }

  private push(key: string, t: number, x: number, y: number, fa: number) {
    let h = this.hist.get(key);
    if (!h) this.hist.set(key, (h = []));
    if (h.length && t <= h[h.length - 1].t) h.length = 0; // a restarted clock (rejoin): start over
    h.push({ t, x, y, fa });
    if (h.length > 24) h.splice(0, h.length - 24);
  }

  /** Where `key` was at time `t`: interpolated between snapshots, briefly extrapolated past the newest one. */
  private sample(key: string, t: number): Sample | null {
    const h = this.hist.get(key);
    if (!h?.length) return null;
    let i = h.length - 1;
    while (i > 0 && h[i].t > t) i--;
    const a = h[i], b = h[i + 1];
    if (!b) {
      // past the newest snapshot: keep going for up to 0.1 s at the last known velocity, then hold
      const p = h[i - 1];
      if (!p || t <= a.t || Math.hypot(a.x - p.x, a.y - p.y) > 4) return a;
      const k = Math.min(t - a.t, 0.1) / (a.t - p.t);
      return { t, x: a.x + (a.x - p.x) * k, y: a.y + (a.y - p.y) * k, fa: a.fa };
    }
    if (t <= a.t || Math.hypot(b.x - a.x, b.y - a.y) > 4) return t < b.t ? a : b; // before the history, or a teleport
    const k = (t - a.t) / (b.t - a.t);
    let dfa = b.fa - a.fa;
    dfa = Math.atan2(Math.sin(dfa), Math.cos(dfa));
    return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, fa: a.fa + dfa * k };
  }

  /** Place remote players and enemies on the interpolated timeline (INTERP_DELAY behind the authority). */
  smooth(dt: number, localId: number) {
    this.t += dt;
    this.clock += dt;
    const rt = this.clock - INTERP_DELAY;
    for (const p of this.players) {
      if (p.id === localId) continue;
      const q = this.sample('p' + p.id, rt);
      if (q) { p.x = q.x; p.y = q.y; p.facing = q.fa; }
    }
    const me = this.player(localId);
    if (!me) return;
    const fs = this.floorState(me.floor);
    for (const e of fs.enemies) {
      const q = this.sample('e' + e.id, rt);
      if (q) { e.x = q.x; e.y = q.y; e.facing = q.fa; }
    }
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}

export class ClientSession {
  t = new Transport();
  id = 0;
  code = '';
  /** set when connected to a dedicated server (no host player): its name and message of the day */
  server: { name: string; motd: string } | null = null;
  view: ClientView | null = null;
  lobby: { players: { id: number; name: string; ready: boolean; host: boolean }[]; difficulty: Difficulty; ff?: boolean; stage: string; seed: number; deployIn?: number | null; late?: boolean } | null = null;
  /** the holiday theme before the host/server's took over (restored on close) */
  private prevHoliday: Holiday | null | undefined | false = false;
  private sendT = 0;
  onLobby: () => void = () => {};
  onStart: (v: ClientView) => void = () => {};
  onDisconnect: (reason: string) => void = () => {};
  /** a proximity voice frame from a squadmate (only sent while voice is on, see setVoice) */
  onVoice: (speaker: number, opus: Uint8Array) => void = () => {};
  private voiceOn = false;

  /** code: the relay squad code ('' on a dedicated server); password: dedicated servers only. */
  async join(url: string, code: string, name: string, password = ''): Promise<void> {
    await this.t.connect(url);
    await new Promise<void>((resolve, reject) => {
      this.t.onMsg = (m) => {
        if (m.t === 'joined') {
          this.id = m.id; this.code = m.code; this.server = m.srv ?? null;
          this.t.onMsg = (mm) => this.handle(mm);
          this.t.onClose = (r) => this.onDisconnect(r);
          this.t.onBinary = (b) => { const v = unpackVoice(b); if (v) this.onVoice(v.speaker, v.opus); };
          this.t.send({ t: 'to_host', d: { k: 'hello', name, v: NET_VERSION } });
          resolve();
        } else if (m.t === 'error') reject(new Error(m.msg));
      };
      this.t.onClose = (r) => reject(new Error(r)); // refused without a message (e.g. connection limit)
      this.t.send({ t: 'join', code: code.trim().toUpperCase(), name, v: NET_VERSION, pw: password });
    });
  }

  close() {
    this.t.close();
    if (this.prevHoliday !== false) { setHolidayOverride(this.prevHoliday); this.prevHoliday = false; }
  }

  ready(lo: Loadout, look?: PlayerLook) { this.t.send({ t: 'to_host', d: { k: 'ready', loadout: lo, look } }); }

  /** Opt in/out of receiving squad voice (the server sends nothing to players with voice off). */
  setVoice(on: boolean) { this.voiceOn = on; this.t.send({ t: 'to_host', d: { k: 'vc', on } }); }
  /** One encoded Opus frame from our microphone. */
  sendVoice(opus: Uint8Array) {
    const b = new Uint8Array(opus.length + 1);
    b[0] = VOICE_UP; b.set(opus, 1);
    this.t.sendBinary(b);
  }

  private handle(m: RelayMsg) {
    // the socket closes right after: report this reason, not a generic "Connection lost"
    if (m.t === 'host_left' || m.t === 'error') { this.t.onClose = () => {}; this.onDisconnect(m.t === 'error' ? m.msg : 'The host left — mission aborted.'); return; }
    if (m.t !== 'data') return;
    const d = m.d;
    if (d.k === 'lobby') { this.lobby = d; this.onLobby(); }
    else if (d.k === 'start') {
      // dress the tower in the authority's holiday theme (Halloween also changes the enemies)
      if (d.hol !== undefined) { const prev = setHolidayOverride(d.hol); if (this.prevHoliday === false) this.prevHoliday = prev; }
      this.view = new ClientView(d.seed, d.difficulty, d.players);
      if (this.voiceOn) this.setVoice(true); // a rejoin is a new id on the server: opt in again
      this.onStart(this.view);
    }
    else if (d.k === 'snap' && this.view) this.view.apply(d, this.id);
  }

  /** Local prediction of own movement + input upload. */
  update(dt: number) {
    const v = this.view;
    if (!v || !v.placed) return; // don't report createPlayer's default position as ours
    const me = v.player(this.id);
    if (me && me.life === 'alive' && !me.ride) {
      const inp = me.input;
      me.crouch = inp.crouch && me.z <= 0.01;
      me.aiming = inp.aim;
      me.moving = Math.hypot(inp.mx, inp.my) > 0.15;
      me.sprinting = inp.sprint && me.moving && !me.crouch && !(inp.fire && me.sel !== 'knife') && !me.aiming;
      movePlayer(me, v.floorState(me.floor).L, dt);
      me.last.jump = inp.jump;
      me.aimX = inp.ax; me.aimY = inp.ay; me.aimZ = inp.az;
      if (Math.hypot(inp.ax - me.x, inp.ay - me.y) > 0.05) me.facing = Math.atan2(inp.ay - me.y, inp.ax - me.x);
    }
    v.smooth(dt, this.id);
    this.sendT += dt;
    if (me && this.sendT >= 1 / 30) { this.sendT = 0; this.t.send({ t: 'to_host', d: encodeInput(me) }); }
  }
}
