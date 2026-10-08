import { describe, it, expect } from 'vitest';
import { BOT_CLASSES, BOT_CLASS, BOT_NAMES, BOT_RANKS, SQUAD_MEMBERS } from '../src/config/bots';
import { WEAPONS } from '../src/config/weapons';
import { STREET_CAST, CHIEF } from '../src/config/npcs';
import { makeSquad, botKit, pathCost, type SquadPick } from '../src/sim/bot';
import { validLoadout } from '../src/sim/loadout';
import { Rng } from '../src/core/rng';
import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/ui/shop';
import { findPath } from '../src/sim/nav';
import { isWalkableTile, FW, FH } from '../src/gen/floor';
import { canSee } from '../src/sim/combat';

describe('bot config', () => {
  it('has 100 unique surnames that clash with no cast or lore name', () => {
    expect(BOT_NAMES).toHaveLength(100);
    expect(new Set(BOT_NAMES).size).toBe(100);
    const taken = new Set([...STREET_CAST.map((n) => n.name), CHIEF.name, 'Ward', 'Voss']);
    expect(BOT_NAMES.filter((n) => taken.has(n))).toEqual([]);
  });
  it('has the 11 ranks and 4 squad members with portraits', () => {
    expect(BOT_RANKS).toEqual(['Major', 'Captain', 'Lieutenant', 'Warrant Officer', 'Sergeant Major', 'Sergeant', 'Corporal', 'Private', 'Marine', 'Trooper', 'Operator']);
    expect(SQUAD_MEMBERS.map((m) => m.portrait)).toEqual(['squad1.png', 'squad2.png', 'squad3.png', 'squad4.png']);
  });
  it('every class kit pool names real weapons in the right slot', () => {
    expect(BOT_CLASSES).toHaveLength(8);
    for (const c of BOT_CLASSES) {
      const d = BOT_CLASS[c];
      for (const id of d.primary) if (id) expect(WEAPONS.find((w) => w.id === id)?.slot, `${c} ${id}`).toBe('primary');
      for (const id of d.secondary) expect(WEAPONS.find((w) => w.id === id)?.slot, `${c} ${id}`).toBe('secondary');
      expect(d.range[0]).toBeLessThan(d.range[1]);
    }
  });
});

describe('bot identity and kit', () => {
  it('names and ranks are unique within the squad; members follow the slots', () => {
    for (let seed = 1; seed < 40; seed++) {
      const picks: SquadPick[] = ['medic', null, 'random', 'gunner'];
      const sq = makeSquad(seed, picks);
      expect(sq.map((b) => b.member)).toEqual([0, 2, 3]);
      expect(new Set(sq.map((b) => b.surname)).size).toBe(3);
      expect(new Set(sq.map((b) => b.rank)).size).toBe(3);
      expect(sq[0].cls).toBe('medic');
      expect(BOT_CLASSES).toContain(sq[1].cls);
    }
  });
  it("a member's name and rank don't change with the other slots' picks (the Squad screen shows them before deploy)", () => {
    for (let seed = 1; seed < 20; seed++) {
      const all = makeSquad(seed, ['random', 'random', 'random', 'random']);
      for (const picks of [['medic', null, null, null], [null, 'gunner', null, 'recon'], ['breacher', 'random', null, 'marksman']] as SquadPick[][]) {
        for (const b of makeSquad(seed, picks)) {
          const ref = all.find((r) => r.member === b.member)!;
          expect([b.rank, b.surname]).toEqual([ref.rank, ref.surname]);
        }
      }
    }
  });
  it('kits stay in the class pool and within budget on every difficulty', () => {
    for (const cls of BOT_CLASSES) for (const d of ['normal', 'hard', 'insane'] as const) for (let s = 0; s < 20; s++) {
      const lo = botKit(cls, d, new Rng(s + 1));
      expect(validLoadout(lo, d), `${cls} ${d}`).toBe(true);
      expect(BOT_CLASS[cls].primary).toContain(lo.primary);
      expect(BOT_CLASS[cls].secondary).toContain(lo.secondary);
    }
  });
  it('addBot puts a checked-in bot on the human floor with its member look and kit', () => {
    const sim = new Sim({ seed: 5, difficulty: 'normal', mode: 'single' });
    sim.addPlayer(1, 'Op', emptyLoadout());
    const [info] = makeSquad(5, ['rifleman']);
    const b = sim.addBot(info);
    expect(b.id).toBe(100);
    expect(b.bot).toEqual(info);
    expect(b.name).toBe(`${info.rank} ${info.surname}`);
    expect(b.checkedIn).toBe(true);
    expect(b.look).toEqual(SQUAD_MEMBERS[0].look);
    expect(b.weapons.primary?.id).toBe(b.loadout!.primary);
    expect(sim.human()?.id).toBe(1);
  });
});

describe('bot rules', () => {
  const squadSim = (n = 2) => {
    const sim = new Sim({ seed: 7, difficulty: 'normal', mode: 'single' });
    const me = sim.addPlayer(1, 'Op', emptyLoadout()); me.checkedIn = true;
    const bots = makeSquad(7, (['rifleman', 'medic', 'gunner', 'recon'] as SquadPick[]).slice(0, n)).map((i) => sim.addBot(i));
    return { sim, me, bots };
  };
  it('bots follow the human to every new floor and arrive near them', () => {
    const { sim, me, bots } = squadSim(3);
    sim.travel(me, 1, 'stair0', 'stairs');
    for (const b of bots) { expect(b.floor).toBe(1); expect(Math.hypot(b.x - me.x, b.y - me.y)).toBeLessThan(8); }
  });
  it('a bot never takes stairs by itself', () => {
    const { sim, me, bots } = squadSim(1);
    sim.travel(me, 1, 'stair0', 'stairs');
    const b = bots[0];
    // the bot exactly where the human arrived (the flight's landing), walking "up" the stairs for a second
    b.x = me.x; b.y = me.y; (b as any).stairCd = 0;
    me.x += 3;
    for (let i = 0; i < 60; i++) { (b as any).stairPrevY = b.y + 0.05; (b as any).stairCd = 0; sim.tick(1 / 60); }
    expect(b.floor).toBe(1);
  });
  it('with a bot alive the human goes down, not out; with nobody alive the run is lost', () => {
    const { sim, me, bots } = squadSim(1);
    sim.travel(me, 1, 'stair0', 'stairs');
    sim.playerDies(me);
    expect(me.life).toBe('down');
    sim.playerDies(bots[0]);
    expect(bots[0].life).toBe('down');
    sim.tick(1 / 60);
    expect(sim.phase).toBe('lost');
    expect(sim.lostReason).toMatch(/whole squad/);
  });
  it('the run is lost when the human bleeds out even with bots standing', () => {
    const { sim, me } = squadSim(2);
    sim.travel(me, 1, 'stair0', 'stairs');
    sim.playerDies(me);
    me.downT = 0.01;
    sim.tick(1 / 60); sim.tick(1 / 60);
    expect(me.life).toBe('out');
    expect(sim.phase).toBe('lost');
  });
  it('a bot that bleeds out is gone and does not follow any more', () => {
    const { sim, me, bots } = squadSim(2);
    sim.travel(me, 1, 'stair0', 'stairs');
    sim.playerDies(bots[0]); bots[0].downT = 0.01;
    sim.tick(1 / 60); sim.tick(1 / 60);
    expect(bots[0].life).toBe('out');
    expect(sim.phase).toBe('playing');
    sim.travel(me, 2, 'stair0', 'stairs');
    expect(bots[0].floor).toBe(1);
    expect(bots[1].floor).toBe(2);
  });
  it('solo single player keeps one life', () => {
    const sim = new Sim({ seed: 7, difficulty: 'normal', mode: 'single' });
    const me = sim.addPlayer(1, 'Op', emptyLoadout());
    sim.playerDies(me);
    expect(me.life).toBe('out');
  });
  it('save and continue restores the bots on the human floor', () => {
    const { sim, me, bots } = squadSim(2);
    sim.travel(me, 3, 'stair0', 'stairs');
    bots[1].items.medkit = 2; bots[1].life = 'down'; bots[1].downT = 30;
    const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.exportSave(me))), 1);
    const bb = back.players.filter((p) => p.bot);
    expect(bb.map((b) => b.name)).toEqual(bots.map((b) => b.name));
    expect(bb.every((b) => b.floor === 3)).toBe(true);
    expect(bb[1].life).toBe('down');
    expect(bb[1].items.medkit).toBe(2);
  });
  it('bots neither score for the human nor start the clock', () => {
    const { sim, me, bots } = squadSim(1);
    sim.travel(me, 1, 'stair0', 'stairs');
    expect(me.score.best).toBe(1);
    expect(bots[0].score.pts).toBe(0);
  });
});

describe('bot brain: movement and support', () => {
  const walkSim = (cls: SquadPick[] = ['rifleman', 'medic', 'gunner', 'recon']) => {
    const sim = new Sim({ seed: 11, difficulty: 'normal', mode: 'single' });
    const me = sim.addPlayer(1, 'Op', emptyLoadout()); me.checkedIn = true; me.cheats = { god: true };
    const bots = makeSquad(11, cls).map((i) => sim.addBot(i));
    for (const b of bots) b.cheats = { god: true };
    return { sim, me, bots };
  };
  const clear = (sim: Sim, f: number) => { for (const e of sim.floorState(f).enemies) { e.state = 'dead'; e.hp = 0; } };
  it('a squad keeps up while the human walks across floors 1-3 (never stuck)', () => {
    const { sim, me, bots } = walkSim();
    for (const f of [1, 2, 3]) {
      sim.travel(me, f, 'stair0', 'stairs');
      clear(sim, f);
      const L = sim.floorState(f).L;
      // walk to the anchor farthest from where we arrived
      const goal = Object.values(L.anchors).sort((a, c) => Math.hypot(c.x - me.x, c.y - me.y) - Math.hypot(a.x - me.x, a.y - me.y))[0];
      const path = findPath(L, me.x, me.y, goal.x, goal.y, undefined, 20000, true) ?? [];
      let far = 0;
      for (let i = 0, w = 0; i < 60 * 60 && w < path.length && me.floor === f; i++) {
        const wp = path[w];
        const a = Math.atan2(wp.y - me.y, wp.x - me.x);
        me.input.mx = Math.cos(a); me.input.my = Math.sin(a);
        if (Math.hypot(wp.x - me.x, wp.y - me.y) < 0.4) w++;
        sim.tick(1 / 60);
        if (i % 60 === 0) for (const b of bots) if (Math.hypot(b.x - me.x, b.y - me.y) > 12) far++;
      }
      me.input.mx = me.input.my = 0;
      if (me.floor !== f) sim.travel(me, f, 'stair0', 'stairs');
      for (let i = 0; i < 5 * 60; i++) sim.tick(1 / 60);
      for (const b of bots) expect(Math.hypot(b.x - me.x, b.y - me.y), `${b.name} floor ${f}`).toBeLessThan(8); // formation slots reach ~4 m, plus up to 3 m to the nearest walkable tile
      expect(far, `bot-seconds spent >12 m away on floor ${f}`).toBeLessThan(20);
    }
  });
  it('a medic with one kit revives the downed human, not the downed bot', () => {
    const { sim, me, bots } = walkSim(['medic', 'rifleman']);
    sim.travel(me, 1, 'stair0', 'stairs');
    clear(sim, 1);
    me.cheats = {}; bots[1].cheats = {};
    bots[1].items.medkit = 0;
    sim.playerDies(bots[1]); sim.playerDies(me);
    bots[0].items.medkit = 1;
    for (let i = 0; i < 10 * 60; i++) sim.tick(1 / 60);
    expect(me.life).toBe('alive');
    expect(bots[1].life).toBe('down');
  });
  it('a bot heals itself below 40 hp when it has a kit and no enemy is close', () => {
    const { sim, me, bots } = walkSim(['rifleman']);
    sim.travel(me, 1, 'stair0', 'stairs');
    clear(sim, 1);
    const b = bots[0]; b.cheats = {}; b.hp = 30; b.items.medkit = 1;
    for (let i = 0; i < 30; i++) sim.tick(1 / 60);
    expect(b.hp).toBe(100);
    expect(b.items.medkit).toBe(0);
  });
});

describe('bot brain: combat', () => {
  const duel = (cls: SquadPick) => {
    const sim = new Sim({ seed: 21, difficulty: 'normal', mode: 'single' });
    const me = sim.addPlayer(1, 'Op', emptyLoadout()); me.checkedIn = true; me.cheats = { god: true };
    const [b] = makeSquad(21, [cls]).map((i) => sim.addBot(i));
    b.cheats = { god: true };
    sim.travel(me, 1, 'stair0', 'stairs');
    const fs = sim.floorState(1);
    const keep = fs.enemies.find((e) => e.type === 'loyalist')!;
    for (const e of fs.enemies) if (e !== keep) { e.state = 'dead'; e.hp = 0; }
    // the loyalist 7-10 m from the bot, in clear sight, alerted
    // find an open stretch: a walkable tile with a clear 8-10 m line of sight; put the bot and the commander there
    let spot: { x: number; y: number } | undefined;
    for (let ty = 2; ty < FH - 2 && !spot; ty += 2) for (let tx = 2; tx < FW - 2 && !spot; tx += 2) {
      if (!isWalkableTile(fs.L, tx, ty)) continue;
      const ox = tx + 0.5, oy = ty + 0.5;
      for (let k = 0; k < 16 && !spot; k++) {
        const x = ox + Math.cos((k / 16) * Math.PI * 2) * 9, y = oy + Math.sin((k / 16) * Math.PI * 2) * 9;
        if (!isWalkableTile(fs.L, Math.floor(x), Math.floor(y)) || !canSee(fs, ox, oy, x, y)) continue;
        const sx = ox - Math.sin((k / 16) * Math.PI * 2) * 1.5, sy = oy + Math.cos((k / 16) * Math.PI * 2) * 1.5; // the commander 1.5 m to the side
        if (!isWalkableTile(fs.L, Math.floor(sx), Math.floor(sy))) continue;
        b.x = ox; b.y = oy; me.x = sx; me.y = sy; spot = { x, y };
      }
    }
    if (!spot) throw new Error('no open 9 m stretch on floor 1');
    keep.x = spot.x; keep.y = spot.y; keep.state = 'alert';
    sim.drainEvents();
    return { sim, me, b, keep, fs };
  };
  for (const cls of ['rifleman', 'gunner', 'marksman', 'medic'] as const) {
    it(`a ${cls} kills an alerted loyalist in sight`, () => {
      const { sim, keep } = duel(cls);
      for (let i = 0; i < 20 * 60 && keep.state !== 'dead'; i++) sim.tick(1 / 60);
      expect(keep.state).toBe('dead');
    });
  }
  it('holds fire while the commander stands in the line of fire', () => {
    const { sim, me, b, keep } = duel('rifleman');
    let shots = 0;
    for (let i = 0; i < 3 * 60; i++) {
      me.x = (b.x + keep.x) / 2; me.y = (b.y + keep.y) / 2; // stay between them
      sim.tick(1 / 60);
      shots += sim.drainEvents().filter((ev) => ev.e === 'shot' && (ev as any).src === 'p' && (ev as any).id === b.id).length;
    }
    expect(shots).toBe(0);
  });
  it('holds fire while nobody is alerted and the commander sneaks', () => {
    const { sim, me, b, keep } = duel('rifleman');
    me.input.crouch = true;
    let shots = 0;
    for (let i = 0; i < 2 * 60; i++) {
      keep.state = 'patrol';
      sim.tick(1 / 60);
      shots += sim.drainEvents().filter((ev) => ev.e === 'shot' && (ev as any).src === 'p' && (ev as any).id === b.id).length;
    }
    expect(shots).toBe(0);
  });
});

describe('final review fixes', () => {
  const squad = (cls: SquadPick[]) => {
    const sim = new Sim({ seed: 21, difficulty: 'normal', mode: 'single' });
    const me = sim.addPlayer(1, 'Op', emptyLoadout()); me.checkedIn = true; me.cheats = { god: true };
    const bots = makeSquad(21, cls).map((i) => sim.addBot(i));
    for (const b of bots) b.cheats = { god: true };
    sim.travel(me, 1, 'stair0', 'stairs');
    return { sim, me, bots, fs: sim.floorState(1) };
  };
  it('a breacher never flashbangs an enemy the commander is close to', () => {
    const { sim, me, bots, fs } = squad(['breacher']);
    const b = bots[0];
    const keep = fs.enemies.find((e) => e.type === 'loyalist')!;
    for (const e of fs.enemies) if (e !== keep) { e.state = 'dead'; e.hp = 0; }
    let found = false;
    for (let ty = 2; ty < FH - 2 && !found; ty += 2) for (let tx = 2; tx < FW - 2 && !found; tx += 2) {
      if (!isWalkableTile(fs.L, tx, ty) || !isWalkableTile(fs.L, tx + 8, ty) || !isWalkableTile(fs.L, tx, ty + 1)) continue;
      if (!canSee(fs, tx + 0.5, ty + 0.5, tx + 8.5, ty + 0.5) || !canSee(fs, tx + 0.5, ty + 1.5, tx + 8.5, ty + 0.5)) continue;
      b.x = tx + 0.5; b.y = ty + 0.5; me.x = tx + 0.5; me.y = ty + 1.5; keep.x = tx + 8.5; keep.y = ty + 0.5; found = true;
    }
    expect(found).toBe(true);
    b.grenades.flash = 3;
    for (let i = 0; i < 5 * 60; i++) { keep.state = 'alert'; keep.hp = 9999; me.x = b.x; me.y = b.y + 1; sim.tick(1 / 60); }
    expect(b.grenades.flash).toBe(3);
  });
  it('bot paths cost revealed armed traps, fire and tiles where a bot got stuck', () => {
    const { fs } = squad(['rifleman']);
    let t = { x: 0, y: 0 };
    for (let ty = 2; ty < FH - 2; ty++) for (let tx = 2; tx < FW - 2; tx++) if (isWalkableTile(fs.L, tx, ty)) t = { x: tx, y: ty };
    const plain = pathCost(fs, new Set());
    expect(plain(t.x, t.y)).toBe(0);
    fs.traps.push({ id: -1, kind: 'mine', x: t.x + 0.5, y: t.y + 0.5, x2: t.x + 0.5, y2: t.y + 0.5, armed: true, revealed: true, fuse: 0 });
    expect(pathCost(fs, new Set())(t.x, t.y)).toBeGreaterThan(0);
    fs.traps.pop();
    fs.zones.push({ id: -2, kind: 'fire', x: t.x + 0.5, y: t.y + 0.5, r: 2.8, t: 7, tick: 0 } as any);
    expect(pathCost(fs, new Set())(t.x, t.y)).toBeGreaterThan(0);
    fs.zones.pop();
    expect(pathCost(fs, new Set([t.y * FW + t.x]))(t.x, t.y)).toBeGreaterThan(0);
  });
  it('quitting while downed with a squad counts as the loss; otherwise it saves', () => {
    const { sim, me } = squad(['medic']);
    expect(sim.quitCountsAsLoss()).toBe(false);
    me.cheats = {};
    sim.playerDies(me);
    expect(me.life).toBe('down');
    expect(sim.quitCountsAsLoss()).toBe(true);
  });
  it('a bot stuck while the commander sneaks still jumps', () => {
    const { sim, me, bots, fs } = squad(['rifleman']);
    for (const e of fs.enemies) { e.state = 'dead'; e.hp = 0; }
    const b = bots[0];
    me.input.crouch = true;
    me.x = b.x + 5 > FW - 2 ? b.x - 5 : b.x + 5;
    const px = b.x, py = b.y;
    let jumped = false;
    for (let i = 0; i < 70; i++) { sim.tick(1 / 60); if (b.z > 0.01) jumped = true; b.x = px; b.y = py; b.vx = b.vy = 0; }
    expect(jumped).toBe(true);
  });
});
