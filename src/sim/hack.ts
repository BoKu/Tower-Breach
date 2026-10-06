import type { FloorState, HackState, PlayerState } from './state';
import type { Sim } from './sim';

/**
 * Hackable computers. The minigame itself runs in the UI (ui/hack.ts); the sim only applies the outcome, so co-op
 * clients report `hackOk` through their input and the host stays authoritative.
 */

/** Security computer: every CCTV camera and armed trap on the floor goes offline. */
export function disableSecurity(fs: FloorState) {
  for (const c of fs.cameras) { c.alive = false; c.detect = 0; c.alarmT = 0; }
  for (const t of fs.traps) { t.armed = false; t.revealed = true; t.fuse = 0; (t as any).spent = true; }
}

/** Lighting computer: flicker and dead bulbs repaired, emergency strobes back to normal, darkness lifted. */
export function fixFloorLights(fs: FloorState) {
  if (fs.lightsFixed) return;
  fs.lightsFixed = true;
  for (const l of fs.lights) { l.broken = false; l.burstT = 0; }
  // the layout is shared (generation cache), so swap in a repaired copy instead of mutating it
  fs.L = {
    ...fs.L,
    darkness: 0,
    lights: fs.L.lights.map((l) => (l.kind === 'ceiling' || l.kind === 'emergency' ? { ...l, flicker: 0, broken: false, kind: 'ceiling' as const, color: l.kind === 'emergency' ? 0xfff2e2 : l.color } : l)),
  };
}

/** Trace time (s) and puzzle size for the minigame at a floor. */
export function hackDifficulty(floor: number) {
  const k = Math.min(1, Math.max(0, (floor - 1) / 189));
  return { k, trace: Math.round(75 - k * 27), wordLen: 5 + Math.round(k * 2), words: 8 + Math.round(k * 5), seqLen: 4 + Math.round(k * 2) };
}

export function applyHack(sim: Sim, p: PlayerState, fs: FloorState, h: HackState, ok: boolean) {
  if (h.state !== 'ready') return;
  if (ok) {
    h.state = 'done';
    if (h.kind === 'security') { disableSecurity(fs); sim.msg(null, `${p.name} hacked security: CCTV, mines and tripwires offline on floor ${fs.floor}.`, 'good'); }
    else { fixFloorLights(fs); sim.msg(null, `${p.name} restored the lighting grid: floor ${fs.floor} is fully lit.`, 'good'); }
  } else {
    // traced: terminal burns out and the building's security hears about it
    h.state = 'locked';
    sim.noise(fs, h.x, h.y, 16, p);
    fs.networkAlertT = 6;
    sim.msg(p, 'TRACE COMPLETE: terminal locked out and the alarm has been raised.', 'warn');
  }
  sim.emit({ e: 'hack', f: fs.floor, id: h.id, kind: h.kind, ok, x: h.x, y: h.y });
}
