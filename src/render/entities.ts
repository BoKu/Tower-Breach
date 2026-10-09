import * as THREE from 'three';
import { gunKindOf, cloneRig } from './models';
import { gearModel } from './armoryArt';
import { currentHoliday } from '../config/holiday';
import { OperatorRig, GunKind } from './operator';
import { DogRig, DroneRig, WardenRig } from './beasts';
import { stairElevation } from '../sim/stairs';
import { weapon, isSuppressed } from '../config/weapons';
import { dist, angleTo } from '../core/math';
import { lineOfSight } from '../sim/nav';
import { lightLevel, lightOut } from '../sim/lights';
import type { FloorState, PlayerState, Enemy, SimEvent } from '../sim/state';
import { TEAM_COLORS, SELF_COLOR, teamColorIndex, ViewSource } from './view';

/** humans/cyborgs use the operator rig, everything else a beast rig */
interface ERig { op: OperatorRig | null; beast: DogRig | DroneRig | WardenRig | null; lastX: number; lastY: number; vis: number; visT: number }
const rootOf = (r: ERig) => (r.beast ? r.beast.root : r.op!.root);
interface PRig { rig: OperatorRig; color: number; look: string; ring: THREE.Mesh; downRing: THREE.Mesh; marks: THREE.Group; lastShot: number }

const pingTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ff2020'; g.lineWidth = 6;
  g.beginPath(); g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32); g.closePath(); g.stroke();
  g.fillStyle = 'rgba(255,32,32,0.5)'; g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const beastProtos = new Map<string, DogRig | DroneRig | WardenRig>();
/** Beast rigs are built once per kind (and holiday) and copied after that, like OperatorRig.make. */
function makeBeast(type: Enemy['type'], bite: boolean): DogRig | DroneRig | WardenRig {
  const key = `${type}:${bite}:${currentHoliday()}`;
  let p = beastProtos.get(key);
  if (!p) beastProtos.set(key, (p = type === 'drone' ? new DroneRig(bite) : type === 'warden' ? new WardenRig(bite) : new DogRig(type === 'dogcyborg')));
  const r = cloneRig(p);
  const blur = (r as any).blur as THREE.Mesh[] | undefined; // drone rotor blur fades per drone
  if (blur?.length) { const m = (blur[0].material as THREE.Material).clone(); for (const b of blur) b.material = m; }
  return r;
}

/** The rig for an enemy (also called ahead of time with a floor's spawns, so their looks are built before arrival). */
export function enemyRig(e: Pick<Enemy, 'id' | 'type' | 'elite' | 'weapon'>): Pick<ERig, 'op' | 'beast'> {
  if (e.type === 'loyalist' || e.type === 'cyborg') {
    // humans and human-cyborgs use the articulated rig; Halloween zombies ('bite') are unarmed
    const zombie = e.weapon === 'bite';
    const op = OperatorRig.make(0xff2020, { outfit: e.type === 'cyborg' ? (e.elite ? 'cyborgElite' : 'cyborg') : e.elite ? 'loyalistElite' : 'loyalist', skin: [0xb88c6a, 0x8a5a3c, 0xd8a888, 0x6a4430][e.id % 4], zombie });
    op.setGun(zombie ? null : (gunKindOf(weapon(e.weapon).category) as GunKind));
    return { op, beast: null };
  }
  // Halloween bats / ogres ('bite') are synced via weapon, so co-op clients build the same rig
  return { op: null, beast: makeBeast(e.type, e.weapon === 'bite') };
}

export class Entities {
  group = new THREE.Group();
  private enemies = new Map<number, ERig>();
  private players = new Map<number, PRig>();
  private pings = new Map<number, THREE.Sprite>();
  private grenades = new Map<number, THREE.Mesh>();
  /** dropped Health Kits: hovering, turning model + a soft shadow */
  private kits = new Map<number, { kit: THREE.Object3D; shadow: THREE.Mesh }>();
  private floor = -1;

  reset() {
    for (const r of this.players.values()) { this.group.remove(r.rig.root); this.group.remove(r.marks); }
    this.players.clear();
    for (const e of this.enemies.values()) this.group.remove(rootOf(e));
    this.enemies.clear();
    for (const s of this.pings.values()) this.group.remove(s);
    this.pings.clear();
    for (const g of this.grenades.values()) this.group.remove(g);
    this.grenades.clear();
    for (const k of this.kits.values()) this.group.remove(k.kit, k.shadow);
    this.kits.clear();
  }

  /** Is an enemy perceivable by the local team (light + line of sight)? */
  private visibleTo(fs: FloorState, e: Enemy, viewers: PlayerState[], t: number): boolean {
    const L = fs.L;
    for (const p of viewers) {
      const d = dist(p.x, p.y, e.x, e.y);
      if (d > 26) continue;
      if (!lineOfSight(L, p.x, p.y, e.x, e.y)) continue;
      if (d < 2.6) return true;
      let light = fs.floor === 0 ? 1 : 0.75 * (1 - L.darkness);
      for (const tp of viewers) {
        if (!tp.torchOn) continue;
        const td = dist(tp.x, tp.y, e.x, e.y);
        if (td < (tp.mods.torchmod ? 18 : 14) && Math.cos(angleTo(tp.x, tp.y, e.x, e.y) - tp.facing) > (tp.mods.torchmod ? 0.83 : 0.87)) { light = 1; break; }
      }
      if (light < 0.35) {
        for (let i = 0; i < L.lights.length; i++) {
          const l = L.lights[i];
          const ld = dist(l.x, l.y, e.x, e.y);
          if (ld > l.range) continue;
          const lv = lightLevel(l, lightOut(fs.lights[i], l), t);
          light = Math.max(light, (1 - ld / l.range) * lv);
          if (light >= 0.35) break;
        }
      }
      if (e.shotT < 0.15) light = 1; // muzzle flash gives them away
      if ((e as any).eyeGlow && light < 0.35 && d < 16) return true;
      if (light >= 0.3) return true;
    }
    return false;
  }

  update(view: ViewSource, localId: number, fs: FloorState, dt: number, events: SimEvent[] = []) {
    const t = view.t;
    if (this.floor !== fs.floor) { this.reset(); this.floor = fs.floor; }
    const local = view.players.find((p) => p.id === localId);
    const viewers = view.players.filter((p) => p.floor === fs.floor && p.life === 'alive');
    if (local && local.life !== 'alive' && !viewers.length) viewers.push(local);
    // enemies
    const seen = new Set<number>();
    for (const e of fs.enemies) {
      seen.add(e.id);
      let r = this.enemies.get(e.id);
      if (!r) {
        r = { ...enemyRig(e), lastX: e.x, lastY: e.y, vis: 0, visT: 0 };
        this.group.add(rootOf(r));
        this.enemies.set(e.id, r);
        (e as any).eyeGlow = e.type !== 'loyalist' && e.type !== 'dog';
      }
      if (r.beast) {
        const tp = e.target >= 0 ? view.players.find((p) => p.id === e.target) : undefined;
        r.beast.update({ dt, t: t + e.id, x: e.x, y: e.y, facing: e.facing, state: e.state, ground: stairElevation(fs.L, e.x, e.y), alert: e.state === 'alert', targetX: tp?.x, targetY: tp?.y });
      } else if (r.op) {
        const w = weapon(e.weapon);
        const moved = Math.hypot(e.x - r.lastX, e.y - r.lastY);
        const spd = dt > 0 ? moved / dt : 0;
        r.lastX = e.x; r.lastY = e.y;
        const z = r.op.zombie;
        r.op.update({
          dt, t: t + e.id, x: e.x, y: e.y, z: 0, facing: e.facing,
          crouch: !z && e.hasCover && Math.hypot(e.x - e.coverX, e.y - e.coverY) < 0.6 && e.state === 'alert' && e.shotT > 0.6,
          aiming: e.state === 'alert', sprinting: spd > 3.6 && e.state !== 'alert', firingRecently: !z && e.shotT < 0.8,
          life: e.state === 'dead' ? 'dead' : 'alive', gun: z ? null : (gunKindOf(w.category) as GunKind), aimPitch: 0,
          reload: !z && e.reloadT > 0 ? 1 - e.reloadT / (w.reload * 1.15) : -1, hurt: e.flashT > 0, ground: stairElevation(fs.L, e.x, e.y),
        });
      }
      r.visT -= dt;
      if (r.visT <= 0) {
        r.visT = 0.1;
        r.vis = this.visibleTo(fs, e, viewers, t) ? 1 : 0;
      }
      rootOf(r).visible = r.vis > 0;
    }
    for (const ev of events) {
      if (ev.e === 'shot' && ev.src === 'e') { const r = this.enemies.get(ev.id); r?.op?.onShot(); if (r?.beast instanceof DroneRig || r?.beast instanceof WardenRig) r.beast.onShot(); }
      if (ev.e === 'melee' && ev.pid < 0) { // a dog bite / zombie claw / bat nip / ogre smash: animate the nearest biter
        let best: ERig | null = null, bd = 2.2;
        for (const e of fs.enemies) { const r = this.enemies.get(e.id); const d = Math.hypot(e.x - ev.x, e.y - ev.y); if (r && (r.beast ? e.weapon === 'bite' : r.op?.zombie) && d < bd) { bd = d; best = r; } }
        if (best?.beast) best.beast.onBite(); else best?.op?.onMelee();
      }
    }
    for (const [id, r] of this.enemies) if (!seen.has(id)) { this.group.remove(rootOf(r)); this.enemies.delete(id); }
    // players: articulated operator rigs
    const pseen = new Set<number>();
    for (const ev of events) {
      if (ev.e === 'shot' && ev.src === 'p') this.players.get(ev.id)?.rig.onShot();
      else if (ev.e === 'throw') this.players.get(ev.pid)?.rig.onThrow();
      else if (ev.e === 'melee' && ev.pid >= 0) this.players.get(ev.pid)?.rig.onMelee();
    }
    for (const p of view.players) {
      if (p.floor !== fs.floor || p.life === 'out' || !p.connected) continue; // a disconnected teammate vanishes
      pseen.add(p.id);
      const ci = teamColorIndex(view.players, localId, p.id);
      const color = p.id === localId ? SELF_COLOR : TEAM_COLORS[ci % 4];
      let r = this.players.get(p.id);
      const look = JSON.stringify(p.look ?? null); // a teammate's appearance arriving (or changing) rebuilds their rig
      if (!r || r.color !== color || r.look !== look) {
        if (r) { this.group.remove(r.rig.root); this.group.remove(r.marks); }
        const rig = OperatorRig.make(color, { player: p.look });
        const marks = new THREE.Group();
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), (p.bot ? new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.45), transparent: true, opacity: 0.18, depthWrite: false }) /* bots: a faint, toned-down hint */ : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, toneMapped: false })));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
        const downRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.05, 32), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.7, toneMapped: false }));
        downRing.rotation.x = -Math.PI / 2; downRing.position.y = 0.04;
        marks.add(ring, downRing);
        this.group.add(rig.root, marks);
        r = { rig, color, look, ring, downRing, marks, lastShot: -9 };
        this.players.set(p.id, r);
      }
      const wi = p.sel === 'knife' ? null : p.weapons[p.sel];
      const w = wi ? weapon(wi.id) : null;
      r.rig.setGun(w ? (gunKindOf(w.category) as GunKind) : null, !!w && isSuppressed(w, p.mods));
      const d = Math.max(0.4, Math.hypot(p.aimX - p.x, p.aimY - p.y));
      const gz = (p.crouch ? 0.9 : 1.25) + p.z;
      const pitch = Number.isFinite(p.aimZ) ? Math.max(-0.9, Math.min(0.9, Math.atan2(gz - p.aimZ, d))) : 0;
      r.rig.update({
        dt, t, x: p.x, y: p.y, z: p.z, facing: p.facing,
        crouch: p.crouch, aiming: p.aiming, sprinting: p.sprinting, firingRecently: p.muzzleT > -0.8,
        life: p.life, gun: w ? (gunKindOf(w.category) as GunKind) : null, aimPitch: pitch,
        reload: p.reloadT > 0 && w ? 1 - p.reloadT / (p.reloadDur || w.reload) : -1, hurt: p.hurtT > 0, ground: stairElevation(fs.L, p.x, p.y),
      });
      r.marks.position.set(p.x, stairElevation(fs.L, p.x, p.y), p.y);
      r.ring.visible = p.life === 'alive';
      r.downRing.visible = p.life === 'down';
      if (p.life === 'down') r.downRing.scale.setScalar(1 + Math.sin(t * 5) * 0.08);
    }
    for (const [id, r] of this.players) if (!pseen.has(id)) { this.group.remove(r.rig.root); this.group.remove(r.marks); this.players.delete(id); }
    // enemy pings (red is reserved for enemy markers)
    const gseen = new Set<number>();
    for (const pg of fs.pings) {
      gseen.add(pg.id);
      let s = this.pings.get(pg.id);
      if (!s) {
        const mat = new THREE.SpriteMaterial({ map: pingTexture, depthTest: false, transparent: true, toneMapped: false, color: pg.enemyId >= 0 ? 0xffffff : 0x888888 });
        s = new THREE.Sprite(mat);
        s.scale.set(0.6, 0.6, 1);
        s.renderOrder = 10;
        this.group.add(s);
        this.pings.set(pg.id, s);
        if (pg.enemyId < 0) {
          // location ping: tint to the pinger's colour
          const ci = teamColorIndex(view.players, localId, pg.by);
          mat.color.setHex(pg.by === localId ? SELF_COLOR : TEAM_COLORS[Math.max(0, ci) % 4]);
          mat.map = null;
          s.scale.set(0.35, 0.35, 1);
        }
      }
      s.position.set(pg.x, pg.enemyId >= 0 ? 2.6 + Math.sin(t * 4) * 0.1 : 0.4, pg.y);
      (s.material as THREE.SpriteMaterial).opacity = Math.min(1, pg.t);
    }
    for (const [id, s] of this.pings) if (!gseen.has(id)) { this.group.remove(s); this.pings.delete(id); }
    // grenades in flight
    const nseen = new Set<number>();
    for (const g of fs.grenades) {
      nseen.add(g.id);
      let m = this.grenades.get(g.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: g.kind === 'flash' ? 0x9a9a9a : g.kind === 'smoke' ? 0x5a6a5a : g.kind === 'incendiary' ? 0x8a3a1a : 0x3a4a2a, roughness: 0.5, metalness: 0.4 }));
        this.group.add(m);
        this.grenades.set(g.id, m);
      }
      m.position.set(g.x, g.z + 0.08, g.y);
    }
    for (const [id, m] of this.grenades) if (!nseen.has(id)) { this.group.remove(m); this.grenades.delete(id); }
    // dropped Health Kits
    const kseen = new Set<number>();
    for (const k of fs.pickups) {
      kseen.add(k.id);
      let r = this.kits.get(k.id);
      if (!r) {
        const kit = gearModel('medkit');
        kit.scale.setScalar(1.6);
        const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
        shadow.rotation.x = -Math.PI / 2;
        this.group.add(kit, shadow);
        this.kits.set(k.id, (r = { kit, shadow }));
      }
      const g = stairElevation(fs.L, k.x, k.y), bob = Math.sin(t * 2.2 + k.id) * 0.06;
      r.kit.position.set(k.x, g + 0.45 + bob, k.y);
      r.kit.rotation.y = t * 0.9;
      r.shadow.position.set(k.x, g + 0.02, k.y);
      r.shadow.scale.setScalar(1 - bob * 1.5); // smaller as it rises
    }
    for (const [id, r] of this.kits) if (!kseen.has(id)) { this.group.remove(r.kit, r.shadow); this.kits.delete(id); }
  }

  /** A shooter's gun muzzle (sim coordinates) from its rig's last pose: players and human enemies; null otherwise. */
  muzzleOf(src: 'p' | 'e', id: number) {
    const op = src === 'p' ? this.players.get(id)?.rig : this.enemies.get(id)?.op;
    return op ? op.muzzleWorld() : null;
  }

  /** Whether the local team can currently see this enemy (used for cursor target snapping). */
  isVisible(id: number): boolean { return (this.enemies.get(id)?.vis ?? 0) > 0; }

  /** Muzzle position of a player's gun in world space (for tracer origin / torch). */
  playerRig(id: number): OperatorRig | null {
    return this.players.get(id)?.rig ?? null;
  }
}
