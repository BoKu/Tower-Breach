import type { Synth } from './synth';
import { currentHoliday } from '../config/holiday';

type Pos = { x: number; y: number };
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const VOWELS: [number, number, number][] = [[800, 1150, 2900], [400, 1700, 2600], [450, 800, 2830], [325, 700, 2530], [300, 2200, 3000]];

// ---- elevator muzak: 8-bar bossa loop in C (ii-V-I), slightly out of tune on purpose
const BEAT = 60 / 104;
const CHORDS: { root: number; v: number[] }[] = [
  { root: 38, v: [62, 65, 69, 72] }, { root: 43, v: [62, 65, 67, 71] }, { root: 36, v: [60, 64, 67, 71] }, { root: 45, v: [61, 64, 67, 69] },
  { root: 38, v: [62, 65, 69, 72] }, { root: 43, v: [62, 65, 67, 71] }, { root: 36, v: [60, 64, 67, 71] }, { root: 36, v: [60, 64, 67, 71] },
];
/** [beat, midi, beats] per bar */
const MELODY: [number, number, number][][] = [
  [[0, 74, 1], [1, 72, 0.5], [1.5, 69, 0.5], [2, 72, 1.5]],
  [[0, 71, 0.5], [0.5, 72, 0.5], [1, 74, 1], [2, 71, 2]],
  [[0, 76, 1.5], [1.5, 74, 0.5], [2, 72, 1], [3, 71, 1]],
  [[0, 73, 1], [1, 76, 1], [2, 79, 2]],
  [[0, 77, 1], [1, 76, 0.5], [1.5, 74, 0.5], [2, 72, 2]],
  [[0, 71, 1], [1, 74, 1], [2, 79, 1], [3, 77, 1]],
  [[0, 76, 3], [3, 74, 0.5], [3.5, 76, 0.5]],
  [[0, 72, 1], [1, 69, 1], [2, 67, 1.5], [3.5, 79, 0.5]],
];

// ---- Halloween elevator tune: an original creepy-kooky harpsichord ditty in D minor with finger snaps on 2 and 4
const SPOOK_BEAT = 60 / 112;
const SPOOK_CHORDS: { root: number; v: number[] }[] = [
  { root: 38, v: [62, 65, 69] }, { root: 38, v: [62, 65, 69] }, { root: 43, v: [62, 67, 70] }, { root: 45, v: [61, 64, 67, 69] },
  { root: 38, v: [62, 65, 69] }, { root: 46, v: [62, 65, 70] }, { root: 45, v: [61, 64, 67, 69] }, { root: 38, v: [62, 65, 69] },
];
const SPOOK_MELODY: [number, number, number][][] = [
  [[0, 74, 0.5], [0.5, 73, 0.5], [1, 72, 0.5], [1.5, 71, 0.5], [2, 70, 1], [3, 69, 1]],
  [[0, 62, 0.5], [0.5, 65, 0.5], [1, 69, 1], [2, 74, 0.5], [2.5, 72, 0.5], [3, 69, 1]],
  [[0, 70, 1], [1, 67, 0.5], [1.5, 70, 0.5], [2, 74, 1.5], [3.5, 72, 0.5]],
  [[0, 73, 1], [1, 69, 0.5], [1.5, 73, 0.5], [2, 76, 1], [3, 79, 1]],
  [[0, 77, 0.5], [0.5, 76, 0.5], [1, 75, 0.5], [1.5, 74, 0.5], [2, 77, 1], [3, 74, 1]],
  [[0, 74, 0.5], [0.5, 77, 0.5], [1, 74, 0.5], [1.5, 70, 0.5], [2, 65, 2]],
  [[0, 69, 0.5], [0.5, 70, 0.5], [1, 69, 0.5], [1.5, 68, 0.5], [2, 69, 1], [3, 61, 1]],
  [[0, 62, 1.5], [2, 57, 0.5], [2.5, 62, 1.5]],
];

// ---- Christmas elevator tune: "Jingle Bells" (J. L. Pierpont, 1857, public domain), chorus in C, 16 bars
const XMAS_BEAT = 60 / 140;
const C_ = [60, 64, 67], F_ = [60, 65, 69], D7 = [60, 62, 66, 69], G7 = [59, 62, 65, 67];
const XMAS_CHORDS: { root: number; v: number[] }[] = [
  ...[48, 48, 48, 48].map((root) => ({ root, v: C_ })), { root: 53, v: F_ }, { root: 48, v: C_ }, { root: 50, v: D7 }, { root: 43, v: G7 },
  ...[48, 48, 48, 48].map((root) => ({ root, v: C_ })), { root: 53, v: F_ }, { root: 48, v: C_ }, { root: 43, v: G7 }, { root: 48, v: C_ },
];
const JB_A: [number, number, number][][] = [
  [[0, 64, 1], [1, 64, 1], [2, 64, 2]],
  [[0, 64, 1], [1, 64, 1], [2, 64, 2]],
  [[0, 64, 1], [1, 67, 1], [2, 60, 1.5], [3.5, 62, 0.5]],
  [[0, 64, 4]],
  [[0, 65, 1], [1, 65, 1], [2, 65, 1.5], [3.5, 65, 0.5]],
  [[0, 65, 1], [1, 64, 1], [2, 64, 1], [3, 64, 0.5], [3.5, 64, 0.5]],
];
const XMAS_MELODY: [number, number, number][][] = [
  ...JB_A, [[0, 64, 1], [1, 62, 1], [2, 62, 1], [3, 64, 1]], [[0, 62, 2], [2, 67, 2]],
  ...JB_A, [[0, 67, 1], [1, 67, 1], [2, 65, 1], [3, 62, 1]], [[0, 60, 4]],
];

/**
 * Procedural soundscapes, all synthesised, driven by random event timers so nothing audibly loops:
 * - street: traffic swells, crowd murmur, car pass-bys, horns, aeroplanes, trains, sirens, radios, birds
 * - tower: creaks, doors, whispers, drips, sparks, distant footsteps and impacts, and stretches of eerie silence
 * - elevator: tinny bossa-nova muzak on the music bus
 */
export class Soundscape {
  /** zone bus: beds and events go through it so silence and the elevator can duck them */
  zone: GainNode | null = null;
  private zoneKind: 'street' | 'tower' | 'none' = 'none';
  /** a real street recording is playing: skip the synth murmur and car pass-bys it already contains */
  realStreet = false;
  /** Halloween street: night-time wind and spooky events instead of the city */
  spooky = false;
  private eventT = 3;
  private murmurT = 0;
  private silenceT = 0;
  private planeCd = 20;
  private trainCd = 35;
  private zoneTarget = 1;
  private muzak: GainNode | null = null;
  private muzakNext = 0;
  private muzakBar = 0;
  private muzakOn = false;
  private muzakOffAt = 0;
  private long = new Map<string, AudioBuffer>();

  constructor(private s: Synth) {}

  /** Long noise buffer (tens of seconds) for beds, so the noise loop itself is not audible. */
  longNoise(kind: 'brown' | 'pink'): AudioBuffer {
    let b = this.long.get(kind);
    if (b) return b;
    const ctx = this.s.ctx, n = Math.floor(ctx.sampleRate * (kind === 'brown' ? 23 : 19));
    b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    this.long.set(kind, b);
    return b;
  }

  /** Session over: drop the zone (the caller tears its nodes down) and cut the muzak. */
  stop() {
    this.zone = null; this.zoneKind = 'none'; this.silenceT = 0; this.zoneTarget = 1;
    if (this.muzak) { this.muzak.gain.cancelScheduledValues(this.s.now); this.muzak.gain.setTargetAtTime(0, this.s.now, 0.1); }
    this.muzakOn = false; this.muzakOffAt = 0;
  }

  /** New zone bus for a floor; the caller connects beds to it and tracks it for teardown. */
  begin(kind: 'street' | 'tower' | 'none'): GainNode {
    const s = this.s;
    this.zoneKind = kind;
    this.zone = s.gain(this.zoneTarget);
    this.zone.connect(s.amb);
    this.silenceT = 0;
    this.eventT = rnd(2, 5);
    return this.zone;
  }

  /** Slow LFO on an AudioParam: base ± depth at rate Hz. Returns the nodes to stop later. */
  lfo(param: AudioParam, rate: number, depth: number): AudioNode[] {
    const o = this.s.ctx.createOscillator(); o.frequency.value = rate;
    const g = this.s.gain(depth);
    o.connect(g).connect(param); o.start();
    return [o, g];
  }

  update(dt: number, me: Pos, inElevator: boolean) {
    const s = this.s;
    // ducking: the elevator car muffles the floor, eerie silence nearly mutes it
    const target = inElevator ? 0.25 : this.silenceT > 0 ? 0.08 : 1;
    if (target !== this.zoneTarget && this.zone) this.zone.gain.setTargetAtTime(target, s.now, target < this.zoneTarget ? 0.6 : 1.4);
    this.zoneTarget = target;
    this.updateMuzak(inElevator);
    if (!this.zone || this.zoneKind === 'none') return;
    this.planeCd -= dt; this.trainCd -= dt;
    if (this.silenceT > 0) { this.silenceT -= dt; return; }
    if (this.zoneKind === 'street' && !this.realStreet && !this.spooky) {
      this.murmurT -= dt;
      if (this.murmurT <= 0) { this.murmurT = rnd(0.12, 0.45); this.murmur(me); }
    }
    this.eventT -= dt;
    if (this.eventT > 0) return;
    if (this.zoneKind === 'street' && this.spooky) { this.eventT = rnd(3, 9); this.spookyEvent(me); }
    else if (this.zoneKind === 'street') { this.eventT = rnd(2.5, 8); this.streetEvent(me); }
    else { this.eventT = rnd(4, 12); this.towerEvent(me); }
  }

  private around(me: Pos, r0: number, r1: number): Pos {
    const a = Math.random() * Math.PI * 2, r = rnd(r0, r1);
    return { x: me.x + Math.cos(a) * r, y: me.y + Math.sin(a) * r };
  }
  private at(p: Pos, ref: number, wet: number) { return this.s.out(this.zone!, { ...p, ref }, wet); }

  // ------------------------------------------------------------------ street
  private murmur(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 9, 26), 4, 0.25);
    const p = Math.random() < 0.5 ? rnd(95, 150) : rnd(170, 260);
    const n = Math.random() < 0.3 ? 3 : 1;
    for (let i = 0; i < n; i++) s.voice(o, s.now + i * rnd(0.14, 0.22), rnd(0.12, 0.28), p * rnd(0.95, 1.1), p * rnd(0.8, 1.05), pick(VOWELS), rnd(0.015, 0.04));
    if (Math.random() < 0.025) for (let i = 0; i < 5; i++) s.voice(o, s.now + 0.4 + i * 0.13, 0.1, p * 1.5, p * 1.3, VOWELS[0], 0.035); // a laugh
  }

  private streetEvent(me: Pos) {
    const r = Math.random();
    if (r < 0.3) { if (!this.realStreet) this.carPass(me); }
    else if (r < 0.38) this.horn(me);
    else if (r < 0.46 && this.planeCd <= 0) { this.planeCd = rnd(70, 120); this.plane(); }
    else if (r < 0.54 && this.trainCd <= 0) { this.trainCd = rnd(80, 140); this.train(me); }
    else if (r < 0.6) this.siren(me);
    else if (r < 0.72) this.radio(me);
    else if (r < 0.78) this.airBrake(me);
    else if (r < 0.84) this.dog(me);
    else if (r < 0.9) this.jackhammer(me);
    else this.birds(me);
  }

  private carPass(me: Pos) {
    const s = this.s, t = s.now, dur = rnd(3, 5.5), dir = Math.random() < 0.5 ? 1 : -1, off = rnd(10, 22);
    const p = s.panner(me.x - 45 * dir, me.y + off, 6, 1, 80);
    p.positionX.setValueAtTime(me.x - 45 * dir, t);
    p.positionX.linearRampToValueAtTime(me.x + 45 * dir, t + dur);
    const g = s.gain(0); g.connect(p).connect(this.zone!);
    const peak = rnd(0.25, 0.5);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.noise(g, t, dur, { type: 'bandpass', freq: 380, q: 0.7, peak: 0.5, attack: 0.01, buf: 'brown' });
    s.noise(g, t, dur, { type: 'highpass', freq: 2500, peak: 0.05, attack: 0.01, buf: 'pink' }); // tyre hiss
    const f = rnd(60, 95); // engine with a little doppler drop
    s.tone(g, t, dur, { type: 'sawtooth', freq: f * 1.06, to: f * 0.92, peak: 0.08, filter: 320, attack: 0.01 });
  }
  private horn(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 18, 35), 8, 0.4), t = s.now;
    const n = Math.random() < 0.5 ? 2 : 1;
    for (let i = 0; i < n; i++) for (const f of [415, 523]) s.tone(o, t + i * 0.32, rnd(0.18, 0.5), { type: 'square', freq: f, peak: 0.05, filter: 1800, sustain: 0.04, rel: 0.05 });
  }
  private plane() {
    const s = this.s, t = s.now, dur = 26;
    const o = s.out(this.zone!, undefined, 0.3);
    const src = s.ctx.createBufferSource(); src.buffer = this.longNoise('brown'); src.loop = true;
    const f = s.ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(180, t); f.frequency.linearRampToValueAtTime(900, t + dur * 0.5); f.frequency.linearRampToValueAtTime(220, t + dur);
    const g = s.gain(0.0001);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + dur * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(o); src.start(t, Math.random() * 10); src.stop(t + dur + 0.1);
    s.tone(o, t + 4, dur - 6, { type: 'sine', freq: 2300, to: 2050, peak: 0.004, attack: 8 }); // turbine whine
  }
  private train(me: Pos) {
    const s = this.s, t = s.now, dur = 16;
    const o = this.at({ x: me.x + rnd(-30, 30), y: me.y + 45 }, 15, 0.5);
    const swell = s.gain(0.0001); swell.connect(o);
    swell.gain.setValueAtTime(0.0001, t); swell.gain.exponentialRampToValueAtTime(1, t + dur * 0.45); swell.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.noise(swell, t, dur, { type: 'lowpass', freq: 260, peak: 0.6, attack: 0.01, buf: 'brown' });
    for (let k = 0.6; k < dur - 0.6; k += 0.95) for (const d of [0, 0.16]) s.noise(swell, t + k + d, 0.07, { type: 'lowpass', freq: 900, peak: 0.25, buf: 'brown' }); // wheel clacks
    for (const f of [311, 370]) s.tone(o, t + 2, 1.6, { type: 'sawtooth', freq: f, peak: 0.03, filter: 900, sustain: 0.025, rel: 0.4 }); // horn
  }
  private siren(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 30, 45), 12, 0.8), t = s.now;
    for (let i = 0; i < 2; i++) { s.tone(o, t + i * 3.2, 1.6, { type: 'sawtooth', freq: 620, to: 880, peak: 0.025, filter: 1400 }); s.tone(o, t + 1.6 + i * 3.2, 1.6, { type: 'sawtooth', freq: 880, to: 620, peak: 0.025, filter: 1400 }); }
  }
  private radio(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 5, 10), 4, 0.1), t = s.now;
    s.noise(o, t, 0.12, { freq: 2500, q: 0.8, peak: 0.12 });
    for (let i = 0; i < 4; i++) s.voice(o, t + 0.15 + i * 0.2, 0.17, 150 + Math.random() * 40, 130, [700, 1400, 2600], 0.12, 0.5);
    s.noise(o, t + 1.0, 0.1, { freq: 2500, q: 0.8, peak: 0.1 });
  }
  private airBrake(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 15, 30), 8, 0.3);
    s.noise(o, s.now, 0.9, { type: 'highpass', freq: 3200, peak: 0.08, attack: 0.005 });
  }
  private dog(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 25, 40), 10, 0.5), t = s.now;
    for (let i = 0; i < (Math.random() < 0.5 ? 2 : 3); i++) s.voice(o, t + i * 0.32, 0.14, 520, 340, [700, 1300, 2500], 0.06, 0.4);
  }
  private jackhammer(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 35, 50), 14, 0.4), t = s.now, len = rnd(1.2, 2.8);
    for (let k = 0; k < len; k += 1 / 17) s.noise(o, t + k, 0.035, { type: 'lowpass', freq: 1500, peak: 0.12 });
  }
  private birds(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 8, 18), 4, 0.2), t = s.now;
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) { const f = rnd(2800, 4200); s.tone(o, t + i * rnd(0.09, 0.16), 0.06, { type: 'sine', freq: f, to: f * rnd(1.1, 1.35), peak: 0.03 }); }
  }

  // ------------------------------------------------------------------ tower
  private towerEvent(me: Pos) {
    const r = Math.random();
    if (r < 0.16) this.creak(this.at(this.around(me, 6, 18), 4, 0.6), this.s.now, rnd(1, 2.2));
    else if (r < 0.27) this.door(me);
    else if (r < 0.35) this.whisper(me);
    else if (r < 0.49) this.drips(me);
    else if (r < 0.6) this.sparks(me);
    else if (r < 0.68) { this.silenceT = rnd(7, 13); this.eventT = rnd(1, 3); }
    else if (r < 0.74) this.footsteps(me);
    else if (r < 0.87) this.impact(me);
    else this.groan(me);
  }

  /** Door hinge creak: stick-slip friction, a jittery sawtooth through two resonances with a jagged amplitude. */
  private creak(dest: AudioNode, t: number, dur: number, peak = 0.07) {
    const s = this.s, N = 48;
    const fq = new Float32Array(N), am = new Float32Array(N);
    let f = rnd(110, 200);
    for (let i = 0; i < N; i++) { f = Math.min(380, Math.max(70, f + rnd(-35, 40))); fq[i] = f; am[i] = peak * (Math.random() < 0.25 ? 0.15 : rnd(0.5, 1)) * Math.sin((Math.PI * (i + 0.5)) / N); }
    const o = s.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueCurveAtTime(fq, t, dur);
    const g = s.gain(0); g.gain.setValueCurveAtTime(am, t, dur);
    for (const [fr, q] of [[750, 5], [1900, 9]] as const) { const bp = s.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = q; o.connect(bp).connect(g); }
    g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  private door(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 7, 16), 4, 0.6), t = s.now;
    s.noise(o, t, 0.03, { freq: 3000, q: 3, peak: 0.15 }); // latch
    s.tone(o, t, 0.03, { type: 'square', freq: 1100, peak: 0.03 });
    const len = rnd(1.2, 2);
    this.creak(o, t + 0.15, len);
    if (Math.random() < 0.5) { // ...and it swings shut
      const tc = t + 0.4 + len + rnd(0.5, 2);
      s.noise(o, tc, 0.5, { type: 'lowpass', freq: 260, peak: 0.6, buf: 'brown' });
      s.tone(o, tc, 0.35, { freq: 70, to: 40, peak: 0.3 });
      s.noise(o, tc + 0.05, 0.12, { freq: 2200, q: 2, peak: 0.06 });
    }
  }
  /** Breathy whisper: pink noise shaped into syllables through shifting vowel formants, close by the player. */
  private whisper(me: Pos) {
    const s = this.s, t = s.now;
    const o = this.at({ x: me.x + rnd(2, 4) * (Math.random() < 0.5 ? 1 : -1), y: me.y + rnd(2, 4) }, 1.5, 0.8);
    const src = s.ctx.createBufferSource(); src.buffer = s.pink; src.loop = true;
    const hp = s.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 600;
    const g = s.gain(0); g.connect(o);
    const fs = [0, 1, 2].map((i) => { const bp = s.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6 + i * 3; hp.connect(bp); const fg = s.gain([1, 0.7, 0.4][i]); bp.connect(fg).connect(g); return bp; });
    src.connect(hp);
    let k = t + 0.05;
    const n = 5 + Math.floor(Math.random() * 7), peak = rnd(0.25, 0.45);
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < n; i++) {
      const len = rnd(0.1, 0.24), v = pick(VOWELS);
      fs.forEach((bp, j) => bp.frequency.setValueAtTime(v[j], k));
      g.gain.setValueAtTime(0, k); g.gain.linearRampToValueAtTime(peak * rnd(0.6, 1), k + 0.04); g.gain.linearRampToValueAtTime(0, k + len);
      if (Math.random() < 0.25) s.noise(o, k + len, 0.12, { type: 'highpass', freq: 5000, peak: 0.03 }); // "s"
      k += len + rnd(0.02, 0.12);
    }
    src.start(t, Math.random()); src.stop(k + 0.2);
  }
  private drips(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 4, 12), 2.5, 0.6);
    const f = rnd(1100, 2000);
    let k = s.now;
    for (let i = 0; i < 5 + Math.floor(Math.random() * 6); i++) {
      const ff = f * rnd(0.92, 1.08);
      s.tone(o, k, 0.05, { type: 'sine', freq: ff, to: ff * 1.7, peak: 0.07 });
      s.tone(o, k + 0.03, 0.12, { type: 'sine', freq: ff * 0.5, peak: 0.012 });
      k += rnd(0.6, 1.5);
    }
  }
  private sparks(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 5, 14), 3, 0.3), t = s.now;
    let k = t;
    for (let i = 0; i < 4 + Math.floor(Math.random() * 7); i++) { s.noise(o, k, rnd(0.012, 0.06), { type: 'highpass', freq: 3000, peak: rnd(0.1, 0.25) }); k += rnd(0.02, 0.25); }
    if (Math.random() < 0.6) s.tone(o, t, k - t + 0.1, { type: 'sawtooth', freq: 120, peak: 0.03, filter: 2500 }); // electrical buzz
  }
  private footsteps(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 16, 26), 6, 0.7), t = s.now;
    for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) s.noise(o, t + i * rnd(0.6, 0.8), 0.12, { type: 'lowpass', freq: 420, peak: 0.28 * (1 - i * 0.12), buf: 'brown' });
  }
  private impact(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 25, 35), 12, 0.8);
    if (Math.random() < 0.7) { s.noise(o, s.now, 1.2, { type: 'lowpass', freq: 300, peak: 0.5, buf: 'brown' }); s.tone(o, s.now, 0.8, { freq: 50, to: 30, peak: 0.3 }); }
    else for (let i = 0; i < 5; i++) s.noise(o, s.now + i * 0.09, 0.05, { freq: 1500, peak: 0.1 });
  }
  private groan(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 20, 35), 12, 0.8);
    s.tone(o, s.now, 2.2, { type: 'sawtooth', freq: 55 + Math.random() * 30, to: 45, peak: 0.06, filter: 500, q: 12 });
  }

  // ------------------------------------------------------------------ Halloween street (night)
  private spookyEvent(me: Pos) {
    const r = Math.random();
    if (r < 0.2) this.howl(me);
    else if (r < 0.38) this.owl(me);
    else if (r < 0.52) this.crows(me);
    else if (r < 0.62) this.bell();
    else if (r < 0.74) this.whisper(me);
    else if (r < 0.86) this.groan(me);
    else { const o = this.at(this.around(me, 8, 20), 6, 0.6); this.creak(o, this.s.now, rnd(1, 2.2), 0.05); } // gate swinging
  }
  /** a far-off wolf: a rising, wavering wail that sags away */
  private howl(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 30, 50), 14, 0.9), f = rnd(330, 420);
    s.tone(o, s.now, 1.1, { freq: f * 0.7, to: f, peak: 0.05, attack: 0.5 });
    s.tone(o, s.now + 1.1, 1.8, { freq: f, to: f * 0.62, peak: 0.05, rel: 0.8 });
    s.tone(o, s.now, 2.9, { freq: f * 2, to: f * 1.3, peak: 0.008, attack: 0.6 });
  }
  private owl(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 12, 25), 8, 0.6), f = rnd(360, 420);
    for (const [t, d] of [[0, 0.25], [0.45, 0.18], [0.7, 0.5]]) s.tone(o, s.now + t, d, { freq: f, to: f * 0.92, peak: 0.05, attack: 0.04, filter: 900 });
  }
  private crows(me: Pos) {
    const s = this.s, o = this.at(this.around(me, 10, 24), 8, 0.5), n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const t = s.now + i * rnd(0.35, 0.55);
      s.voice(o, t, 0.22, rnd(520, 640), rnd(380, 460), VOWELS[0], 0.05, 0.6);
      s.noise(o, t, 0.2, { freq: 1500, q: 3, peak: 0.03 });
    }
  }
  /** distant church bell: inharmonic partials with a long decay */
  private bell() {
    const s = this.s, o = this.at({ x: 0, y: -60 }, 30, 1);
    for (const [m, p] of [[1, 0.05], [2.0, 0.025], [2.4, 0.02], [3.0, 0.012], [4.2, 0.008]]) s.tone(o, s.now, 5.5, { freq: 98 * m, peak: p, attack: 0.005, rel: 4 });
  }

  // ------------------------------------------------------------------ elevator muzak
  private updateMuzak(inElevator: boolean) {
    const s = this.s;
    if (inElevator && !this.muzakOn) {
      if (!this.muzak) {
        // tinny little ceiling speaker
        this.muzak = s.gain(0);
        const hp = s.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 280;
        const lp = s.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600;
        this.muzak.connect(hp).connect(lp).connect(s.music);
      }
      this.muzakOn = true;
      this.muzakNext = Math.max(this.muzakNext, s.now + 0.05);
      this.muzak.gain.setTargetAtTime(0.9, s.now, 0.4);
    } else if (!inElevator && this.muzakOn) {
      this.muzakOn = false;
      this.muzakOffAt = s.now + 1.5;
      this.muzak!.gain.setTargetAtTime(0, s.now, 0.35);
    }
    if (!this.muzak || (!this.muzakOn && s.now > this.muzakOffAt)) return;
    const hol = currentHoliday();
    const [play, bars, beat] = hol === 'halloween' ? [this.spookBar, 8, SPOOK_BEAT] : hol === 'xmas' ? [this.xmasBar, 16, XMAS_BEAT] : [this.bar, 8, BEAT];
    while (this.muzakNext < s.now + 0.6) { play.call(this, this.muzakBar % bars, this.muzakNext); this.muzakBar++; this.muzakNext += 4 * beat; }
  }

  /** Christmas muzak bar: glockenspiel melody, piano on 2 and 4, oom-pah bass, sleigh bells on every eighth. */
  private xmasBar(i: number, t: number) {
    const s = this.s, d = this.muzak!, c = XMAS_CHORDS[i], B = XMAS_BEAT;
    for (const [b, m, len] of XMAS_MELODY[i]) {
      const f = hz(m + 12);
      s.tone(d, t + b * B, len * B + 0.4, { type: 'sine', freq: f, peak: 0.07, attack: 0.003, rel: 0.5 }); // glockenspiel
      s.tone(d, t + b * B, 0.35, { type: 'sine', freq: f * 2.76, peak: 0.012, attack: 0.002 }); // bar's bright overtone
    }
    for (const b of [1, 3]) for (const m of c.v) s.tone(d, t + b * B, 0.3, { type: 'triangle', freq: hz(m), peak: 0.02, filter: 2200 }); // piano
    for (const [b, m] of [[0, c.root], [2, c.root + 7]] as const) s.tone(d, t + b * B, 0.9 * B, { type: 'triangle', freq: hz(m + 12), peak: 0.09, filter: 600 }); // bass
    for (let k = 0; k < 8; k++) s.noise(d, t + k * 0.5 * B, 0.06, { type: 'highpass', freq: 7000, peak: k % 2 ? 0.025 : 0.05 }); // sleigh bells
  }

  /** Halloween muzak bar: plucky harpsichord melody and chord stabs, walking bass, two finger snaps. */
  private spookBar(i: number, t: number) {
    const s = this.s, d = this.muzak!, c = SPOOK_CHORDS[i], B = SPOOK_BEAT;
    const harp = (m: number, at: number, peak: number) => { // harpsichord: bright plucked saw with a quieter octave
      s.tone(d, at, 0.55, { type: 'sawtooth', freq: hz(m), peak, filter: 3200, attack: 0.002, rel: 0.4 });
      s.tone(d, at, 0.35, { type: 'square', freq: hz(m + 12), peak: peak * 0.25, filter: 4500, attack: 0.002 });
    };
    for (const [b, m] of SPOOK_MELODY[i]) harp(m, t + b * B, 0.05);
    for (const b of [0, 2]) for (const m of c.v) harp(m - 12, t + b * B + 0.01, 0.014);
    for (const [b, m] of [[0, c.root], [1, c.root + 7], [2, c.root + 12], [3, c.root + 7]] as const) s.tone(d, t + b * B, 0.9 * B, { type: 'triangle', freq: hz(m + 12), peak: 0.09, filter: 600 }); // bass
    for (const b of [1, 3]) s.noise(d, t + b * B, 0.035, { type: 'bandpass', freq: 2300, q: 2.5, peak: 0.14 }); // snap
  }

  private bar(i: number, t: number) {
    const s = this.s, d = this.muzak!, c = CHORDS[i];
    const wob = () => rnd(-16, 16); // cents: the tape has seen better days
    for (const [b, m, len] of MELODY[i]) { // vibraphone
      const f = hz(m);
      s.tone(d, t + b * BEAT, len * BEAT + 0.7, { type: 'sine', freq: f, peak: 0.07, detune: wob(), attack: 0.004 });
      s.tone(d, t + b * BEAT, 0.5, { type: 'sine', freq: f * 4, peak: 0.008, detune: wob() });
    }
    for (const b of i % 2 ? [0.5, 2, 3] : [0, 1.5, 3]) for (const m of c.v) s.tone(d, t + b * BEAT, 0.42, { type: 'triangle', freq: hz(m), peak: 0.018, filter: 1800, detune: wob() }); // electric piano comp
    for (const [b, m, len] of [[0, c.root, 1.4], [1.5, c.root + 7, 0.4], [2, c.root + 7, 1.4], [3.5, c.root, 0.4]] as const) s.tone(d, t + b * BEAT, len * BEAT, { type: 'triangle', freq: hz(m + 12), peak: 0.1, filter: 700 }); // bass
    for (let k = 0; k < 8; k++) s.noise(d, t + k * 0.5 * BEAT, 0.05, { type: 'highpass', freq: 6500, peak: k % 2 ? 0.03 : 0.014 }); // shaker
    for (const b of i % 2 ? [1, 2] : [0, 1.5, 3]) s.noise(d, t + b * BEAT, 0.03, { type: 'bandpass', freq: 1800, q: 4, peak: 0.05 }); // rim (clave)
  }
}
