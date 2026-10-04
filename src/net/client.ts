import { fixFloorLights } from '../sim/hack';
import { makePanels } from '../sim/lights';
import { Transport, RelayMsg } from './transport';
import { decodePlayer, encodeInput } from './protocol';
import { BuildingPlan, StairCondition } from '../gen/building';
import { generateFloor, setFlightBlocked } from '../gen/floor';
import { CONTAINER_LABEL } from '../gen/loot';
import { createPlayer, movePlayer } from '../sim/player';
import { weapon } from '../config/weapons';
import type { FloorState, PlayerState, SimEvent, Loadout, Enemy } from '../sim/state';
import type { ViewSource } from '../render/view';
import type { Difficulty } from '../config/difficulty';
import { emptyLoadout } from '../ui/shop';

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
  private targets = new Map<number, { x: number; y: number; f: number }>();
  private remoteTargets = new Map<number, { x: number; y: number; fa: number }>();
  events: SimEvent[] = [];

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
      vendings: L.vendings.map((v) => ({ id: v.id, x: v.x, y: v.y, rot: v.rot, hp: 45, broken: false, drops: v.drops })),
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
    this.phase = s.ph; this.lostReason = s.why; this.objective = s.obj; this.stats = s.st;
    for (const k of s.cl as string[]) if (!this.cleared.has(k)) { this.cleared.add(k); this.unblock(k); }
    for (const o of s.pl) {
      let p = this.player(o.id);
      if (!p) { p = createPlayer(o.id, o.slot, o.name, emptyLoadout()); this.players.push(p); }
      const local = o.id === localId;
      const tpChanged = local && o.tp !== ((p as any).tp ?? 0);
      decodePlayer(p, o, local);
      if (local && (tpChanged || p.life !== 'alive' || p.ride)) { p.x = o.x; p.y = o.y; p.z = o.z; (p as any).tp = o.tp; p.vx = p.vy = 0; }
      if (!local) this.remoteTargets.set(p.id, { x: o.x, y: o.y, fa: o.fa });
    }
    this.players = this.players.filter((p) => s.pl.some((o: any) => o.id === p.id));
    const F = s.fl;
    const fs = this.floorState(F.f);
    const byId = new Map(fs.enemies.map((e) => [e.id, e]));
    const next: Enemy[] = [];
    for (const a of F.en) {
      const [id, type, elite, x, y, facing, hp, maxHp, state, shotT, flashT, hasCover, coverX, coverY, target, wpn] = a;
      let e = byId.get(id);
      if (!e) {
        e = { id, type, elite: !!elite, x, y, facing, vx: 0, vy: 0, hp, maxHp, armor: 0, state, prevState: state, aware: 0, target, lastKnownX: x, lastKnownY: y, lastSeenT: 0, interestX: x, interestY: y, path: null, pathGoalX: 0, pathGoalY: 0, pathT: 0, route: [], routeI: 0, homeX: x, homeY: y, homeFacing: 0, squad: 0, weapon: wpn, mag: weapon(wpn).mag, fireCd: 0, reloadT: 0, burstLeft: 0, stateT: 0, thinkT: 0, coverX, coverY, hasCover: !!hasCover, flankSide: 1, flashT, stunT: 0, pushing: false, barkT: 0, deadT: 0, anim: 0, shotT, seenBy: 0, spawnWave: false } as Enemy;
      }
      Object.assign(e, { hp, maxHp, state, shotT, flashT, hasCover: !!hasCover, coverX, coverY, target, facing });
      this.targets.set(id, { x, y, f: facing });
      next.push(e);
    }
    fs.enemies = next;
    for (const [id, angle, alive, detect, alarmT] of F.cam) { const c = fs.cameras.find((c) => c.id === id); if (c) Object.assign(c, { angle, alive: !!alive, detect, alarmT }); }
    for (const [id, armed, revealed, fuse, spent] of F.tr) { const t = fs.traps.find((t) => t.id === id); if (t) { Object.assign(t, { armed: !!armed, revealed: !!revealed, fuse }); (t as any).spent = !!spent; } }
    for (const v of fs.vendings) v.broken = F.vd.includes(v.id);
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

  /** Smooth remote entities toward their latest replicated positions. */
  smooth(dt: number, localId: number) {
    this.t += dt;
    const k = Math.min(1, dt * 14);
    for (const p of this.players) {
      if (p.id === localId) continue;
      const t = this.remoteTargets.get(p.id);
      if (!t) continue;
      if (Math.hypot(t.x - p.x, t.y - p.y) > 4) { p.x = t.x; p.y = t.y; }
      p.x += (t.x - p.x) * k; p.y += (t.y - p.y) * k;
    }
    const me = this.player(localId);
    if (!me) return;
    const fs = this.floorState(me.floor);
    for (const e of fs.enemies) {
      const t = this.targets.get(e.id);
      if (!t) continue;
      if (Math.hypot(t.x - e.x, t.y - e.y) > 4) { e.x = t.x; e.y = t.y; }
      e.x += (t.x - e.x) * k; e.y += (t.y - e.y) * k;
    }
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
}

export class ClientSession {
  t = new Transport();
  id = 0;
  code = '';
  view: ClientView | null = null;
  lobby: { players: { id: number; name: string; ready: boolean; host: boolean }[]; difficulty: Difficulty; ff?: boolean; stage: string; seed: number } | null = null;
  private sendT = 0;
  onLobby: () => void = () => {};
  onStart: (v: ClientView) => void = () => {};
  onDisconnect: (reason: string) => void = () => {};

  async join(url: string, code: string, name: string): Promise<void> {
    await this.t.connect(url);
    this.t.onClose = (r) => this.onDisconnect(r);
    await new Promise<void>((resolve, reject) => {
      this.t.onMsg = (m) => {
        if (m.t === 'joined') { this.id = m.id; this.code = m.code; this.t.onMsg = (mm) => this.handle(mm); this.t.send({ t: 'to_host', d: { k: 'hello', name } }); resolve(); }
        else if (m.t === 'error') reject(new Error(m.msg));
      };
      this.t.send({ t: 'join', code: code.trim().toUpperCase(), name });
    });
  }

  close() { this.t.close(); }

  ready(lo: Loadout) { this.t.send({ t: 'to_host', d: { k: 'ready', loadout: lo } }); }

  private handle(m: RelayMsg) {
    if (m.t === 'host_left') { this.onDisconnect('The host left — mission aborted.'); return; }
    if (m.t === 'error') { this.onDisconnect(m.msg); return; }
    if (m.t !== 'data') return;
    const d = m.d;
    if (d.k === 'lobby') { this.lobby = d; this.onLobby(); }
    else if (d.k === 'start') { this.view = new ClientView(d.seed, d.difficulty, d.players); this.onStart(this.view); }
    else if (d.k === 'snap' && this.view) this.view.apply(d, this.id);
  }

  /** Local prediction of own movement + input upload. */
  update(dt: number) {
    const v = this.view;
    if (!v) return;
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
