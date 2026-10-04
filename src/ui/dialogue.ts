import { h } from './dom';
import type { NpcDef } from '../config/npcs';

/**
 * Conversation panel for street NPCs: name plate, typewriter speech line, numbered topics (click or 1-9) and a
 * goodbye (ESC). Topics already asked are dimmed but can be asked again.
 */
export class DialogueUI {
  el: HTMLElement;
  private text = h('div', { class: 'dl-text' });
  private opts = h('div', { class: 'dl-opts' });
  private asked = new Set<number>();
  private full = '';
  private shown = 0;
  private drawn = -1;
  private raf = 0;
  private closed = false;
  private onKey = (e: KeyboardEvent) => {
    const n = Number(e.key);
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
    else if (n >= 1 && n <= this.npc.topics.length) { e.preventDefault(); e.stopImmediatePropagation(); this.ask(n - 1); }
    else if (n === this.npc.topics.length + 1) { e.preventDefault(); e.stopImmediatePropagation(); this.close(); }
    else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); this.shown = this.full.length; } // skip typing
  };

  constructor(private npc: NpcDef, private onClose: () => void, private blip: () => void, portrait: HTMLImageElement | null = null) {
    this.el = h('div', { class: `dialogue ${portrait ? 'has-pic' : ''}` },
      portrait ? h('div', { class: 'dl-pic' }, portrait, h('div', { class: 'dl-badge' }, npc.name.toUpperCase())) : '',
      h('div', { class: 'dl-head' }, h('span', { class: 'dl-rank' }, npc.rank.toUpperCase()), h('span', { class: 'dl-name' }, npc.name), h('span', { class: 'dl-unit' }, 'AXIOM TOWER CORDON')),
      this.text, this.opts);
    this.say(npc.greeting);
    this.renderOpts();
    window.addEventListener('keydown', this.onKey, true);
    this.raf = requestAnimationFrame(this.tick);
  }

  private say(line: string) { this.full = line; this.shown = 0; this.drawn = -1; }
  private ask(i: number) { this.asked.add(i); this.say(this.npc.topics[i].a); this.renderOpts(); this.blip(); }

  private renderOpts() {
    this.opts.replaceChildren(
      ...this.npc.topics.map((t, i) => h('button', { class: `dl-opt ${this.asked.has(i) ? 'asked' : ''}`, onclick: () => this.ask(i) }, h('span', { class: 'dl-k' }, String(i + 1)), t.q)),
      h('button', { class: 'dl-opt bye', onclick: () => this.close() }, h('span', { class: 'dl-k' }, String(this.npc.topics.length + 1)), 'Goodbye'));
  }

  private tick = () => {
    if (this.shown < this.full.length) this.shown = Math.min(this.full.length, this.shown + 2);
    if (this.drawn !== this.shown || this.shown === 0) {
      this.drawn = this.shown;
      this.text.textContent = `"${this.full.slice(0, this.shown)}${this.shown < this.full.length ? '▍' : '"'}`;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  close() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    this.onClose();
  }
}
