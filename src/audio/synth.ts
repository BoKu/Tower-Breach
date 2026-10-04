/** Low-level WebAudio synthesis helpers. Every sound in the game is generated here at runtime. */
export class Synth {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  music: GainNode;
  amb: GainNode;
  reverbSend: GainNode;
  private reverb: ConvolverNode;
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.master = this.gain(0.8);
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.gain(1); this.sfx.connect(this.master);
    this.music = this.gain(0.7); this.music.connect(this.master);
    this.amb = this.gain(0.8); this.amb.connect(this.master);
    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.8);
    this.reverbSend = this.gain(0.35);
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.white = this.noiseBuffer('white');
    this.pink = this.noiseBuffer('pink');
    this.brown = this.noiseBuffer('brown');
  }

  get now() { return this.ctx.currentTime; }

  gain(v: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  private noiseBuffer(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const n = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return b;
  }

  impulse(sec: number, decay: number): AudioBuffer {
    const n = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(2, n, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  /** 3D panner at world position (sim x,y). */
  panner(x: number, y: number, ref = 3, rolloff = 1.2, max = 60): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = max;
    p.positionX.value = x; p.positionY.value = 1; p.positionZ.value = y;
    return p;
  }

  /** Output chain: optional 3D panner -> bus, plus reverb send. */
  out(bus: AudioNode, pos?: { x: number; y: number; ref?: number }, wet = 0.2): AudioNode {
    const g = this.gain(1);
    if (pos) {
      const p = this.panner(pos.x, pos.y, pos.ref ?? 3);
      g.connect(p).connect(bus);
      if (wet > 0) { const s = this.gain(wet); p.connect(s).connect(this.reverbSend); }
    } else {
      g.connect(bus);
      if (wet > 0) { const s = this.gain(wet); g.connect(s).connect(this.reverbSend); }
    }
    return g;
  }

  env(g: GainNode, t: number, a: number, peak: number, d: number, sustain = 0, rel = 0) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, a));
    if (sustain > 0) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, sustain), t + a + d);
      g.gain.setValueAtTime(Math.max(0.0002, sustain), t + a + d + rel);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + rel + 0.1);
    } else g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noise(dest: AudioNode, t: number, dur: number, opts: { type?: BiquadFilterType; freq?: number; q?: number; peak?: number; attack?: number; buf?: 'white' | 'pink' | 'brown'; sweepTo?: number; rate?: number }) {
    const src = this.ctx.createBufferSource();
    src.buffer = opts.buf === 'pink' ? this.pink : opts.buf === 'brown' ? this.brown : this.white;
    src.playbackRate.value = opts.rate ?? 1;
    const f = this.ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 1000, t);
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = this.gain(0);
    this.env(g, t, opts.attack ?? 0.002, opts.peak ?? 1, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest: AudioNode, t: number, dur: number, opts: { type?: OscillatorType; freq: number; to?: number; peak?: number; attack?: number; detune?: number; filter?: number; q?: number; sustain?: number; rel?: number }) {
    const o = this.ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = this.gain(0);
    this.env(g, t, opts.attack ?? 0.005, opts.peak ?? 0.5, dur, opts.sustain ?? 0, opts.rel ?? 0);
    let node: AudioNode = o;
    if (opts.filter) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = opts.filter; f.Q.value = opts.q ?? 0.7;
      node = node.connect(f);
    }
    node.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + (opts.rel ?? 0) + 0.2);
  }

  /** Formant "voice" blip: a buzzy source through vowel formant filters. */
  voice(dest: AudioNode, t: number, dur: number, pitch: number, pitchTo: number, formants: [number, number, number], peak = 0.4, grit = 0) {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch, t);
    o.frequency.exponentialRampToValueAtTime(pitchTo, t + dur);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 6 + Math.random() * 3;
    const vg = this.gain(pitch * 0.03);
    vib.connect(vg).connect(o.frequency);
    const sum = this.gain(1);
    const g = this.gain(0);
    this.env(g, t, 0.02, peak, dur);
    for (const [i, f] of formants.entries()) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 7 + i * 3;
      const fg = this.gain([1, 0.6, 0.35][i]);
      o.connect(bp).connect(fg).connect(sum);
    }
    if (grit > 0) {
      const ws = this.ctx.createWaveShaper();
      ws.curve = this.crushCurve(grit);
      sum.connect(ws).connect(g);
    } else sum.connect(g);
    g.connect(dest);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  }

  private curves = new Map<number, Float32Array<ArrayBuffer>>();
  crushCurve(amount: number): Float32Array<ArrayBuffer> {
    const key = Math.round(amount * 10);
    let c = this.curves.get(key);
    if (c) return c;
    c = new Float32Array(1024);
    const steps = Math.max(2, Math.round(16 - amount * 12));
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      c[i] = Math.round(Math.tanh(x * (1 + amount * 4)) * steps) / steps;
    }
    this.curves.set(key, c);
    return c;
  }

  distortion(amount: number): WaveShaperNode {
    const ws = this.ctx.createWaveShaper();
    const c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
    ws.curve = c;
    return ws;
  }
}
