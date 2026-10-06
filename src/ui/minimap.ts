import { FloorLayout, FW, FH, idx, T_WALL, T_WINDOW, T_DOOR, T_FLOOR } from '../gen/floor';
import { stairPassable } from '../gen/building';
import type { ViewSource } from '../render/view';
import { TEAM_CSS, teamColorIndex } from '../render/view';

const S = 4; // px per tile on the base layer

export class Minimap {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private baseKey = '';
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 472; this.canvas.height = 380;
    this.ctx = this.canvas.getContext('2d')!;
  }

  private buildBase(L: FloorLayout) {
    const c = document.createElement('canvas');
    c.width = FW * S; c.height = FH * S;
    const g = c.getContext('2d')!;
    for (let y = 0; y < FH; y++)
      for (let x = 0; x < FW; x++) {
        const t = L.tiles[idx(x, y)];
        if (t === T_FLOOR || t === T_DOOR) {
          const room = L.rooms[L.roomAt[idx(x, y)]];
          g.fillStyle = room?.type === 'stair' ? '#0c4a3a' : room?.type === 'elevator' ? '#10304a' : room?.main ? '#0b3440' : '#072229';
          if (L.solid[idx(x, y)] && t !== T_DOOR) g.fillStyle = '#124252';
          g.fillRect(x * S, y * S, S, S);
        } else if (t === T_WALL || t === T_WINDOW) {
          let edge = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = L.tiles[idx(Math.min(FW - 1, Math.max(0, x + dx)), Math.min(FH - 1, Math.max(0, y + dy)))]; if (n === T_FLOOR || n === T_DOOR) edge = true; }
          if (edge) { g.fillStyle = t === T_WINDOW ? '#1d6680' : '#2aa6c8'; g.fillRect(x * S, y * S, S, S); }
        }
      }
    this.base = c;
  }

  draw(view: ViewSource, localId: number, focusId: number) {
    const me = view.players.find((p) => p.id === focusId);
    if (!me) return;
    const fs = view.floorState(me.floor);
    const key = `${view.cfg.seed}:${me.floor}`;
    if (key !== this.baseKey) { this.buildBase(fs.L); this.baseKey = key; }
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,14,18,0.92)';
    g.fillRect(0, 0, W, H);
    const scale = 2.3; // canvas px per base px
    g.translate(W / 2, H / 2);
    g.rotate(Math.PI / 4); // match the isometric camera: screen-up = world north-west
    g.scale(scale, scale);
    g.translate(-me.x * S, -me.y * S);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.base!, 0, 0);
    const P = (x: number) => x * S;
    // stairs & lifts, coloured by the state of the flight *up*
    for (const s of fs.L.stairs) {
      const c = me.floor >= 200 ? 'collapsed' : view.flightCondition(me.floor, s.index);
      g.fillStyle = stairPassable(c) ? (c === 'clear' ? '#43d17a' : '#e3a634') : c === 'debris' ? '#c07030' : '#ff3b30';
      g.fillRect(P(s.upX) - 5, P(s.upY) - 5, 10, 10);
      g.fillStyle = '#9aa';
      g.font = 'bold 9px monospace';
      g.fillText('▲', P(s.upX) - 4, P(s.upY) + 3);
    }
    for (const e of fs.L.elevators) {
      const w = view.plan.elevator(me.floor, e.index).working;
      g.strokeStyle = w ? '#43d17a' : '#ff3b30';
      g.lineWidth = 2;
      g.strokeRect(P(e.x0), P(e.y0), P(3), P(3));
    }
    if (fs.L.mainframe) { g.fillStyle = '#57b5ff'; g.beginPath(); g.arc(P(fs.L.mainframe.termX), P(fs.L.mainframe.termY), 6, 0, 6.28); g.fill(); }
    for (const po of fs.L.portals) { g.fillStyle = '#e3a634'; g.fillRect(P(po.x) - 5, P(po.y) - 3, 10, 6); }
    // street: until you check in, mark Command (the officer at the tent laptop)
    const meP = view.players.find((p) => p.id === localId);
    if (fs.floor === 0 && meP && !meP.checkedIn) {
      const cmd = fs.L.ambient.find((a) => a.kind === 'officer' && a.npc < 0);
      if (cmd) { const pulse = 7 + Math.sin(performance.now() / 180) * 2; g.strokeStyle = '#ffd23d'; g.lineWidth = 2.5; g.beginPath(); g.arc(P(cmd.x), P(cmd.y), pulse, 0, 6.28); g.stroke(); g.fillStyle = '#ffd23d'; g.beginPath(); g.arc(P(cmd.x), P(cmd.y), 3, 0, 6.28); g.fill(); }
    }
    // hackable computers: hex outline (magenta security, amber lighting; green done, red locked)
    for (const hk of fs.hacks) {
      g.strokeStyle = hk.state === 'done' ? '#1fe07a' : hk.state === 'locked' ? '#ff3b4e' : hk.kind === 'security' ? '#ff4fd0' : '#ffc23a';
      g.lineWidth = 2;
      g.beginPath();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.PI / 6; g.lineTo(P(hk.x) + Math.cos(a) * 6, P(hk.y) + Math.sin(a) * 6); }
      g.closePath(); g.stroke();
    }
    // shut doors: a bar across the doorway, red when locked
    fs.L.doors.forEach((d, i) => {
      const st = fs.doors[i]?.state;
      if (!st || st === 'open') return;
      const t0 = d.tiles[0], t1 = d.tiles[d.tiles.length - 1];
      g.strokeStyle = st === 'locked' ? '#ff3b30' : '#c8a060'; g.lineWidth = 2;
      g.beginPath();
      if (d.vertical) { g.moveTo(P(d.x), P((t0 / FW) | 0)); g.lineTo(P(d.x), P(((t1 / FW) | 0) + 1)); }
      else { g.moveTo(P(t0 % FW), P(d.y)); g.lineTo(P((t1 % FW) + 1), P(d.y)); }
      g.stroke();
    });
    // known hazards
    for (const t of fs.traps) if (t.revealed && t.armed) { g.strokeStyle = '#ff3b30'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(P(t.x) - 3, P(t.y) - 3); g.lineTo(P(t.x) + 3, P(t.y) + 3); g.moveTo(P(t.x) + 3, P(t.y) - 3); g.lineTo(P(t.x) - 3, P(t.y) + 3); g.stroke(); }
    for (const c of fs.cameras) if (c.alive && Math.hypot(c.x - me.x, c.y - me.y) < 16) {
      g.fillStyle = c.alarmT > 0 ? 'rgba(255,40,30,0.35)' : 'rgba(255,170,40,0.18)';
      g.beginPath(); g.moveTo(P(c.x), P(c.y)); g.arc(P(c.x), P(c.y), P(c.range), c.angle - c.fov, c.angle + c.fov); g.closePath(); g.fill();
    }
    // red = enemy markers (pings)
    for (const pg of fs.pings) {
      if (pg.enemyId < 0) continue;
      g.fillStyle = '#ff2020';
      g.beginPath(); g.moveTo(P(pg.x), P(pg.y) - 6); g.lineTo(P(pg.x) + 6, P(pg.y)); g.lineTo(P(pg.x), P(pg.y) + 6); g.lineTo(P(pg.x) - 6, P(pg.y)); g.closePath(); g.fill();
    }
    // teammates: same floor = solid, other floors = hollow with floor delta
    for (const p of view.players) {
      if (p.life === 'out' || !p.connected) continue;
      const self = p.id === localId;
      const ci = teamColorIndex(view.players, localId, p.id);
      const col = self ? '#f0f0f0' : TEAM_CSS[Math.max(0, ci) % 4];
      const x = P(p.x), y = P(p.y);
      if (p.floor === me.floor) {
        g.fillStyle = col;
        g.beginPath(); g.arc(x, y, self ? 5 : 4.5, 0, 6.28); g.fill();
        g.strokeStyle = col; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(p.facing) * 10, y + Math.sin(p.facing) * 10); g.stroke();
        if (p.life === 'down') { g.strokeStyle = '#ff3b30'; g.beginPath(); g.arc(x, y, 9, 0, 6.28); g.stroke(); }
      } else {
        g.strokeStyle = col; g.lineWidth = 2;
        g.setLineDash([3, 2]);
        g.beginPath(); g.arc(x, y, 5, 0, 6.28); g.stroke();
        g.setLineDash([]);
        g.save(); g.translate(x, y); g.rotate(-Math.PI / 4);
        g.fillStyle = col; g.font = 'bold 10px monospace';
        g.fillText(`${p.floor > me.floor ? '▲' : '▼'}${p.floor}`, 7, 4);
        g.restore();
      }
    }
  }
}
