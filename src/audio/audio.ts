import { Synth } from './synth';
import { Soundscape } from './soundscape';
import { renderMenuLoop } from './menuMusic';
import { weapon } from '../config/weapons';
import { currentHoliday } from '../config/holiday';
import { dist } from '../core/math';
import { idx } from '../gen/floor';
import { lightLevel } from '../sim/lights';
import type { SimEvent, FloorState } from '../sim/state';
import type { ViewSource } from '../render/view';

type Pos = { x: number; y: number; ref?: number };
const VOWELS: Record<string, [number, number, number]> = {
  a: [800, 1150, 2900], e: [400, 1700, 2600], o: [450, 800, 2830], u: [325, 700, 2530], i: [300, 2200, 3000],
};

/** Game audio: event-driven SFX, spatial footsteps, ambience beds, light buzz, heartbeat and stingers. */
export class GameAudio {
  s: Synth | null = null;
  private lastFloor = -1;
  private ambNodes: AudioNode[] = [];
  private buzz: { src: OscillatorNode; g: GainNode; p: PannerNode; li: number }[] = [];
  private steps = new Map<number, { x: number; y: number; acc: number }>();
  private heartT = 0;
  private scape: Soundscape | null = null;
  private menuWanted = false;
  private menuBuf: Promise<AudioBuffer> | null = null;
  private menu: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  private street: AudioBuffer | null = null;
  private streetLoad: Promise<AudioBuffer | null> | null = null;
  private tensionGain: GainNode | null = null;
  private tinnitus: GainNode | null = null;
  private vols = { master: 0.8, sfx: 0.9, music: 0.7 };

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock() {
    try {
      if (!this.s) { this.s = new Synth(); this.scape = new Soundscape(this.s); this.applyVolumes(); }
      if (this.s.ctx.state === 'suspended') this.s.ctx.resume();
      this.syncMenu();
    } catch { this.s = null; }
  }

  setVolumes(master: number, sfx: number, music: number) {
    this.vols = { master, sfx, music };
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.s) return;
    this.s.master.gain.value = this.vols.master;
    this.s.sfx.gain.value = this.vols.sfx;
    this.s.amb.gain.value = this.vols.sfx * 0.9;
    this.s.music.gain.value = this.vols.music;
  }

  /** Main-menu techno loop on the music bus (starts once audio is unlocked by a click or key). */
  setMenuMusic(on: boolean) {
    this.menuWanted = on;
    // OfflineAudioContext needs no user gesture: render now so the theme starts the moment audio unlocks.
    // 48 kHz; a buffer source resamples if the device runs at another rate.
    if (on) { this.menuBuf ??= renderMenuLoop(48000); void this.loadStreet(); }
    this.syncMenu();
  }
  /** Street ambience recording (public/audio/street.mp3, moddable), made seamlessly loopable. Null if it can't load. */
  loadStreet(): Promise<AudioBuffer | null> {
    return (this.streetLoad ??= fetch(`${import.meta.env.BASE_URL}audio/street.mp3`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((a) => new OfflineAudioContext(2, 1, 44100).decodeAudioData(a)) // decoding needs no user gesture
      .then((b) => (this.street = loopable(b)))
      .catch(() => null));
  }

  /** True once the browser lets us make sound (after the first click or key press). */
  get unlocked() { return !!this.s && this.s.ctx.state === 'running'; }

  /** Session ended: stop floor ambience, light buzz, the tension drone and muzak so none of it bleeds into the menu. */
  stopWorld() {
    const s = this.s; if (!s) return;
    for (const n of this.ambNodes) { try { (n as any).stop?.(); n.disconnect(); } catch { /* ignore */ } }
    this.ambNodes = [];
    for (const b of this.buzz) { try { b.src.stop(); b.src.disconnect(); b.p.disconnect(); } catch { /* ignore */ } }
    this.buzz = [];
    this.tensionGain = null;
    this.scape?.stop();
    this.steps.clear();
    this.lastFloor = -1;
  }
  private syncMenu() {
    const s = this.s; if (!s) return;
    if (this.menuWanted && !this.menu) {
      this.menuBuf ??= renderMenuLoop(48000);
      this.menuBuf.then((buf) => {
        if (!this.menuWanted || this.menu) return;
        const src = s.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const g = s.gain(0); g.gain.setValueAtTime(0, s.now); g.gain.linearRampToValueAtTime(1, s.now + 1.5);
        src.connect(g).connect(s.music); src.start();
        this.menu = { src, g };
      }).catch(() => { this.menuBuf = null; });
    } else if (!this.menuWanted && this.menu) {
      const { src, g } = this.menu; this.menu = null;
      g.gain.cancelScheduledValues(s.now); g.gain.setValueAtTime(g.gain.value, s.now); g.gain.linearRampToValueAtTime(0, s.now + 0.6);
      src.stop(s.now + 0.7);
    }
  }

  // ------------------------------------------------------------------ UI
  ui(kind: 'click' | 'hover' | 'buy' | 'error' | 'open' | 'back') {
    const s = this.s; if (!s) return;
    const t = s.now, o = s.out(s.sfx, undefined, 0);
    if (kind === 'click') s.tone(o, t, 0.05, { type: 'square', freq: 1400, to: 900, peak: 0.08, filter: 3000 });
    if (kind === 'hover') s.tone(o, t, 0.03, { type: 'sine', freq: 2200, peak: 0.03 });
    if (kind === 'buy') { s.tone(o, t, 0.12, { type: 'triangle', freq: 880, peak: 0.12 }); s.tone(o, t + 0.07, 0.18, { type: 'triangle', freq: 1320, peak: 0.1 }); s.noise(o, t, 0.08, { type: 'highpass', freq: 5000, peak: 0.05 }); }
    if (kind === 'error') s.tone(o, t, 0.2, { type: 'sawtooth', freq: 140, peak: 0.12, filter: 800 });
    if (kind === 'open') s.tone(o, t, 0.15, { type: 'sine', freq: 300, to: 600, peak: 0.1 });
    if (kind === 'back') s.tone(o, t, 0.12, { type: 'sine', freq: 600, to: 300, peak: 0.08 });
  }

  /** hacking console blips */
  hack(kind: 'ok' | 'bad' | 'granted' | 'traced') {
    const s = this.s; if (!s) return;
    const t = s.now, o = s.out(s.sfx, undefined, 0);
    if (kind === 'ok') s.tone(o, t, 0.06, { type: 'square', freq: 1760, peak: 0.07, filter: 5000 });
    if (kind === 'bad') s.tone(o, t, 0.16, { type: 'sawtooth', freq: 180, to: 120, peak: 0.12, filter: 900 });
    if (kind === 'granted') [880, 1175, 1568].forEach((f, i) => s.tone(o, t + i * 0.09, 0.16, { type: 'triangle', freq: f, peak: 0.1 }));
    if (kind === 'traced') for (let i = 0; i < 3; i++) s.tone(o, t + i * 0.22, 0.18, { type: 'square', freq: 440, to: 330, peak: 0.1, filter: 1600 });
  }

  // ------------------------------------------------------------------ weapons
  private gunshot(wid: string, p: Pos, enemy: boolean, near: boolean) {
    const s = this.s!; const t = s.now;
    const w = weapon(wid);
    const o = s.out(s.sfx, { ...p, ref: 6 }, 0.35);
    const cat = w.category;
    const quiet = w.noise < 10;
    if (wid === 'drone_gun') { s.tone(o, t, 0.08, { type: 'square', freq: 1800, to: 300, peak: 0.25, filter: 4000 }); s.noise(o, t, 0.05, { freq: 3000, peak: 0.3 }); return; }
    if (wid === 'warden_mg') { s.noise(o, t, 0.12, { type: 'lowpass', freq: 900, peak: 1.1, buf: 'pink' }); s.tone(o, t, 0.1, { freq: 90, to: 40, peak: 0.8 }); s.noise(o, t, 0.03, { freq: 2500, peak: 0.5 }); return; }
    if (quiet) { s.noise(o, t, 0.06, { freq: 2200, q: 0.8, peak: 0.45 }); s.noise(o, t, 0.02, { type: 'highpass', freq: 5000, peak: 0.3 }); s.tone(o, t + 0.01, 0.04, { type: 'square', freq: 3000, to: 2400, peak: 0.04 }); return; }
    const P: Record<string, [number, number, number, number]> = {
      // [crack freq, body decay, thump freq, gain]
      pistol: [2600, 0.12, 140, 0.9], heavy_pistol: [1800, 0.25, 90, 1.25], smg: [2400, 0.1, 130, 0.8], shotgun: [1200, 0.35, 70, 1.4],
      rifle: [2000, 0.18, 110, 1.1], sniper: [1500, 0.45, 60, 1.6], machine_gun: [1900, 0.2, 100, 1.1], integrated: [2000, 0.15, 100, 1],
    };
    const [cf, dec, th, gn] = P[cat] ?? P.rifle;
    const pv = 1 + (Math.random() - 0.5) * 0.08;
    s.noise(o, t, 0.02, { type: 'highpass', freq: 3500, peak: gn * 0.8 });
    s.noise(o, t, dec, { freq: cf * pv, q: 0.7, peak: gn * 0.9, sweepTo: cf * 0.4 });
    s.noise(o, t, dec * 1.6, { type: 'lowpass', freq: 700, peak: gn * 0.7, buf: 'brown' });
    s.tone(o, t, 0.09 + dec * 0.3, { freq: th * pv, to: th * 0.45, peak: gn * (near ? 0.9 : 0.5) });
    if (enemy) s.tone(o, t, 0.05, { type: 'sawtooth', freq: 700, to: 500, peak: 0.05, filter: 1500 });
  }

  private footstep(surface: string, p: Pos, vol: number, kind: 'boot' | 'paw' | 'stomp' | 'servo' | 'flap' | 'ogre') {
    const s = this.s!; const t = s.now;
    const o = s.out(s.amb, { ...p, ref: 2 }, 0.12);
    if (kind === 'paw') { s.noise(o, t, 0.04, { freq: 1500, q: 1.5, peak: vol * 0.25 }); return; }
    if (kind === 'stomp') { s.tone(o, t, 0.25, { freq: 60, to: 30, peak: vol * 1.2 }); s.noise(o, t, 0.2, { type: 'lowpass', freq: 400, peak: vol * 0.8, buf: 'brown' }); s.tone(o, t + 0.05, 0.3, { type: 'sawtooth', freq: 220, to: 330, peak: vol * 0.08, filter: 900 }); return; }
    if (kind === 'ogre') { s.tone(o, t, 0.3, { freq: 55, to: 28, peak: vol * 1.3 }); s.noise(o, t, 0.22, { type: 'lowpass', freq: 350, peak: vol * 0.9, buf: 'brown' }); return; } // bare-footed stomp, no servo whine
    if (kind === 'flap') { s.noise(o, t, 0.12, { type: 'lowpass', freq: 500 + Math.random() * 200, peak: vol * 0.5, attack: 0.03, buf: 'pink' }); return; } // leathery wingbeat
    if (kind === 'servo') { s.tone(o, t, 0.25, { type: 'sawtooth', freq: 380 + Math.random() * 80, to: 520, peak: vol * 0.05, filter: 1400, q: 6 }); return; }
    const f = surface === 'carpet' ? 700 : surface === 'tile' ? 3200 : surface === 'metal' ? 2400 : surface === 'asphalt' ? 1600 : 1900;
    s.noise(o, t, surface === 'carpet' ? 0.06 : 0.045, { freq: f * (0.9 + Math.random() * 0.2), q: surface === 'carpet' ? 0.6 : 1.2, peak: vol * (surface === 'carpet' ? 0.35 : 0.45) });
    s.tone(o, t, 0.05, { freq: 90, to: 60, peak: vol * 0.25 });
    if (surface === 'metal') s.tone(o, t, 0.12, { type: 'triangle', freq: 820 + Math.random() * 120, peak: vol * 0.05 });
  }

  private bark(type: string, k: string, p: Pos, monster = false) {
    const s = this.s!; const t = s.now;
    const o = s.out(s.sfx, { ...p, ref: 4 }, 0.3);
    if (monster && type === 'drone') { // Halloween bat: shrill screeches and chitters
      if (k === 'die') { s.voice(o, t, 0.6, 2200, 500, VOWELS.i, 0.35, 0.6); return; }
      if (k === 'idle' || k === 'suspicious') { for (let i = 0; i < 4; i++) s.tone(o, t + i * 0.05, 0.025, { type: 'square', freq: 3200 + Math.random() * 800, peak: 0.05, filter: 6000 }); return; }
      for (let i = 0; i < (k === 'alert' ? 3 : 1); i++) s.voice(o, t + i * 0.14, 0.12, 1800, 2600, VOWELS.i, 0.3, 0.5);
      return;
    }
    if (monster && type === 'warden') { // Halloween ogre: roars, grunts and a long groan
      if (k === 'alert') { s.voice(o, t, 0.9, 85, 60, VOWELS.a, 0.7, 0.8); s.noise(o, t, 0.8, { type: 'lowpass', freq: 500, peak: 0.4, buf: 'brown' }); return; }
      if (k === 'die') { s.voice(o, t, 1.3, 95, 40, VOWELS.o, 0.6, 0.7); return; }
      s.voice(o, t, k === 'pain' ? 0.25 : 0.35, 75, 60, VOWELS.u, 0.5, 0.6);
      return;
    }
    const human = type === 'loyalist', cyb = type === 'cyborg';
    if (type === 'dog' || type === 'dogcyborg') {
      if (k === 'die' || k === 'pain') { s.voice(o, t, 0.35, 900, 380, VOWELS.i, 0.35); return; }
      if (k === 'suspicious' || k === 'idle') { s.voice(o, t, 0.6, 110, 90, VOWELS.u, 0.25, type === 'dogcyborg' ? 0.6 : 0.2); return; }
      for (let i = 0; i < 2; i++) { s.voice(o, t + i * 0.22, 0.12, 520, 300, VOWELS.a, 0.5, type === 'dogcyborg' ? 0.7 : 0.1); s.noise(o, t + i * 0.22, 0.08, { freq: 1200, peak: 0.2 }); }
      return;
    }
    if (type === 'drone' || type === 'warden') {
      if (k === 'die') { s.tone(o, t, 0.8, { type: 'sawtooth', freq: 600, to: 40, peak: 0.25, filter: 2000 }); s.noise(o, t, 0.5, { freq: 3000, peak: 0.4, sweepTo: 300 }); return; }
      if (k === 'alert') { for (let i = 0; i < 3; i++) s.tone(o, t + i * 0.12, 0.08, { type: 'square', freq: type === 'warden' ? 440 : 1320, peak: 0.12, filter: 3000 }); return; }
      s.tone(o, t, 0.3, { type: 'sawtooth', freq: 300, to: 600, peak: 0.08, filter: 1500, q: 5 });
      return;
    }
    const base = cyb ? 95 : 130 + Math.random() * 30;
    const grit = cyb ? 0.8 : 0;
    switch (k) {
      case 'alert': s.voice(o, t, 0.28, base * 1.6, base * 1.2, VOWELS.e, 0.55, grit); s.voice(o, t + 0.3, 0.2, base * 1.5, base * 1.1, VOWELS.a, 0.4, grit); if (cyb) s.noise(o, t, 0.5, { freq: 4000, q: 3, peak: 0.08 }); break;
      case 'suspicious': s.voice(o, t, 0.35, base, base * 1.3, VOWELS.u, 0.3, grit); break;
      case 'search': s.voice(o, t, 0.25, base * 1.2, base, VOWELS.o, 0.3, grit); break;
      case 'pain': s.voice(o, t, 0.18, base * 1.9, base * 1.3, VOWELS.a, 0.45, grit); break;
      case 'die': s.voice(o, t, 0.6, base * 1.4, base * 0.6, VOWELS.o, 0.4, grit); if (cyb) s.tone(o, t + 0.2, 0.7, { type: 'square', freq: 800, to: 60, peak: 0.07, filter: 2000 }); break;
    }
    void human;
  }

  private explosion(kind: string, p: Pos) {
    const s = this.s!; const t = s.now;
    const o = s.out(s.sfx, { ...p, ref: 10 }, 0.6);
    if (kind === 'flash') { s.noise(o, t, 0.25, { type: 'highpass', freq: 1500, peak: 1.3 }); s.tone(o, t, 0.3, { freq: 120, to: 50, peak: 0.8 }); return; }
    if (kind === 'smoke') { s.noise(o, t, 1.6, { freq: 2500, q: 0.4, peak: 0.35, attack: 0.05, sweepTo: 800 }); return; }
    if (kind === 'spark') { // shorting breaker: a pop, then electrical crackle
      s.noise(o, t, 0.12, { freq: 3000, q: 0.6, peak: 0.9 }); s.tone(o, t, 0.25, { freq: 120, to: 60, peak: 0.4 });
      for (let i = 0; i < 8; i++) s.noise(o, t + 0.05 + Math.random() * 0.5, 0.03, { type: 'highpass', freq: 4000, peak: 0.25 });
      return;
    }
    if (kind === 'fire') { s.noise(o, t, 1.2, { type: 'lowpass', freq: 1200, peak: 0.7, buf: 'pink', attack: 0.03 }); s.tone(o, t, 0.2, { freq: 200, to: 80, peak: 0.3 }); return; }
    s.noise(o, t, 1.6, { type: 'lowpass', freq: 1400, peak: 1.6, buf: 'brown', sweepTo: 200 });
    s.noise(o, t, 0.3, { freq: 1800, q: 0.5, peak: 1.0 });
    s.tone(o, t, 0.9, { freq: 70, to: 25, peak: 1.3 });
    for (let i = 0; i < 6; i++) s.noise(o, t + 0.1 + Math.random() * 0.6, 0.05, { freq: 2000 + Math.random() * 2000, peak: 0.12 });
  }

  // ------------------------------------------------------------------ stingers & music
  stinger(k: string) {
    const s = this.s; if (!s) return;
    const t = s.now, o = s.out(s.music, undefined, 0.5);
    const chord = (notes: number[], dur: number, type: OscillatorType, peak: number, filter = 2000, att = 0.05) => notes.forEach((f, i) => { s.tone(o, t, dur, { type, freq: f, peak, attack: att, filter, detune: (i % 2 ? 1 : -1) * 8 }); s.tone(o, t, dur, { type, freq: f, peak: peak * 0.6, attack: att, filter, detune: (i % 2 ? -1 : 1) * 14 }); });
    switch (k) {
      case 'alert': chord([110, 116.5, 164.8, 233], 1.6, 'sawtooth', 0.12, 1400, 0.01); s.noise(o, t, 0.8, { freq: 300, q: 0.5, peak: 0.25, buf: 'brown' }); break;
      case 'scare': chord([1244, 1318, 1396, 1480], 1.2, 'sawtooth', 0.06, 6000, 0.02); s.noise(o, t, 0.6, { type: 'highpass', freq: 3000, peak: 0.25, sweepTo: 9000 }); s.tone(o, t, 0.4, { freq: 55, to: 30, peak: 0.6 }); break;
      case 'upload': for (let i = 0; i < 8; i++) s.tone(o, t + i * 0.11, 0.2, { type: 'square', freq: [220, 277, 330, 440, 554, 660, 880, 1108][i], peak: 0.08, filter: 3000 }); chord([55, 82.4], 3, 'sawtooth', 0.12, 600, 0.4); break;
      case 'victory': chord([261.6, 329.6, 392, 523.2], 4, 'triangle', 0.12, 3000, 0.4); chord([130.8, 196], 4, 'sine', 0.2, 1000, 0.6); break;
      case 'death': chord([65.4, 77.8, 98, 116.5], 3.5, 'sawtooth', 0.12, 700, 0.1); s.tone(o, t, 2.5, { freq: 220, to: 55, peak: 0.1 }); break;
      case 'floor': [110, 164.8, 246, 277].forEach((f, i) => s.tone(o, t + i * 0.02, 2.4, { type: 'sine', freq: f * (1 + i * 0.013), peak: 0.1 })); s.tone(o, t, 2.8, { freq: 55, peak: 0.25 }); break;
      case 'wave': s.tone(o, t, 0.4, { freq: 80, to: 35, peak: 0.5 }); s.noise(o, t, 0.15, { type: 'lowpass', freq: 3000, peak: 0.3 }); break;
    }
  }

  // ------------------------------------------------------------------ events
  onEvents(events: SimEvent[], view: ViewSource, localId: number) {
    const s = this.s; if (!s) return;
    const me = view.players.find((p) => p.id === localId);
    if (!me) return;
    const floor = me.floor;
    const fs = view.floorState(floor);
    const epos = (id: number): Pos | null => { const e = fs.enemies.find((e) => e.id === id); return e ? { x: e.x, y: e.y } : null; };
    const monster = (id: number) => fs.enemies.find((e) => e.id === id)?.weapon === 'bite'; // Halloween bat / ogre (dogs too, harmlessly)
    let shots = 0;
    for (const ev of events) {
      if ('f' in ev && ev.f !== floor) continue;
      switch (ev.e) {
        case 'shot': if (shots++ < 6) this.gunshot(ev.w, { x: ev.x, y: ev.y }, ev.src === 'e', ev.id === localId); if ((ev.hit === 'metal' && currentHoliday() !== 'halloween') || ev.hit === 'wall' || ev.hit === 'floor') this.impact(ev.x2, ev.y2, ev.hit === 'metal'); break; // Halloween 'metal' is a bat or ogre
        case 'explode': this.explosion(ev.kind, { x: ev.x, y: ev.y }); break;
        case 'bark': { const p = epos(ev.id); if (p) this.bark(ev.t, ev.k, p, monster(ev.id)); break; }
        case 'die':
          if ((ev.t === 'warden' || ev.t === 'drone') && monster(ev.id)) { // ogre hits the floor / bat drops: a thud, not an explosion
            const o = s.out(s.sfx, { x: ev.x, y: ev.y, ref: ev.t === 'warden' ? 8 : 3 }, 0.3), big = ev.t === 'warden';
            s.tone(o, s.now + (big ? 0.35 : 0.5), big ? 0.7 : 0.15, { freq: big ? 50 : 140, to: big ? 22 : 70, peak: big ? 1.6 : 0.5 });
            s.noise(o, s.now + (big ? 0.35 : 0.5), big ? 0.6 : 0.12, { type: 'lowpass', freq: big ? 400 : 900, peak: big ? 1.1 : 0.3, buf: 'brown' });
          } else if (ev.t === 'warden' || ev.t === 'drone') this.explosion('small', { x: ev.x, y: ev.y });
          break;
        case 'hurt': if (ev.pid === localId) this.hurt(ev.armor); break;
        case 'reload': if (ev.pid === localId || dist(me.x, me.y, view.players.find((p) => p.id === ev.pid)?.x ?? 0, view.players.find((p) => p.id === ev.pid)?.y ?? 0) < 12) this.reload(ev.pid === localId ? null : view.players.find((p) => p.id === ev.pid)!); break;
        case 'dry': if (ev.pid === localId) { const o = s.out(s.sfx, undefined, 0); s.noise(o, s.now, 0.02, { freq: 3500, q: 3, peak: 0.3 }); } break;
        case 'melee': { const o = s.out(s.sfx, { x: ev.x, y: ev.y }, 0.1); s.noise(o, s.now, 0.15, { freq: 900, sweepTo: 4000, q: 2, peak: 0.3 }); if (ev.hit) s.noise(o, s.now + 0.05, 0.08, { type: 'lowpass', freq: 700, peak: 0.6, buf: 'brown' }); break; }
        case 'throw': { const o = s.out(s.sfx, undefined, 0); s.noise(o, s.now, 0.2, { freq: 600, sweepTo: 2000, q: 1, peak: 0.2 }); s.tone(o, s.now, 0.03, { type: 'square', freq: 2000, peak: 0.05 }); break; }
        case 'bounce': { const o = s.out(s.sfx, { x: ev.x, y: ev.y }, 0.1); s.tone(o, s.now, 0.06, { type: 'triangle', freq: 1200 + Math.random() * 300, peak: 0.12 }); break; }
        case 'vend': { const o = s.out(s.sfx, { x: ev.x, y: ev.y, ref: 5 }, 0.4); for (let i = 0; i < 14; i++) s.noise(o, s.now + Math.random() * 0.4, 0.06, { type: 'highpass', freq: 4000 + Math.random() * 3000, peak: 0.25 }); for (let i = 0; i < 6; i++) s.tone(o, s.now + Math.random() * 0.5, 0.2, { type: 'sine', freq: 3000 + Math.random() * 3000, peak: 0.05 }); s.noise(o, s.now, 0.4, { type: 'lowpass', freq: 500, peak: 0.8, buf: 'brown' }); s.tone(o, s.now + 0.3, 0.3, { type: 'triangle', freq: 400, to: 380, peak: 0.1 }); break; }
        case 'cctv': {
          const c = fs.cameras.find((c) => c.id === ev.id);
          const o = s.out(s.sfx, c ? { x: c.x, y: c.y } : undefined, 0.2);
          if (ev.k === 'alarm') for (let i = 0; i < 6; i++) s.tone(o, s.now + i * 0.25, 0.22, { type: 'square', freq: i % 2 ? 660 : 880, peak: 0.12, filter: 2500 });
          else if (ev.k === 'spot') s.tone(o, s.now, 0.12, { type: 'sine', freq: 1760, peak: 0.1 });
          else { s.noise(o, s.now, 0.3, { freq: 4000, peak: 0.4 }); s.tone(o, s.now, 0.5, { type: 'sawtooth', freq: 400, to: 40, peak: 0.1, filter: 1500 }); }
          break;
        }
        case 'stinger': this.stinger(ev.k); break;
        case 'scare': this.scare(ev.k, { x: ev.x, y: ev.y }); break;
        case 'trap': {
          const tr = fs.traps.find((t) => t.id === ev.id);
          const o = s.out(s.sfx, tr ? { x: tr.x, y: tr.y } : undefined, 0.1);
          if (ev.k === 'beep') for (let i = 0; i < 4; i++) s.tone(o, s.now + i * 0.1, 0.05, { type: 'square', freq: 2400, peak: 0.15 });
          if (ev.k === 'trigger') s.tone(o, s.now, 0.04, { type: 'square', freq: 1800, peak: 0.2 });
          if (ev.k === 'disarm') { s.tone(o, s.now, 0.08, { type: 'sine', freq: 660, peak: 0.1 }); s.tone(o, s.now + 0.1, 0.12, { type: 'sine', freq: 440, peak: 0.1 }); }
          if (ev.k === 'reveal' && tr && tr.kind !== 'tripwire') s.tone(s.out(s.sfx, undefined, 0), s.now, 0.2, { type: 'sine', freq: 1200, to: 1500, peak: 0.06 });
          break;
        }
        case 'elev': {
          const o = s.out(s.sfx, { x: ev.x, y: ev.y, ref: 6 }, 0.4);
          if (ev.k === 'ding') { s.tone(o, s.now, 1.4, { type: 'sine', freq: 1318, peak: 0.25 }); s.tone(o, s.now + 0.35, 1.6, { type: 'sine', freq: 1046, peak: 0.25 }); }
          else if (ev.k === 'dead') { s.noise(o, s.now, 0.5, { freq: 3500, q: 2, peak: 0.25 }); s.tone(o, s.now, 0.6, { type: 'sawtooth', freq: 60, peak: 0.15, filter: 400 }); }
          else s.tone(o, s.now, 0.1, { type: 'sine', freq: 880, peak: 0.1 });
          break;
        }
        case 'use': this.useSound(ev.item); break;
        case 'down': case 'out': { const o = s.out(s.sfx, undefined, 0.3); s.voice(o, s.now, 0.7, 180, 90, VOWELS.a, 0.3); break; }
        case 'revive': { const o = s.out(s.sfx, undefined, 0.2); s.tone(o, s.now, 0.4, { type: 'sine', freq: 440, to: 880, peak: 0.15 }); break; }
        case 'travel': if (ev.pid === localId) { const o = s.out(s.sfx, undefined, 0.3); s.noise(o, s.now, 0.5, { type: 'lowpass', freq: 600, peak: 0.25, buf: 'brown' }); } break;
        case 'msg': if (ev.pid === localId && ev.k === 'warn') this.ui('error'); break;
      }
    }
  }

  private impact(x: number, y: number, metal: boolean) {
    const s = this.s!;
    const o = s.out(s.sfx, { x, y, ref: 2 }, 0.1);
    if (metal) s.tone(o, s.now, 0.15, { type: 'triangle', freq: 1800 + Math.random() * 1500, peak: 0.08 });
    else s.noise(o, s.now, 0.04, { freq: 2500, peak: 0.12 });
  }

  private hurt(armor: boolean) {
    const s = this.s!; const t = s.now; const o = s.out(s.sfx, undefined, 0.1);
    s.noise(o, t, 0.1, { type: 'lowpass', freq: 500, peak: 0.6, buf: 'brown' });
    if (armor) s.tone(o, t, 0.2, { type: 'triangle', freq: 1500, to: 1300, peak: 0.12 });
    else s.voice(o, t, 0.18, 140, 110, VOWELS.u, 0.25);
  }

  private reload(other: { x: number; y: number } | null) {
    const s = this.s!; const t = s.now;
    const o = s.out(s.sfx, other ? { x: other.x, y: other.y } : undefined, 0.05);
    s.noise(o, t, 0.05, { freq: 3000, q: 4, peak: 0.3 });
    s.noise(o, t + 0.35, 0.04, { freq: 2200, q: 5, peak: 0.3 });
    s.tone(o, t + 0.6, 0.05, { type: 'square', freq: 1600, peak: 0.08, filter: 3000 });
    s.noise(o, t + 0.65, 0.05, { freq: 4000, q: 6, peak: 0.35 });
  }

  private useSound(item: string) {
    const s = this.s!; const t = s.now; const o = s.out(s.sfx, undefined, 0.05);
    if (item === 'medkit') { s.noise(o, t, 0.3, { freq: 2500, q: 0.5, peak: 0.3, sweepTo: 5000 }); s.noise(o, t + 0.35, 0.6, { type: 'highpass', freq: 6000, peak: 0.15 }); }
    else if (item === 'battery') { s.tone(o, t, 0.05, { type: 'square', freq: 1200, peak: 0.1 }); s.tone(o, t + 0.1, 0.5, { freq: 300, to: 3000, peak: 0.05 }); }
    else if (item === 'drink') { s.noise(o, t, 0.05, { freq: 2000, peak: 0.4 }); s.noise(o, t + 0.05, 0.8, { type: 'highpass', freq: 5000, peak: 0.12 }); }
    else if (item === 'food') for (let i = 0; i < 3; i++) s.noise(o, t + i * 0.18, 0.08, { freq: 1500, q: 1, peak: 0.3 });
    else if (item === 'plate') { s.noise(o, t, 0.1, { freq: 1200, peak: 0.3 }); s.tone(o, t + 0.15, 0.2, { type: 'triangle', freq: 900, peak: 0.08 }); }
    else if (item === 'loot') s.noise(o, t, 0.25, { freq: 1800, q: 0.6, peak: 0.15 });
  }

  private scare(k: string, p: Pos) {
    const s = this.s!; const t = s.now;
    const o = s.out(s.sfx, { ...p, ref: 6 }, 0.7);
    switch (k) {
      case 'lightburst': s.noise(o, t, 0.1, { type: 'highpass', freq: 3000, peak: 0.9 }); s.tone(o, t, 0.2, { freq: 150, to: 40, peak: 0.6 }); for (let i = 0; i < 8; i++) s.noise(o, t + 0.1 + Math.random() * 0.4, 0.03, { freq: 5000, peak: 0.2 }); break;
      case 'slam': s.noise(o, t, 0.4, { type: 'lowpass', freq: 900, peak: 1.2, buf: 'brown' }); s.tone(o, t, 0.3, { freq: 80, to: 40, peak: 0.8 }); break;
      case 'scream': s.voice(o, t, 1.4, 700, 450, VOWELS.a, 0.3); s.voice(o, t + 0.1, 1.2, 900, 500, VOWELS.i, 0.15); break;
      case 'whisper': for (let i = 0; i < 6; i++) s.noise(o, t + i * 0.18, 0.15, { freq: [2500, 4000, 3200, 5000, 2800, 3600][i], q: 6, peak: 0.1 }); break;
      case 'metal': s.tone(o, t, 2.5, { type: 'sawtooth', freq: 70, to: 55, peak: 0.12, filter: 600, q: 10 }); s.tone(o, t, 2, { type: 'triangle', freq: 420, to: 380, peak: 0.08 }); break;
      case 'shadow': s.noise(o, t, 0.5, { freq: 400, sweepTo: 2000, q: 0.7, peak: 0.25 }); break;
    }
  }

  /** Cosmetic street-life sounds (officer radios, pigeons, rats). */
  ambientSounds(list: { k: 'coo' | 'flutter' | 'squeak' | 'radio'; x: number; y: number }[]) {
    const s = this.s; if (!s) return;
    for (const a of list.slice(0, 4)) {
      const t = s.now;
      const o = s.out(s.amb, { x: a.x, y: a.y, ref: 2.5 }, 0.15);
      if (a.k === 'coo') { s.voice(o, t, 0.35, 260, 210, [320, 700, 2400], 0.12); s.voice(o, t + 0.4, 0.5, 250, 200, [320, 650, 2400], 0.1); }
      else if (a.k === 'flutter') { for (let i = 0; i < 10; i++) s.noise(o, t + i * 0.035 + Math.random() * 0.01, 0.03, { freq: 1500 + Math.random() * 1500, q: 1.2, peak: 0.18 }); }
      else if (a.k === 'squeak') { for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) s.tone(o, t + i * 0.09, 0.06, { type: 'sine', freq: 3800 + Math.random() * 900, to: 3200, peak: 0.05 }); }
      else { // police radio: squelch, clipped dispatcher voice, squelch
        s.noise(o, t, 0.1, { freq: 2600, q: 0.8, peak: 0.1 });
        for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) s.voice(o, t + 0.12 + i * 0.19, 0.16, 160 + Math.random() * 50, 135, [650 + Math.random() * 150, 1300, 2600], 0.1, 0.55);
        s.noise(o, t + 1.1, 0.08, { freq: 2600, q: 0.8, peak: 0.08 });
      }
    }
  }

  // ------------------------------------------------------------------ continuous
  update(view: ViewSource, localId: number, dt: number) {
    const s = this.s; if (!s) return;
    const me = view.players.find((p) => p.id === localId);
    if (!me) return;
    const fs = view.floorState(me.floor);
    const L = s.ctx.listener;
    if (L.positionX) { L.positionX.value = me.x; L.positionY.value = 6; L.positionZ.value = me.y; L.forwardX.value = -0.5; L.forwardY.value = -0.7; L.forwardZ.value = -0.5; L.upX.value = -0.5; L.upY.value = 0.7; L.upZ.value = -0.5; }
    if (me.floor !== this.lastFloor) { this.lastFloor = me.floor; this.startAmbience(fs); this.steps.clear(); }
    // footsteps from movement for everyone on this floor
    const Lay = fs.L;
    const surf = (x: number, y: number) => Lay.rooms[Lay.roomAt[idx(Math.floor(x), Math.floor(y))]]?.surface ?? 'concrete';
    for (const p of view.players) {
      if (p.floor !== me.floor || p.life !== 'alive' || p.z > 0.02) continue;
      this.stepFor(p.id, p.x, p.y, p.sprinting ? 1.25 : p.crouch ? 0.6 : 0.8, () => this.footstep(surf(p.x, p.y), p, (p.crouch ? 0.25 : p.sprinting ? 1 : 0.55) * (p.id === localId ? 0.7 : 1), 'boot'));
    }
    for (const e of fs.enemies) {
      if (e.state === 'dead') continue;
      const d = dist(e.x, e.y, me.x, me.y);
      if (d > 22) continue;
      const mon = e.weapon === 'bite'; // Halloween: drones are bats (wingbeats), wardens ogres (bare stomps)
      const kind = e.type === 'dog' || e.type === 'dogcyborg' ? 'paw' : e.type === 'warden' ? (mon ? 'ogre' : 'stomp') : e.type === 'drone' ? (mon ? 'flap' : 'servo') : 'boot';
      this.stepFor(e.id, e.x, e.y, kind === 'paw' ? 0.45 : kind === 'stomp' || kind === 'ogre' ? 1.6 : kind === 'servo' ? 2.5 : kind === 'flap' ? 1.1 : 0.85, () => this.footstep(surf(e.x, e.y), e, 0.7, kind));
    }
    // flickering light buzz follows the 3 nearest lit fixtures
    const near = Lay.lights.map((l, i) => ({ l, i, d: dist(l.x, l.y, me.x, me.y) })).filter((o) => o.d < 10 && o.l.kind === 'ceiling' && !(fs.lights[o.i]?.broken)).sort((a, b) => a.d - b.d).slice(0, 3);
    while (this.buzz.length < 3) {
      const src = s.ctx.createOscillator(); src.type = 'sawtooth'; src.frequency.value = 120;
      const bp = s.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 240; bp.Q.value = 4;
      const g = s.gain(0); const p = s.panner(0, 0, 1.5, 1.6, 20);
      src.connect(bp).connect(g).connect(p).connect(s.amb);
      src.start();
      this.buzz.push({ src, g, p, li: -1 });
    }
    this.buzz.forEach((b, k) => {
      const n = near[k];
      if (!n) { b.g.gain.value = 0; return; }
      b.p.positionX.value = n.l.x; b.p.positionZ.value = n.l.y; b.p.positionY.value = 2.5;
      const lv = lightLevel(n.l, false, view.t);
      b.g.gain.value = n.l.flicker ? (lv > 0.5 ? 0.03 : 0.005) + (lv < 0.5 && Math.random() < 0.3 ? 0.05 : 0) : 0.01;
    });
    // street / tower soundscape events and elevator muzak
    const inElevator = !!me.ride || Lay.elevators.some((e) => view.plan.elevator(me.floor, e.index).working && me.x > e.x0 - 0.2 && me.x < e.x1 + 1.2 && me.y > e.y0 - 0.2 && me.y < e.y1 + 1.2); // in a powered car (inclusive tile bounds); dead cars stay silent
    this.scape!.update(dt, me, inElevator);
    // tension bed rises when hostiles are hunting
    const hunting = fs.enemies.some((e) => e.state === 'alert');
    const searching = fs.enemies.some((e) => e.state === 'search' || e.state === 'investigate');
    if (this.tensionGain && me.floor !== 0) {
      const target = hunting ? 0.22 : searching ? 0.1 : 0.03;
      this.tensionGain.gain.value += (target - this.tensionGain.gain.value) * Math.min(1, dt * 0.8);
    }
    // heartbeat at low health
    if (me.life === 'alive' && me.hp < 35) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.55 + me.hp / 80;
        const o = s.out(s.sfx, undefined, 0);
        s.tone(o, s.now, 0.12, { freq: 55, to: 40, peak: 0.6 });
        s.tone(o, s.now + 0.18, 0.12, { freq: 50, to: 38, peak: 0.4 });
      }
    }
    // flashbang tinnitus
    if (me.flashT > 0.3 && !this.tinnitus) {
      const o = s.ctx.createOscillator(); o.frequency.value = 3800;
      this.tinnitus = s.gain(0.08); o.connect(this.tinnitus).connect(s.sfx); o.start();
      o.stop(s.now + me.flashT + 0.5);
      this.tinnitus.gain.setValueAtTime(0.08, s.now);
      this.tinnitus.gain.exponentialRampToValueAtTime(0.0001, s.now + me.flashT + 0.4);
      setTimeout(() => (this.tinnitus = null), (me.flashT + 0.6) * 1000);
    }
  }

  private stepFor(id: number, x: number, y: number, stride: number, play: () => void) {
    const st = this.steps.get(id);
    if (!st) { this.steps.set(id, { x, y, acc: 0 }); return; }
    const d = Math.hypot(x - st.x, y - st.y);
    st.x = x; st.y = y;
    if (d > 3) return; // teleport
    st.acc += d;
    if (st.acc >= stride) { st.acc = 0; play(); }
  }

  private startAmbience(fs: FloorState) {
    const s = this.s!;
    for (const n of this.ambNodes) { try { (n as any).stop?.(); n.disconnect(); } catch { /* ignore */ } }
    this.ambNodes = [];
    const dark = fs.L.darkness;
    const sc = this.scape!;
    const zone = sc.begin(fs.floor === 0 ? 'street' : fs.floor > 0 ? 'tower' : 'none');
    this.ambNodes.push(zone);
    const loop = (buf: AudioBuffer, type: BiquadFilterType, freq: number, gain: number, rate = 1, q = 1) => {
      const src = s.ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
      const f = s.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = s.gain(gain);
      src.connect(f).connect(g).connect(zone);
      src.start(0, Math.random() * buf.duration);
      this.ambNodes.push(src, g);
      return { f, g };
    };
    const lfo = (param: AudioParam, rate: number, depth: number) => this.ambNodes.push(...sc.lfo(param, rate, depth));
    sc.spooky = fs.floor === 0 && currentHoliday() === 'halloween';
    if (sc.spooky) {
      // Halloween night: no city, just cold wind, a low drone and the soundscape's howls, owls, crows and bells
      const wind = loop(sc.longNoise('pink'), 'bandpass', 420, 0.07, 0.6, 0.8);
      lfo(wind.g.gain, 0.06, 0.04); lfo(wind.f.frequency, 0.023, 220);
      const drone = loop(sc.longNoise('brown'), 'lowpass', 110, 0.16);
      lfo(drone.g.gain, 0.04, 0.05);
    } else if (fs.floor === 0) {
      // city: a real street recording; synth events (planes, trains, sirens, radios, horns) play on top
      const play = (b: AudioBuffer) => {
        const src = s.ctx.createBufferSource(); src.buffer = b; src.loop = true;
        const g = s.gain(0); g.gain.setValueAtTime(0, s.now); g.gain.linearRampToValueAtTime(streetGain(b), s.now + 1.5);
        src.connect(g).connect(zone); src.start(0, Math.random() * b.duration);
        this.ambNodes.push(src, g);
        sc.realStreet = true;
      };
      // fallback if the file is missing: soft broadband traffic wash, high-passed so there is no low hum
      const synth = () => {
        sc.realStreet = false;
        const wash = loop(sc.longNoise('pink'), 'lowpass', 1400, 0.05);
        lfo(wash.g.gain, 0.045, 0.025); lfo(wash.f.frequency, 0.017, 500);
        const hp = s.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 120;
        wash.g.disconnect(); wash.g.connect(hp).connect(zone); this.ambNodes.push(hp);
      };
      sc.realStreet = true; // assume the recording; the synth events skip murmur/cars until we know
      if (this.street) play(this.street);
      else void this.loadStreet().then((b) => { if (sc.zone !== zone) return; if (b) play(b); else synth(); });
    } else {
      const rumble = loop(sc.longNoise('brown'), 'lowpass', 180, 0.3 + dark * 0.2);
      lfo(rumble.g.gain, 0.03, 0.08);
      loop(sc.longNoise('pink'), 'bandpass', 500, 0.04, 0.7);
      if (fs.floor > 60) { const w = loop(sc.longNoise('pink'), 'bandpass', 250 + dark * 200, 0.05 + dark * 0.08, 0.3); lfo(w.f.frequency, 0.05, 90); } // wind through sealed floors
      const hum = s.ctx.createOscillator(); hum.frequency.value = 50; const hg = s.gain(0.02 * (1 - dark));
      hum.connect(hg).connect(zone); hum.start(); this.ambNodes.push(hum, hg);
    }
    // tension pad (music bus)
    const pad = s.gain(0.03);
    for (const f of [55, 58.3, 82.4]) {
      const o = s.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (fs.floor > 100 ? 0.94 : 1);
      const lp = s.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      o.connect(lp).connect(pad); o.start(); this.ambNodes.push(o);
    }
    if (fs.floor === 0) pad.gain.value = 0;
    pad.connect(s.music);
    this.ambNodes.push(pad);
    this.tensionGain = pad;
  }
}

/** Seamless loop from a recording: skip a noisy intro on long files, then equal-power cross-fade the tail into the head. */
export function loopable(b: AudioBuffer): AudioBuffer {
  const sr = b.sampleRate;
  const start = b.duration > 60 ? Math.floor(35 * sr) : 0;
  const end = b.length;
  const xf = Math.min(Math.floor(4 * sr), Math.floor((end - start) / 4));
  const len = end - start - xf;
  const out = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: len, sampleRate: sr });
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c), d = new Float32Array(len);
    for (let i = 0; i < len; i++) d[i] = src[start + i];
    for (let i = 0; i < xf; i++) { const t = (i / xf) * Math.PI / 2; d[i] = src[start + i] * Math.sin(t) + src[end - xf + i] * Math.cos(t); }
    out.copyToChannel(d, c);
  }
  return out;
}

/** Gain that brings a recording to a consistent ambience level (about -24 dBFS RMS on the amb bus). */
function streetGain(b: AudioBuffer): number {
  const d = b.getChannelData(0); let sum = 0, n = 0;
  for (let i = 0; i < d.length; i += 64) { sum += d[i] * d[i]; n++; }
  const rms = Math.sqrt(sum / Math.max(1, n));
  return Math.min(3, 0.063 / Math.max(1e-4, rms));
}
