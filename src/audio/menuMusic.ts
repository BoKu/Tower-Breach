/**
 * Main-menu theme: 90s acid techno (think the "Hackers" soundtrack). Four-on-the-floor kick, claps, 16th hats,
 * a squelchy 303-style bassline whose filter breathes over the loop, a delayed square arp, a saw pad, and a
 * break with a noise riser and snare roll that drops back into bar 1.
 *
 * Rendered once into an AudioBuffer with an OfflineAudioContext and played with loop = true, so the loop is
 * sample-accurate. The last two bars are also rendered as a lead-in before bar 1 and then trimmed off, so delay
 * and pad tails from the end of the loop are already present at its start: the seam is inaudible.
 */
const BPM = 132, STEP = 60 / BPM / 4, BAR = STEP * 16, BARS = 16, LOOP = BAR * BARS;
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
// two bars per chord: Am F C G | Am F G E (E major pulls back to Am at the loop point)
const PROG: { root: number; q: number[] }[] = [
  { root: 33, q: [0, 3, 7] }, { root: 29, q: [0, 4, 7] }, { root: 36, q: [0, 4, 7] }, { root: 31, q: [0, 4, 7] },
  { root: 33, q: [0, 3, 7] }, { root: 29, q: [0, 4, 7] }, { root: 31, q: [0, 4, 7] }, { root: 28, q: [0, 4, 7] },
];
const BASS: (number | null)[] = [0, 0, 12, 0, null, 7, 0, 12, 0, null, 10, 0, 12, 0, 7, 3];
const ACCENT = new Set([2, 7, 12]);
export const MENU_LOOP_SECONDS = LOOP;

export async function renderMenuLoop(sampleRate: number): Promise<AudioBuffer> {
  const len = Math.round(LOOP * sampleRate);
  const PRE = 2 * BAR, pre = Math.round(PRE * sampleRate);
  const ctx = new OfflineAudioContext(2, pre + len, sampleRate);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.15;
  const master = ctx.createGain(); master.gain.value = 0.5;
  master.connect(comp).connect(ctx.destination);
  const noise = ctx.createBuffer(1, sampleRate, sampleRate);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const drive = ctx.createWaveShaper();
  { const c = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.tanh(x * 2.2); } drive.curve = c; }
  const bassBus = ctx.createGain(); bassBus.gain.value = 0.5; bassBus.connect(drive).connect(master);
  // arp bus with a dotted-8th feedback delay
  const arpBus = ctx.createGain(); arpBus.connect(master);
  const delay = ctx.createDelay(1); delay.delayTime.value = STEP * 3;
  const fb = ctx.createGain(); fb.gain.value = 0.38;
  const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2200;
  const wet = ctx.createGain(); wet.gain.value = 0.45;
  arpBus.connect(delay); delay.connect(dlp).connect(fb).connect(delay); dlp.connect(wet).connect(master);

  // shared filter/pan buses keep the node count (and render time) low
  const bus = (type: BiquadFilterType, freq: number, q = 1, pan = 0, to: AudioNode = master) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    f.connect(p).connect(to); return f;
  };
  const hatC = bus('highpass', 8000), hatO = bus('highpass', 7000), clapB = bus('bandpass', 1300, 1.2), click = bus('highpass', 3000);
  const arpL = bus('lowpass', 2600, 1, -0.5, arpBus), arpR = bus('lowpass', 2600, 1, 0.5, arpBus);
  const padL = bus('lowpass', 950, 1, -0.4), padR = bus('lowpass', 950, 1, 0.4);
  const env = (g: GainNode, t: number, a: number, peak: number, d: number) => {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const burst = (dest: AudioNode, t: number, dur: number, peak: number) => {
    const src = ctx.createBufferSource(); src.buffer = noise;
    const g = ctx.createGain(); env(g, t, 0.001, peak, dur);
    src.connect(g).connect(dest); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  };
  const kick = (t: number) => {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain(); env(g, t, 0.002, 0.9, 0.32);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.4);
    burst(click, t, 0.012, 0.15);
  };
  const clap = (t: number, peak = 0.22) => { for (const d of [0, 0.011, 0.023]) burst(clapB, t + d, d < 0.02 ? 0.02 : 0.16, peak); };
  const bass = (t: number, m: number, acc: boolean, cut: number) => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = acc ? 16 : 11;
    f.frequency.setValueAtTime(cut * (acc ? 5 : 3), t); f.frequency.exponentialRampToValueAtTime(cut, t + STEP * 0.9);
    const g = ctx.createGain(); env(g, t, 0.003, acc ? 0.5 : 0.32, STEP * 0.85);
    o.connect(f).connect(g).connect(bassBus); o.start(t); o.stop(t + STEP + 0.05);
  };
  const arp = (t: number, m: number, pan: number) => {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz(m);
    const g = ctx.createGain(); env(g, t, 0.002, 0.045, STEP * 0.8);
    o.connect(g).connect(pan < 0 ? arpL : arpR); o.start(t); o.stop(t + STEP);
  };
  const pad = (t: number, ms: number[], dur: number) => {
    for (const m of ms) for (const det of [-9, 9]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.014, t + 0.5); g.gain.setValueAtTime(0.014, t + dur - 0.1); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.7);
      o.connect(g).connect(det < 0 ? padL : padR); o.start(t); o.stop(t + dur + 0.8);
    }
  };

  // Nodes are created bar by bar while rendering (suspend/resume): nodes scheduled far ahead would otherwise be
  // processed for the whole render and make it run at real-time speed.
  const scheduleBar = (b: number) => { // bars -2,-1 are the lead-in (= bars 14,15)
    {
      const bar = (b + BARS) % BARS, t0 = PRE + b * BAR, ch = PROG[bar >> 1];
      const brk = bar === 12 || bar === 13; // break: no kick or arp
      const fill = bar === 15;
      // the bass filter opens and closes once per loop (periodic, so the seam matches)
      const cut = 260 + 1100 * (0.5 - 0.5 * Math.cos((2 * Math.PI * bar) / BARS));
      if (bar % 2 === 0) pad(t0, ch.q.map((q) => ch.root + 36 + q).concat(ch.root + 48), BAR * 2);
      for (let s = 0; s < 16; s++) {
        const t = t0 + s * STEP;
        if (s % 4 === 0 && !brk && !(fill && s >= 8)) kick(t);
        if ((s === 4 || s === 12) && !fill) clap(t);
        if (fill && s >= 8) clap(t, 0.06 + (s - 8) * 0.03); // snare roll into the drop
        burst(hatC, t, 0.03, s % 2 ? 0.05 : 0.025); // closed hat
        if (s % 4 === 2 && !brk) burst(hatO, t, 0.12, 0.07); // open hat
        const bn = BASS[s];
        if (bn !== null && !(brk && s % 4)) bass(t, ch.root + 12 + bn, ACCENT.has(s), cut);
        if (!brk) { const tones = [...ch.q, 12, 12 + ch.q[1], 12 + ch.q[2], 24, 12 + ch.q[2]]; arp(t, ch.root + 36 + tones[s % 8], s % 2 ? 0.5 : -0.5); }
      }
      if (bar === 14) { // noise riser across the last two bars
        const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
        f.frequency.setValueAtTime(400, t0); f.frequency.exponentialRampToValueAtTime(7000, t0 + BAR * 2);
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + BAR * 2 - 0.02); g.gain.linearRampToValueAtTime(0, t0 + BAR * 2);
        src.connect(f).connect(g).connect(master); src.start(t0); src.stop(t0 + BAR * 2);
      }
    }
  };
  scheduleBar(-2);
  for (let b = -1; b < BARS; b++) {
    const at = Math.floor(((PRE + b * BAR - 0.25) * sampleRate) / 128) * 128 / sampleRate; // render-quantum aligned
    ctx.suspend(at).then(() => { scheduleBar(b); ctx.resume(); });
  }
  const rendered = await ctx.startRendering();
  // trim the lead-in, then normalise to -1 dBFS so the loop never clips
  const out = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate });
  let peak = 0;
  for (let c = 0; c < 2; c++) for (const v of rendered.getChannelData(c).subarray(pre, pre + len)) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.89 / peak : 1;
  for (let c = 0; c < 2; c++) { const d = rendered.getChannelData(c).slice(pre, pre + len); for (let i = 0; i < d.length; i++) d[i] *= k; out.copyToChannel(d, c); }
  return out;
}
