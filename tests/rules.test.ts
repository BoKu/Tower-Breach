import { describe, it, expect } from 'vitest';
import { setup } from './helpers';
import { explode } from '../src/sim/combat';

function fire(sim: any, p: any, x: number, y: number, z = 1.1) {
  p.input.ax = x; p.input.ay = y; p.input.az = z; p.input.aim = true;
  sim.tick(1 / 60);
  p.bloom = 0; p.fireCd = 0; sim.drainEvents();
  p.input.fire = true; sim.tick(1 / 60); p.input.fire = false; sim.tick(1 / 60);
  return sim.drainEvents();
}

describe('street is a no-fire zone', () => {
  it('guns, knife and grenades do nothing on floor 0, and say why', () => {
    const { sim, p } = setup('single', 1, 0);
    const mag = p.weapons.primary!.mag, frags = p.grenades.frag;
    const ev = fire(sim, p, p.x + 5, p.y);
    expect(ev.some((e: any) => e.e === 'shot')).toBe(false);
    expect(p.weapons.primary!.mag).toBe(mag);
    expect(ev.some((e: any) => e.e === 'msg' && /Weapons safe/.test(e.text))).toBe(true);
    p.input.grenade++; p.input.melee++; sim.tick(1 / 60);
    expect(p.grenades.frag).toBe(frags);
    expect(sim.floorState(0).grenades.length).toBe(0);
  });
  it('the same gun fires normally inside the tower', () => {
    const { sim, p } = setup('single', 1, 5);
    const mag = p.weapons.primary!.mag;
    expect(fire(sim, p, p.x + 5, p.y).some((e: any) => e.e === 'shot')).toBe(true);
    expect(p.weapons.primary!.mag).toBe(mag - 1);
  });
});

describe('friendly fire (co-op host option)', () => {
  for (const ff of [false, true]) {
    it(`friendly fire ${ff ? 'on' : 'off'}: teammate in the line of fire and in a blast`, () => {
      const { sim, ps } = setup('coop', 2, 5);
      (sim.cfg as any).friendlyFire = ff;
      const [a, b] = ps;
      a.x = 10; a.y = 10; b.x = 13; b.y = 10;
      const hp = b.hp + b.armor;
      fire(sim, a, b.x, b.y, 1.1);
      expect(b.hp + b.armor < hp, 'bullet').toBe(ff);
      const hp2 = b.hp + b.armor;
      explode(sim, sim.floorState(5), b.x + 0.5, b.y, 4, 60, 'frag', a);
      expect(b.hp + b.armor < hp2, 'grenade').toBe(ff);
    });
  }
  it('your own grenade still hurts you with friendly fire off', () => {
    const { sim, p } = setup('coop', 2, 5);
    const hp = p.hp + p.armor;
    explode(sim, sim.floorState(5), p.x + 0.5, p.y, 4, 60, 'frag', p);
    expect(p.hp + p.armor).toBeLessThan(hp);
  });
});

describe('the street stays safe even with friendly fire on', () => {
  it('no player can hurt a teammate on floor 0, in single player or co-op', () => {
    for (const mode of ['single', 'coop'] as const) {
      const { sim, ps } = setup(mode, 2, 0);
      (sim.cfg as any).friendlyFire = true;
      const [a, b] = ps;
      a.x = 10; a.y = 10; b.x = 13; b.y = 10;
      const hp = b.hp + b.armor;
      const ev = fire(sim, a, b.x, b.y, 1.1);
      expect(ev.some((e: any) => e.e === 'shot')).toBe(false);
      explode(sim, sim.floorState(0), b.x + 0.5, b.y, 4, 60, 'frag', a); // even a blast from someone else
      expect(b.hp + b.armor).toBe(hp);
    }
  });
});

import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/ui/shop';
import { officerPose } from '../src/gen/floor';
import { equipLoadout } from '../src/sim/player';
import { addRecord, loadRecords } from '../src/save/settings';

describe('check in with Police Chief Hollis before the tower', () => {
  it('single player: the door is shut until check-in; Command opens the check-in panel; the armory re-kits you', () => {
    const sim = new Sim({ seed: 3, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'Op', emptyLoadout());
    expect(p.checkedIn).toBe(false);
    const L = sim.floorState(0).L;
    const door = L.portals.find((q) => q.target === 1)!;
    p.x = door.x; p.y = door.y + 0.8; sim.tick(1 / 60);
    expect(p.prompt).toMatch(/check in with Police Chief Hollis/i);
    p.input.interact = true; sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60);
    expect(p.floor).toBe(0);
    // Command at the tent laptop
    const cmd = L.ambient.find((a: any) => a.kind === 'officer' && a.npc < 0) as any;
    const at = officerPose(cmd, sim.t);
    p.x = at.x; p.y = at.y + 1.1; sim.tick(1 / 60);
    expect(p.prompt).toMatch(/Check in with Police Chief Hollis/);
    p.input.interact = true; sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60);
    expect((p as any).panel).toEqual({ kind: 'checkin' });
    // the UI registers the name and the armory confirms a loadout
    p.checkedIn = true; p.name = 'Ghost';
    equipLoadout(p, { ...emptyLoadout(), primary: 'dmr20', armor: 'vesthelm', items: { medkit: 2 } });
    p.input.closeSeq++; sim.tick(1 / 60);
    expect((p as any).panel).toBeNull();
    expect(p.weapons.primary?.id).toBe('dmr20');
    expect(p.armor).toBe(100); expect(p.helmet).toBe(true); expect(p.items.medkit).toBe(2);
    expect(p.loadout?.primary).toBe('dmr20');
    // now the door works
    p.x = door.x; p.y = door.y + 0.8; sim.tick(1 / 60);
    p.input.interact = true; sim.tick(1 / 60); p.input.interact = false; sim.tick(1 / 60);
    expect(p.floor).toBe(1);
    // check-in survives save/continue
    const s = sim.exportSave(p);
    const back = Sim.fromSave(s, 1).players[0];
    expect(back.checkedIn).toBe(true);
    expect(back.name).toBe('Ghost');
  });
  it('co-op squads are checked in by the lobby', () => {
    const sim = new Sim({ seed: 3, difficulty: 'normal', mode: 'coop' });
    expect(sim.addPlayer(1, 'A', emptyLoadout()).checkedIn).toBe(true);
  });
  it('Hall of Records ranks wins, then floor, kills, time', () => {
    const base = { difficulty: 'hard' as const, date: new Date(0).toISOString() };
    addRecord({ ...base, name: 'A', floor: 40, kills: 10, time: 900, won: false });
    const r = addRecord({ ...base, name: 'B', floor: 200, kills: 90, time: 5000, won: true });
    expect(r).toBe(1);
    const hard = loadRecords().filter((x) => x.difficulty === 'hard');
    expect(hard[0].name).toBe('B');
  });
});

describe('armory re-kit keeps street loot', () => {
  it('ammo, items and grenades picked up after the last kit survive a loadout change', () => {
    const sim = new Sim({ seed: 3, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'Op', emptyLoadout());
    equipLoadout(p, { ...emptyLoadout(), primary: 'sr4' });
    expect(p.ammo.pistol).toBe(48); expect(p.ammo.rifle).toBe(90);
    p.ammo.pistol += 24; p.items.battery += 1; // the tent supply crate
    equipLoadout(p, { ...emptyLoadout(), primary: 'sr4', secondary: 'm18', mods: { bypass: false, torchmod: false, pouch: true } });
    expect(p.weapons.secondary?.id).toBe('m18');
    expect(p.ammo.pistol).toBe(60 + 30 + 24); // M-18 reserve + pouch load (2 mags) + looted rounds
    expect(p.ammo.rifle).toBe(90 + 60);       // SR-4 reserve + pouch load
    expect(p.items.battery).toBe(1);
    // a re-kit with no changes and no loot is a no-op
    const before = JSON.stringify([p.ammo, p.items, p.grenades]);
    equipLoadout(p, p.loadout!);
    expect(JSON.stringify([p.ammo, p.items, p.grenades])).toBe(before);
  });
});

describe('a new single-player game starts from scratch', () => {
  it('fresh sim: issued sidearm only, no armour, items, grenades or mods; not checked in', () => {
    const sim = new Sim({ seed: 9, difficulty: 'normal', mode: 'single' });
    const p = sim.addPlayer(1, 'Operator', emptyLoadout());
    expect(p.weapons.primary).toBeNull();
    expect(p.weapons.secondary?.id).toBe('p9');
    expect(p.armor).toBe(0);
    expect(Object.values(p.items).every((n) => n === 0)).toBe(true);
    expect(Object.values(p.grenades).every((n) => n === 0)).toBe(true);
    expect(p.mods).toEqual({ bypass: false, torchmod: false, pouch: false });
    expect(p.checkedIn).toBe(false);
  });
});
