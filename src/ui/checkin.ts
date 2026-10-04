import { h } from './dom';

/**
 * Command-tent check-in: Police Chief Hollis at the laptop registers the operator's callsign (used for the saved score
 * records) before the armory unlocks. Same look as the NPC dialogue panel, with a name field.
 */
export class CheckInUI {
  el: HTMLElement;
  private input: HTMLInputElement;
  private done = false;
  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.finish(null); }
    else if (e.code === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); this.finish(this.input.value); }
  };

  constructor(defaultName: string, private onDone: (name: string | null) => void, portrait: HTMLImageElement | null = null) {
    this.input = h('input', { class: 'text ci-name', value: defaultName, maxlength: 16, placeholder: 'Enter your callsign' }) as HTMLInputElement;
    this.el = h('div', { class: `dialogue ${portrait ? 'has-pic' : ''}` },
      portrait ? h('div', { class: 'dl-pic chief' }, portrait, h('div', { class: 'dl-badge' }, 'HOLLIS')) : '',
      h('div', { class: 'dl-head' }, h('span', { class: 'dl-rank' }, 'POLICE CHIEF'), h('span', { class: 'dl-name' }, 'Hollis'), h('span', { class: 'dl-unit' }, 'AXIOM TOWER CORDON')),
      h('div', { class: 'dl-text' }, '"Chief Hollis. I run this cordon, and nobody goes through that door until they\'re on my books. Operator, you\'re cleared to breach once you are. Give me your callsign. It goes on the record, win or lose. Then the armory is yours: spend it wisely, there\'s no coming back down for more."'),
      h('div', { class: 'ci-row' }, h('span', { class: 'dl-k' }, 'CALLSIGN'), this.input),
      h('div', { class: 'dl-opts' },
        h('button', { class: 'dl-opt', onclick: () => this.finish(this.input.value) }, h('span', { class: 'dl-k' }, '↵'), 'Register and open the armory'),
        h('button', { class: 'dl-opt bye', onclick: () => this.finish(null) }, h('span', { class: 'dl-k' }, 'ESC'), 'Not yet')));
    window.addEventListener('keydown', this.onKey, true);
    setTimeout(() => { this.input.focus(); this.input.select(); }, 30);
  }

  private finish(name: string | null) {
    if (this.done) return;
    const clean = name === null ? null : name.replace(/[^\w .\-']/g, '').trim().slice(0, 16);
    if (clean === '') { this.input.classList.add('bad'); this.input.focus(); return; }
    this.done = true;
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    this.onDone(clean);
  }

  close() { this.finish(null); }
}
