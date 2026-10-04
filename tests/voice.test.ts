import { describe, it, expect } from 'vitest';
import { VOICE, voiceGain, voiceTargets, packVoice, unpackVoice, packFanout, VOICE_UP } from '../src/net/voice';
import { taggedPlayers } from '../src/ui/nametags';
import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/sim/loadout';

describe('proximity voice + name tags', () => {
  it('gain: full up close, smooth fade, silent at the cutoff, muffled through walls', () => {
    expect(voiceGain(0)).toBe(1);
    expect(voiceGain(VOICE.full)).toBe(1);
    expect(voiceGain(VOICE.range)).toBe(0);
    expect(voiceGain(50)).toBe(0);
    const mid = voiceGain((VOICE.full + VOICE.range) / 2);
    expect(mid).toBeCloseTo(0.5, 5);
    let prev = 1;
    for (let d = VOICE.full; d <= VOICE.range; d += 0.5) { const g = voiceGain(d); expect(g).toBeLessThanOrEqual(prev); prev = g; }
    expect(voiceGain(2, true)).toBeCloseTo(0.4, 5);
  });

  it('targets: same floor, within range, connected, listening, never the speaker', () => {
    const sim = new Sim({ seed: 3, difficulty: 'normal', mode: 'coop' });
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((n, i) => sim.addPlayer(i + 1, n, emptyLoadout()));
    a.x = 10; a.y = 10; b.x = 15; b.y = 10; c.x = 10; c.y = 10 + VOICE.range + 0.1; d.x = 11; d.y = 10;
    const all = () => true;
    expect(voiceTargets(sim.players, 1, all).sort()).toEqual([2, 4]);
    d.floor = 3;
    expect(voiceTargets(sim.players, 1, all)).toEqual([2]);
    b.connected = false;
    expect(voiceTargets(sim.players, 1, all)).toEqual([]);
    b.connected = true;
    expect(voiceTargets(sim.players, 1, (id) => id !== 2)).toEqual([]);
    b.life = 'out';
    expect(voiceTargets(sim.players, 1, all)).toEqual([]);
    expect(voiceTargets(sim.players, 99, all)).toEqual([]); // unknown speaker
  });

  it('frame packing round-trips', () => {
    const opus = new Uint8Array([1, 2, 3]);
    expect(unpackVoice(packVoice(VOICE_UP, 70000, opus))).toEqual({ speaker: 70000, opus });
    expect(unpackVoice(new Uint8Array([0x57, 0, 0, 0, 0, 1]))).toBeNull();
    const f = packFanout(5, [2, 3], opus);
    expect(f.length).toBe(6 + 8 + 3);
    expect(f[5]).toBe(2);
  });

  it('name tags: other operators on the shown floor only; none in single player', () => {
    const sim = new Sim({ seed: 3, difficulty: 'normal', mode: 'coop' });
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((n, i) => sim.addPlayer(i + 1, n, emptyLoadout()));
    c.floor = 2; d.connected = false;
    expect(taggedPlayers(sim, a.id, 0).map((p) => p.name)).toEqual(['B']);
    b.life = 'down';
    expect(taggedPlayers(sim, a.id, 0).map((p) => p.name)).toEqual(['B']);
    b.life = 'out';
    expect(taggedPlayers(sim, a.id, 0)).toEqual([]);
    const solo = new Sim({ seed: 3, difficulty: 'normal', mode: 'single' });
    solo.addPlayer(1, 'S', emptyLoadout()); solo.addPlayer(2, 'T', emptyLoadout());
    expect(taggedPlayers(solo, 1, 0)).toEqual([]);
  });
});
