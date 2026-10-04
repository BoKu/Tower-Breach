import { hackDifficulty } from '../sim/hack';

/**
 * Uplink-style intrusion minigame, pure logic (the DOM view is ui/hack.ts).
 *  1. Bounce: the connection routes through a chain of proxies (flavour; the trace clock starts when it lands).
 *  2. Password Breaker: a memory dump leaks candidate passwords. Pick one: a wrong pick reports its likeness
 *     (letters in the correct position) so you can deduce the real one. Wrong picks add trace.
 *  3. Decrypter: click the target byte sequence in order in a shuffling hex grid.
 * Mistakes add trace. The trace hitting 100% fails the hack; DISCONNECT aborts with no penalty.
 */
export type HackStage = 'bounce' | 'password' | 'decrypt' | 'granted' | 'traced' | 'aborted';
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

export class HackGame {
  stage: HackStage = 'bounce';
  t = 0;
  trace = 0;
  readonly traceTime: number;
  readonly route: string[];
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

  constructor(readonly floor: number, readonly kind: 'security' | 'lights', seed = Math.random() * 1e9) {
    let s = Math.floor(seed) % 2147483647 || 1;
    this.rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    const d = hackDifficulty(floor);
    this.traceTime = d.trace;
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
  }

  private shuffled<T>(a: T[]): T[] {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  }

  get done() { return this.stage === 'granted' || this.stage === 'traced' || this.stage === 'aborted'; }
  /** 0..1: how many route hops have connected (bounce stage). */
  get bounce() { return Math.min(1, this.t / 2); }

  tick(dt: number) {
    if (this.done) return;
    this.t += dt;
    this.flashWrong = Math.max(0, this.flashWrong - dt);
    if (this.stage === 'bounce') { if (this.t >= 2) this.stage = 'password'; return; }
    this.trace += dt / this.traceTime;
    if (this.trace >= 1) { this.trace = 1; this.stage = 'traced'; return; }
    if (this.stage === 'decrypt') {
      this.shuffleT += dt;
      if (this.shuffleT > 4.5) { this.shuffleT = 0; this.grid = this.shuffled(this.grid); }
    }
  }

  private wrong(pen = WRONG_PENALTY) { this.trace = Math.min(1, this.trace + pen); this.flashWrong = 0.35; if (this.trace >= 1) this.stage = 'traced'; }

  /** Pick a candidate password. Right: on to the decrypter. Wrong: likeness is reported and trace rises. */
  guess(word: string): boolean {
    if (this.stage !== 'password' || this.tried.some((t) => t.word === word)) return false;
    if (word === this.password) { this.stage = 'decrypt'; return true; }
    this.tried.push({ word, like: likeness(word, this.password) });
    this.wrong(GUESS_PENALTY);
    return false;
  }

  /** Click a decrypter cell. */
  pick(i: number): boolean {
    if (this.stage !== 'decrypt') return false;
    if (this.grid[i] === this.target[this.seqI]) {
      this.seqI++;
      if (this.seqI >= this.target.length) this.stage = 'granted';
      return true;
    }
    this.wrong();
    return false;
  }

  abort() { if (!this.done) this.stage = 'aborted'; }
}
