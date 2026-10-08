import { h } from './dom';
import { TEAM_CSS, teamColorIndex, type ViewSource } from '../render/view';
import { stairElevation } from '../sim/stairs';

/** Who gets a tag: other connected, living-or-downed co-op operators on the floor the camera shows (single player: none). */
export function taggedPlayers(view: ViewSource, localId: number, floor: number) {
  return view.cfg.mode === 'coop' ? view.players.filter((p) => p.id !== localId && p.floor === floor && p.connected && p.life !== 'out') : [];
}

type Project = (x: number, y: number, z: number) => { x: number; y: number; on: boolean };

/**
 * Co-op name tags: each other operator's callsign floats over their head in their team colour (DOM overlay
 * positioned with renderer.worldToScreen; #ui has no pointer events). Only teammates the renderer draws get
 * one: same floor as the camera, connected, not KIA. A downed teammate reads "DOWN"; a talking one shows a mic.
 */
export class NameTags {
  root = h('div', { class: 'nametags' });
  private tags = new Map<number, { el: HTMLElement; key: string }>();
  /** speech bubbles over squadmates (single-player chatter), with seconds left */
  private bubbles = new Map<number, { el: HTMLElement; t: number }>();

  say(id: number, text: string, seconds = 3.2) {
    this.bubbles.get(id)?.el.remove();
    const el = h('div', { class: 'bubble' }, text);
    this.root.append(el);
    this.bubbles.set(id, { el, t: seconds });
  }

  update(view: ViewSource, localId: number, floor: number, project: Project, speaking: (id: number) => boolean, dt = 0) {
    const seen = new Set<number>();
    for (const p of taggedPlayers(view, localId, floor)) {
      const ground = stairElevation(view.floorState(floor).L, p.x, p.y) + p.z;
      const head = (p.life === 'down' ? 0.7 : p.crouch ? 1.45 : 2.05) + ground;
      const s = project(p.x, p.y, head);
      if (!s.on) continue;
      seen.add(p.id);
      let t = this.tags.get(p.id);
      if (!t) { t = { el: h('div', { class: 'nametag' }), key: '' }; this.tags.set(p.id, t); this.root.append(t.el); }
      const col = TEAM_CSS[teamColorIndex(view.players, localId, p.id) % 4];
      const talk = speaking(p.id);
      const key = `${p.name}|${col}|${p.life}|${talk}`;
      if (key !== t.key) {
        t.key = key;
        t.el.replaceChildren(talk ? h('i', { class: 'mic' }) : '', p.name, p.life === 'down' ? h('b', {}, ' DOWN') : '');
        t.el.style.color = col;
        t.el.classList.toggle('talk', talk);
      }
      // a world-sized label: shrinks as the camera zooms out, within readable limits
      const pxPerM = Math.abs(project(p.x, p.y, head + 1).y - s.y);
      t.el.style.fontSize = `${Math.max(12, Math.min(18, pxPerM * 0.3))}px`;
      t.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, t] of this.tags) if (!seen.has(id)) { t.el.remove(); this.tags.delete(id); }
    for (const [id, b] of this.bubbles) {
      b.t -= dt;
      const p = view.players.find((q) => q.id === id);
      const s = p && p.floor === floor && p.life === 'alive' ? project(p.x, p.y, stairElevation(view.floorState(floor).L, p.x, p.y) + p.z + (p.crouch ? 1.9 : 2.5)) : null;
      if (b.t <= 0 || !s || !s.on) { if (b.t <= 0 || !p || p.life !== 'alive') { b.el.remove(); this.bubbles.delete(id); } else b.el.style.opacity = '0'; continue; }
      b.el.style.opacity = b.t < 0.4 ? String(b.t / 0.4) : '1';
      b.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
