import { weapon, KNIFE, AMMO_CAP, isSuppressed, shotNoise, SUPPRESSOR_DAMAGE } from '../config/weapons';
import { DRINK_DURATION, DRINK_SPEED, FOOD_HEAL, PLATE_REPAIR, INJURY_SPEED, TORCH_DRAIN_PER_SEC, ITEM_NAMES, GRENADE_NAMES, ItemType } from '../config/items';
import { clamp, dist, wrapAngle, angleTo, segPointDist } from '../core/math';
import { moveCircle, collides, BODY_R } from './nav';
import { newScore, scoreShot } from './score';
import { idx, S_LOW, FloorLayout, pointsNear } from '../gen/floor';
import { trace, unaware, damageEnemy, damagePlayer, destroyCamera, breakVending, killPanel, shootLight } from './combat';
import { currentWeapon, nextItem, nextGrenade, ammoCap } from './inventory';
import { FUSE } from './combat';
import type { Sim } from './sim';
import type { PlayerState, Loadout, PlayerInput, Enemy, FloorState } from './state';
import { emptyInput } from './state';
import { updateInteraction } from './interact';
import { stairAt, stairElevation } from './stairs';

/** Fraction of the carry distance a grenade travels after first touchdown (bounces + roll). */
export const GRENADE_ROLL = 0.22;
/** Item belt order, matching hotkeys 1-5. */
export const BELT: ItemType[] = ['medkit', 'battery', 'plate', 'drink', 'food'];
export const WALK_SPEED = 3.3;
export const SPRINT_SPEED = 5.4;
export const CROUCH_SPEED = 1.7;

export function createPlayer(id: number, slot: number, name: string, lo: Loadout): PlayerState {
  const p: PlayerState = {
    id, slot, name, connected: true, floor: 0, x: 32, y: 44, vx: 0, vy: 0, z: 0, vz: 0, facing: -Math.PI / 2, aimX: 32, aimY: 40, aimZ: NaN,
    hp: 100, armor: lo.armor === 'none' ? 0 : 100, helmet: lo.armor === 'vesthelm', injured: false, life: 'alive', downT: 0,
    crouch: false, sprinting: false, aiming: false, moving: false,
    weapons: { primary: null, secondary: null }, sel: 'secondary', lastSel: 'knife',
    ammo: { pistol: 0, heavy: 0, smg: 0, rifle: 0, sniper: 0, shell: 0, internal: 0 },
    grenades: { frag: 0, flash: 0, smoke: 0, incendiary: 0, decoy: 0 }, grenadeSel: 'frag',
    items: { medkit: 0, battery: 0, plate: 0, drink: 0, food: 0 }, itemSel: 'medkit', coins: 0, keys: [],
    mods: { ...lo.mods }, torchOn: false, battery: 1, boostT: 0,
    fireCd: 0, reloadT: 0, burstLeft: 0, bloom: 0, meleeCd: 0, triggerHeld: false, muzzleT: -9, stepT: 0,
    burnT: 0, flashT: 0, hurtT: 0, hold: null, ride: null, exposure: 0.5, kills: 0, score: newScore(),
    input: emptyInput(), last: emptyInput(), prompt: '',
  };
  (p as any).vest = lo.armor !== 'none';
  (p as any).panel = null;
  const sec = weapon(lo.secondary);
  p.weapons.secondary = { id: sec.id, mag: sec.mag };
  p.ammo[sec.ammo] += sec.reserve;
  if (lo.primary) {
    const pri = weapon(lo.primary);
    p.weapons.primary = { id: pri.id, mag: pri.mag };
    p.ammo[pri.ammo] += pri.reserve;
    p.sel = 'primary';
    p.lastSel = 'secondary';
  }
  if (lo.mods.pouch) {
    for (const w of [p.weapons.primary, p.weapons.secondary]) if (w) { const d = weapon(w.id); p.ammo[d.ammo] += d.mag * 2; }
  }
  for (const k of Object.keys(p.ammo) as (keyof typeof p.ammo)[]) p.ammo[k] = Math.min(p.ammo[k], Math.round(AMMO_CAP[k] * (lo.mods.pouch ? 1.5 : 1)));
  for (const [g, n] of Object.entries(lo.grenades)) p.grenades[g as keyof typeof p.grenades] = n ?? 0;
  for (const [i, n] of Object.entries(lo.items)) p.items[i as ItemType] = n ?? 0;
  const firstG = (Object.keys(p.grenades) as (keyof typeof p.grenades)[]).find((g) => p.grenades[g] > 0);
  if (firstG) p.grenadeSel = firstG;
  return p;
}

/** Re-kit a player from a loadout (street armory): weapons, ammo, armour, grenades, items and mods. */
export function equipLoadout(p: PlayerState, lo: Loadout) {
  // anything picked up since the last kit (street supply crate) rides along on top of the new purchase
  const base = createPlayer(p.id, p.slot, p.name, p.loadout ?? lo);
  const extra = <T extends string>(cur: Record<T, number>, was: Record<T, number>) => Object.fromEntries(Object.keys(cur).map((k) => [k, Math.max(0, cur[k as T] - was[k as T])])) as Record<T, number>;
  const xAmmo = extra(p.ammo, base.ammo), xItems = extra(p.items, base.items), xGren = extra(p.grenades, base.grenades);
  const n = createPlayer(p.id, p.slot, p.name, lo);
  for (const k of Object.keys(n.ammo) as (keyof typeof n.ammo)[]) n.ammo[k] = Math.min(n.ammo[k] + xAmmo[k], Math.round(AMMO_CAP[k] * (lo.mods.pouch ? 1.5 : 1)));
  for (const k of Object.keys(n.items) as (keyof typeof n.items)[]) n.items[k] += xItems[k];
  for (const k of Object.keys(n.grenades) as (keyof typeof n.grenades)[]) n.grenades[k] += xGren[k];
  Object.assign(p, {
    hp: n.hp, armor: n.armor, helmet: n.helmet, weapons: n.weapons, sel: n.sel, lastSel: n.lastSel, ammo: n.ammo,
    grenades: n.grenades, grenadeSel: n.grenadeSel, items: n.items, mods: n.mods, reloadT: 0, burstLeft: 0,
  });
  (p as any).vest = (n as any).vest;
  p.loadout = JSON.parse(JSON.stringify(lo));
}

/** Height of the gun muzzle above the floor. */
export function muzzleHeight(p: PlayerState): number {
  return (p.crouch ? 0.9 : 1.25) + p.z;
}

export function torchCapacityMul(p: PlayerState) {
  return p.mods.torchmod ? 1.5 : 1;
}

export function playerSpeed(p: PlayerState): number {
  const w = currentWeapon(p);
  let s = p.crouch ? CROUCH_SPEED : p.sprinting ? SPRINT_SPEED : WALK_SPEED;
  const wd = w && weapon(w.id);
  if (p.aiming && !p.sprinting && wd?.category !== 'pistol' && wd?.category !== 'smg') s *= 0.72; // pistols and SMGs aim on the move
  if (wd) s *= wd.move;
  if (p.injured) s *= INJURY_SPEED;
  if (p.boostT > 0) s *= DRINK_SPEED;
  if (p.burnT > 0) s *= 0.9;
  return s;
}

const pressed = (p: PlayerState, k: keyof PlayerInput) => (p.input[k] as number) > (p.last[k] as number);

export function updatePlayer(sim: Sim, p: PlayerState, dt: number, externalMove: boolean) {
  const inp = p.input;
  p.fireCd -= dt; p.meleeCd -= dt; p.muzzleT -= dt; p.hurtT -= dt; p.flashT -= dt; p.burnT -= dt;
  if (p.boostT > 0) p.boostT -= dt;
  if (p.life === 'down') {
    p.downT -= dt;
    p.vx = p.vy = 0;
    if (p.downT <= 0) sim.playerOut(p);
    syncLast(p);
    return;
  }
  if (p.life !== 'alive') { syncLast(p); return; }
  const fs = sim.floorState(p.floor);
  const L = fs.L;
  // elevator ride in progress
  if (p.ride) {
    p.ride.t -= dt;
    p.vx = p.vy = 0;
    if (p.ride.t <= 0) sim.completeRide(p);
    syncLast(p);
    return;
  }
  p.crouch = inp.crouch && p.z <= 0.01;
  p.aiming = inp.aim;
  const mlen = Math.hypot(inp.mx, inp.my);
  const mx = mlen > 1 ? inp.mx / mlen : inp.mx, my = mlen > 1 ? inp.my / mlen : inp.my;
  p.moving = mlen > 0.15;
  p.sprinting = inp.sprint && p.moving && !p.crouch && !(inp.fire && p.sel !== 'knife');
  if (p.sprinting && p.aiming) p.sprinting = false;
  const px = p.x, py = p.y, pz = p.z;
  if (!externalMove) movePlayer(p, L, dt);
  // noise from actual displacement (works for host-simulated and client-reported movement alike)
  if (pz > 0 && p.z <= 0.001) {
    sim.noise(fs, p.x, p.y, 5, p);
  }
  const moved = Math.hypot(p.x - px, p.y - py);
  if (moved < 3) p.stepT += moved;
  const stride = p.sprinting ? 1.25 : p.crouch ? 0.6 : 0.8;
  if (p.stepT > stride && p.z <= 0.01) {
    p.stepT = 0;
    const surf = L.rooms[L.roomAt[idx(Math.floor(p.x), Math.floor(p.y))]]?.surface ?? 'concrete';
    const sm = surf === 'metal' ? 1.3 : surf === 'tile' ? 1.1 : surf === 'carpet' ? 0.8 : 1;
    const rad = (p.crouch ? 1.1 : p.sprinting ? 9.5 : 3.6) * sm;
    sim.noise(fs, p.x, p.y, rad, p);
  }
  // walking up (or down) a stairwell flight takes you to the next floor when you step onto its top landing.
  // Compare with last tick's position, not this tick's: in co-op the client's movement is applied before the tick
  // (applyInput), so `py` already equals p.y for externally moved players and the climb never fired
  (p as any).stairCd = Math.max(0, ((p as any).stairCd ?? 0) - dt);
  const prevY = (p as any).stairPrevY ?? py;
  (p as any).stairPrevY = p.y;
  const here = stairAt(L, p.x, p.y);
  if ((p as any).stairHold && (!here || `${here.s.index}:${here.dir}` !== (p as any).stairHold)) (p as any).stairHold = null;
  if (!p.bot && !(p as any).stairHold && (p as any).stairCd <= 0 && p.z <= 0.05 && p.floor >= 1) { // bots only change floor with the human (Sim.travel)
    const st = here;
    if (st && st.t >= 1 && p.y - prevY < -0.005) {
      if ((st.dir > 0 && p.floor < 200) || (st.dir < 0 && p.floor > 1)) { sim.takeStairs(p, st.s.index, st.dir); syncLast(p); return; }
    }
  }
  // facing follows aim
  p.aimX = inp.ax; p.aimY = inp.ay; p.aimZ = inp.az;
  if (Math.hypot(inp.ax - p.x, inp.ay - p.y) > 0.05) p.facing = angleTo(p.x, p.y, inp.ax, inp.ay);
  // torch
  if (pressed(p, 'torch')) {
    if (p.battery > 0) { p.torchOn = !p.torchOn; } else sim.msg(p, 'Torch battery empty — use a battery.', 'warn');
  }
  if (p.torchOn && !p.cheats?.torch) {
    p.battery -= (TORCH_DRAIN_PER_SEC / torchCapacityMul(p)) * dt;
    if (p.battery <= 0) { p.battery = 0; p.torchOn = false; sim.msg(p, 'Torch battery depleted!', 'warn'); }
    else if (p.battery < 0.15 && p.battery + (TORCH_DRAIN_PER_SEC / torchCapacityMul(p)) * dt >= 0.15) sim.msg(p, 'Torch battery low.', 'warn');
  }
  // weapon selection
  if (inp.slotSeq > p.last.slotSeq && inp.slot >= 0) {
    const want = (['primary', 'secondary', 'knife'] as const)[inp.slot];
    if (want && want !== p.sel && (want === 'knife' || p.weapons[want])) selectSlot(p, want);
  }
  if (pressed(p, 'swap')) {
    const want = p.lastSel !== p.sel && (p.lastSel === 'knife' || p.weapons[p.lastSel]) ? p.lastSel : p.sel === 'primary' ? (p.weapons.secondary ? 'secondary' : 'knife') : p.weapons.primary ? 'primary' : 'knife';
    selectSlot(p, want);
  }
  // reload
  const wi = currentWeapon(p);
  if (wi) {
    const w = weapon(wi.id);
    if (pressed(p, 'reload') && p.reloadT <= 0 && wi.mag < w.mag && p.ammo[w.ammo] > 0) startReload(sim, p);
    else if (wi.mag <= 0 && p.reloadT <= 0 && p.ammo[w.ammo] > 0 && !p.cheats?.ammo) startReload(sim, p, AUTO_RELOAD_SECONDS);
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) {
        const take = Math.min(w.mag - wi.mag, p.ammo[w.ammo]);
        wi.mag += take;
        p.ammo[w.ammo] -= take;
      }
    }
  }
  p.bloom = Math.max(0, p.bloom - (wi ? weapon(wi.id).recover : 1) * dt * 0.6);
  // firing (the police cordon is a no-fire zone: weapons stay safed on the street)
  const firePress = inp.fire && !p.triggerHeld;
  const safe = p.floor === 0;
  if (safe) {
    if (firePress || pressed(p, 'melee') || pressed(p, 'grenade')) {
      if (((p as any).safeMsgT ?? 0) <= sim.t) { (p as any).safeMsgT = sim.t + 2.5; sim.msg(p, 'Weapons safe inside the police cordon. Save it for the tower.', 'warn'); }
    }
  } else if (p.sel === 'knife') {
    if (firePress) knife(sim, p);
  } else if (wi) {
    const w = weapon(wi.id);
    if (firePress && w.burst) p.burstLeft = w.burst;
    const want = (w.auto && inp.fire) || (!w.auto && !w.burst && firePress) || p.burstLeft > 0;
    if (want && p.fireCd <= 0 && p.reloadT <= 0) {
      if (wi.mag <= 0 && p.cheats?.ammo) wi.mag = w.mag;
      if (wi.mag <= 0) {
        p.burstLeft = 0;
        if (firePress || w.auto) {
          sim.emit({ e: 'dry', f: p.floor, pid: p.id });
          p.fireCd = 0.3;
          if (p.ammo[w.ammo] > 0) startReload(sim, p, AUTO_RELOAD_SECONDS);
          else sim.msg(p, `Out of ${w.ammo} ammo — loot bodies or swap guns [3: knife]`, 'warn');
        }
      } else fireShot(sim, p);
    }
  }
  p.triggerHeld = inp.fire;
  if (!safe && pressed(p, 'melee')) knife(sim, p);
  // grenades
  if (pressed(p, 'cycleGrenade')) { p.grenadeSel = nextGrenade(p); sim.msg(p, `Grenade: ${GRENADE_NAMES[p.grenadeSel]} (${p.grenades[p.grenadeSel]})`, 'info'); }
  if (!safe && pressed(p, 'grenade')) throwGrenade(sim, p);
  // items
  if (pressed(p, 'cycleItem')) p.itemSel = nextItem(p);
  if (inp.selItemSeq > p.last.selItemSeq && BELT[inp.selItem]) p.itemSel = BELT[inp.selItem];
  if (inp.useItemSeq > p.last.useItemSeq && BELT[inp.useItem - 1]) p.itemSel = BELT[inp.useItem - 1]; // 1-5 select; F uses
  if (pressed(p, 'use')) useItem(sim, p, p.itemSel);
  if (pressed(p, 'medkit')) useItem(sim, p, 'medkit');
  if (pressed(p, 'battery')) useItem(sim, p, 'battery');
  if (pressed(p, 'ping')) sim.ping(p);
  if (pressed(p, 'drop')) dropKit(sim, p, fs);
  takePickups(sim, p, fs);
  // exposure (for stealth)
  p.exposure = sim.exposureOf(fs, p);
  updateInteraction(sim, p, fs, dt);
  syncLast(p);
}

/**
 * Pure movement integration (acceleration, jump arc, collision with vaulting over low cover).
 * Shared by the authoritative simulation and multiplayer client-side prediction.
 */
export function movePlayer(p: PlayerState, L: FloorLayout, dt: number) {
  const inp = p.input;
  const mlen = Math.hypot(inp.mx, inp.my);
  const mx = mlen > 1 ? inp.mx / mlen : inp.mx, my = mlen > 1 ? inp.my / mlen : inp.my;
  const sp = playerSpeed(p);
  const k = Math.min(1, dt * (p.z > 0 ? 2.5 : 12));
  p.vx += (mx * sp - p.vx) * k;
  p.vy += (my * sp - p.vy) * k;
  if (inp.jump > p.last.jump && p.z <= 0.001 && !p.crouch) { p.vz = 4.4; p.z = 0.001; }
  if (p.z > 0 || p.vz > 0) {
    p.z += p.vz * dt;
    p.vz -= 14 * dt;
    if (p.z <= 0) {
      p.z = 0; p.vz = 0;
      if (onLowL(L, p)) { p.z = 0.05; p.vz = 0.8; }
    }
  }
  const allowLow = p.z > 0.12 || onLowL(L, p);
  const r = moveCircle(L, p.x, p.y, p.vx * dt, p.vy * dt, BODY_R, allowLow);
  p.x = r.x; p.y = r.y;
}

function onLowL(L: FloorLayout, p: PlayerState): boolean {
  return L.solid[idx(Math.floor(p.x), Math.floor(p.y))] === S_LOW || (collides(L, p.x, p.y, BODY_R * 0.8, false) && !collides(L, p.x, p.y, BODY_R * 0.8, true));
}

function syncLast(p: PlayerState) {
  const a = p.input, b = p.last;
  b.jump = a.jump; b.reload = a.reload; b.melee = a.melee; b.use = a.use; b.swap = a.swap; b.grenade = a.grenade;
  b.cycleGrenade = a.cycleGrenade; b.cycleItem = a.cycleItem; b.torch = a.torch; b.ping = a.ping; b.medkit = a.medkit; b.battery = a.battery; b.drop = a.drop;
  b.slotSeq = a.slotSeq; b.elevSeq = a.elevSeq; b.stairSeq = a.stairSeq; b.hackSeq = a.hackSeq; b.closeSeq = a.closeSeq; b.useItemSeq = a.useItemSeq; b.selItemSeq = a.selItemSeq;
  b.interact = a.interact;
}

/** Weapon draw time; pistols come out (and go away) twice as fast. */
export const SWAP_TIME = 0.35;
function selectSlot(p: PlayerState, s: PlayerState['sel']) {
  if (s === p.sel) return;
  const pistol = (k: PlayerState['sel']) => k !== 'knife' && !!p.weapons[k] && weapon(p.weapons[k]!.id).category === 'pistol';
  const swap = pistol(p.sel) || pistol(s) ? SWAP_TIME / 2 : SWAP_TIME;
  p.lastSel = p.sel;
  p.sel = s;
  p.reloadT = 0;
  p.burstLeft = 0;
  p.fireCd = Math.max(p.fireCd, swap);
}

/** An emptied mag reloads itself this fast; a manual [R] reload keeps the weapon's own reload time. */
const AUTO_RELOAD_SECONDS = 0.33;

function startReload(sim: Sim, p: PlayerState, dur?: number) {
  const wi = currentWeapon(p);
  if (!wi) return;
  const w = weapon(wi.id);
  p.reloadT = p.reloadDur = dur ?? w.reload;
  p.burstLeft = 0;
  sim.emit({ e: 'reload', f: p.floor, pid: p.id, w: w.id });
}

/** Shotguns: pellets on one enemy within this range stagger it (and one-shot dogs). */
export const STAGGER = { range: 8, pellets: 3, time: 0.6 };
/** Snipers: a round carries through into one more enemy at this fraction of its damage. */
export const PIERCE_DAMAGE = 0.7;
/** Machine guns: rounds passing this close to an enemy add pin time (capped). */
export const PIN = { radius: 1.5, add: 0.5, max: 1.5 };

function fireShot(sim: Sim, p: PlayerState) {
  const fs = sim.floorState(p.floor);
  const wi = currentWeapon(p)!;
  const w = weapon(wi.id), cat = w.category;
  const sup = isSuppressed(w, p.mods);
  const dmg = w.damage * (sup ? SUPPRESSOR_DAMAGE : 1);
  p.sprinting = false;
  const move = (p.z > 0.05 ? 0.12 : p.moving ? (p.crouch ? 0.01 : 0.03) : 0) * (cat === 'smg' ? 0.7 : 1); // SMGs: tighter on the move
  const spread = (p.aiming ? w.aimSpread : w.spread) + p.bloom + move;
  // hit-test from just in front of the body (not the muzzle 0.45 m out) so targets at your feet still count
  const ox = p.x + Math.cos(p.facing) * 0.12, oy = p.y + Math.sin(p.facing) * 0.12;
  const mx = p.x + Math.cos(p.facing) * 0.45, my = p.y + Math.sin(p.facing) * 0.45; // muzzle (tracer start)
  // 3D aim: from the gun (lower when crouched) toward the crosshair point (floor or target body)
  const gunZ = muzzleHeight(p) + stairElevation(fs.L, p.x, p.y);
  const flat = !Number.isFinite(p.aimZ);
  const aimDist = Math.max(0.25, Math.hypot(p.aimX - ox, p.aimY - oy));
  const baseDz = flat ? 0 : (p.aimZ - gunZ) / aimDist;
  const pellets = new Map<Enemy, number>();
  let landed = false;
  // damage to an enemy: sneak shots (pistols, snipers) double on the unaware; close shotgun blasts one-shot dogs
  const hitEnemy = (e: Enemy, d: number, t: number) => {
    if ((cat === 'pistol' || cat === 'sniper') && unaware(e)) d *= 2;
    if (cat === 'shotgun' && t <= STAGGER.range && (e.type === 'dog' || e.type === 'dogcyborg')) d = 1e4;
    if (cat === 'shotgun' && t <= STAGGER.range) pellets.set(e, (pellets.get(e) ?? 0) + 1);
    landed = true;
    damageEnemy(sim, fs, e, d, w.pen, p, 'bullet');
  };
  for (let k = 0; k < w.pellets; k++) {
    const a = p.facing + (sim.rng.next() + sim.rng.next() - 1) * spread;
    const vdz = baseDz + (sim.rng.next() + sim.rng.next() - 1) * spread * 0.6;
    const vert = flat ? undefined : { z0: gunZ, dz: vdz };
    let hit = trace(sim, fs, ox, oy, a, w.range, 'p', p.id, vert);
    let hk: 'wall' | 'flesh' | 'metal' | 'none' | 'glass' | 'floor' = hit.kind === 'none' ? 'none' : hit.kind === 'floor' ? 'floor' : 'wall';
    const falloff = hit.t > w.range * 0.6 ? 0.8 : 1;
    if (hit.kind === 'enemy') {
      const e = hit.ref;
      hk = e.type === 'drone' || e.type === 'warden' ? 'metal' : 'flesh';
      hitEnemy(e, dmg * falloff, hit.t);
      if (cat === 'sniper') { // pierce: the same round carries on into the next enemy behind (walls still stop it)
        const h2 = trace(sim, fs, ox, oy, a, w.range, 'p', p.id, vert, e);
        if (h2.kind === 'enemy') { hit = h2; hitEnemy(h2.ref, dmg * PIERCE_DAMAGE * (h2.t > w.range * 0.6 ? 0.8 : 1), h2.t); }
      }
    } else if (hit.kind === 'player') { hk = 'flesh'; damagePlayer(sim, hit.ref, dmg * falloff * 0.75, w.pen, 'bullet'); } // friendly fire
    else if (hit.kind === 'camera') { hk = 'metal'; destroyCamera(sim, fs, hit.ref, p); }
    else if (hit.kind === 'vending') {
      hk = 'glass';
      hit.ref.hp -= w.damage;
      if (hit.ref.hp <= 0) breakVending(sim, fs, hit.ref, p);
    } else if (hit.kind === 'light') { hk = 'glass'; shootLight(sim, fs, hit.ref, p); }
    else if (hit.kind === 'panel') { hk = 'metal'; killPanel(sim, fs, hit.ref, p); }
    else if (hit.kind === 'mine') { hit.ref.armed = false; hit.ref.fuse = 0.05; hit.ref.revealed = true; }
    // machine guns: every round that cracks past (or into) an enemy pins it
    if (cat === 'machine_gun') for (const e of fs.enemies) if (e.state !== 'dead' && segPointDist(ox, oy, hit.x, hit.y, e.x, e.y) < PIN.radius) e.pinT = Math.min(PIN.max, e.pinT + PIN.add);
    sim.emit({ e: 'shot', f: p.floor, x: mx, y: my, x2: hit.x, y2: hit.y, z: gunZ, z2: flat ? 1.0 : hit.z, w: w.id, src: 'p', id: p.id, hit: hk, ...(sup ? { sup: true } : {}) });
  }
  // shotgun stagger: enough pellets at close range interrupt the target's aim and fire
  for (const [e, n] of pellets) if (n >= STAGGER.pellets && e.state !== 'dead') { e.stunT = Math.max(e.stunT, STAGGER.time); e.burstLeft = 0; }
  if (!p.cheats?.ammo) wi.mag--;
  if (p.floor > 0) scoreShot(p.score, landed);
  p.bloom = Math.min(0.25, p.bloom + w.recoil * (p.crouch ? 0.7 : 1) * (p.aiming ? 0.8 : 1));
  p.fireCd = 1 / w.rps;
  if (p.burstLeft > 0) { p.burstLeft--; if (p.burstLeft === 0) p.fireCd = 0.28; }
  p.muzzleT = 0.07;
  sim.noise(fs, p.x, p.y, shotNoise(w, p.mods), p);
}

function knife(sim: Sim, p: PlayerState) {
  if (p.meleeCd > 0) return;
  p.meleeCd = KNIFE.cooldown;
  const fs = sim.floorState(p.floor);
  let hitAny = false;
  for (const e of fs.enemies) {
    if (e.state === 'dead') continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d > KNIFE.range + 0.2) continue;
    const a = Math.abs(wrapAngle(angleTo(p.x, p.y, e.x, e.y) - p.facing));
    if (a > KNIFE.arc / 2 + 0.2) continue;
    // back-stab: target unaware and we are behind it
    const behind = Math.abs(wrapAngle(angleTo(p.x, p.y, e.x, e.y) - e.facing)) < 1.2;
    const stealth = e.state !== 'alert' && behind && e.type !== 'warden';
    damageEnemy(sim, fs, e, stealth ? KNIFE.backstab : KNIFE.damage, 1, p, 'melee');
    hitAny = true;
    break;
  }
  if (!hitAny && sim.cfg.friendlyFire && p.floor !== 0) {
    for (const o of sim.players) {
      if (o === p || o.floor !== p.floor || o.life !== 'alive') continue;
      if (dist(p.x, p.y, o.x, o.y) > KNIFE.range + 0.2 || Math.abs(wrapAngle(angleTo(p.x, p.y, o.x, o.y) - p.facing)) > KNIFE.arc / 2 + 0.2) continue;
      damagePlayer(sim, o, KNIFE.damage * 0.6, 1, 'melee');
      hitAny = true;
      break;
    }
  }
  if (!hitAny) {
    for (const v of fs.vendings) {
      if (v.broken || dist(p.x, p.y, v.x, v.y) > 1.4) continue;
      v.hp -= 20;
      hitAny = true;
      if (v.hp <= 0) breakVending(sim, fs, v, p);
      else sim.noise(fs, v.x, v.y, 6, p);
      break;
    }
  }
  sim.emit({ e: 'melee', f: p.floor, x: p.x + Math.cos(p.facing), y: p.y + Math.sin(p.facing), hit: hitAny, pid: p.id });
  sim.noise(fs, p.x, p.y, KNIFE.noise, p);
}

function throwGrenade(sim: Sim, p: PlayerState) {
  const g = p.grenadeSel;
  if (p.grenades[g] <= 0) {
    const n = nextGrenade(p);
    if (p.grenades[n] <= 0) { sim.msg(p, 'No grenades.', 'warn'); return; }
    p.grenadeSel = n;
    return throwGrenade(sim, p);
  }
  const fs = sim.floorState(p.floor);
  const d = clamp(Math.hypot(p.aimX - p.x, p.aimY - p.y), 2, 14);
  // Exact ballistic arc: first touchdown short of the aim point by the expected bounce/roll distance.
  const T = 0.45 + d / 18;
  const a = p.facing;
  const land = Math.max(0.5, d - 0.4) / (1 + GRENADE_ROLL);
  const sx = p.x + Math.cos(a) * 0.4, sy = p.y + Math.sin(a) * 0.4;
  const h = land;
  const vx = (Math.cos(a) * h) / T, vy = (Math.sin(a) * h) / T;
  fs.grenades.push({ id: sim.id(), kind: g, x: sx, y: sy, z: 1.3, vx, vy, vz: 0.5 * 13 * T - 1.3 / T, fuse: FUSE[g], owner: p.id, rest: false });
  if (!p.cheats?.ammo) p.grenades[g]--;
  sim.emit({ e: 'throw', f: p.floor, pid: p.id, x: p.x, y: p.y });
  if (p.grenades[g] <= 0) p.grenadeSel = nextGrenade(p);
}

export function useItem(sim: Sim, p: PlayerState, it: ItemType) {
  if (p.items[it] <= 0) { sim.msg(p, `No ${ITEM_NAMES[it]}.`, 'warn'); return; }
  switch (it) {
    case 'medkit':
      if (p.hp >= 100 && !p.injured) { sim.msg(p, 'Already at full health.', 'info'); return; }
      p.hp = 100; p.injured = false;
      break;
    case 'battery':
      if (p.battery > 0.97) { sim.msg(p, 'Torch battery already full.', 'info'); return; }
      p.battery = 1;
      break;
    case 'plate':
      if (!(p as any).vest) { sim.msg(p, 'Need a vest to fit armour plates.', 'warn'); return; }
      if (p.armor >= 100) { sim.msg(p, 'Armour already intact.', 'info'); return; }
      p.armor = Math.min(100, p.armor + PLATE_REPAIR);
      break;
    case 'drink':
      p.boostT = DRINK_DURATION;
      break;
    case 'food':
      if (p.hp >= 100) { sim.msg(p, 'Not hungry — health full.', 'info'); return; }
      p.hp = Math.min(100, p.hp + FOOD_HEAL);
      break;
  }
  p.items[it]--;
  sim.emit({ e: 'use', f: p.floor, pid: p.id, item: it });
  sim.msg(p, `Used ${ITEM_NAMES[it]}`, 'good');
  if (p.items[it] <= 0) p.itemSel = nextItem(p);
}

export { ammoCap };

/** Q: one Health Kit onto the floor a metre in front (for a squadmate). */
function dropKit(sim: Sim, p: PlayerState, fs: FloorState) {
  if (p.items.medkit <= 0) { sim.msg(p, 'No Health Kit to drop.', 'warn'); return; }
  let x = p.x + Math.cos(p.facing) * 1.1, y = p.y + Math.sin(p.facing) * 1.1;
  if (collides(fs.L, x, y, 0.2, false)) { // blocked ahead: the nearest clear spot not under your own feet
    const spot = pointsNear(fs.L, p.x, p.y, 16).find((q) => { const d = dist(q.x, q.y, p.x, p.y); return d > 0.8 && d < 1.8; });
    if (!spot) { sim.msg(p, 'No room to drop it here.', 'warn'); return; }
    x = spot.x; y = spot.y;
  }
  p.items.medkit--;
  fs.pickups.push({ id: sim.id(), item: 'medkit', x, y });
  sim.emit({ e: 'use', f: p.floor, pid: p.id, item: 'loot' });
}

/** Walking onto a dropped kit takes it: people always (if they have room); bots only the one meant for it, and use it. */
function takePickups(sim: Sim, p: PlayerState, fs: FloorState) {
  if (!fs.pickups.length) return;
  for (let i = fs.pickups.length - 1; i >= 0; i--) {
    const k = fs.pickups[i];
    if (dist(p.x, p.y, k.x, k.y) > 0.6) continue;
    if (p.bot ? sim.kitTaker(fs) !== p : p.items.medkit >= 3) continue;
    fs.pickups.splice(i, 1);
    p.items.medkit++;
    if (p.bot) useItem(sim, p, 'medkit');
    else sim.msg(p, '+1 Health Kit', 'loot');
  }
}
