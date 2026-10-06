import { it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { ClientView } from '../src/net/client';
import { encodeSnapshot } from '../src/net/protocol';
import { emptyLoadout } from '../src/ui/shop';

// Remote players must glide: snapshots arrive at ~15 Hz with jitter, the screen runs at 60 fps.
it('remote players move smoothly between irregular snapshots (no stop-start, no jumps)', () => {
  const sim = new Sim({ seed: 7, difficulty: 'normal', mode: 'coop' });
  sim.addPlayer(1, 'Me', emptyLoadout());
  const them = sim.addPlayer(2, 'Them', emptyLoadout());
  const v = new ClientView(7, 'normal', [{ id: 1, name: 'Me', slot: 0 }, { id: 2, name: 'Them', slot: 1 }]);
  const x0 = them.x, SPEED = 3.3, FRAME = 1 / 60;
  const gaps = [0.05, 0.09, 0.06, 0.1, 0.04, 0.07, 0.08, 0.05, 0.09, 0.06];
  let t = 0, nextSnap = 0, gi = 0;
  const shown: number[] = [];
  for (let f = 0; f < 240; f++) {
    t += FRAME;
    if (t >= nextSnap) {
      sim.t = t; them.x = x0 + SPEED * t; // the remote walks east at a steady speed
      v.apply(JSON.parse(JSON.stringify(encodeSnapshot(sim, 1, [], false))), 1);
      nextSnap = t + gaps[gi++ % gaps.length];
    }
    v.smooth(FRAME, 1);
    shown.push(v.player(2)!.x);
  }
  const want = SPEED * FRAME;
  for (let i = 61; i < shown.length; i++) {
    const s = shown[i] - shown[i - 1];
    expect(s, `frame ${i}`).toBeGreaterThan(want * 0.5);
    expect(s, `frame ${i}`).toBeLessThan(want * 1.5);
  }
});
