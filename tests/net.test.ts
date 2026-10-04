import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { HostSession } from '../src/net/host';
import { ClientSession } from '../src/net/client';
import { emptyLoadout } from '../src/ui/shop';

const PORT = 18787;
const URL = `ws://localhost:${PORT}/ws`;
let relay: ChildProcess;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout'); await wait(10); }
}

beforeAll(async () => {
  relay = spawn('node', ['server/server.mjs', '--relay-only'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise<void>((res) => relay.stdout!.on('data', (d) => { if (String(d).includes('relay')) res(); }));
});
afterAll(() => relay?.kill());

async function squad(n: number) {
  const host = new HostSession();
  const code = await host.open(URL, 'Alpha');
  const clients: ClientSession[] = [];
  for (let i = 0; i < n; i++) { const c = new ClientSession(); await c.join(URL, code, 'C' + i); clients.push(c); }
  await until(() => host.peers.size === n && clients.every((c) => c.lobby && c.lobby.players.length === n + 1));
  return { host, clients, code };
}

/** Pump host sim + network for `sec` seconds of game time. */
async function pump(host: HostSession, clients: ClientSession[], sec: number, each?: () => void) {
  const dt = 1 / 60;
  for (let t = 0; t < sec; t += dt) {
    each?.();
    host.sim!.tick(dt);
    host.distribute(host.sim!.drainEvents());
    host.update(dt);
    for (const c of clients) c.update(dt);
    if (Math.round(t / dt) % 4 === 0) await wait(1);
  }
  await wait(40);
}

describe('multiplayer (host-authoritative over relay)', () => {
  it('lobby -> armory -> deploy with 5 players; roster, seed and colours consistent', async () => {
    const { host, clients } = await squad(4);
    host.setDifficulty('hard');
    host.goShop();
    await until(() => clients.every((c) => c.lobby?.stage === 'shop'));
    let started = 0;
    for (const c of clients) c.onStart = () => started++;
    host.setHostLoadout(emptyLoadout());
    for (const c of clients) c.ready({ ...emptyLoadout(), primary: 'sr4' });
    await until(() => started === 4 && !!host.sim);
    expect(host.sim!.players.length).toBe(5);
    for (const c of clients) {
      expect(c.view!.cfg.seed).toBe(host.seed);
      expect(c.view!.cfg.difficulty).toBe('hard');
      expect(c.view!.players.map((p) => p.id).sort()).toEqual(host.sim!.players.map((p) => p.id).sort());
    }
    // a 6th player is refused
    const extra = new ClientSession();
    await expect(extra.join(URL, host.code, 'Late')).rejects.toThrow(/full|progress/i);
    host.close(); clients.forEach((c) => c.close()); extra.close();
  });

  it('replicates enemies, deaths, loot, pings, traps and client movement', async () => {
    const { host, clients } = await squad(1);
    host.goShop();
    await until(() => clients[0].lobby?.stage === 'shop');
    host.setHostLoadout({ ...emptyLoadout(), primary: 'sr4' });
    clients[0].ready({ ...emptyLoadout(), primary: 'sr4' });
    await until(() => !!clients[0].view);
    const sim = host.sim!;
    const c = clients[0];
    await pump(host, clients, 0.5);
    const cv = c.view!;
    // the street is a safe zone: no hostiles replicated
    expect(cv.floorState(0).enemies.length).toBe(0);
    expect(sim.floorState(0).enemies.length).toBe(0);
    // client movement is reported to the host
    const me = cv.player(c.id)!;
    const hostMe = sim.player(c.id)!;
    const x0 = hostMe.x;
    await pump(host, clients, 1, () => { me.input.mx = -1; me.input.my = 0; me.input.ax = me.x - 5; me.input.ay = me.y; });
    expect(hostMe.x).toBeLessThan(x0 - 1.5);
    me.input.mx = 0;
    // both operators head into the tower where the hostiles are
    const F = 5;
    for (const p of sim.players) sim.travel(p, F, 'stair0', 'test');
    const fsH = sim.floorState(F);
    for (const e of fsH.enemies) e.state = 'sleep'; // keep the squad alive for the checks
    await pump(host, clients, 0.5);
    const fsC = cv.floorState(F);
    expect(fsH.enemies.length).toBeGreaterThan(0);
    expect(fsC.enemies.map((e) => e.id).sort()).toEqual(fsH.enemies.map((e) => e.id).sort());
    for (const e of fsH.enemies) {
      const ce = fsC.enemies.find((x) => x.id === e.id)!;
      expect(Math.hypot(ce.x - e.x, ce.y - e.y)).toBeLessThan(1.5);
    }
    // host kills an enemy -> death + lootable body replicate
    const e = fsH.enemies[0];
    sim.ai.setState(e, 'idle');
    const { damageEnemy } = await import('../src/sim/combat');
    damageEnemy(sim, fsH, e, 9999, 1, sim.players[0], 'bullet');
    await pump(host, clients, 0.7);
    expect(fsC.enemies.find((x) => x.id === e.id)!.state).toBe('dead');
    expect(fsC.containers.some((x) => x.id === e.id && x.kind === 'corpse')).toBe(true);
    // pings (red enemy markers) replicate
    const alive = fsH.enemies.find((x) => x.state !== 'dead')!;
    fsH.pings.push({ id: 424242, enemyId: alive.id, x: alive.x, y: alive.y, by: 1, t: 10 });
    await pump(host, clients, 0.2);
    expect(fsC.pings.some((p) => p.enemyId === alive.id)).toBe(true);
    // discovered hazards replicate
    fsH.traps.push({ id: 9191, kind: 'mine', x: 5, y: 30, x2: 0, y2: 0, armed: true, revealed: true, fuse: 0 });
    fsC.traps.push({ id: 9191, kind: 'mine', x: 5, y: 30, x2: 0, y2: 0, armed: true, revealed: false, fuse: 0 });
    await pump(host, clients, 0.2);
    expect(fsC.traps.find((t) => t.id === 9191)!.revealed).toBe(true);
    // client input (torch toggle press) is applied by the host
    me.input.torch++;
    await pump(host, clients, 0.3);
    expect(hostMe.torchOn).toBe(true);
    expect(me.torchOn).toBe(true);
    host.close(); c.close();
  });

  it('client teleports with host travel; floors can differ between players', async () => {
    const { host, clients } = await squad(1);
    host.goShop();
    await until(() => clients[0].lobby?.stage === 'shop');
    host.setHostLoadout(emptyLoadout());
    clients[0].ready(emptyLoadout());
    await until(() => !!clients[0].view);
    const sim = host.sim!;
    const cid = clients[0].id;
    sim.travel(sim.player(cid)!, 7, 'stair1', 'test');
    await pump(host, clients, 0.4);
    const me = clients[0].view!.player(cid)!;
    expect(me.floor).toBe(7);
    expect(Math.hypot(me.x - sim.player(cid)!.x, me.y - sim.player(cid)!.y)).toBeLessThan(0.5);
    // host still on the street; client sees host's floor indicator
    expect(clients[0].view!.player(1)!.floor).toBe(0);
    host.close(); clients[0].close();
  });

  it('disconnect marks player offline; same-name rejoin restores the operator; host leaving aborts clients', async () => {
    const { host, clients, code } = await squad(1);
    host.goShop();
    await until(() => clients[0].lobby?.stage === 'shop');
    host.setHostLoadout(emptyLoadout());
    clients[0].ready(emptyLoadout());
    await until(() => !!clients[0].view);
    const sim = host.sim!;
    const oldId = clients[0].id;
    sim.player(oldId)!.items.medkit = 3;
    clients[0].close();
    await until(() => sim.players.find((p) => p.name === 'C0')!.connected === false);
    const again = new ClientSession();
    let started = false;
    again.onStart = () => (started = true);
    await again.join(URL, code, 'C0');
    await until(() => started);
    const p = sim.players.find((p) => p.name === 'C0')!;
    expect(p.connected).toBe(true);
    expect(p.id).toBe(again.id);
    expect(p.items.medkit).toBe(3);
    await pump(host, [again], 0.3);
    expect(again.view!.player(again.id)!.items.medkit).toBe(3);
    let aborted = '';
    again.onDisconnect = (r) => (aborted = r);
    host.close();
    await until(() => aborted !== '');
    expect(aborted).toMatch(/host|lost/i);
    again.close();
  });

  it('snapshot bandwidth stays reasonable', async () => {
    const { host, clients } = await squad(1);
    host.goShop();
    await until(() => clients[0].lobby?.stage === 'shop');
    host.setHostLoadout(emptyLoadout());
    clients[0].ready(emptyLoadout());
    await until(() => !!clients[0].view);
    host.sim!.travel(host.sim!.player(clients[0].id)!, 160, 'stair0', 't');
    const b0 = clients[0].t.bytesIn;
    await pump(host, clients, 2);
    const perSec = (clients[0].t.bytesIn - b0) / 2;
    console.log('client downstream bytes/s', Math.round(perSec));
    expect(perSec).toBeLessThan(90000);
    host.close(); clients[0].close();
  });
});
