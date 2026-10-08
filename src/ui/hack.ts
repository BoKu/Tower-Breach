import { h } from './dom';
import { HackGame, Keypad, PUZZLE_IDS, Signal, type HackKind, type PuzzleId } from './hackgame';

const TITLES: Record<PuzzleId, string> = {
  password: 'PASSWORD BREAKER · MEMORY DUMP', decrypt: 'DECRYPTER · ENCRYPTION KEY', cameras: 'CAMERA SEQUENCE · FEED HANDSHAKE', signal: 'SIGNAL JAM · CARRIER LOOP', keypad: 'KEYPAD OVERRIDE · DOOR CONTROLLER',
  wires: 'WIRE PATCH · LIGHTING BUS', breakers: 'BREAKER SWITCHES · DISTRIBUTION BOARD', circuit: 'CIRCUIT ROUTE · POWER FEED', voltage: 'VOLTAGE CALIBRATE · BALLAST', load: 'LOAD BALANCE · SUBSTATION',
};
const HINTS: Record<PuzzleId, string> = {
  password: 'click a password', decrypt: 'click key bytes in order', cameras: 'watch, then repeat the feeds', signal: 'tune, then loop the feed', keypad: 'deduce the 4-digit code',
  wires: 'click a wire, then its colour', breakers: 'a breaker flips its neighbours too', circuit: 'click tiles to rotate', voltage: 'lock in the green band', load: 'switch circuits to hit the target',
};
const WIRE_HEX: Record<string, string> = { red: '#ff3b4e', blue: '#3a8bff', yellow: '#ffd84a', pink: '#ff6ad5', cyan: '#35d8ff', green: '#5cff3a', orange: '#ff8c1a' };
const WIRE_ROW = 38;

/** `?dev=1&hack=wires,signal` forces the puzzles for testing. */
function forcedPuzzles(): PuzzleId[] | undefined {
  const q = new URLSearchParams(location.search);
  if (!q.get('dev')) return undefined;
  return (q.get('hack') ?? '').split(',').filter((s): s is PuzzleId => (PUZZLE_IDS as string[]).includes(s));
}

/**
 * DOM view of the intrusion minigame: green-on-black Uplink-style console with a proxy route, trace tracker and the
 * current puzzle. Calls onEnd(result) once: 1 granted, 0 traced, -1 aborted.
 * Every puzzle is plain buttons acting on mousedown, so the gamepad's focus-and-press works on all of them.
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
  private hint = h('span');
  private gridKey = '';
  /** per-frame updates for animated puzzles (needle, waves), set when the puzzle view is built */
  private animate: ((t: number) => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.game.abort(); }
  };

  /** code: this floor's keypad code; noteFound: the squad found its sticky note, so the keypad shows it */
  constructor(floor: number, kind: HackKind, private onEnd: (r: 1 | 0 | -1) => void, private sound: (k: 'ok' | 'bad' | 'granted' | 'traced') => void, private code?: string, private noteFound = false) {
    this.game = new HackGame(floor, kind, undefined, forcedPuzzles(), code);
    const title = kind === 'security' ? 'SECURITY SUBSYSTEM · CCTV / PROXIMITY MINES / TRIPWIRES' : 'FACILITIES SUBSYSTEM · LIGHTING GRID';
    this.el = h('div', { class: 'hack' },
      h('div', { class: 'hk-head' }, h('b', {}, 'UPLINK'), h('span', {}, ` // ${title}`)),
      this.routeEl,
      h('div', { class: 'hk-trace' }, h('span', {}, 'TRACE'), h('div', { class: 'hk-bar' }, this.traceBar), this.traceTxt),
      this.stageEl,
      this.status,
      h('div', { class: 'hk-foot' }, this.hint,
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

  /** A puzzle button: acts on mousedown (the gamepad dispatches mousedown) and blips good/bad. */
  private btn(cls: string, act: () => boolean, ...kids: (Node | string)[]) {
    return h('button', { class: `hk-cell ${cls}`, onmousedown: () => this.sound(act() ? 'ok' : 'bad') }, ...kids);
  }

  private render() {
    const g = this.game;
    const hops = g.route.length, lit = g.stage === 'bounce' ? Math.floor(g.bounce * hops) : hops;
    this.routeEl.replaceChildren(...g.route.flatMap((n, i) => [h('span', { class: `hk-node ${i < lit ? 'on' : ''} ${i === hops - 1 ? 'tgt' : ''}` }, n), i < hops - 1 ? h('span', { class: `hk-link ${i < lit - 1 ? 'on' : ''}` }, '──▶') : '']));
    this.traceBar.style.width = `${g.trace * 100}%`;
    this.traceBar.className = g.trace > 0.75 ? 'hot' : '';
    this.traceTxt.textContent = g.stage === 'bounce' ? 'routing…' : `${Math.round(g.trace * 100)}%  ·  ${Math.max(0, (1 - g.trace) * g.traceTime).toFixed(1)}s`;
    this.el.classList.toggle('wrong', g.flashWrong > 0);
    this.hint.textContent = `${g.stage in HINTS ? HINTS[g.stage as PuzzleId] + '  ·  ' : ''}[ESC] disconnect`;
    if (g.stage === 'bounce') {
      this.stageEl.replaceChildren(h('div', { class: 'hk-title' }, 'ESTABLISHING BOUNCED CONNECTION'));
      this.status.textContent = 'Routing through proxies. The trace clock starts when the link lands.';
    } else if (g.done) {
      this.animate = null;
      const ok = g.stage === 'granted';
      this.stageEl.replaceChildren(h('div', { class: `hk-result ${ok ? 'ok' : 'bad'}` }, ok ? 'ACCESS GRANTED' : g.stage === 'traced' ? 'TRACE COMPLETE' : 'DISCONNECTED'));
      this.status.textContent = ok ? (g.kind === 'security' ? 'Cameras, mines and tripwires on this floor are going offline.' : 'Lighting grid repaired. Full brightness restored.') : 'Connection severed. Terminal locked and the alarm is up.';
    } else {
      // rebuild a puzzle only when its state changes, so clicks aren't eaten by a mid-click re-render
      const id = g.stage as PuzzleId;
      const key = id + g.stageI + ':' + this.key(id);
      if (key !== this.gridKey) {
        this.gridKey = key;
        this.animate = null;
        const [body, status] = this.build(id);
        this.stageEl.replaceChildren(h('div', { class: 'hk-title' }, `[${g.stageI + 1}/${g.stages.length}] ${TITLES[id]}`), ...body);
        this.status.textContent = status;
      }
      this.animate?.(g.t);
    }
  }

  /** Everything a puzzle's view depends on (except animation). */
  private key(id: PuzzleId): string {
    const g = this.game, p = g.p;
    switch (id) {
      case 'password': return 'pw' + g.tried.length;
      case 'decrypt': return g.grid.join('') + g.seqI;
      case 'wires': return `${p.wires!.sel}|${[...p.wires!.done]}`;
      case 'breakers': return p.breakers!.on.join();
      case 'circuit': return p.circuit!.tiles.join();
      case 'voltage': return `${p.voltage!.hits}|${p.voltage!.center}`;
      case 'cameras': { const c = p.cameras!; return `${c.lit}|${c.showT === null}|${c.idx}|${c.len}`; }
      case 'signal': return JSON.stringify(p.signal!.val);
      case 'keypad': { const k = p.keypad!; return `${k.entry}|${k.log.length}|${k.resets}`; }
      case 'load': return p.load!.on.join();
    }
  }

  private build(id: PuzzleId): [Node[], string] {
    const g = this.game;
    switch (id) {
      case 'password': {
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
        return [[h('div', { class: 'hk-pw' }, h('div', { class: 'hk-dump' }, ...rows), h('div', { class: 'hk-log' }, h('div', { class: 'hk-log-h' }, 'ATTEMPTS'), ...(log.length ? log : [h('div', { class: 'hk-log-l dim' }, 'no attempts yet')])))],
          g.tried.length
            ? 'Likeness = letters in the right position. Pick a word that shares exactly that many with every denied word.'
            : 'One of these leaked words is the password. Pick one: a wrong pick tells you how many letters are in the right place.'];
      }
      case 'decrypt': {
        const seq = g.target.map((b, i) => h('span', { class: `hk-b ${i < g.seqI ? 'ok' : i === g.seqI ? 'next' : ''}` }, b));
        const cells = g.grid.map((b, i) => h('button', { class: `hk-cell ${g.target.indexOf(b) >= 0 && g.target.indexOf(b) < g.seqI ? 'used' : ''}`, onmousedown: () => this.sound(g.pick(i) ? 'ok' : 'bad') }, b));
        return [[h('div', { class: 'hk-seq' }, ...seq), h('div', { class: 'hk-grid' }, ...cells)], 'Click the key bytes in order. The matrix reshuffles.'];
      }
      case 'wires': {
        const w = g.p.wires!, n = w.left.length, H = n * WIRE_ROW;
        const end = (side: 'L' | 'R', c: string, i: number) => this.btn(`hk-wire ${side} ${w.done.has(c) ? 'done' : ''} ${side === 'L' && w.sel === i ? 'sel' : ''}`,
          () => g.act('wires', (p) => p.pick(side, i)), h('i', { style: `background:${WIRE_HEX[c]}` }), c.toUpperCase());
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 200 ${H}`);
        svg.setAttribute('class', 'hk-wires-svg');
        const y = (i: number) => i * WIRE_ROW + WIRE_ROW / 2;
        svg.innerHTML = w.left.map((c, i) => w.done.has(c)
          ? `<line x1="0" y1="${y(i)}" x2="200" y2="${y(w.right.indexOf(c))}" stroke="${WIRE_HEX[c]}" stroke-width="6" stroke-linecap="round"/>`
          : w.sel === i ? `<line x1="0" y1="${y(i)}" x2="60" y2="${y(i)}" stroke="${WIRE_HEX[c]}" stroke-width="6" stroke-dasharray="6 5"/>` : '').join('');
        return [[h('div', { class: 'hk-wires' },
          h('div', { class: 'hk-wcol' }, ...w.left.map((c, i) => end('L', c, i))), svg,
          h('div', { class: 'hk-wcol' }, ...w.right.map((c, i) => end('R', c, i))))],
          w.sel === null ? 'Splice the lighting bus: pick a wire on the left.' : 'Now pick the same colour on the right. A wrong splice adds trace.'];
      }
      case 'breakers': {
        const b = g.p.breakers!;
        return [[h('div', { class: 'hk-brks' }, ...b.on.map((on, i) => this.btn(`hk-brk ${on ? 'on' : ''}`, () => g.act('breakers', (p) => p.flip(i)),
          h('em', {}, on ? 'ON' : 'OFF'), h('i'), h('small', {}, `CB${i + 1}`))))],
          `Get every breaker ON. Each switch also flips the ones beside it.  ${b.on.filter(Boolean).length}/${b.on.length} on`];
      }
      case 'circuit': {
        const c = g.p.circuit!, pw = c.powered, n = c.n;
        const cells: Node[] = [];
        for (let y = 0; y < n; y++) {
          cells.push(h('span', { class: `hk-end ${y === c.srcRow ? 'src' : ''}` }, y === c.srcRow ? '⏻' : ''));
          for (let x = 0; x < n; x++) {
            const i = y * n + x, m = c.tiles[i];
            cells.push(this.btn(`hk-tile ${pw.has(i) ? 'pw' : ''}`, () => g.act('circuit', (p) => p.rotate(i)),
              ...[0, 1, 2, 3].filter((d) => m & (1 << d)).map((d) => h('i', { class: `a${d}` })), h('b')));
          }
          cells.push(h('span', { class: `hk-end ${y === c.bulbRow ? 'bulb' : ''}` }, y === c.bulbRow ? '✺' : ''));
        }
        return [[h('div', { class: 'hk-circ', style: `grid-template-columns: 26px repeat(${n}, 44px) 26px` }, ...cells)],
          'Rotate tiles to carry power from the source to the bulb. Lit tiles are live.'];
      }
      case 'voltage': {
        const v = g.p.voltage!;
        const needle = h('i', { class: 'hk-needle' });
        this.animate = () => { needle.style.left = `${v.x * 100}%`; };
        return [[
          h('div', { class: 'hk-gauge' }, h('span', { class: 'hk-band', style: `left:${(v.center - v.width / 2) * 100}%;width:${v.width * 100}%` }), needle),
          h('div', { class: 'hk-pips' }, ...Array.from({ length: v.locks }, (_, i) => h('span', { class: i < v.hits ? 'ok' : '' }))),
          this.btn('hk-act', () => g.act('voltage', (p) => p.lock()), 'LOCK')],
          `Lock the needle inside the green band ${v.locks} times. A miss adds trace.`];
      }
      case 'cameras': {
        const c = g.p.cameras!, watching = c.showT !== null;
        const feeds = Array.from({ length: 9 }, (_, i) => this.btn(`hk-cam ${c.lit === i ? 'lit' : ''}`, () => g.act('cameras', (p) => p.pick(i)),
          h('small', {}, `CAM ${String(i + 1).padStart(2, '0')}`), h('i')));
        return [[h('div', { class: `hk-cams ${watching ? 'watch' : ''}` }, ...feeds),
          h('div', { class: 'hk-pips' }, ...Array.from({ length: c.seq.length - 3 }, (_, i) => h('span', { class: i < c.len - 4 ? 'ok' : '' })))],
          watching ? `WATCH: the handshake flashes ${c.len} feeds.` : `REPEAT the ${c.len} feeds in order  ·  ${c.idx}/${c.len}. A wrong feed adds trace and replays.`];
      }
      case 'signal': {
        const s = g.p.signal!;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 360 90');
        svg.setAttribute('class', 'hk-scope');
        svg.innerHTML = '<path class="tgt"/><path class="live"/>';
        const [tgt, live] = [...svg.querySelectorAll('path')];
        const wave = (v: Record<string, number>, t: number) => {
          let d = '';
          for (let x = 0; x <= 360; x += 4) d += `${x ? 'L' : 'M'}${x},${(45 - v.AMP * 6.5 * Math.sin((v.FREQ * x * 2 * Math.PI) / 360 + ((v.PHASE ?? 0) * Math.PI) / 4 + t * 3)).toFixed(1)}`;
          return d;
        };
        this.animate = (t) => { tgt.setAttribute('d', wave(s.target, t)); live.setAttribute('d', wave(s.val, t)); };
        const rows = s.params.map((p) => h('div', { class: 'hk-knob' }, h('span', {}, p),
          this.btn('hk-act sm', () => g.act('signal', (x) => x.tune(p, -1)), '−'),
          h('b', {}, String(s.val[p])),
          this.btn('hk-act sm', () => g.act('signal', (x) => x.tune(p, 1)), '+'),
          h('small', {}, `${Signal.RANGE[p][0]}–${Signal.RANGE[p][1]}`)));
        return [[svg, h('div', { class: 'hk-knobs' }, ...rows), this.btn('hk-act', () => g.act('signal', (x) => x.loop()), 'LOOP FEED')],
          'Tune the live wave (bright) onto the camera carrier (dim), then loop the feed. A bad loop adds trace.'];
      }
      case 'keypad': {
        const k = g.p.keypad!;
        const slots = Array.from({ length: 4 }, (_, i) => h('span', { class: `hk-b ${i === k.entry.length ? 'next' : k.entry[i] ? 'ok' : ''}` }, k.entry[i] ?? '_'));
        const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => this.btn('hk-key', () => g.act('keypad', (p) => p.press(d)), String(d)));
        keys.push(this.btn('hk-key', () => g.act('keypad', (p) => p.del()), 'DEL'), this.btn('hk-key', () => g.act('keypad', (p) => p.press(0)), '0'),
          this.btn('hk-key', () => g.act('keypad', (p) => p.enter()), 'ENTER'));
        const log = k.log.map((l) => h('div', { class: 'hk-log-l' }, '> ', ...[...l.g].map((d, i) => h('b', { class: `kd ${l.marks[i]}` }, d)), h('span', {}, `  ${l.hit} PLACED · ${l.near} MISPLACED`)));
        return [[h('div', { class: 'hk-kp' },
          h('div', { class: 'hk-kpad' }, this.noteFound && !k.resets ? h('div', { class: 'hk-note' }, 'STICKY NOTE  ', h('b', {}, this.code ?? '')) : null, h('div', { class: 'hk-seq' }, ...slots), h('div', { class: 'hk-keys' }, ...keys)),
          h('div', { class: 'hk-log' }, h('div', { class: 'hk-log-h' }, `ATTEMPTS ${k.log.length}/${Keypad.MAX}`), ...(log.length ? log : [h('div', { class: 'hk-log-l dim' }, 'no attempts yet')])))],
          this.noteFound && !k.resets ? `STICKY NOTE: the code is ${this.code}. Enter it.`
          : k.resets && !k.log.length ? `LOCKOUT: the controller rolled a new code${this.noteFound ? ' (the note is useless now)' : ''}. Start again.`
            : `Enter a 4-digit code${k.repeats ? ' (digits may repeat)' : ' (no repeated digits)'}. Green = right digit, right place; amber = in the code, wrong place; dim = not in the code. Each wrong code adds trace.`];
      }
      case 'load': {
        const l = g.p.load!, max = l.watts.reduce((a, b) => a + b, 0), tot = l.total;
        return [[h('div', { class: 'hk-meter' }, h('i', { class: tot > l.target ? 'over' : '', style: `width:${(tot / max) * 100}%` }), h('b', { style: `left:${(l.target / max) * 100}%` })),
          h('div', { class: 'hk-title' }, `LOAD ${tot} W  /  TARGET ${l.target} W`),
          h('div', { class: 'hk-brks' }, ...l.watts.map((w, i) => this.btn(`hk-load ${l.on[i] ? 'on' : ''}`, () => g.act('load', (p) => p.toggle(i)),
            h('em', {}, l.on[i] ? 'ON' : 'OFF'), h('b', {}, `${w}W`), h('small', {}, `L${i + 1}`)))),
          this.btn('hk-act', () => g.act('load', (p) => p.commit()), 'COMMIT LOAD')],
          'Switch circuits until the load matches the target exactly, then commit. A wrong commit adds trace.'];
      }
    }
  }

  close(r: 1 | 0 | -1) {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    this.el.remove();
    this.onEnd(r);
  }
}
