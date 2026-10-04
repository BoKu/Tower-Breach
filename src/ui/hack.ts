import { h } from './dom';
import { HackGame } from './hackgame';

/**
 * DOM view of the intrusion minigame: green-on-black Uplink-style console with a proxy route, trace tracker,
 * password breaker columns and a decrypter grid. Calls onEnd(result) once: 1 granted, 0 traced, -1 aborted.
 */
export class HackUI {
  el: HTMLElement;
  private game: HackGame;
  private raf = 0;
  private last = performance.now();
  private ended = false;
  private routeEl = h('div', { class: 'hk-route' });
  private traceBar = h('i');
  private traceTxt = h('span', { class: 'hk-tt' });
  private stageEl = h('div', { class: 'hk-stage' });
  private status = h('div', { class: 'hk-status' });
  private gridKey = '';
  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.game.abort(); }
  };

  constructor(floor: number, kind: 'security' | 'lights', private onEnd: (r: 1 | 0 | -1) => void, private sound: (k: 'ok' | 'bad' | 'granted' | 'traced') => void) {
    this.game = new HackGame(floor, kind);
    const title = kind === 'security' ? 'SECURITY SUBSYSTEM · CCTV / PROXIMITY MINES / TRIPWIRES' : 'FACILITIES SUBSYSTEM · LIGHTING GRID';
    this.el = h('div', { class: 'hack' },
      h('div', { class: 'hk-head' }, h('b', {}, 'UPLINK'), h('span', {}, ` // ${title}`)),
      this.routeEl,
      h('div', { class: 'hk-trace' }, h('span', {}, 'TRACE'), h('div', { class: 'hk-bar' }, this.traceBar), this.traceTxt),
      this.stageEl,
      this.status,
      h('div', { class: 'hk-foot' }, h('span', {}, 'click a password  ·  click key bytes in order  ·  [ESC] disconnect'),
        h('button', { class: 'btn small', onclick: () => this.game.abort() }, 'Disconnect')));
    window.addEventListener('keydown', this.onKey, true);
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.game.tick(dt);
    this.render();
    if (this.game.done && !this.ended) {
      this.ended = true;
      const r = this.game.stage === 'granted' ? 1 : this.game.stage === 'traced' ? 0 : -1;
      if (r === 1) this.sound('granted'); else if (r === 0) this.sound('traced');
      setTimeout(() => this.close(r), r === -1 ? 0 : 1400);
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private render() {
    const g = this.game;
    const hops = g.route.length, lit = g.stage === 'bounce' ? Math.floor(g.bounce * hops) : hops;
    this.routeEl.replaceChildren(...g.route.flatMap((n, i) => [h('span', { class: `hk-node ${i < lit ? 'on' : ''} ${i === hops - 1 ? 'tgt' : ''}` }, n), i < hops - 1 ? h('span', { class: `hk-link ${i < lit - 1 ? 'on' : ''}` }, '──▶') : '']));
    this.traceBar.style.width = `${g.trace * 100}%`;
    this.traceBar.className = g.trace > 0.75 ? 'hot' : '';
    this.traceTxt.textContent = g.stage === 'bounce' ? 'routing…' : `${Math.round(g.trace * 100)}%  ·  ${Math.max(0, (1 - g.trace) * g.traceTime).toFixed(1)}s`;
    this.el.classList.toggle('wrong', g.flashWrong > 0);
    if (g.stage === 'bounce') {
      this.stageEl.replaceChildren(h('div', { class: 'hk-title' }, 'ESTABLISHING BOUNCED CONNECTION'));
      this.status.textContent = 'Routing through proxies. The trace clock starts when the link lands.';
    } else if (g.stage === 'password') {
      const key = 'pw' + g.tried.length;
      if (key !== this.gridKey) {
        this.gridKey = key;
        // memory dump: each leaked candidate sits inside a line of junk, like a raw hex/ASCII read
        const junk = '!@#$%^&*()_+-=[]{};:<>?/|~';
        const rows = g.words.map((w, i) => {
          const tried = g.tried.find((t) => t.word === w);
          const pad = (n: number, sd: number) => Array.from({ length: n }, (_, k) => junk[(sd * 7 + k * 13 + i * 5) % junk.length]).join('');
          const lead = 2 + ((i * 5) % 6);
          return h('div', { class: 'hk-row' },
            h('span', { class: 'hk-addr' }, '0x' + (0xf4a0 + i * 12).toString(16).toUpperCase()),
            h('span', { class: 'hk-junk' }, pad(lead, i)),
            h('button', { class: `hk-word ${tried ? 'dud' : ''}`, disabled: !!tried, onmousedown: () => this.sound(g.guess(w) ? 'ok' : 'bad') }, w),
            h('span', { class: 'hk-junk' }, pad(12 - lead, i + 3)));
        });
        const log = g.tried.map((t) => h('div', { class: 'hk-log-l' }, `> ${t.word}`, h('span', {}, ` DENIED · likeness ${t.like}/${g.password.length}`)));
        this.stageEl.replaceChildren(h('div', { class: 'hk-title' }, 'PASSWORD BREAKER · MEMORY DUMP'),
          h('div', { class: 'hk-pw' }, h('div', { class: 'hk-dump' }, ...rows), h('div', { class: 'hk-log' }, h('div', { class: 'hk-log-h' }, 'ATTEMPTS'), ...(log.length ? log : [h('div', { class: 'hk-log-l dim' }, 'no attempts yet')]))));
        this.status.textContent = g.tried.length
          ? 'Likeness = letters in the right position. Pick a word that shares exactly that many with every denied word.'
          : 'One of these leaked words is the password. Pick one: a wrong pick tells you how many letters are in the right place.';
      }
    } else if (g.stage === 'decrypt') {
      // rebuild the grid only when it changes, so clicks aren't eaten by a mid-click re-render
      const key = g.grid.join('') + g.seqI;
      if (key !== this.gridKey) {
        this.gridKey = key;
        const seq = g.target.map((b, i) => h('span', { class: `hk-b ${i < g.seqI ? 'ok' : i === g.seqI ? 'next' : ''}` }, b));
        const cells = g.grid.map((b, i) => h('button', { class: `hk-cell ${g.target.indexOf(b) >= 0 && g.target.indexOf(b) < g.seqI ? 'used' : ''}`, onmousedown: () => this.sound(g.pick(i) ? 'ok' : 'bad') }, b));
        this.stageEl.replaceChildren(h('div', { class: 'hk-title' }, 'DECRYPTER · ENCRYPTION KEY'), h('div', { class: 'hk-seq' }, ...seq), h('div', { class: 'hk-grid' }, ...cells));
        this.status.textContent = 'Click the key bytes in order. The matrix reshuffles.';
      }
    } else {
      const ok = g.stage === 'granted';
      this.stageEl.replaceChildren(h('div', { class: `hk-result ${ok ? 'ok' : 'bad'}` }, ok ? 'ACCESS GRANTED' : g.stage === 'traced' ? 'TRACE COMPLETE' : 'DISCONNECTED'));
      this.status.textContent = ok ? (g.kind === 'security' ? 'Cameras, mines and tripwires on this floor are going offline.' : 'Lighting grid repaired. Full brightness restored.') : 'Connection severed. Terminal locked and the alarm is up.';
    }
  }

  close(r: 1 | 0 | -1) {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    this.onEnd(r);
  }
}
