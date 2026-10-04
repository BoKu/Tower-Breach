import { clamp, dist, wrapAngle, turnToward, angleTo } from '../core/math';
import { findPath, moveCircle, nearestWalkable } from './nav';
import { isWalkableTile, idx, S_LOW, S_TALL, T_WALL, T_WINDOW, FW, FH } from '../gen/floor';
import { canSee, trace, damagePlayer, damageEnemy, destroyCamera, breakVending } from './combat';
import { ENEMY_STATS } from './stats';
import { NETWORKED } from './types';
import { weapon } from '../config/weapons';
import type { Sim } from './sim';
import type { Enemy, FloorState, PlayerState } from './state';

const THINK = 0.1;

export class AI {
  constructor(private sim: Sim) {}

  /** AI collective network alert: only networked units (cyborgs, cyber-hounds, robots) respond. */
  networkAlert(fs: FloorState, x: number, y: number, spotted: boolean, who?: PlayerState) {
    fs.networkAlertT = 6;
    for (const e of fs.enemies) {
      if (e.state === 'dead' || !NETWORKED[e.type]) continue;
      e.lastKnownX = x; e.lastKnownY = y;
      e.interestX = x; e.interestY = y;
      if (spotted && who) {
        e.target = who.id;
        e.lastSeenT = this.sim.t;
        e.aware = Math.max(e.aware, 1);
        if (e.state !== 'alert') this.setState(e, 'alert');
      } else if (e.state !== 'alert') {
        e.aware = Math.max(e.aware, 0.6);
        this.setState(e, 'search');
      }
      e.path = null;
    }
  }

  setState(e: Enemy, s: Enemy['state']) {
    if (e.state === s) return;
    e.prevState = e.state;
    e.state = s;
    e.stateT = 0;
    e.path = null;
    e.hasCover = false;
  }

  becomeAlert(fs: FloorState, e: Enemy, p: PlayerState, knowsPos: boolean) {
    const wasCalm = e.state !== 'alert';
    e.target = p.id;
    e.aware = Math.max(e.aware, 1);
    if (knowsPos) { e.lastKnownX = p.x; e.lastKnownY = p.y; e.lastSeenT = this.sim.t; }
    if (!wasCalm) return;
    this.setState(e, 'alert');
    e.burstLeft = 0;
    e.fireCd = 0.35 + this.sim.rng.next() * 0.4; // reaction time
    const pr = this.sim.pressure(fs.floor);
    e.pushing = this.sim.rng.chance(clamp(0.18 * pr.aggression, 0, 0.8));
    this.sim.emit({ e: 'bark', f: fs.floor, id: e.id, t: e.type, k: 'alert' });
    if (this.sim.t - (fs as any)._lastAlertStinger > 12 || (fs as any)._lastAlertStinger === undefined) {
      (fs as any)._lastAlertStinger = this.sim.t;
      this.sim.emit({ e: 'stinger', f: fs.floor, k: 'alert' });
    }
    // humans shout to nearby squadmates; networked units broadcast
    if (NETWORKED[e.type]) {
      this.networkAlert(fs, p.x, p.y, true, p);
    } else {
      for (const o of fs.enemies) {
        if (o === e || o.state === 'dead' || o.state === 'alert') continue;
        const d = dist(e.x, e.y, o.x, o.y);
        if ((o.squad === e.squad && d < 18) || d < 9 || (d < 16 && canSee(fs, e.x, e.y, o.x, o.y))) {
          o.lastKnownX = p.x; o.lastKnownY = p.y; o.lastSeenT = this.sim.t;
          o.target = p.id;
          o.aware = 1;
          this.setState(o, 'alert');
          o.fireCd = 0.6 + this.sim.rng.next() * 0.5;
        }
      }
    }
  }

  /** Sound propagation. Everyone hears; walls muffle. */
  hear(fs: FloorState, x: number, y: number, r: number, src: PlayerState | null) {
    for (const e of fs.enemies) {
      if (e.state === 'dead' || e.flashT > 0.5) continue;
      const st = ENEMY_STATS[e.type];
      const d = dist(x, y, e.x, e.y);
      const reach = r * st.hearing * (canSee(fs, e.x, e.y, x, y) ? 1 : 0.6);
      if (d > reach) continue;
      const strength = 1 - d / reach;
      if (e.state === 'alert') {
        if (src && e.target === src.id && this.sim.t - e.lastSeenT > 1) { e.lastKnownX = x; e.lastKnownY = y; }
        continue;
      }
      e.interestX = x; e.interestY = y;
      e.lastKnownX = x; e.lastKnownY = y;
      const loud = r >= 14;
      // Sound raises suspicion but never completes detection on its own: the last 40% must come from sight.
      e.aware = Math.max(e.aware, Math.min(0.6, e.aware + (loud ? 0.55 : 0.3) * (0.4 + strength)));
      if (loud && d < reach * 0.45 && src) {
        e.target = src.id;
        this.setState(e, 'search');
      } else if (e.aware > 0.3) {
        if (e.state === 'sleep') this.sim.emit({ e: 'bark', f: fs.floor, id: e.id, t: e.type, k: 'suspicious' });
        if (e.state !== 'investigate' && e.state !== 'search') {
          this.setState(e, loud ? 'investigate' : 'suspicious');
          if (e.barkT <= 0) { this.sim.emit({ e: 'bark', f: fs.floor, id: e.id, t: e.type, k: 'suspicious' }); e.barkT = 3; }
        }
      }
    }
  }

  /** Detection rate (per second) of player p by enemy e, 0 if not perceivable. */
  detectRate(fs: FloorState, e: Enemy, p: PlayerState): number {
    if (p.life !== 'alive' || !p.connected || p.floor !== fs.floor) return 0; // disconnected players have left the world
    const st = ENEMY_STATS[e.type];
    const d = dist(e.x, e.y, p.x, p.y);
    const inTorch = p.torchOn && d < 16 && Math.cos(angleTo(p.x, p.y, e.x, e.y) - p.facing) > 0.86;
    let view = st.view * (inTorch ? 1.35 : 1);
    if (e.state === 'alert') view *= 1.3;
    if (d > view) return 0;
    const ang = Math.abs(wrapAngle(angleTo(e.x, e.y, p.x, p.y) - e.facing));
    const close = d < 1.8;
    if (ang > st.fov && !close && !inTorch) return 0;
    if (e.state === 'sleep' && !close) return 0;
    if (!canSee(fs, e.x, e.y, p.x, p.y)) return 0;
    let exp = p.exposure;
    if (st.metal || e.type === 'cyborg' || e.type === 'dogcyborg') exp = Math.max(exp, 0.32); // low-light optics (darkness still helps)
    if (e.type === 'dog') exp = Math.max(exp, 0.3);
    if (inTorch) exp = Math.max(exp, 0.95);
    const stance = p.crouch ? (p.moving ? 0.45 : 0.35) : p.sprinting ? 1.4 : p.moving ? 1 : 0.62;
    const range = Math.pow(1 - d / view, 0.5);
    const state = e.state === 'alert' ? 3 : e.state === 'search' || e.state === 'investigate' || e.state === 'suspicious' ? 1.6 : 1;
    let rate = 2.6 * this.sim.pressure(fs.floor).perception * exp * range * stance * state;
    if (close && ang > st.fov) rate *= 0.7;
    return rate;
  }

  update(fs: FloorState, dt: number) {
    const sim = this.sim;
    for (const e of fs.enemies) {
      if (e.state === 'dead') { e.deadT += dt; continue; }
      e.stateT += dt; e.thinkT -= dt; e.barkT -= dt; e.fireCd -= dt; e.shotT += dt;
      if (e.flashT > 0) e.flashT -= dt;
      if (e.stunT > 0) e.stunT -= dt;
      if (e.reloadT > 0) { e.reloadT -= dt; if (e.reloadT <= 0) e.mag = weapon(e.weapon).mag; }
      if (e.mag === 0 && e.reloadT <= 0 && e.shotT === 9) e.mag = weapon(e.weapon).mag;
      if (e.thinkT <= 0) {
        e.thinkT = THINK;
        this.perceive(fs, e, THINK);
        this.think(fs, e);
      }
      this.act(fs, e, dt);
    }
  }

  private perceive(fs: FloorState, e: Enemy, dt: number) {
    if (e.flashT > 0) return;
    let best: PlayerState | null = null, bestRate = 0;
    e.seenBy = 0;
    for (const p of this.sim.players) {
      const r = this.detectRate(fs, e, p);
      if (r > bestRate) { bestRate = r; best = p; }
    }
    if (best && bestRate > 0) {
      e.aware = Math.min(1.5, e.aware + bestRate * dt);
      if (e.state === 'alert' && e.target === best.id) { e.lastKnownX = best.x; e.lastKnownY = best.y; e.lastSeenT = this.sim.t; }
      if (e.aware >= 1) {
        if (e.state !== 'alert' || e.target !== best.id) {
          const cur = this.sim.players.find((p) => p.id === e.target);
          if (e.state !== 'alert' || !cur || cur.life !== 'alive' || !cur.connected || cur.floor !== fs.floor || dist(e.x, e.y, best.x, best.y) < dist(e.x, e.y, cur.x, cur.y) - 3) this.becomeAlert(fs, e, best, true);
        }
        e.lastKnownX = best.x; e.lastKnownY = best.y; e.lastSeenT = this.sim.t;
      } else if (e.aware > 0.35 && (e.state === 'patrol' || e.state === 'guard' || e.state === 'wander' || e.state === 'idle' || e.state === 'sleep')) {
        e.interestX = best.x; e.interestY = best.y;
        this.setState(e, 'suspicious');
        if (e.barkT <= 0) { this.sim.emit({ e: 'bark', f: fs.floor, id: e.id, t: e.type, k: 'suspicious' }); e.barkT = 3; }
      } else if (e.state === 'suspicious' || e.state === 'investigate') {
        e.interestX = best.x; e.interestY = best.y;
      }
    } else if (e.state !== 'alert') {
      e.aware = Math.max(0, e.aware - 0.1 * dt);
    }
  }

  private think(fs: FloorState, e: Enemy) {
    const sim = this.sim;
    switch (e.state) {
      case 'suspicious':
        if (e.stateT > 1.3) this.setState(e, 'investigate');
        break;
      case 'investigate':
        if (dist(e.x, e.y, e.interestX, e.interestY) < 1.2 || e.stateT > 18) {
          if (e.stateT > 3 && !e.path) { this.setState(e, e.route.length > 1 ? 'patrol' : 'guard'); e.aware = Math.min(e.aware, 0.3); }
        }
        break;
      case 'search':
        if (e.stateT > 14) { this.setState(e, e.route.length > 1 ? 'patrol' : 'guard'); e.aware = 0.3; e.target = -1; }
        break;
      case 'alert': {
        const tp = sim.players.find((p) => p.id === e.target);
        if (!tp || tp.life !== 'alive' || !tp.connected || tp.floor !== fs.floor) {
          // find another target
          const alt = sim.players.filter((p) => p.life === 'alive' && p.connected && p.floor === fs.floor).sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y))[0];
          if (alt && dist(e.x, e.y, alt.x, alt.y) < 20) { e.target = alt.id; e.lastKnownX = alt.x; e.lastKnownY = alt.y; }
          else { this.setState(e, 'search'); e.target = -1; }
        } else if (sim.t - e.lastSeenT > (fs.wave?.active ? 30 : 6)) {
          this.setState(e, 'search');
          e.interestX = e.lastKnownX; e.interestY = e.lastKnownY;
        }
        break;
      }
    }
  }

  private act(fs: FloorState, e: Enemy, dt: number) {
    const sim = this.sim;
    const st = ENEMY_STATS[e.type];
    const L = fs.L;
    let goalX = e.x, goalY = e.y, speed = st.walk, faceTo: number | null = null;
    const tp = e.target >= 0 ? sim.players.find((p) => p.id === e.target) : undefined;
    switch (e.state) {
      case 'sleep':
      case 'idle':
        break;
      case 'guard':
        if (dist(e.x, e.y, e.homeX, e.homeY) > 0.8) { goalX = e.homeX; goalY = e.homeY; }
        else faceTo = e.homeFacing + Math.sin(sim.t * 0.3 + e.id) * 1.1;
        break;
      case 'wander':
        if (!e.path || e.stateT > 12) {
          const a = sim.rng.range(0, 6.28), r = sim.rng.range(2, 6);
          e.interestX = e.homeX + Math.cos(a) * r; e.interestY = e.homeY + Math.sin(a) * r;
          e.stateT = sim.rng.range(0, 6);
        }
        goalX = e.interestX; goalY = e.interestY;
        break;
      case 'patrol': {
        const wp = e.route[e.routeI % e.route.length];
        if (dist(e.x, e.y, wp.x, wp.y) < 0.9) { e.routeI++; e.stateT = 0; }
        if (e.stateT > 1.5 || e.route.length < 2) { goalX = wp.x; goalY = wp.y; }
        break;
      }
      case 'suspicious':
        faceTo = angleTo(e.x, e.y, e.interestX, e.interestY);
        break;
      case 'investigate':
        goalX = e.interestX; goalY = e.interestY;
        speed = (st.walk + st.run) / 2;
        if (dist(e.x, e.y, goalX, goalY) < 1.2) faceTo = e.facing + dt * 1.5;
        break;
      case 'search': {
        speed = st.run * 0.8;
        if (e.stateT < 5 || !e.path) {
          if (dist(e.x, e.y, e.interestX, e.interestY) < 1.4) {
            const a = sim.rng.range(0, 6.28), r = sim.rng.range(3, 7);
            const nx = e.lastKnownX + Math.cos(a) * r, ny = e.lastKnownY + Math.sin(a) * r;
            if (isWalkableTile(L, Math.floor(nx), Math.floor(ny))) { e.interestX = nx; e.interestY = ny; }
          }
        }
        goalX = e.interestX; goalY = e.interestY;
        if (e.stateT < 0.2) { e.interestX = e.lastKnownX; e.interestY = e.lastKnownY; }
        break;
      }
      case 'alert': {
        if (!tp) break;
        const zombie = e.weapon === 'bite' && !st.melee; // Halloween: zombie (loyalist/cyborg), bat (drone), ogre (warden)
        speed = zombie ? st.run * ({ cyborg: 0.9, loyalist: 0.75, drone: 1.7, warden: 1.1 } as Record<string, number>)[e.type] : st.run;
        const d = dist(e.x, e.y, tp.x, tp.y);
        const seen = sim.t - e.lastSeenT < 0.3;
        const tx = seen ? tp.x : e.lastKnownX, ty = seen ? tp.y : e.lastKnownY;
        faceTo = angleTo(e.x, e.y, tx, ty);
        if (st.melee || zombie) {
          // fast flankers: circle wide then close in
          if (d > 4.5) {
            const a = angleTo(tp.x, tp.y, e.x, e.y) + e.flankSide * 0.7;
            goalX = tp.x + Math.cos(a) * 2.5; goalY = tp.y + Math.sin(a) * 2.5;
          } else { goalX = tx; goalY = ty; }
          if (d < (e.type === 'warden' ? 1.9 : 1.35) && e.fireCd <= 0 && seen) this.bite(fs, e, tp); // ogres reach further
          break;
        }
        const w = weapon(e.weapon);
        const wantRange = e.type === 'drone' ? 7 : e.type === 'warden' ? 9 : e.pushing || fs.wave?.active ? 4 : Math.min(12, w.range * 0.45);
        if (e.type === 'drone') {
          const a = angleTo(tp.x, tp.y, e.x, e.y) + Math.sin(sim.t * 0.22 + e.id) * 0.45;
          goalX = tx + Math.cos(a) * wantRange; goalY = ty + Math.sin(a) * wantRange;
        } else if (e.type === 'warden') {
          if (d > wantRange || !seen) { goalX = tx; goalY = ty; } else speed = 0;
        } else {
          // humans & cyborgs: cover and flanking
          if (!seen) {
            if (e.type === 'cyborg' && d > 5) {
              const a = angleTo(tp.x, tp.y, e.x, e.y) + e.flankSide * 0.9;
              goalX = e.lastKnownX + Math.cos(a) * 4; goalY = e.lastKnownY + Math.sin(a) * 4;
            } else { goalX = e.lastKnownX; goalY = e.lastKnownY; }
            e.hasCover = false;
          } else if (e.pushing && d > 3.5) {
            goalX = tp.x; goalY = tp.y; speed = st.run * 0.8;
          } else {
            if (!e.hasCover || e.stateT > 5 + (e.id % 4)) {
              this.findCover(fs, e, tp);
              e.stateT = 0;
              if (sim.rng.chance(0.12 * sim.pressure(fs.floor).aggression)) e.pushing = true;
            }
            if (e.hasCover) { goalX = e.coverX; goalY = e.coverY; }
            else if (d > wantRange) { goalX = tp.x; goalY = tp.y; }
          }
        }
        // shooting
        if (seen && d <= w.range && e.flashT <= 0) this.shoot(fs, e, tp, dt);
        break;
      }
    }
    if (e.flashT > 0) { // blinded: stumble
      speed *= 0.3;
      faceTo = e.facing + Math.sin(sim.t * 5 + e.id) * dt * 3;
    }
    // path following
    const moving = dist(e.x, e.y, goalX, goalY) > 0.35 && speed > 0;
    if (moving) {
      if (!e.path || dist(goalX, goalY, e.pathGoalX, e.pathGoalY) > 1.5 || sim.t - e.pathT > 1.2) {
        const fireZones = fs.zones.filter((z) => z.kind === 'fire');
        e.path = findPath(L, e.x, e.y, goalX, goalY, fireZones.length ? (tx, ty) => (fireZones.some((z) => dist(tx + 0.5, ty + 0.5, z.x, z.y) < z.r + 0.5) ? 25 : 0) : undefined, 2200);
        e.pathGoalX = goalX; e.pathGoalY = goalY; e.pathT = sim.t;
        if (!e.path && e.state === 'investigate') this.setState(e, 'patrol');
      }
      if (e.path && e.path.length) {
        const wp = e.path[0];
        const dx = wp.x - e.x, dy = wp.y - e.y;
        const dd = Math.hypot(dx, dy);
        if (dd < 0.3) e.path.shift();
        else {
          let vx = (dx / dd) * speed, vy = (dy / dd) * speed;
          // separation
          for (const o of fs.enemies) {
            if (o === e || o.state === 'dead') continue;
            const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy);
            const min = st.radius + ENEMY_STATS[o.type].radius + 0.15;
            if (od < min && od > 0.001) { vx += (ox / od) * 0.8; vy += (oy / od) * 0.8; }
          }
          const vl = Math.hypot(vx, vy);
          if (vl > speed * 1.15) { vx *= (speed * 1.15) / vl; vy *= (speed * 1.15) / vl; } // separation never speeds a unit up
          e.vx = vx; e.vy = vy;
          const r = moveCircle(L, e.x, e.y, vx * dt, vy * dt, st.radius * 0.9, e.type === 'drone');
          e.x = r.x; e.y = r.y;
          e.anim += Math.hypot(vx, vy) * dt;
          if (faceTo === null) faceTo = Math.atan2(vy, vx);
        }
      }
    } else { e.vx = 0; e.vy = 0; }
    if (faceTo !== null) e.facing = turnToward(e.facing, faceTo, st.turn * dt);
    // Warden stomps; drones hum -> occasional noise pulses keep the soundscape reactive
  }

  private findCover(fs: FloorState, e: Enemy, tp: PlayerState) {
    const L = fs.L;
    const w = weapon(e.weapon);
    let best = -1e9, bx = 0, by = 0;
    const cx = Math.floor(e.x), cy = Math.floor(e.y);
    for (let dy = -6; dy <= 6; dy++)
      for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx, y = cy + dy;
        if (!isWalkableTile(L, x, y)) continue;
        const px = x + 0.5, py = y + 0.5;
        const d = dist(px, py, tp.x, tp.y);
        if (d < 3.5 || d > w.range * 0.85) continue;
        // cover: a blocker between the tile and the target direction
        const sx = Math.sign(tp.x - px), sy = Math.sign(tp.y - py);
        const bxT = x + (Math.abs(tp.x - px) > Math.abs(tp.y - py) ? sx : 0);
        const byT = y + (Math.abs(tp.x - px) > Math.abs(tp.y - py) ? 0 : sy);
        const blk = L.solid[idx(bxT, byT)];
        const wall = L.tiles[idx(bxT, byT)] === T_WALL || L.tiles[idx(bxT, byT)] === T_WINDOW;
        if (!blk && !wall) continue;
        const low = blk === S_LOW;
        if (low && !canSee(fs, px, py, tp.x, tp.y)) continue;
        if (!low && !canSee(fs, px + (bxT === x ? 0.9 * (dx >= 0 ? 1 : -1) : 0), py + (byT === y ? 0.9 : 0), tp.x, tp.y) && !canSee(fs, px, py, tp.x, tp.y)) continue;
        if (fs.enemies.some((o) => o !== e && o.state !== 'dead' && o.hasCover && dist(o.coverX, o.coverY, px, py) < 1.2)) continue;
        const score = (low ? 4 : 2) - dist(px, py, e.x, e.y) * 0.4 - Math.abs(d - 8) * 0.25 + this.sim.rng.next();
        if (score > best) { best = score; bx = px; by = py; }
      }
    if (best > -1e9) { e.hasCover = true; e.coverX = bx; e.coverY = by; } else e.hasCover = false;
  }

  private shoot(fs: FloorState, e: Enemy, tp: PlayerState, dt: number) {
    const sim = this.sim;
    const w = weapon(e.weapon);
    if (e.reloadT > 0 || e.fireCd > 0) return;
    const aimAng = angleTo(e.x, e.y, tp.x, tp.y);
    if (Math.abs(wrapAngle(aimAng - e.facing)) > 0.3) return;
    if (e.mag <= 0) { e.reloadT = w.reload * 1.15; return; }
    if (e.burstLeft <= 0) {
      e.burstLeft = w.auto ? 3 + Math.floor(sim.rng.next() * 4) : 1;
    }
    const pr = sim.pressure(fs.floor);
    const st = ENEMY_STATS[e.type];
    const acc = clamp(st.accuracy * pr.accuracy * (e.elite ? 1.2 : 1), 0.1, 0.97);
    const moveErr = tp.moving ? (tp.sprinting ? 0.09 : 0.05) : 0;
    const d = dist(e.x, e.y, tp.x, tp.y);
    const spread = (w.spread * 0.6 + (1 - acc) * 0.16 + moveErr + (tp.crouch ? 0.02 : 0)) * (e.state === 'alert' && sim.t - e.lastSeenT > 0.2 ? 1.5 : 1);
    for (let k = 0; k < w.pellets; k++) {
      const a = aimAng + (sim.rng.next() - 0.5) * 2 * spread;
      const ox = e.x + Math.cos(e.facing) * 0.4, oy = e.y + Math.sin(e.facing) * 0.4;
      const hit = trace(sim, fs, ox, oy, a, w.range, 'e', e.id);
      sim.emit({ e: 'shot', f: fs.floor, x: ox, y: oy, x2: hit.x, y2: hit.y, w: w.id, src: 'e', id: e.id, hit: hit.kind === 'player' ? 'flesh' : hit.kind === 'none' ? 'none' : 'wall' });
      if (hit.kind === 'player') {
        const falloff = d > w.range * 0.6 ? 0.75 : 1;
        damagePlayer(sim, hit.ref as PlayerState, w.damage * pr.damage * 0.55 * falloff, w.pen, 'bullet', sim.rng.chance(0.08));
      } else if (hit.kind === 'camera') { /* enemies never shoot own cameras */ }
    }
    e.mag--;
    e.shotT = 0;
    e.burstLeft--;
    sim.noise(fs, e.x, e.y, w.noise, null, true);
    e.fireCd = e.burstLeft > 0 ? 1 / w.rps : 0.45 + sim.rng.next() * 0.9 / pr.aggression;
  }

  private bite(fs: FloorState, e: Enemy, tp: PlayerState) {
    const sim = this.sim;
    const pr = sim.pressure(fs.floor);
    const w = weapon(e.weapon);
    const dmg = ({ dogcyborg: 22, cyborg: 24, loyalist: 16, drone: 9, warden: 45 } as Record<string, number>)[e.type] ?? 14; // dogs, zombies, bats, ogres
    damagePlayer(sim, tp, dmg * pr.damage, e.type === 'warden' ? 0.6 : 0.3, 'melee');
    sim.emit({ e: 'bark', f: fs.floor, id: e.id, t: e.type, k: 'alert' });
    sim.emit({ e: 'melee', f: fs.floor, x: tp.x, y: tp.y, hit: true, pid: -1 });
    e.fireCd = e.type === 'warden' ? 1.8 : e.type === 'drone' ? 0.9 : 1 / w.rps; // ogre swings are slow, bat nips quick
  }
}

export { destroyCamera, breakVending, damageEnemy };
