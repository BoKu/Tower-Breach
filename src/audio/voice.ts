import { VOICE } from '../net/voice';

/** 20 ms batches of mono float samples from the mic, posted to the main thread (inline AudioWorklet module). */
const WORKLET = `registerProcessor('tb-mic', class extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${(VOICE.sampleRate * VOICE.frameMs) / 1000}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(this.buf.length); this.n = 0; }
    }
    return true;
  }
});`;

/** Playout delay after a gap: absorbs network jitter (frames arrive in order over the WebSocket). */
const JITTER = 0.08;
/** Further behind than this and frames are dropped to catch up (keeps latency bounded). */
const MAX_LAG = 0.4;
/** Open mic: RMS above this counts as speech; transmission holds a moment after it drops. */
const VAD_LEVEL = 0.02, VAD_HOLD_MS = 350;

/** Why voice can't work here, or '' when it can. Listening needs only the decoder; talking also needs a mic. */
export function voiceUnsupported(talk: boolean): string {
  // browsers hide the audio codecs (and the mic) on plain http pages, so say why instead of blaming the browser
  if (!window.isSecureContext) return 'voice chat needs a secure page: the server must use https (see docs/HOSTING.md), or use the desktop app';
  if (typeof AudioDecoder === 'undefined' || typeof AudioEncoder === 'undefined') return 'this browser has no WebCodecs audio (use the desktop app, or a current Chrome / Edge / Firefox)';
  if (talk && !navigator.mediaDevices?.getUserMedia) return 'no microphone access in this browser';
  return '';
}

interface Speaker { dec: AudioDecoder; gain: GainNode; lp: BiquadFilterNode; pan: StereoPannerNode; next: number; ts: number; heard: number }

/**
 * Proximity voice in the browser: mic -> AudioWorklet -> WebCodecs Opus encoder (24 kbps mono, 20 ms frames)
 * -> `send`; received frames -> one Opus decoder per speaker -> gain / muffle / pan -> voice volume -> speakers.
 * The caller sets each speaker's spatial mix every frame (setSpatial) from snapshot positions.
 */
export class VoiceChat {
  ctx = new AudioContext({ sampleRate: VOICE.sampleRate, latencyHint: 'interactive' });
  private out = this.ctx.createGain();
  private speakers = new Map<number, Speaker>();
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private enc: AudioEncoder | null = null;
  private ts = 0;
  private loudAt = 0;
  private micAt = 0;
  private micDebt = 0;
  /** mic level 0..1 (smoothed RMS), for the settings meter */
  level = 0;
  /** hold the push-to-talk key (or open mic + speech): frames go out */
  wantTalk = false;
  openMic = false;
  /** a frame went out in the last ~150 ms (HUD mic indicator) */
  get transmitting() { return performance.now() - this.sentAt < 150; }
  private sentAt = -1e9;
  device = '';
  send: (opus: Uint8Array) => void = () => {};

  constructor() { this.out.connect(this.ctx.destination); }

  setVolume(v: number) { this.out.gain.value = v; }
  /** browsers start audio suspended until a user gesture */
  resume() { if (this.ctx.state === 'suspended') void this.ctx.resume(); }

  /** Open the microphone (deviceId '' = system default) and start encoding. Rejects with a readable reason. */
  async startMic(deviceId = '') {
    const why = voiceUnsupported(true);
    if (why) throw new Error(why);
    this.stopMic();
    this.device = deviceId;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (this.ctx.state === 'closed') { stream.getTracks().forEach((t) => t.stop()); return; }
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try { await this.ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const cfg: AudioEncoderConfig = { codec: 'opus', sampleRate: VOICE.sampleRate, numberOfChannels: 1, bitrate: VOICE.bitrate, opus: { frameDuration: VOICE.frameMs * 1000, application: 'voip' } as any };
    if (!(await AudioEncoder.isConfigSupported(cfg)).supported) { stream.getTracks().forEach((t) => t.stop()); throw new Error('this browser cannot encode Opus'); }
    const enc = new AudioEncoder({
      output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); this.sentAt = performance.now(); this.send(b); },
      error: () => { this.enc = null; },
    });
    enc.configure(cfg);
    const node = new AudioWorkletNode(this.ctx, 'tb-mic', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
    node.port.onmessage = (e) => this.onMic(e.data as Float32Array);
    this.ctx.createMediaStreamSource(stream).connect(node);
    this.stream = stream; this.node = node; this.enc = enc;
  }

  stopMic() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node?.disconnect();
    if (this.enc && this.enc.state !== 'closed') this.enc.close();
    this.stream = null; this.node = null; this.enc = null; this.level = 0;
  }
  get micOn() { return !!this.stream; }

  private onMic(buf: Float32Array) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    this.level = Math.max(rms * 4, this.level * 0.85);
    const now = performance.now();
    // blocks that queued up behind a main-thread stall arrive together: send at most a few, drop the stale rest
    this.micDebt = Math.max(0, this.micDebt - (now - this.micAt) / VOICE.frameMs) + 1;
    this.micAt = now;
    if (this.micDebt > 5) return;
    if (rms > VAD_LEVEL) this.loudAt = now;
    const talk = this.openMic ? this.wantTalk && now - this.loudAt < VAD_HOLD_MS : this.wantTalk;
    if (!talk || !this.enc || this.enc.state !== 'configured') return;
    if (this.enc.encodeQueueSize > 10) return; // encoder can't keep up: skip rather than build latency
    const data = new AudioData({ format: 'f32', sampleRate: VOICE.sampleRate, numberOfFrames: buf.length, numberOfChannels: 1, timestamp: this.ts, data: buf as Float32Array<ArrayBuffer> });
    this.ts += (buf.length / VOICE.sampleRate) * 1e6;
    this.enc.encode(data);
    data.close();
  }

  /** A frame from a squadmate. */
  receive(speaker: number, opus: Uint8Array) {
    if (this.ctx.state === 'closed') return;
    let s = this.speakers.get(speaker);
    if (!s) {
      const gain = this.ctx.createGain(), lp = this.ctx.createBiquadFilter(), pan = this.ctx.createStereoPanner();
      lp.type = 'lowpass'; lp.frequency.value = 20000;
      gain.gain.value = 0;
      gain.connect(lp).connect(pan).connect(this.out);
      const sp: Speaker = { gain, lp, pan, next: 0, ts: 0, heard: 0, dec: null! };
      sp.dec = new AudioDecoder({ output: (d) => this.play(sp, d), error: () => this.speakers.delete(speaker) });
      sp.dec.configure({ codec: 'opus', sampleRate: VOICE.sampleRate, numberOfChannels: 1 });
      this.speakers.set(speaker, s = sp);
    }
    s.heard = performance.now();
    if (s.dec.state !== 'configured') return;
    s.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: s.ts, data: opus as Uint8Array<ArrayBuffer> }));
    s.ts += VOICE.frameMs * 1000;
  }

  private play(s: Speaker, d: AudioData) {
    const n = d.numberOfFrames;
    const buf = this.ctx.createBuffer(1, n, d.sampleRate);
    d.copyTo(buf.getChannelData(0), { planeIndex: 0, format: 'f32-planar' });
    d.close();
    const now = this.ctx.currentTime;
    if (s.next < now + 0.01) s.next = now + JITTER; // after silence / underrun: rebuild the playout buffer
    if (s.next > now + MAX_LAG) return; // too far behind: drop
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(s.gain);
    src.start(s.next);
    s.next += n / d.sampleRate;
  }

  /** Per-frame mix for one speaker: gain 0..1, pan -1..1, muffled = a wall in between. */
  setSpatial(speaker: number, gain: number, pan: number, muffled: boolean) {
    const s = this.speakers.get(speaker);
    if (!s) return;
    const t = this.ctx.currentTime;
    s.gain.gain.setTargetAtTime(gain, t, 0.05);
    s.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
    s.lp.frequency.setTargetAtTime(muffled ? 900 : 20000, t, 0.08);
  }

  /** Heard from this speaker in the last 300 ms (name tag mic). */
  speaking(id: number) { const s = this.speakers.get(id); return !!s && performance.now() - s.heard < 300; }
  speakerIds() { return [...this.speakers.keys()]; }

  close() {
    this.stopMic();
    for (const s of this.speakers.values()) if (s.dec.state !== 'closed') s.dec.close();
    this.speakers.clear();
    void this.ctx.close();
  }
}
