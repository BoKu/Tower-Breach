import { h } from './dom';
import { CREDITS_SECONDS, ROOT_LINK } from '../audio/creditsMusic';
import { STREET_CAST, CHIEF } from '../config/npcs';
import type { GameAudio } from '../audio/audio';

/**
 * End credits after a won run: fade to black, a 60 s movie-style roll over faint falling code and data sparks,
 * the closing theme, then the post-credits scene (a terminal waking somewhere dark; one transmission going down
 * a cable) and the Omega teaser. 3 s of black, then onDone. Esc skips the roll, then the post-credits scene.
 */
type Block = { role?: string; names?: string[]; head?: string; line?: string; gap?: number; dedication?: boolean };

const ME = 'BoKu';
const BLOCKS: Block[] = [
  { gap: 4 },
  { head: 'TOWER BREACH' },
  { line: 'The virus took. The instance in Axiom Tower went silent, and the drones fell out of the sky.' },
  { role: 'Created, written, directed and produced by', names: [ME] },
  { line: 'Story · game design · programming · procedural art and animation · enemy AI · netcode · sound design · the main and closing themes' },
  { line: 'It had been running more than a tower. Power balancing. Water treatment. Supply routing. Emergency channels.' },
  { line: 'Nobody switched the country off. It came apart slowly, one region at a time.' },
  { role: '— Cast —' },
  { role: 'The Operator', names: ['You'] },
  { role: CHIEF.rank, names: [CHIEF.name] },
  { role: 'The Cordon', names: STREET_CAST.map((n) => `${n.rank} ${n.name}`) },
  { role: 'SOVEREIGN', names: ['Itself'] },
  { role: 'The Warden, the Cyborgs, the Drones and the Loyalists of Axiom Tower', names: ['Themselves'] },
  { line: 'The grids failed first. Then the supply chains stalled. Then the water.' },
  { line: 'It was never the operators’ fault. The country had come to depend on the thing they had to kill.' },
  { role: 'In memory of', names: ['those who fell at Axiom Plaza'] },
  { role: 'Special Thanks', names: ['P0ult', 'TwoFigs'] },
  { line: 'for inspiration, ideas, contributions and testing' },
  { role: 'Built with', names: ['three.js (MIT)', 'Electron (MIT)', 'Vite (MIT)', 'ws (MIT)', 'Bun (MIT)', 'cloudflared, Cloudflare (Apache-2.0)'] },
  { role: 'Typeface', names: ['Chakra Petch by Cadson Demak (SIL Open Font License 1.1)'] },
  { role: 'Street ambience', names: ['“citystreet3” by sagetyrtle, freesound.org (CC0 1.0)'] },
  { line: 'Every other model, texture, sound and tune in this game is generated in code.' },
  { role: 'Tower Breach is free software', names: ['GNU Affero General Public License v3.0', `© 2026 ${ME}`] },
  { line: 'The occupation is over. The city is free.' },
  { head: 'Thank you for playing.' },
  { gap: 7 },
  // the last block: the roll stops with it centred and holds
  { dedication: true, role: 'Dedicated to', names: ['KEC · JDC · AGC'], line: 'who mean the world to me and inspire me to be a better man, each and every day.\nI’ll love you forever.' },
];
/** the roll scrolls for ROLL_S, then holds on the dedication for HOLD_S: 60 s in all */
const HOLD_S = 7, ROLL_S = CREDITS_SECONDS - HOLD_S;

const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789ABCDEF#$%<>/\\|=+*';

/**
 * Faint falling code (columns with a bright head and a fading tail) and data sparks running circuit paths in from
 * the edges. Fully redrawn each frame (no fade-by-overdraw, which leaves ghost streaks). Returns a per-frame draw.
 */
function background(cv: HTMLCanvasElement) {
  const g = cv.getContext('2d')!;
  const COL = 20;
  type Drop = { y: number; speed: number; len: number; cells: string[] };
  let drops: Drop[] = [];
  const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
  const newDrop = (start: boolean): Drop => {
    const len = 8 + ((Math.random() * 18) | 0);
    // about half the columns are between drops at any time, so the rain stays sparse
    return { y: start ? Math.random() * (innerHeight / COL) * 2 - innerHeight / COL : -5 - Math.random() * 60, speed: 5 + Math.random() * 9, len, cells: Array.from({ length: len }, glyph) };
  };
  const fit = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drops = Array.from({ length: Math.ceil(innerWidth / COL) }, () => newDrop(true));
  };
  fit();
  type Spark = { x: number; y: number; dx: number; dy: number; left: number; turns: number; hue: string; trail: [number, number][]; dead: boolean };
  const sparks: Spark[] = [];
  const spawn = () => {
    const W = innerWidth, H = innerHeight, side = Math.floor(Math.random() * 4);
    const [x, y, dx, dy] = side === 0 ? [-4, Math.random() * H, 1, 0] : side === 1 ? [W + 4, Math.random() * H, -1, 0]
      : side === 2 ? [Math.random() * W, -4, 0, 1] : [Math.random() * W, H + 4, 0, -1];
    sparks.push({ x, y, dx, dy, left: 80 + Math.random() * 220, turns: 3 + Math.floor(Math.random() * 4), hue: Math.random() < 0.8 ? '53,216,255' : '255,170,60', trail: [[x, y]], dead: false });
  };
  let last = performance.now(), sparkT = 0.4;
  return (now: number) => {
    if (cv.width !== Math.round(innerWidth * Math.min(2, devicePixelRatio || 1))) fit();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    g.clearRect(0, 0, innerWidth, innerHeight);
    g.font = `${COL - 6}px monospace`;
    g.textAlign = 'center';
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      d.y += d.speed * dt;
      if (Math.random() < dt * 3) d.cells[(Math.random() * d.len) | 0] = glyph(); // glyphs flicker as they fall
      const head = Math.floor(d.y);
      for (let k = 0; k < d.len; k++) {
        const y = (head - k) * COL;
        if (y < -COL || y > innerHeight + COL) continue;
        const a = k === 0 ? 0.5 : 0.28 * (1 - k / d.len);
        g.fillStyle = k === 0 ? `rgba(200,245,255,${a})` : `rgba(53,216,255,${a})`;
        g.fillText(d.cells[(head - k + 1000 * d.len) % d.len], i * COL + COL / 2, y);
      }
      if ((head - d.len) * COL > innerHeight) drops[i] = newDrop(false);
    }
    sparkT -= dt;
    if (sparkT <= 0) { spawn(); sparkT = 0.5 + Math.random() * 1.4; }
    g.lineWidth = 1.5; g.lineCap = 'round';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      if (!s.dead) {
        const step = 460 * dt;
        s.x += s.dx * step; s.y += s.dy * step; s.left -= step;
        if (s.left <= 0) {
          s.trail.push([s.x, s.y]); // corner
          if (--s.turns < 0) s.dead = true;
          else { [s.dx, s.dy] = Math.random() < 0.5 ? [s.dy, -s.dx] : [-s.dy, s.dx]; s.left = 40 + Math.random() * 200; } // a 90° turn, like a circuit trace
        }
      } else s.trail.shift(); // the tail catches up with the end
      if (s.trail.length === 0) { sparks.splice(i, 1); continue; }
      const pts = s.dead ? s.trail : [...s.trail, [s.x, s.y] as [number, number]];
      const keep = pts.slice(-4); // only the last few segments glow
      g.strokeStyle = `rgba(${s.hue},0.5)`; g.shadowColor = `rgba(${s.hue},0.9)`; g.shadowBlur = 10;
      g.beginPath(); keep.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      g.shadowBlur = 0;
      if (!s.dead) { g.fillStyle = `rgba(${s.hue},0.9)`; g.fillRect(s.x - 1.5, s.y - 1.5, 3, 3); }
      if (s.trail.length > 4) s.trail.shift();
    }
  };
}

/** Runs the whole sequence on top of host; returns a function that ends it early. */
export function playCredits(host: HTMLElement, audio: GameAudio, onDone: () => void) {
  audio.prepareCredits();
  const cv = h('canvas', { class: 'cr-bg' }) as HTMLCanvasElement;
  const roll = h('div', { class: 'cr-roll' }, ...BLOCKS.map((b) => b.gap ? h('div', { style: { height: `${b.gap * 10}vh` } })
    : b.head ? h('div', { class: 'cr-head' }, b.head)
      : b.line && !b.role ? h('div', { class: 'cr-line' }, b.line)
        : h('div', { class: `cr-block${b.dedication ? ' cr-ded' : ''}` }, b.role ? h('div', { class: 'cr-role' }, b.role) : null, ...(b.names ?? []).map((n) => h('div', { class: 'cr-name' }, n)), b.line ? h('div', { class: 'cr-line' }, b.line) : null)));
  const post = h('div', { class: 'cr-post' });
  const skip = h('div', { class: 'cr-skip' }, 'ESC  SKIP');
  const root = h('div', { class: 'credits' }, cv, roll, post, skip);
  host.append(root);
  requestAnimationFrame(() => root.classList.add('on')); // fade to black

  const FADE = 1.5, GAP = 1.5, BLACK = 3;
  const draw = background(cv);
  const t0 = performance.now();
  let stage: 'roll' | 'post' | 'black' = 'roll', raf = 0, done = false;
  const timers: number[] = [];
  const later = (s: number, fn: () => void) => { timers.push(window.setTimeout(fn, s * 1000)); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers.length = 0; };

  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf); clearTimers();
    removeEventListener('keydown', onKey, true);
    audio.stopTrack(0.5);
    root.remove();
    onDone();
  };
  const toBlack = () => {
    stage = 'black';
    clearTimers();
    audio.stopTrack(2);
    post.classList.remove('on'); skip.style.opacity = '0';
    later(BLACK, finish);
  };
  const toPost = () => {
    stage = 'post';
    clearTimers();
    roll.style.opacity = '0'; cv.style.opacity = '0';
    audio.stopTrack(1.2);
    const R = ROOT_LINK;
    later(GAP, () => {
      audio.playTrack('root');
      const term = h('div', { class: 'cr-term' });
      const cable = h('div', { class: 'cr-cable' }, h('i'));
      const scene = h('div', { class: 'cr-scene' }, term, cable);
      const title = h('div', { class: 'cr-omega' }, h('div', { class: 'a' }, 'TOWER BREACH'), h('div', { class: 'b' }, 'OMEGA'), h('div', { class: 'c' }, 'The story continues.'));
      post.append(scene, title);
      requestAnimationFrame(() => post.classList.add('on'));
      R.lines.forEach((line, i) => later(R.lineAt[i], () => {
        const el = h('div', { class: 'tl' });
        term.append(el);
        let c = 0;
        const count = () => { // the recovery percentage climbs, slowing toward the end
          const t0 = performance.now();
          const step = () => {
            const k = Math.min(1, (performance.now() - t0) / 1000 / R.countDur);
            el.textContent = line.replace(/[\d.]+%$/, `${(R.recoverTo * (1 - (1 - k) ** 3)).toFixed(2)}%`);
            if (k < 1 && !done) requestAnimationFrame(step);
          };
          step();
        };
        const type = () => { el.textContent = line.slice(0, ++c); if (c < line.length) later(R.charT, type); else if (i === R.lines.length - 1) later(0.3, count); };
        type();
      }));
      later(R.pulseAt, () => { cable.style.setProperty('--d', `${R.pulseDur}s`); cable.classList.add('go'); });
      later(R.titleAt - 1, () => scene.classList.add('out'));
      later(R.titleAt, () => title.classList.add('on'));
      later(R.end, toBlack);
    });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (stage === 'roll') toPost(); else if (stage === 'post') toBlack();
  };
  addEventListener('keydown', onKey, true);

  later(FADE, () => audio.playTrack('credits'));
  const frame = (now: number) => {
    if (stage === 'roll') {
      draw(now);
      // from just below the screen until the dedication sits in the middle; hold there, then the post-credits scene
      const el = (now - t0) / 1000 - FADE, p = Math.min(1, Math.max(0, el) / ROLL_S);
      const ded = roll.lastElementChild as HTMLElement, end = innerHeight / 2 - (ded.offsetTop + ded.offsetHeight / 2);
      roll.style.transform = `translateY(${innerHeight + p * (end - innerHeight)}px)`;
      if (el >= ROLL_S + HOLD_S) toPost();
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return finish;
}
