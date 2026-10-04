import { dist } from '../core/math';
import { weapon } from '../config/weapons';
import { STAIR_LABEL, stairPassable } from '../gen/building';
import { FINAL_FLOOR } from '../config/difficulty';
import { giveLoot, swapWeapon } from './inventory';
import { applyHack } from './hack';
import { officerPose, AmbientSpec } from '../gen/floor';
import { npcFor } from '../config/npcs';
import type { Sim } from './sim';
import type { FloorState, PlayerState, ContainerState } from './state';
import { togglePanel } from './combat';
import type { LootItem } from './types';

interface Target {
  key: string;
  label: string;
  hold: number; // seconds; 0 = tap
  x: number; y: number;
  act: () => void;
  /** optional quick-tap action on a hold target: tap = `tap`, hold = `act` */
  tap?: () => void;
  tapLabel?: string;
  onTick?: (t: number) => void;
  blocked?: string;
  /** subtracted from distance when ranking (hack terminals share desks with lootable drawers) */
  pri?: number;
}

const REACH = 1.6;

export function updateInteraction(sim: Sim, p: PlayerState, fs: FloorState, dt: number) {
  const panel = (p as any).panel as { kind: 'elev'; elev: number; dests: number[] } | { kind: 'hack'; id: number } | { kind: 'talk'; npc: number } | null;
  // command-tent check-in / armory: the UI closes it
  if ((panel as any)?.kind === 'checkin') {
    if (p.input.closeSeq > p.last.closeSeq || p.floor !== 0 || p.life !== 'alive') (p as any).panel = null;
    p.prompt = ''; p.hold = null;
    return;
  }
  // NPC conversation: stays open until the player closes it or the officer walks off
  if (panel?.kind === 'talk') {
    const o = fs.L.ambient.find((a) => a.kind === 'officer' && a.npc === panel.npc) as Extract<AmbientSpec, { kind: 'officer' }> | undefined;
    const at = o && officerPose(o, sim.t - (fs.npcHold[o.npc] ?? 0));
    if (p.input.closeSeq > p.last.closeSeq || !at || dist(p.x, p.y, at.x, at.y) > 4.5 || p.life !== 'alive') (p as any).panel = null;
    p.prompt = ''; p.hold = null;
    return;
  }
  // hacking minigame result
  if (panel?.kind === 'hack') {
    const h = fs.hacks.find((h) => h.id === panel.id);
    if (p.input.hackSeq > p.last.hackSeq) {
      if (h && p.input.hackId === h.id && p.input.hackOk >= 0) applyHack(sim, p, fs, h, p.input.hackOk === 1);
      (p as any).panel = null;
    } else if (!h || dist(p.x, p.y, h.x, h.y) > 2.6 || p.life !== 'alive') (p as any).panel = null;
    p.prompt = ''; p.hold = null;
    return;
  }
  // elevator panel selection
  if (panel && p.input.elevSeq > p.last.elevSeq) {
    const to = p.input.elevTo;
    if (to > 0 && panel.dests.includes(to)) sim.startRide(p, panel.elev, to);
    (p as any).panel = null;
  }
  if (panel) {
    const e = fs.L.elevators[panel.elev];
    if (!e || dist(p.x, p.y, e.cx, e.cy) > 2.6) (p as any).panel = null;
  }
  const targets = gather(sim, p, fs);
  let best: Target | null = null, bd = 1e9;
  for (const t of targets) {
    const d = dist(p.x, p.y, t.x, t.y) - Math.cos(Math.atan2(t.y - p.y, t.x - p.x) - p.facing) * 0.3 - (t.pri ?? 0);
    if (d < bd) { bd = d; best = t; }
  }
  const tap = p.input.interact && !p.last.interact;
  if (!best) { p.prompt = ''; p.hold = null; return; }
  if (best.blocked) {
    p.prompt = best.blocked;
    if (tap) sim.msg(p, best.blocked, 'warn');
    p.hold = null;
    return;
  }
  p.prompt = best.hold > 0 ? `[Hold {interact}] ${best.label}` : `[{interact}] ${best.label}`;
  if (best.tap) {
    // dual target: a quick tap (released before the hold completes) does `tap`, holding does `act`
    p.prompt = `[{interact}] ${best.tapLabel}  ·  [Hold {interact}] ${best.label}`;
    const released = !p.input.interact && p.last.interact;
    if (released && p.hold && p.hold.key === best.key && !(p.hold as any).done && p.hold.t < p.hold.need) { p.hold = null; best.tap(); return; }
    if (!p.input.interact) { p.hold = null; return; }
    if (!p.hold || p.hold.key !== best.key) { if (!tap) return; p.hold = { key: best.key, t: 0, need: best.hold, label: best.label }; }
    if ((p.hold as any).done) return; // hold already used: wait for release, never tap
    p.hold.t += dt;
    if (p.hold.t >= p.hold.need) { (p.hold as any).done = true; best.act(); }
    return;
  }
  if (best.hold <= 0) {
    p.hold = null;
    if (tap) best.act();
    return;
  }
  if (!p.input.interact) { p.hold = null; return; }
  if (!p.hold || p.hold.key !== best.key) p.hold = { key: best.key, t: 0, need: best.hold, label: best.label };
  p.hold.t += dt;
  best.onTick?.(p.hold.t);
  if (p.hold.t >= p.hold.need) {
    p.hold = null;
    best.act();
  }
}

function gather(sim: Sim, p: PlayerState, fs: FloorState): Target[] {
  const out: Target[] = [];
  const L = fs.L;
  const near = (x: number, y: number, r = REACH) => dist(p.x, p.y, x, y) < r;
  // containers & bodies
  for (const c of fs.containers) {
    if (!near(c.x, c.y)) continue;
    if (!c.items.length) {
      if (!c.opened) out.push({ key: 'c' + c.id, label: `Search ${c.label}`, hold: 0, x: c.x, y: c.y, act: () => { c.opened = true; sim.msg(p, `${c.label}: empty.`, 'info'); } });
      continue;
    }
    const hasLoot = c.items.some((i) => i.k !== 'weapon' || !p.weapons[weapon(i.id).slot]);
    const wpn = c.items.find((i) => i.k === 'weapon' && p.weapons[weapon(i.id).slot]) as Extract<LootItem, { k: 'weapon' }> | undefined;
    const search = () => lootAll(sim, p, fs, c);
    if (!wpn) {
      if (hasLoot || !c.opened) out.push({ key: 'c' + c.id, label: `Search ${c.label}`, hold: 0, x: c.x, y: c.y, act: search });
      continue;
    }
    // a gun for an occupied slot: hold to swap it in; tap still searches the rest (items you can't carry
    // stay behind and must never block the swap)
    const cur = p.weapons[weapon(wpn.id).slot]!;
    out.push({
      key: 'w' + c.id, label: `Swap ${weapon(cur.id).name} for ${weapon(wpn.id).name} (${wpn.mag} rds)`, hold: 0.6, x: c.x, y: c.y,
      tap: search, tapLabel: `Search ${c.label}`,
      act: () => {
        c.opened = true;
        c.items.splice(c.items.indexOf(wpn), 1);
        const dropped = swapWeapon(p, wpn);
        if (dropped) c.items.push(dropped);
        sim.msg(p, `Took ${weapon(wpn.id).name}`, 'loot');
        sim.emit({ e: 'reload', f: p.floor, pid: p.id, w: wpn.id });
      },
    });
  }
  // breaker panels: quiet switch for the lights here and next door
  for (const pn of fs.panels) {
    if (pn.dead || !near(pn.x, pn.y, 1.5)) continue;
    out.push({ key: 'pn' + pn.id, label: pn.off ? 'Switch lights on' : 'Switch lights off', hold: 0, x: pn.x, y: pn.y, act: () => togglePanel(sim, fs, pn, p) });
  }
  // vending machines
  for (const v of fs.vendings) {
    if (v.broken || !near(v.x, v.y, 1.5)) continue;
    out.push({ key: 'v' + v.id, label: 'Pry open vending machine (loud)', hold: 1.8, x: v.x, y: v.y, act: () => sim.breakVending(fs, v, p) });
  }
  // stairwells
  for (const s of p.floor < 0 ? [] : L.stairs) { // sandbox stairs are display only
    if (near(s.upX, s.upY, 2.1)) {
      if (p.floor >= FINAL_FLOOR) out.push({ key: 's' + s.index, label: '', hold: 0, x: s.upX, y: s.upY, act: () => {}, blocked: 'Roof access sealed. The mainframe is on this floor.' });
      else {
        const cond = sim.flightCondition(p.floor, s.index);
        const to = p.floor + 1;
        if (cond === 'debris') {
          out.push({
            key: 'd' + s.index, label: `Clear debris blocking stairs to ${to} (noisy)`, hold: 8, x: s.upX, y: s.upY,
            act: () => { sim.clearDebris(p.floor, s.index); sim.msg(p, 'Stairwell cleared.', 'good'); },
            onTick: (t) => { if (Math.floor(t) !== Math.floor(t - 1 / 30)) sim.noise(fs, s.upX, s.upY, 12, p); },
          });
        } else if (!stairPassable(cond)) {
          out.push({ key: 's' + s.index, label: '', hold: 0, x: s.upX, y: s.upY, act: () => {}, blocked: `Stairs up: ${STAIR_LABEL[cond]}. Find another route.` });
        } else {
          out.push({ key: 's' + s.index, label: `Climb to floor ${to} (or walk up the stairs)${cond !== 'clear' ? ` — ${STAIR_LABEL[cond]}` : ''}`, hold: 0, x: s.upX, y: s.upY, act: () => sim.takeStairs(p, s.index, 1) });
        }
      }
    }
    if (near(s.downX, s.downY, 2.1)) {
      const cond = sim.flightCondition(p.floor - 1, s.index);
      if (p.floor <= 1) out.push({ key: 'sd' + s.index, label: '', hold: 0, x: s.downX, y: s.downY, act: () => {}, blocked: 'Stairs down: flooded service levels. Use the lobby entrance.' });
      else if (!stairPassable(cond)) out.push({ key: 'sd' + s.index, label: '', hold: 0, x: s.downX, y: s.downY, act: () => {}, blocked: `Stairs down: ${STAIR_LABEL[cond]}.` });
      else out.push({ key: 'sd' + s.index, label: `Descend to floor ${p.floor - 1}`, hold: 0, x: s.downX, y: s.downY, act: () => sim.takeStairs(p, s.index, -1) });
    }
  }
  // elevators
  for (const e of L.elevators) {
    if (!near(e.cx, e.cy, 2.0)) continue;
    const st = sim.plan.elevator(p.floor, e.index);
    if (!st.working) {
      out.push({ key: 'e' + e.index, label: 'Elevator call panel', hold: 0, x: e.cx, y: e.cy, act: () => { sim.msg(p, 'Elevator dead — no power to this car.', 'warn'); sim.emit({ e: 'elev', f: p.floor, k: 'dead', x: e.cx, y: e.cy }); } });
    } else {
      out.push({ key: 'e' + e.index, label: 'Elevator panel (powered)', hold: 0, x: e.cx, y: e.cy, act: () => { (p as any).panel = { kind: 'elev', elev: e.index, dests: st.destinations.slice() }; sim.emit({ e: 'elev', f: p.floor, k: 'open', x: e.cx, y: e.cy }); } });
    }
  }
  // hackable computers
  for (const h of fs.hacks) {
    if (!near(h.x, h.y, 1.7)) continue;
    const what = h.kind === 'security' ? 'security terminal (CCTV, mines, tripwires)' : 'lighting control (fix flicker, full brightness)';
    if (h.state === 'done') out.push({ key: 'h' + h.id, label: '', hold: 0, x: h.x, y: h.y, act: () => {}, blocked: h.kind === 'security' ? 'Security systems offline.' : 'Lighting grid restored.' });
    else if (h.state === 'locked') out.push({ key: 'h' + h.id, label: '', hold: 0, x: h.x, y: h.y, act: () => {}, blocked: 'Terminal locked out: the trace completed.' });
    else out.push({ key: 'h' + h.id, label: `Hack ${what}`, hold: 0, x: h.x, y: h.y, act: () => { (p as any).panel = { kind: 'hack', id: h.id, hk: h.kind, floor: fs.floor }; p.hold = null; }, pri: 0.8 });
  }
  // street officers: talk (the command-tent officer, npc -1, has a separate role)
  for (const a of L.ambient) {
    if (a.kind === 'officer' && a.npc < 0) { // command-tent officer at the laptop: check-in desk and armory
      const at = officerPose(a, sim.t);
      if (!near(at.x, at.y, 2.0)) continue;
      if (sim.cfg.mode !== 'single') out.push({ key: 'ci', label: '', hold: 0, x: at.x, y: at.y, act: () => {}, blocked: 'Chief Hollis: your squad is checked in. Good luck in there.' });
      else out.push({ key: 'ci', label: p.checkedIn ? 'Talk to Police Chief Hollis (armory: change your gear)' : 'Check in with Police Chief Hollis (register, then the armory)', hold: 0, x: at.x, y: at.y, act: () => { (p as any).panel = { kind: 'checkin' }; p.hold = null; }, pri: 0.5 });
      continue;
    }
    if (a.kind !== 'officer' || a.npc < 0) continue;
    const at = officerPose(a, sim.t - (fs.npcHold[a.npc] ?? 0)), who = npcFor(a.npc);
    if (!who || !near(at.x, at.y, 1.8)) continue;
    out.push({ key: 'n' + a.npc, label: `Talk to ${who.rank} ${who.name}`, hold: 0, x: at.x, y: at.y, act: () => { (p as any).panel = { kind: 'talk', npc: a.npc }; p.hold = null; } });
  }
  // portals (tower entrance / exit)
  for (const po of L.portals) {
    if (!near(po.x, po.y, 1.8)) continue;
    if (po.target === 1 && !p.checkedIn) { out.push({ key: 'p1', label: '', hold: 0, x: po.x, y: po.y, act: () => {}, blocked: 'Officers block the door: check in with Police Chief Hollis at the blue tent first.' }); continue; }
    out.push({ key: 'p' + po.target, label: po.label, hold: 0, x: po.x, y: po.y, act: () => sim.travel(p, po.target, po.arriveTag, po.target === 1 ? 'entrance' : 'exit') });
  }
  // downed teammates
  for (const o of sim.players) {
    if (o === p || o.life !== 'down' || o.floor !== p.floor || !near(o.x, o.y, 1.5)) continue;
    if (p.items.medkit <= 0) out.push({ key: 'r' + o.id, label: '', hold: 0, x: o.x, y: o.y, act: () => {}, blocked: `${o.name} is down — you need a Health Kit to revive!` });
    else out.push({ key: 'r' + o.id, label: `Revive ${o.name} (uses Health Kit)`, hold: 3, x: o.x, y: o.y, act: () => sim.revive(p, o) });
  }
  // traps
  for (const t of fs.traps) {
    if (!t.armed || !t.revealed) continue;
    const cx = (t.x + (t.kind === 'tripwire' ? t.x2 : t.x)) / 2, cy = (t.y + (t.kind === 'tripwire' ? t.y2 : t.y)) / 2;
    if (!near(cx, cy, 1.4)) continue;
    out.push({ key: 't' + t.id, label: `Disarm ${t.kind === 'mine' ? 'proximity mine' : 'tripwire charge'}${p.mods.bypass ? ' (Bypass Kit)' : ' (risky without Bypass Kit)'}`, hold: p.mods.bypass ? 1.3 : 4, x: cx, y: cy, act: () => sim.disarmTrap(p, fs, t) });
  }
  // mainframe terminal
  const m = L.mainframe;
  if (m && near(m.termX, m.termY, 1.8) && !sim.objective.uploadStarted) {
    out.push({ key: 'term', label: 'Upload virus to mainframe', hold: 3, x: m.termX, y: m.termY, act: () => sim.startUpload(p) });
  }
  return out;
}

function lootAll(sim: Sim, p: PlayerState, fs: FloorState, c: ContainerState) {
  c.opened = true;
  const msgs: string[] = [];
  const keep: LootItem[] = [];
  for (const it of c.items) {
    const { left, msg } = giveLoot(p, it);
    if (msg) msgs.push(msg);
    if (left) keep.push(left);
  }
  c.items = keep;
  if (msgs.length) sim.msg(p, `${c.label}: ${msgs.join(', ')}`, 'loot');
  else if (keep.some((i) => i.k === 'weapon')) sim.msg(p, `${c.label}: weapon here — hold to swap.`, 'info');
  else if (keep.length) sim.msg(p, `${c.label}: you can't carry any more of that.`, 'warn');
  else sim.msg(p, `${c.label}: empty.`, 'info');
  sim.emit({ e: 'use', f: p.floor, pid: p.id, item: 'loot' });
}
