import { describe, it, expect } from 'vitest';
import { policeStrobe, lightLevel } from '../src/sim/lights';
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, clearFloorCache, isWalkableTile } from '../src/gen/floor';

describe('police light bars', () => {
  it('red and blue sides never light together, each double-flashes once per cycle', () => {
    let both = 0, redOn = 0, blueOn = 0, redEdges = 0, prev = false;
    const dt = 0.002;
    for (let t = 0; t < 1 / 1.4; t += dt) {
      const r = policeStrobe(t, 0.3, true) > 0.5, b = policeStrobe(t, 0.3, false) > 0.5;
      if (r && b) both++;
      if (r) redOn++;
      if (b) blueOn++;
      if (r && !prev) redEdges++;
      prev = r;
    }
    expect(both).toBe(0);
    expect(redOn).toBeGreaterThan(0);
    expect(Math.abs(redOn - blueOn)).toBeLessThan(5);
    expect(redEdges).toBe(2); // double flash
  });
  it('vehicles are out of phase with each other; the bar halves share a phase', () => {
    clearFloorCache();
    const L = generateFloor(new BuildingPlan(77, 'normal'), 0);
    const bars = L.lights.filter((l) => l.kind === 'police');
    expect(bars.length).toBeGreaterThanOrEqual(8);
    const phases = new Set(bars.map((l) => l.phase));
    expect(phases.size).toBe(bars.length / 2);
    for (let i = 0; i < bars.length; i += 2) {
      expect(bars[i].phase).toBe(bars[i + 1].phase);
      expect(bars[i].z).toBeGreaterThan(1);
      // red and blue lenses are side by side across the roof (0.6 m apart)
      expect(Math.hypot(bars[i].x - bars[i + 1].x, bars[i].y - bars[i + 1].y)).toBeCloseTo(0.6, 5);
    }
    // lightLevel uses the pattern
    expect(lightLevel(bars[0], false, 0) === lightLevel(bars[1], false, 0) && lightLevel(bars[0], false, 0) > 0.5).toBe(false);
  });
});

describe('street life', () => {
  it('police officers, pigeons and rats are placed on walkable ground; none inside the tower', () => {
    for (const seed of [1, 2, 3, 99, 4242]) {
      clearFloorCache();
      const plan = new BuildingPlan(seed, 'normal');
      const L = generateFloor(plan, 0);
      const officers = L.ambient.filter((a) => a.kind === 'officer');
      expect(officers.length).toBeGreaterThanOrEqual(12);
      // more officers out front by the tower (plaza, y < 18)
      expect(officers.filter((o) => o.y < 18).length).toBeGreaterThanOrEqual(6);
      // a 4-operator huddle of stand-in squad-mates, one per team colour slot
      const squad = L.ambient.filter((a) => a.kind === 'squad') as any[];
      expect(squad.map((q) => q.slot).sort()).toEqual([0, 1, 2, 3]);
      expect(L.ambient.some((a) => a.kind === 'pigeons')).toBe(true);
      expect(L.ambient.some((a) => a.kind === 'rat')).toBe(true);
      for (const a of L.ambient) {
        expect(isWalkableTile(L, Math.floor(a.x), Math.floor(a.y)), `${a.kind} seed ${seed}`).toBe(true);
        if (a.kind === 'officer' || a.kind === 'rat') expect(isWalkableTile(L, Math.floor(a.x2), Math.floor(a.y2))).toBe(true);
      }
      expect(generateFloor(plan, 1).ambient.length).toBe(0);
      // still a safe zone
      expect(L.spawns.length).toBe(0);
    }
  });
});

import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/ui/shop';
import { officerPose } from '../src/gen/floor';
import { STREET_CAST } from '../src/config/npcs';

describe('street officers you can talk to', () => {
  it('every officer but the command-tent one has a unique story character; talk opens and closes a panel', () => {
    const sim = new Sim({ seed: 2, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'Op', emptyLoadout());
    const L = sim.floorState(0).L;
    const officers = L.ambient.filter((a) => a.kind === 'officer') as any[];
    const tent = officers.filter((o) => o.npc < 0);
    expect(tent.length).toBe(1);
    expect(tent[0].mode).toBe('brief');
    const cast = officers.filter((o) => o.npc >= 0).map((o) => o.npc);
    expect(new Set(cast).size).toBe(cast.length);
    expect(cast.length).toBeLessThanOrEqual(STREET_CAST.length); // nobody repeats
    // walk up to a stationary officer and talk
    const o = officers.find((o) => o.npc >= 0 && o.mode === 'guard');
    const at = officerPose(o, sim.t);
    p.x = at.x; p.y = at.y + 1.1;
    sim.tick(1 / 60);
    expect(p.prompt).toMatch(new RegExp(`Talk to .*${STREET_CAST[o.npc].name}`));
    p.input.interact = true; sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60);
    expect((p as any).panel).toEqual({ kind: 'talk', npc: o.npc });
    p.input.closeSeq++; sim.tick(1 / 60);
    expect((p as any).panel).toBeNull();
    // the tent officer has no talk prompt
    const tp = officerPose(tent[0], sim.t);
    p.x = tp.x; p.y = tp.y + 1.1; sim.tick(1 / 60);
    expect(p.prompt).not.toMatch(/Talk to/);
  });
});

describe('patrolling officers pause while you talk to them', () => {
  it('position freezes during the conversation and the patrol resumes from the same spot', () => {
    const sim = new Sim({ seed: 2, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'Op', emptyLoadout());
    const fs = sim.floorState(0);
    const o = fs.L.ambient.find((a: any) => a.kind === 'officer' && a.mode === 'patrol' && a.npc >= 0) as any;
    const pose = () => officerPose(o, sim.t - (fs.npcHold[o.npc] ?? 0));
    // wait until the officer is mid-walk, then walk up and talk
    for (let i = 0; i < 600 && !pose().moving; i++) sim.tick(1 / 60);
    const a0 = pose();
    p.x = a0.x; p.y = a0.y + 1.0; sim.tick(1 / 60);
    p.input.interact = true; sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60);
    expect((p as any).panel?.kind).toBe('talk');
    const held = pose();
    for (let i = 0; i < 180; i++) sim.tick(1 / 60); // 3 s of chat
    expect(Math.hypot(pose().x - held.x, pose().y - held.y)).toBeLessThan(1e-6);
    expect(fs.npcTalk).toContain(o.npc);
    p.input.closeSeq++; sim.tick(1 / 60);
    expect(fs.npcTalk).not.toContain(o.npc);
    for (let i = 0; i < 60; i++) sim.tick(1 / 60);
    const moved = Math.hypot(pose().x - held.x, pose().y - held.y);
    expect(moved).toBeGreaterThan(0.5); // walking again
    expect(moved).toBeLessThan(1.6);   // from where it stopped (1.25 m/s), not teleported
  });
});

describe('Chief Hollis stands up to talk', () => {
  it('the check-in counts as a conversation with npc -1 (upright talk pose, faces you)', () => {
    const sim = new Sim({ seed: 2, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'Op', emptyLoadout());
    const fs = sim.floorState(0);
    const chief = fs.L.ambient.find((a: any) => a.kind === 'officer' && a.npc < 0) as any;
    const at = officerPose(chief, sim.t);
    p.x = at.x; p.y = at.y + 1.1; sim.tick(1 / 60);
    expect(fs.npcTalk).not.toContain(-1);
    p.input.interact = true; sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60);
    expect((p as any).panel?.kind).toBe('checkin');
    expect(fs.npcTalk).toContain(-1);
    p.input.closeSeq++; sim.tick(1 / 60); sim.tick(1 / 60);
    expect(fs.npcTalk).not.toContain(-1);
  });
});
