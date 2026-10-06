import type { PlayerState, FloorState, SimEvent, Enemy, PlayerInput } from '../sim/state';
import { emptyInput } from '../sim/state';
import type { Sim } from '../sim/sim';
import { APP_VERSION } from '../config/version';
import { stockLeft } from '../sim/inventory';
import type { DoorMode } from '../gen/floor';
import { lookToWire, lookFromWire } from '../config/look';

export const DOOR_MODES: DoorMode[] = ['open', 'closed', 'locked'];

export const SNAP_HZ = 15;
/** Wire protocol version: bump on any incompatible message change. Clients send it on join; servers refuse a mismatch. */
export const NET_VERSION = 5; // v5: player appearance (look) in ready + snapshots; v4: doors (they change collision), coins + keys; v3 (1.2.0): late join window, proximity voice
/** Joins report the protocol (v) and the app release (av): server and every game must be the very same release, 1:1. */
export const sameRelease = (m: { v?: unknown; av?: unknown }) => m.v === NET_VERSION && m.av === APP_VERSION;
export const versionMismatch = (theirs: unknown) =>
  `Version mismatch: the server runs Tower Breach ${APP_VERSION}, your game is ${typeof theirs === 'string' && /^[\w.\-]{1,20}$/.test(theirs) ? theirs : 'an older release'}. Everyone must run the same release: update the game (or the server).`;

/** Callsign rules (same as the co-op screen): letters, digits, space . - ' _ ; max 16. */
export const cleanName = (n: unknown) => String(n ?? '').replace(/[^\w .\-']/g, '').trim().slice(0, 16);
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Player fields every client needs; the recipient gets its own inventory in full. */
export function encodePlayer(p: PlayerState, full: boolean) {
  const base: any = {
    id: p.id, slot: p.slot, name: p.name, c: p.connected, f: p.floor, x: r2(p.x), y: r2(p.y), z: r2(p.z), fa: r2(p.facing),
    ax: r2(p.aimX), ay: r2(p.aimY), az: Number.isFinite(p.aimZ) ? r2(p.aimZ) : null, hp: Math.round(p.hp * 10) / 10, ar: Math.round(p.armor), hl: p.helmet, inj: p.injured, life: p.life, dt: r2(p.downT),
    cr: p.crouch, sp: p.sprinting, am: p.aiming, mv: p.moving, sel: p.sel, w: p.weapons, torch: p.torchOn, bat: r2(p.battery), mods: p.mods,
    hurt: r2(p.hurtT), tp: (p as any).tp ?? 0, k: p.kills, ride: p.ride, ci: p.checkedIn ? 1 : 0, lk: p.look && lookToWire(p.look),
  };
  if (full) {
    Object.assign(base, {
      ammo: p.ammo, gr: p.grenades, gs: p.grenadeSel, it: p.items, is: p.itemSel, boost: r2(p.boostT), rl: r2(p.reloadT), rd: r2(p.reloadDur ?? 0), hold: p.hold,
      exp: r2(p.exposure), pr: p.prompt, panel: (p as any).panel, vest: (p as any).vest, fl: r2(p.flashT), burn: r2(p.burnT), co: p.coins, ky: p.keys,
    });
  }
  return base;
}

export function decodePlayer(p: PlayerState, o: any, isLocal: boolean) {
  if (!isLocal) {
    p.x = o.x; p.y = o.y; p.z = o.z; p.facing = o.fa; p.aimX = o.ax; p.aimY = o.ay; p.aimZ = o.az ?? NaN;
    p.crouch = o.cr; p.sprinting = o.sp; p.aiming = o.am; p.moving = o.mv;
  }
  p.slot = o.slot; p.name = o.name; p.connected = o.c; p.floor = o.f; p.hp = o.hp; p.armor = o.ar; p.helmet = o.hl; p.injured = o.inj;
  p.life = o.life; p.downT = o.dt; p.sel = o.sel; p.weapons = o.w; p.torchOn = o.torch; p.battery = o.bat; p.mods = o.mods; p.hurtT = o.hurt; p.kills = o.k; p.ride = o.ride; p.checkedIn = !!o.ci; // co-op HUD street objective
  p.look = lookFromWire(o.lk);
  if (o.ammo) {
    p.ammo = o.ammo; p.grenades = o.gr; p.grenadeSel = o.gs; p.items = o.it; p.itemSel = o.is; p.boostT = o.boost; p.reloadT = o.rl; p.reloadDur = o.rd; p.hold = o.hold;
    p.exposure = o.exp; p.prompt = o.pr; (p as any).panel = o.panel; (p as any).vest = o.vest; p.flashT = o.fl; p.burnT = o.burn; p.coins = o.co ?? 0; p.keys = o.ky ?? [];
  }
}

const ENEMY_FIELDS = (e: Enemy) => [e.id, e.type, e.elite ? 1 : 0, r2(e.x), r2(e.y), r2(e.facing), Math.round(e.hp), Math.round(e.maxHp), e.state, r2(Math.min(e.shotT, 9)), r2(e.flashT), e.hasCover ? 1 : 0, r2(e.coverX), r2(e.coverY), e.target, e.weapon];

export function encodeFloor(fs: FloorState, withContainers: boolean) {
  return {
    f: fs.floor,
    en: fs.enemies.map(ENEMY_FIELDS),
    cam: fs.cameras.map((c) => [c.id, r2(c.angle), c.alive ? 1 : 0, r2(c.detect), r2(c.alarmT)]),
    tr: fs.traps.map((t) => [t.id, t.armed ? 1 : 0, t.revealed ? 1 : 0, r2(t.fuse), (t as any).spent ? 1 : 0]),
    vd: fs.vendings.filter((v) => v.broken).map((v) => v.id),
    vs: fs.vendings.map((v) => [v.id, stockLeft(v.drops)]),
    dr: fs.doors.map((d) => [d.id, DOOR_MODES.indexOf(d.state)]),
    gr: fs.grenades.map((g) => [g.id, g.kind, r2(g.x), r2(g.y), r2(g.z)]),
    zn: fs.zones.map((z) => [z.id, z.kind, r2(z.x), r2(z.y), z.r, r2(z.t)]),
    pg: fs.pings.map((p) => [p.id, p.enemyId, r2(p.x), r2(p.y), p.by, r2(p.t)]),
    lb: fs.lights.map((l, i) => (l.broken ? i : -1)).filter((i) => i >= 0),
    lo: fs.lights.map((l, i) => (l.off || l.cut ? i : -1)).filter((i) => i >= 0),
    pn: fs.panels.map((p) => [p.id, p.dead ? 1 : 0, p.off ? 1 : 0]),
    hk: fs.hacks.map((h) => [h.id, h.state]),
    lf: fs.lightsFixed ? 1 : 0,
    nh: fs.floor === 0 ? fs.npcHold : undefined,
    nt: fs.floor === 0 ? fs.npcTalk : undefined,
    ct: withContainers ? fs.containers.map((c) => [c.id, c.kind, r2(c.x), r2(c.y), c.opened ? 1 : 0, c.items, c.label]) : undefined,
    wave: fs.wave,
  };
}

export function encodeSnapshot(sim: Sim, recipient: number, events: SimEvent[], withContainers: boolean) {
  const me = sim.player(recipient)!;
  return {
    k: 'snap', t: r2(sim.t), ph: sim.phase, why: sim.lostReason, obj: sim.objective, cl: [...sim.clearedFlights], st: sim.stats,
    pl: sim.players.map((p) => encodePlayer(p, p.id === recipient)),
    fl: encodeFloor(sim.floorState(me.floor), withContainers),
    ev: events,
  };
}

/** Client -> host input packet (client-authoritative movement, host-authoritative everything else). */
export function encodeInput(p: PlayerState) {
  const i = p.input;
  return { k: 'in', i, x: r2(p.x), y: r2(p.y), z: r2(p.z), cr: p.crouch, sp: p.sprinting, mv: p.moving, tp: (p as any).tp ?? 0 };
}
export type InputPacket = { k: 'in'; i: PlayerInput; x: number; y: number; z: number; cr: boolean; sp: boolean; mv: boolean; tp: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const RANGE: Partial<Record<keyof PlayerInput, [number, number]>> = { mx: [-1, 1], my: [-1, 1], ax: [-1e4, 1e4], ay: [-1e4, 1e4], az: [-50, 50] };

/**
 * Untrusted client input -> a well-formed InputPacket, or null. Every PlayerInput field is coerced to its
 * type and clamped; unknown fields are dropped. The sim then applies its own game rules on top.
 */
export function sanitizeInputPacket(d: any): InputPacket | null {
  if (!d || typeof d.i !== 'object' || !d.i) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const x = num(d.x), y = num(d.y), z = num(d.z);
  if (Number.isNaN(x + y + z)) return null;
  const i = emptyInput();
  for (const k of Object.keys(i) as (keyof PlayerInput)[]) {
    const v = d.i[k];
    if (typeof i[k] === 'boolean') (i as any)[k] = v === true;
    else if (k === 'az') i.az = v === null || v === undefined ? NaN : clamp(num(v) || 0, -50, 50); // JSON turns NaN into null
    else {
      const [lo, hi] = RANGE[k] ?? [-1e9, 1e9];
      const n = num(v);
      (i as any)[k] = Number.isNaN(n) ? (i as any)[k] : RANGE[k] ? clamp(n, lo, hi) : clamp(Math.trunc(n), lo, hi);
    }
  }
  return { k: 'in', i, x, y, z, cr: d.cr === true, sp: d.sp === true, mv: d.mv === true, tp: Math.trunc(num(d.tp)) || 0 };
}
