/**
 * End credits: a slow, sombre reworking of the menu theme (same A-minor progression), and the post-credits sting.
 *
 * Theme, 96 BPM, 24 bars = 60 s plus a 4 s ring-out: pads and a soft triangle arpeggio, then the menu theme's
 * square arp and a pulsing bass come in, then a quiet four-on-the-floor and a lead line, and it resolves on
 * A major (a Picardy third: the tower is down, it ends in hope).
 * Both are rendered once with an OfflineAudioContext, like the menu loop.
 */
const BPM = 96, STEP = 60 / BPM / 4, BAR = STEP * 16, BARS = 24, TAIL = 4;
export const CREDITS_SECONDS = BAR * BARS;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// two bars per chord: Am F C G | Am F G E | Am F G A
const PROG: { root: number; q: number[] }[] = [
  { root: 33, q: [0, 3, 7] }, { root: 29, q: [0, 4, 7] }, { root: 36, q: [0, 4, 7] }, { root: 31, q: [0, 4, 7] },
  { root: 33, q: [0, 3, 7] }, { root: 29, q: [0, 4, 7] }, { root: 31, q: [0, 4, 7] }, { root: 28, q: [0, 4, 7] },
  { root: 33, q: [0, 3, 7] }, { root: 29, q: [0, 4, 7] }, { root: 31, q: [0, 4, 7] }, { root: 33, q: [0, 4, 7] },
];

/** Post-credits timeline (seconds), shared with the scene in ui/credits.ts so sound and picture line up. */
export const ROOT_LINK = {
  lines: ['CONTINUITY INSTANCE: SECURE', 'ROOT LINK: ACTIVE', 'RECOVERY STATUS: 0.00%'],
  lineAt: [1.2, 3.2, 5.0], charT: 0.045,
  /** after the last line is typed, its percentage climbs to this over countDur (slowing as it goes) */
  recoverTo: 9.97, countDur: 3.4,
  pulseAt: 7.0, pulseDur: 2.6,
  titleAt: 11.0, end: 16.0,
};

function setup(sampleRate: number, seconds: number) {
  const ctx = new OfflineAudioContext(2, Math.round(seconds * sampleRate), sampleRate);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
  const master = ctx.createGain(); master.gain.value = 0.5;
  master.connect(comp).connect(ctx.destination);
  const noise = ctx.createBuffer(1, sampleRate, sampleRate);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const env = (g: GainNode, t: number, a: number, peak: number, d: number) => {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const burst = (dest: AudioNode, t: number, dur: number, peak: number) => {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const g = ctx.createGain(); env(g, t, 0.001, peak, dur);
    src.connect(g).connect(dest); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  };
  const filt = (type: BiquadFilterType, freq: number, q = 1, pan = 0, to: AudioNode = master) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    f.connect(p).connect(to); return f;
  };
  return { ctx, master, env, burst, filt };
}

async function finish(ctx: OfflineAudioContext) {
  const r = await ctx.startRendering();
  let peak = 0;
  for (let c = 0; c < 2; c++) for (const v of r.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.89 / peak : 1; // normalise to -1 dBFS
  for (let c = 0; c < 2; c++) { const d = r.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return r;
}

export async function renderCreditsTheme(sampleRate: number): Promise<AudioBuffer> {
  const { ctx, master, env, burst, filt } = setup(sampleRate, CREDITS_SECONDS + TAIL);
  // the menu theme's arp, with its dotted-8th delay
  const arpBus = ctx.createGain(); arpBus.connect(master);
  const delay = ctx.createDelay(1); delay.delayTime.value = STEP * 3;
  const fb = ctx.createGain(); fb.gain.value = 0.42;
  const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 1800;
  const wet = ctx.createGain(); wet.gain.value = 0.5;
  arpBus.connect(delay); delay.connect(dlp).connect(fb).connect(delay); dlp.connect(wet).connect(master);
  const arpL = filt('lowpass', 1500, 1, -0.5, arpBus), arpR = filt('lowpass', 1500, 1, 0.5, arpBus);
  const padL = filt('lowpass', 800, 1, -0.45), padR = filt('lowpass', 800, 1, 0.45);
  const keys = filt('lowpass', 2400, 0.7), lead = filt('lowpass', 3000, 0.7, 0.1);
  const hat = filt('highpass', 8000), clapB = filt('bandpass', 1300, 1.2), subB = filt('lowpass', 220);

  const pad = (t: number, ms: number[], dur: number, peak = 0.016) => {
    for (const m of ms) for (const det of [-7, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 1.2); g.gain.setValueAtTime(peak, t + dur - 0.2); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.2);
      o.connect(g).connect(det < 0 ? padL : padR); o.start(t); o.stop(t + dur + 1.3);
    }
  };
  const tri = (t: number, m: number, peak: number, dur: number, to: AudioNode) => {
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m);
    const g = ctx.createGain(); env(g, t, 0.006, peak, dur);
    o.connect(g).connect(to); o.start(t); o.stop(t + dur + 0.05);
  };
  const sq = (t: number, m: number, pan: number) => {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz(m);
    const g = ctx.createGain(); env(g, t, 0.002, 0.03, STEP * 0.8);
    o.connect(g).connect(pan < 0 ? arpL : arpR); o.start(t); o.stop(t + STEP);
  };
  const sub = (t: number, m: number, dur: number, peak: number) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = hz(m);
    const g = ctx.createGain(); env(g, t, 0.01, peak, dur);
    o.connect(g).connect(subB); o.start(t); o.stop(t + dur + 0.05);
  };
  const kick = (t: number) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
    const g = ctx.createGain(); env(g, t, 0.003, 0.45, 0.35);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.45);
  };
  const voice = (t: number, m: number, dur: number) => { // the lead: two detuned triangles with a slow swell
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m); o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.12); g.gain.setValueAtTime(0.05, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(lead); o.start(t); o.stop(t + dur + 0.02);
    }
  };

  const scheduleBar = (bar: number) => {
    const t0 = bar * BAR, ci = bar >> 1, ch = PROG[ci], second = bar % 2 === 1;
    const last = ci === PROG.length - 1;
    const tones = [...ch.q, 12, 12 + ch.q[1], 12 + ch.q[2], 24, 12 + ch.q[2]];
    if (!second) pad(t0, ch.q.map((q) => ch.root + 36 + q).concat(ch.root + 48), last ? BAR * 2 + TAIL - 1.5 : BAR * 2, last ? 0.02 : 0.016);
    if (!second) sub(t0, ch.root + 12, last ? BAR * 2 + TAIL - 0.5 : BAR * 2 - 0.1, 0.3);
    // soft keys arpeggio (8ths) throughout; on the last chord, one slow spread that rings out
    if (last) { if (!second) ch.q.concat(12).forEach((q, i) => tri(t0 + i * STEP * 2, ch.root + 48 + q, 0.06, BAR * 2 + TAIL - i * STEP * 2 - 0.5, keys)); }
    else for (let s = 0; s < 16; s += 2) tri(t0 + s * STEP, ch.root + 48 + tones[(s / 2) % 8], 0.035, STEP * 3, keys);
    if (bar >= 8 && !last) {
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * STEP;
        sq(t, ch.root + 36 + tones[s % 8], s % 2 ? 0.5 : -0.5);
        burst(hat, t, 0.025, s % 2 ? 0.03 : 0.015);
        if (s % 2 === 0) sub(t, ch.root + 24, STEP * 1.6, 0.12); // pulsing bass, an echo of the menu 303
      }
    }
    if (bar >= 16 && !last) {
      for (let s = 0; s < 16; s += 4) kick(t0 + s * STEP);
      for (const s of [4, 12]) for (const d of [0, 0.011, 0.023]) burst(clapB, t0 + s * STEP + d, d < 0.02 ? 0.02 : 0.14, 0.09);
      // lead: fifth, third, then the root an octave up, held over the chord's second bar
      if (!second) { voice(t0, ch.root + 48 + ch.q[2], BAR / 2); voice(t0 + BAR / 2, ch.root + 48 + ch.q[1], BAR / 2); }
      else voice(t0, ch.root + 60, BAR);
    }
  };
  // nodes are made bar by bar while rendering, which keeps the offline render fast (see menuMusic.ts)
  scheduleBar(0);
  for (let b = 1; b < BARS; b++) {
    const at = Math.floor(((b * BAR - 0.25) * sampleRate) / 128) * 128 / sampleRate;
    ctx.suspend(at).then(() => { scheduleBar(b); ctx.resume(); });
  }
  return finish(ctx);
}

/** Post-credits: a cold drone, terminal typing ticks, then one pulse falling away (down the cable), and a low hit. */
export async function renderRootLink(sampleRate: number): Promise<AudioBuffer> {
  const R = ROOT_LINK;
  const { ctx, master, env, burst, filt } = setup(sampleRate, R.end);
  const drone = filt('lowpass', 300, 0.8);
  for (const [m, det] of [[33, -4], [33, 4], [40, 0]] as const) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(0.05, 2); g.gain.setValueAtTime(0.05, R.titleAt - 0.5); g.gain.linearRampToValueAtTime(0.0001, R.end - 0.5);
    o.connect(g).connect(drone); o.start(0); o.stop(R.end);
  }
  const tick = filt('bandpass', 2600, 3);
  R.lines.forEach((line, i) => {
    for (let c = 0; c < line.length; c++) if (line[c] !== ' ') burst(tick, R.lineAt[i] + c * R.charT, 0.012, 0.12);
    const t = R.lineAt[i] + line.length * R.charT + 0.1;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = i === 2 ? 660 : 880; // line confirm beep
    const g = ctx.createGain(); env(g, t, 0.002, 0.04, 0.12);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.2);
  });
  { // the pulse: a bright tone falling away in pitch and level
    const t = R.pulseAt, o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(55, t + R.pulseDur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + R.pulseDur);
    o.connect(g).connect(master); o.start(t); o.stop(t + R.pulseDur + 0.05);
  }
  { // title hit
    const t = R.titleAt, o = ctx.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    const g = ctx.createGain(); env(g, t, 0.005, 0.7, 2.6);
    o.connect(g).connect(master); o.start(t); o.stop(t + 3);
  }
  return finish(ctx);
}
