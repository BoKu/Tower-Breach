import { hackDifficulty } from '../sim/hack';

/**
 * Uplink-style intrusion minigame, pure logic (the DOM view is ui/hack.ts).
 * The connection first bounces through a chain of proxies (flavour; the trace clock starts when it lands), then the
 * hacker clears two puzzles drawn from the terminal's pool, like Among Us tasks:
 *  - security (CCTV): Password Breaker, Decrypter, Camera Sequence, Signal Jam
 *  - lights (facilities): Wire Patch, Breaker Switches, Circuit Route, Voltage Calibrate
 * Mistakes add trace. The trace hitting 100% fails the hack; DISCONNECT aborts with no penalty.
 */
export type HackKind = 'security' | 'lights';
export type PuzzleId = 'password' | 'decrypt' | 'cameras' | 'signal' | 'wires' | 'breakers' | 'circuit' | 'voltage';
export type HackStage = 'bounce' | PuzzleId | 'granted' | 'traced' | 'aborted';
export const POOLS: Record<HackKind, PuzzleId[]> = {
  security: ['password', 'decrypt', 'cameras', 'signal'],
  lights: ['wires', 'breakers', 'circuit', 'voltage'],
};
export const PUZZLE_IDS = [...POOLS.security, ...POOLS.lights];
export const WRONG_PENALTY = 0.07;
/** a wrong password pick costs more trace than a wrong decrypter byte */
export const GUESS_PENALTY = 0.1;
const WORDS: Record<number, string[]> = {
  5: ['GHOST', 'PROXY', 'ROUTE', 'TOKEN', 'VAULT', 'NEXUS', 'RELAY', 'SHARD', 'PULSE', 'OMEGA', 'DELTA', 'SIGMA', 'VIPER', 'RAVEN', 'LASER', 'NODES', 'PIXEL', 'CRYPT', 'ORBIT', 'STEEL', 'TOWER', 'AXIOM', 'CABLE', 'DRONE'],
  6: ['CIPHER', 'KERNEL', 'SERVER', 'ACCESS', 'BINARY', 'PACKET', 'SIGNAL', 'MATRIX', 'VECTOR', 'SYSTEM', 'DAEMON', 'SOCKET', 'BUFFER', 'MIRROR', 'SHADOW', 'CARBON', 'CORTEX', 'FALCON', 'TUNNEL', 'ORACLE', 'PHOTON', 'ROCKET'],
  7: ['NETWORK', 'CONSOLE', 'PROGRAM', 'ENCRYPT', 'COMMAND', 'SECTORS', 'MONITOR', 'CIRCUIT', 'NEURONS', 'ARCHIVE', 'COMPILE', 'CURRENT', 'PHANTOM', 'SPECTRE', 'QUANTUM', 'CONTROL', 'GATEWAY', 'ROUTERS', 'CAPTAIN', 'SILICON'],
};
/** letters in the same position */
export const likeness = (a: string, b: string) => [...a].reduce((n, c, i) => n + (b[i] === c ? 1 : 0), 0);
const GRID = 36;
type Rnd = () => number;
const pickInt = (rnd: Rnd, n: number) => Math.floor(rnd() * n);
function shuffle<T>(rnd: Rnd, a: T[]): T[] {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = pickInt(rnd, i + 1); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/** Puzzle moves return true (good), false (mistake: adds trace) or null (neutral, e.g. rotating a tile). */
type Move = boolean | null;

/** Among Us wiring: click a left wire end, then the matching colour on the right. */
export class WirePatch {
  static COLORS = ['red', 'blue', 'yellow', 'pink', 'cyan'];
  readonly left: string[];
  readonly right: string[];
  sel: number | null = null;
  done = new Set<string>();
  constructor(rnd: Rnd, k: number) {
    const cols = shuffle(rnd, WirePatch.COLORS).slice(0, 4 + Math.round(k));
    this.left = cols;
    this.right = shuffle(rnd, cols);
  }
  get solved() { return this.done.size === this.left.length; }
  pick(side: 'L' | 'R', i: number): Move {
    if (side === 'L') { if (!this.done.has(this.left[i])) this.sel = i; return null; }
    if (this.sel === null || this.done.has(this.right[i])) return null;
    const ok = this.right[i] === this.left[this.sel];
    if (ok) this.done.add(this.right[i]);
    this.sel = null;
    return ok;
  }
}

/** Row of breakers; flipping one also flips its neighbours (1-D Lights Out). Get them all ON. */
export class Breakers {
  on: boolean[];
  constructor(rnd: Rnd, k: number) {
    const n = 5 + Math.round(k * 2);
    this.on = Array(n).fill(true);
    // scramble by applying real flips from the solved state, so it is always solvable
    while (this.solved) for (let i = 0; i < n; i++) if (rnd() < 0.5) this.toggle(i);
  }
  get solved() { return this.on.every(Boolean); }
  private toggle(i: number) { for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < this.on.length) this.on[j] = !this.on[j]; }
  flip(i: number): Move { this.toggle(i); return null; }
}

/** Wire tiles as N/E/S/W bitmasks (1/2/4/8). Rotate tiles to carry power from the west edge to the bulb on the east. */
export class Circuit {
  static DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const; // N E S W
  readonly n: number;
  readonly srcRow: number;
  readonly bulbRow: number;
  tiles: number[];
  constructor(rnd: Rnd, k: number) {
    const n = (this.n = 4 + Math.round(k));
    this.srcRow = pickInt(rnd, n);
    this.bulbRow = pickInt(rnd, n);
    // randomised DFS from the source cell finds a path to the bulb cell
    const path: number[] = [];
    const seen = new Set<number>();
    const goal = this.bulbRow * n + n - 1;
    const dfs = (c: number): boolean => {
      seen.add(c); path.push(c);
      if (c === goal) return true;
      const x = c % n, y = Math.floor(c / n);
      for (const [dx, dy] of shuffle(rnd, [...Circuit.DIRS])) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < n && ny < n && !seen.has(ny * n + nx) && dfs(ny * n + nx)) return true;
      }
      path.pop();
      return false;
    };
    dfs(this.srcRow * n);
    const dirTo = (a: number, b: number) => Circuit.DIRS.findIndex(([dx, dy]) => (a % n) + dx === b % n && Math.floor(a / n) + dy === Math.floor(b / n));
    // decoys: random straights, corners and tees
    const decoys = [0b0101, 0b1010, 0b0011, 0b0110, 0b1100, 0b1001, 0b0111, 0b1011];
    this.tiles = Array.from({ length: n * n }, () => decoys[pickInt(rnd, decoys.length)]);
    path.forEach((c, i) => {
      const a = i === 0 ? 3 : dirTo(c, path[i - 1]); // the source feeds the first tile from the west
      const b = i === path.length - 1 ? 1 : dirTo(c, path[i + 1]); // the last tile feeds the bulb to the east
      this.tiles[c] = (1 << a) | (1 << b);
    });
    // scramble rotations until the circuit is broken
    do this.tiles = this.tiles.map((m) => { let r = m; for (let t = pickInt(rnd, 4); t > 0; t--) r = Circuit.rot(r); return r; });
    while (this.solved);
  }
  static rot(m: number) { return ((m << 1) | (m >> 3)) & 15; }
  /** cells reached by power from the source */
  get powered(): Set<number> {
    const n = this.n, out = new Set<number>(), start = this.srcRow * n;
    if (!(this.tiles[start] & 8)) return out;
    const stack = [start];
    out.add(start);
    while (stack.length) {
      const c = stack.pop()!, x = c % n, y = Math.floor(c / n);
      Circuit.DIRS.forEach(([dx, dy], d) => {
        const nx = x + dx, ny = y + dy, nc = ny * n + nx;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || out.has(nc)) return;
        if (this.tiles[c] & (1 << d) && this.tiles[nc] & (1 << ((d + 2) % 4))) { out.add(nc); stack.push(nc); }
      });
    }
    return out;
  }
  get solved() { const b = this.bulbRow * this.n + this.n - 1; return this.powered.has(b) && !!(this.tiles[b] & 2); }
  rotate(i: number): Move { this.tiles[i] = Circuit.rot(this.tiles[i]); return null; }
}

/** A needle sweeps the gauge; LOCK it inside the green band three times. */
export class Voltage {
  static LOCKS = 3;
  x = 0;
  private dir = 1;
  readonly speed: number;
  readonly width: number;
  center: number;
  hits = 0;
  constructor(private rnd: Rnd, k: number) {
    this.speed = 0.45 + k * 0.5;
    this.width = 0.16 - k * 0.07;
    this.center = this.newCenter();
  }
  private newCenter() { return 0.2 + this.rnd() * 0.6; }
  get solved() { return this.hits >= Voltage.LOCKS; }
  tick(dt: number) {
    this.x += this.dir * this.speed * dt;
    if (this.x > 1) { this.x = 2 - this.x; this.dir = -1; }
    if (this.x < 0) { this.x = -this.x; this.dir = 1; }
  }
  lock(): Move {
    if (Math.abs(this.x - this.center) > this.width / 2) return false;
    this.hits++;
    this.center = this.newCenter();
    return true;
  }
}

/** Simon: a 3x3 wall of camera feeds flashes a sequence; repeat it. Each round adds a step. */
export class Cameras {
  static STEP = 0.55;
  static ON = 0.4;
  static LEAD = 0.6;
  readonly seq: number[] = [];
  len = 3;
  idx = 0;
  /** playback clock; < 0 is the pause before playback, null once the player may answer */
  showT: number | null = -Cameras.LEAD;
  constructor(rnd: Rnd, k: number) {
    const max = 4 + Math.round(k);
    while (this.seq.length < max) { const c = pickInt(rnd, 9); if (c !== this.seq[this.seq.length - 1]) this.seq.push(c); }
  }
  get solved() { return this.len > this.seq.length; }
  /** camera lit by playback right now, or -1 */
  get lit() {
    if (this.showT === null || this.showT < 0) return -1;
    const i = Math.floor(this.showT / Cameras.STEP);
    return this.showT - i * Cameras.STEP < Cameras.ON ? this.seq[i] : -1;
  }
  tick(dt: number) {
    if (this.showT === null) return;
    this.showT += dt;
    if (this.showT >= this.len * Cameras.STEP) this.showT = null;
  }
  pick(c: number): Move {
    if (this.showT !== null || this.solved) return null;
    if (this.seq[this.idx] !== c) { this.idx = 0; this.showT = -Cameras.LEAD; return false; }
    if (++this.idx === this.len) { this.len++; this.idx = 0; if (!this.solved) this.showT = -Cameras.LEAD; }
    return true;
  }
}

/** Tune the live wave until it matches the camera feed's carrier, then LOOP FEED. */
export class Signal {
  static RANGE = { FREQ: [1, 6], AMP: [1, 5], PHASE: [0, 3] } as const;
  readonly params: (keyof typeof Signal.RANGE)[];
  val: Record<string, number> = {};
  readonly target: Record<string, number> = {};
  solved = false;
  constructor(rnd: Rnd, k: number) {
    this.params = k >= 0.5 ? ['FREQ', 'AMP', 'PHASE'] : ['FREQ', 'AMP'];
    const roll = (p: keyof typeof Signal.RANGE) => { const [a, b] = Signal.RANGE[p]; return a + pickInt(rnd, b - a + 1); };
    for (const p of this.params) this.target[p] = roll(p);
    do for (const p of this.params) this.val[p] = roll(p);
    while (this.matched);
  }
  get matched() { return this.params.every((p) => this.val[p] === this.target[p]); }
  tune(p: keyof typeof Signal.RANGE, d: number): Move {
    const [a, b] = Signal.RANGE[p];
    this.val[p] = Math.min(b, Math.max(a, this.val[p] + d));
    return null;
  }
  loop(): Move { if (!this.matched) return false; this.solved = true; return true; }
}

type Puzzles = { cameras: Cameras; signal: Signal; wires: WirePatch; breakers: Breakers; circuit: Circuit; voltage: Voltage };

export class HackGame {
  stage: HackStage = 'bounce';
  t = 0;
  trace = 0;
  readonly traceTime: number;
  readonly route: string[];
  /** the puzzles this hack runs, in order */
  readonly stages: PuzzleId[];
  stageI = 0;
  readonly p: Partial<Puzzles> = {};
  // password breaker
  readonly password: string;
  readonly words: string[];
  /** wrong picks so far, with their likeness */
  tried: { word: string; like: number }[] = [];
  // decrypter
  grid: string[] = [];
  readonly target: string[];
  seqI = 0;
  private shuffleT = 0;
  flashWrong = 0;
  private rnd: () => number;

  constructor(readonly floor: number, readonly kind: HackKind, seed = Math.random() * 1e9, force?: PuzzleId[]) {
    let s = Math.floor(seed) % 2147483647 || 1;
    this.rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    for (let i = 0; i < 4; i++) this.rnd(); // small seeds give tiny first draws
    const d = hackDifficulty(floor);
    this.traceTime = d.trace;
    this.stages = force?.length ? force : this.shuffled(POOLS[kind]).slice(0, 2);
    const pool = this.shuffled([...new Set(WORDS[d.wordLen])]);
    this.password = pool[0];
    // candidates that share letters with the password first, so every wrong pick tells you something
    const rest = pool.slice(1).sort((a, b) => likeness(b, this.password) - likeness(a, this.password));
    const close = rest.filter((w) => likeness(w, this.password) > 0);
    const others = rest.filter((w) => likeness(w, this.password) === 0);
    const decoys = [...close.slice(0, d.words - 2), ...others].slice(0, d.words - 1);
    this.words = this.shuffled([this.password, ...decoys]);
    const hex = () => Math.floor(this.rnd() * 256).toString(16).toUpperCase().padStart(2, '0');
    const tgt: string[] = [];
    while (tgt.length < d.seqLen) { const h = hex(); if (!tgt.includes(h)) tgt.push(h); }
    this.target = tgt;
    const fill: string[] = [...tgt];
    while (fill.length < GRID) { const h = hex(); if (!fill.includes(h)) fill.push(h); }
    this.grid = this.shuffled(fill);
    const nodes = ['InterNIC', 'Uplink PAS', 'Rostock Grid', 'Osaka Relay 7', 'NeoTokyo Exch.', 'Axiom Proxy 3', 'Lagos Mesh', 'Helsinki Node'];
    this.route = [...this.shuffled(nodes).slice(0, 3 + Math.round(floor / 90)), kind === 'security' ? `AXIOM SEC-NET F${floor}` : `AXIOM FACILITIES F${floor}`];
    const make = { cameras: Cameras, signal: Signal, wires: WirePatch, breakers: Breakers, circuit: Circuit, voltage: Voltage };
    for (const id of this.stages) if (id in make) (this.p as any)[id] = new make[id as keyof Puzzles](this.rnd, d.k);
  }

  private shuffled<T>(a: T[]): T[] { return shuffle(this.rnd, a); }

  get done() { return this.stage === 'granted' || this.stage === 'traced' || this.stage === 'aborted'; }
  /** 0..1: how many route hops have connected (bounce stage). */
  get bounce() { return Math.min(1, this.t / 2); }

  private next() { this.stage = this.stages[++this.stageI] ?? 'granted'; }

  tick(dt: number) {
    if (this.done) return;
    this.t += dt;
    this.flashWrong = Math.max(0, this.flashWrong - dt);
    if (this.stage === 'bounce') { if (this.t >= 2) this.stage = this.stages[0]; return; }
    this.trace += dt / this.traceTime;
    if (this.trace >= 1) { this.trace = 1; this.stage = 'traced'; return; }
    if (this.stage === 'decrypt') {
      this.shuffleT += dt;
      if (this.shuffleT > 4.5) { this.shuffleT = 0; this.grid = this.shuffled(this.grid); }
    }
    if (this.stage === 'voltage' || this.stage === 'cameras') this.p[this.stage]!.tick(dt);
  }

  private wrong(pen = WRONG_PENALTY) { this.trace = Math.min(1, this.trace + pen); this.flashWrong = 0.35; if (this.trace >= 1) this.stage = 'traced'; }

  /** Pick a candidate password. Right: on to the next puzzle. Wrong: likeness is reported and trace rises. */
  guess(word: string): boolean {
    if (this.stage !== 'password' || this.tried.some((t) => t.word === word)) return false;
    if (word === this.password) { this.next(); return true; }
    this.tried.push({ word, like: likeness(word, this.password) });
    this.wrong(GUESS_PENALTY);
    return false;
  }

  /** Click a decrypter cell. */
  pick(i: number): boolean {
    if (this.stage !== 'decrypt') return false;
    if (this.grid[i] === this.target[this.seqI]) {
      this.seqI++;
      if (this.seqI >= this.target.length) this.next();
      return true;
    }
    this.wrong();
    return false;
  }

  /** Make a move in one of the other puzzles. Returns false only for a mistake (which adds trace). */
  act<K extends keyof Puzzles>(id: K, move: (p: Puzzles[K]) => Move): boolean {
    const p = this.p[id];
    if (this.stage !== id || !p) return false;
    const r = move(p);
    if (r === false) this.wrong();
    else if (p.solved) this.next();
    return r !== false;
  }

  abort() { if (!this.done) this.stage = 'aborted'; }
}
