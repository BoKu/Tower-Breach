import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startDedicated, diskAssets, parseConfig, DEFAULTS, RunningServer } from '../src/server/dedicated';
import { ClientSession } from '../src/net/client';
import { normalizeServerAddress } from '../src/net/transport';
import { NET_VERSION } from '../src/net/protocol';
import { emptyLoadout } from '../src/sim/loadout';
import { VOICE } from '../src/net/voice';

let srv: RunningServer;
let URL = '';
const logs: string[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000) {
  const t = Date.now();
  while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout'); await wait(10); }
}
/** Run the clients' prediction + input upload in real time (the server ticks on its own clock). */
async function play(clients: ClientSession[], sec: number, each?: () => void) {
  const end = Date.now() + sec * 1000;
  while (Date.now() < end) { each?.(); for (const c of clients) c.update(1 / 60); await wait(16); }
}
/** A raw scripted client: sends `msgs` after connecting and resolves with the first reply + whether it closed. */
function raw(msgs: (object | string)[]): Promise<{ reply: any; closed: boolean }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    let reply: any = null;
    ws.on('open', () => { for (const m of msgs) ws.send(typeof m === 'string' || m instanceof Uint8Array ? m : JSON.stringify(m)); });
    ws.on('message', (d) => { reply ??= JSON.parse(String(d)); });
    ws.on('close', () => resolve({ reply, closed: true }));
    ws.on('error', () => {});
  });
}

beforeAll(async () => {
  srv = await startDedicated({ ...DEFAULTS, port: 0, password: 'sesame', readyTimeout: 0, name: 'Test server', motd: 'hello' }, diskAssets('dist'), (s) => logs.push(s));
  URL = `ws://localhost:${srv.port}/ws`;
});
afterAll(() => srv?.close());

describe('dedicated server', () => {
  it('normalises typed addresses and parses config', () => {
    expect(normalizeServerAddress('1.2.3.4')).toBe('ws://1.2.3.4:8787/ws');
    expect(normalizeServerAddress(' myhost:9000 ')).toBe('ws://myhost:9000/ws');
    expect(normalizeServerAddress('ws://h:1/ws')).toBe('ws://h:1/ws');
    expect(normalizeServerAddress('https://play.example.org')).toBe('wss://play.example.org/ws');
    expect(normalizeServerAddress('[::1]')).toBe('ws://[::1]:8787/ws');
    const c = parseConfig(['--port', '9001', '--friendly-fire', '-d', 'hard'], { TB_PASSWORD: 'x', TB_MAX_PLAYERS: '3' })!;
    expect(c).toMatchObject({ port: 9001, friendlyFire: true, difficulty: 'hard', password: 'x', maxPlayers: 3 });
    expect(() => parseConfig(['--max-players', '9'])).toThrow(/max-players/);
    expect(() => parseConfig(['--bogus'])).toThrow();
    // `npm run server --holiday xmas` (no "--"): npm keeps the flags for itself (npm_config_*), the server must still get them
    const npm = { npm_lifecycle_event: 'server' };
    expect(parseConfig([], { ...npm, npm_config_holiday: 'xmas', npm_config_password: 'abc', npm_config_friendly_fire: 'true', npm_config_max_players: '3' }))
      .toMatchObject({ holiday: 'xmas', password: 'abc', friendlyFire: true, maxPlayers: 3 });
    expect(parseConfig(['xmas'], { ...npm, npm_config_holiday: 'true' })).toMatchObject({ holiday: 'xmas' }); // value split off by npm
    // with "--" the flags arrive as normal, values and all
    expect(parseConfig(['--port', '9002', '--name', 'Tunnel test', '--tunnel'], npm)).toMatchObject({ port: 9002, name: 'Tunnel test', tunnel: true });
    expect(() => parseConfig(['xmas', '9000'], { ...npm, npm_config_holiday: 'true', npm_config_port: 'true' })).toThrow(/npm run server -- --/);
  });

  it('serves the web build and a server-info endpoint, never files outside it', async () => {
    const base = `http://localhost:${srv.port}`;
    const info = await (await fetch(`${base}/server-info`)).json();
    expect(info).toMatchObject({ dedicated: true, name: 'Test server', password: true, version: NET_VERSION });
    expect((await fetch(`${base}/%2e%2e/package.json`)).status).toBe(404);
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
  });

  it('serves https + wss with --tls-cert/--tls-key (browser voice needs a secure page)', async () => {
    const { execFileSync } = await import('node:child_process');
    const os = await import('node:os'), path = await import('node:path'), https = await import('node:https');
    const dir = (await import('node:fs')).mkdtempSync(path.join(os.tmpdir(), 'tb-tls-'));
    const cert = path.join(dir, 'c.pem'), key = path.join(dir, 'k.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const s2 = await startDedicated({ ...DEFAULTS, port: 0, tlsCert: cert, tlsKey: key }, diskAssets('dist'), () => {});
    try {
      const info = await new Promise<any>((res, rej) => https.get({ host: 'localhost', port: s2.port, path: '/server-info', rejectUnauthorized: false }, (r) => {
        let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res(JSON.parse(b)));
      }).on('error', rej));
      expect(info.dedicated).toBe(true);
      const ws = new WebSocket(`wss://localhost:${s2.port}/ws`, { rejectUnauthorized: false });
      await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
      ws.close();
    } finally { await s2.close(); }
    expect(() => parseConfig(['--tls-cert', cert])).toThrow(/together/);
  });

  it('refuses bad versions, passwords, oversized and unknown messages', async () => {
    expect((await raw([{ t: 'join', name: 'Old', code: '' }])).reply.msg).toMatch(/version mismatch/i);
    expect((await raw([{ t: 'join', name: 'X', v: NET_VERSION }])).reply.msg).toMatch(/needs a password/i);
    expect((await raw([{ t: 'join', name: 'X', v: NET_VERSION, pw: 'nope' }])).reply.msg).toMatch(/wrong server password/i);
    expect((await raw([{ t: 'host', name: 'X' }])).reply.msg).toMatch(/dedicated server/i);
    expect((await raw([{ t: 'whatever' }])).reply.msg).toMatch(/unexpected/i);
    expect((await raw(['not json'])).closed).toBe(true);
    expect((await raw(['x'.repeat(64 * 1024)])).closed).toBe(true); // over maxPayload
    expect(srv.squad.sockets.size).toBe(0);
  });

  it('lobby -> ready -> deploy with 2 clients; inputs move players; a leaver does not end the run; rejoin by callsign', async () => {
    const a = new ClientSession(), b = new ClientSession();
    await expect(new ClientSession().join(URL, '', 'A', 'bad')).rejects.toThrow(/password/i);
    await a.join(URL, '', 'Alpha', 'sesame');
    await b.join(URL, '', 'Bravo', 'sesame');
    expect(a.server).toEqual({ name: 'Test server', motd: 'hello' });
    // no host operator: both go straight into the squad armory
    await until(() => [a, b].every((c) => c.lobby?.stage === 'shop' && c.lobby.players.length === 2));
    expect(a.lobby!.players.every((p) => !p.host)).toBe(true);
    // a second "Alpha" is refused while the first is connected
    await expect(new ClientSession().join(URL, '', 'Alpha', 'sesame')).rejects.toThrow(/already/i);
    let started = 0;
    a.onStart = b.onStart = () => started++;
    a.ready({ ...emptyLoadout(), primary: 'sr4' });
    await wait(100);
    expect(started).toBe(0); // waits for everyone
    b.ready({ ...emptyLoadout(), primary: 'sr4', grenades: { frag: 99 } as any, items: { bogus: 1 } as any }, { skin: 1, h: 400, s: 5, l: 0.3, camo: 'tiger', contrast: 0.5 } as any); // over the limits: clamped/sanitised
    await until(() => started === 2);
    const sim = srv.squad.sim!;
    expect(sim.players.map((p) => p.name).sort()).toEqual(['Alpha', 'Bravo']);
    expect(a.view!.cfg.seed).toBe(srv.squad.seed);
    // appearance: cleaned by the dedicated server and replicated to the other client
    const lk = sim.players.find((p) => p.name === 'Bravo')!.look!;
    expect(lk).toMatchObject({ skin: 1, h: 359, s: 0.8, camo: 'tiger' });

    // inputs reach the server and snapshots flow back
    await play([a, b], 0.3);
    // clients take their spawn points from the server (they don't drag everyone onto one spot)
    expect(Math.hypot(sim.players[0].x - sim.players[1].x, sim.players[0].y - sim.players[1].y)).toBeGreaterThan(0.3);
    const me = a.view!.player(a.id)!;
    const srvMe = sim.player(a.id)!;
    const x0 = srvMe.x, bytes0 = b.t.bytesIn;
    await play([a, b], 1, () => { me.input.mx = -1; me.input.my = 0; me.input.ax = me.x - 5; me.input.ay = me.y; });
    me.input.mx = 0;
    expect(srvMe.x).toBeLessThan(x0 - 1.5);
    expect(b.t.bytesIn - bytes0).toBeGreaterThan(5000);
    expect(Math.abs(b.view!.player(a.id)!.x - srvMe.x)).toBeLessThan(1);
    expect(a.view!.player(b.id)!.look).toMatchObject({ skin: 1, h: 359, camo: 'tiger' });

    // a position the server refuses (here a 3 m jump) is corrected on the client, never left to drift apart
    const sx = srvMe.x, sy = srvMe.y;
    me.x += 3;
    await play([a, b], 0.6);
    expect(Math.hypot(me.x - srvMe.x, me.y - srvMe.y)).toBeLessThan(0.3);
    expect(Math.hypot(srvMe.x - sx, srvMe.y - sy)).toBeLessThan(0.3);

    // Bravo walks into the tower: the run starts and the squad locks
    sim.travel(sim.player(b.id)!, 1, 'start', 'stairs');
    await until(() => srv.squad.locked);
    expect(logs.some((l) => /Run started: the squad entered the tower/.test(l))).toBe(true);
    // Alpha drops: the run continues for Bravo, and Alpha leaves the world (not drawn, not targetable)
    a.close();
    await until(() => sim.players.find((p) => p.name === 'Alpha')!.connected === false);
    await play([b], 0.2);
    expect(b.view!.player(srvMe.id)!.connected).toBe(false);
    const t0 = sim.t;
    await play([b], 0.5);
    expect(sim.phase).toBe('playing');
    expect(sim.t).toBeGreaterThan(t0 + 0.3);
    expect(srv.squad.sim).toBe(sim);
    // a stranger can't join mid-run, Alpha can come back
    await expect(new ClientSession().join(URL, '', 'Charlie', 'sesame')).rejects.toThrow(/entered the tower/i);
    const a2 = new ClientSession();
    let back = false;
    a2.onStart = () => (back = true);
    await a2.join(URL, '', 'Alpha', 'sesame');
    await until(() => back);
    expect(sim.players.find((p) => p.name === 'Alpha')!.connected).toBe(true);

    // garbage input packets are dropped, never crash the server
    a2.t.send({ t: 'to_host', d: { k: 'in', i: { mx: 'lots', jump: 1e99 }, x: 'a' } });
    a2.t.send({ t: 'to_host', d: { k: 'in', i: { mx: 1e9, ax: NaN }, x: srvMe.x, y: srvMe.y, z: 0 } });
    await play([a2, b], 0.2);
    expect(Math.abs(sim.player(a2.id)!.input.mx)).toBeLessThanOrEqual(1);

    // everyone leaves: the run ends and the server returns to the armory
    a2.close(); b.close();
    await until(() => srv.squad.stage === 'shop' && !srv.squad.sim && srv.squad.peers.size === 0);
    expect(logs.some((l) => /Squad deployed/.test(l))).toBe(true);
    expect(logs.some((l) => /Back in the armory/.test(l))).toBe(true);
    // a brand-new callsign gets straight in for the next round
    const c = new ClientSession();
    await c.join(URL, '', 'Charlie', 'sesame');
    await until(() => c.lobby?.stage === 'shop');
    c.close();
  });

  it('join window: late joiners deploy on the street, early leavers are dropped, the tower locks the squad', async () => {
    const a = new ClientSession();
    await a.join(URL, '', 'Alpha', 'sesame');
    await until(() => a.lobby?.stage === 'shop');
    a.ready({ ...emptyLoadout(), primary: 'sr4' });
    await until(() => !!a.view && !!srv.squad.sim);
    const sim = srv.squad.sim!;
    // Bravo arrives while Alpha waits on the street: armory first (a personal "shop" lobby), then the street
    const b = new ClientSession();
    await b.join(URL, '', 'Bravo', 'sesame');
    await until(() => b.lobby?.stage === 'shop' && b.lobby.late === true);
    expect(sim.players.length).toBe(1);
    await play([a], 0.1);
    let feed = a.view!.drainEvents();
    expect(feed.some((e) => e.e === 'msg' && /Bravo joined the squad/.test(e.text))).toBe(true);
    b.ready({ ...emptyLoadout(), primary: 'sr4' });
    await until(() => !!b.view);
    const bp = sim.player(b.id)!;
    const start = sim.floorState(0).L.anchors.start;
    expect(bp.floor).toBe(0);
    expect(Math.hypot(bp.x - start.x, bp.y - start.y)).toBeLessThan(6);
    expect(bp.slot).not.toBe(sim.player(a.id)!.slot);
    await play([a, b], 0.3);
    expect(a.view!.players.map((p) => p.name).sort()).toEqual(['Alpha', 'Bravo']);
    // Bravo leaves before the tower: out of the run, callsign free, not an offline teammate
    b.close();
    await until(() => sim.players.length === 1);
    await play([a], 0.2);
    expect(a.view!.players.map((p) => p.name)).toEqual(['Alpha']);
    const b2 = new ClientSession();
    await b2.join(URL, '', 'Bravo', 'sesame');
    await until(() => b2.lobby?.late === true);
    b2.ready(emptyLoadout());
    await until(() => !!b2.view && sim.players.length === 2);
    // Alpha enters the tower: locked. A stranger is refused; a leaver now stays as an offline teammate
    sim.travel(sim.player(a.id)!, 1, 'start', 'stairs');
    await until(() => srv.squad.locked);
    await expect(new ClientSession().join(URL, '', 'Charlie', 'sesame')).rejects.toThrow(/entered the tower/i);
    b2.close();
    await until(() => sim.player(b2.id)?.connected === false);
    expect(sim.players.length).toBe(2);
    expect(sim.phase).toBe('playing');
    a.close();
    await until(() => srv.squad.stage === 'shop' && !srv.squad.sim);
  });

  it('proximity voice: same floor and within range only, never to self, rate and size limits', async () => {
    const [a, b, c] = [new ClientSession(), new ClientSession(), new ClientSession()];
    await a.join(URL, '', 'Alpha', 'sesame'); await b.join(URL, '', 'Bravo', 'sesame'); await c.join(URL, '', 'Charlie', 'sesame');
    await until(() => [a, b, c].every((x) => x.lobby?.players.length === 3));
    for (const x of [a, b, c]) x.ready(emptyLoadout());
    await until(() => [a, b, c].every((x) => !!x.view));
    const got = new Map<ClientSession, { from: number; bytes: number[] }[]>([[a, []], [b, []], [c, []]]);
    for (const x of [a, b, c]) { x.onVoice = (from, opus) => got.get(x)!.push({ from, bytes: [...opus] }); x.setVoice(true); }
    // nobody runs client updates here, so the server positions set below stay put
    const sim = srv.squad.sim!;
    const [pa, pb, pc] = [a, b, c].map((x) => sim.player(x.id)!);
    pa.x = 30; pa.y = 30; pb.x = 30 + 6; pb.y = 30; pc.x = 30 + VOICE.range + 2; pc.y = 30;
    await wait(50);
    const frame = new Uint8Array([1, 2, 3, 4, 5]);
    a.sendVoice(frame);
    await until(() => got.get(b)!.length === 1);
    await wait(80);
    expect(got.get(b)![0]).toEqual({ from: a.id, bytes: [1, 2, 3, 4, 5] });
    expect(got.get(c)!.length).toBe(0); // 12 m away
    expect(got.get(a)!.length).toBe(0); // never yourself
    // the same spot one floor up hears nothing; a listener with voice off gets nothing either
    pc.floor = 1; pc.x = pa.x; pc.y = pa.y;
    b.setVoice(false);
    await wait(50);
    a.sendVoice(frame);
    await wait(150);
    expect(got.get(c)!.length).toBe(0);
    expect(got.get(b)!.length).toBe(1);
    // back on the street and close: C hears, and C's reply reaches A only (B opted out)
    pc.floor = 0; pc.x = pa.x + 2;
    c.sendVoice(new Uint8Array([9]));
    a.sendVoice(frame);
    await until(() => got.get(c)!.length === 1 && got.get(a)!.length === 1);
    expect(got.get(a)![0].from).toBe(c.id);
    // rate: a burst of 100 frames in one second forwards at most VOICE.framesPerSec, and isn't a kick
    got.get(c)!.length = 0;
    await wait(1000);
    for (let i = 0; i < 100; i++) a.sendVoice(frame);
    await wait(300);
    expect(got.get(c)!.length).toBe(VOICE.framesPerSec);
    expect(srv.squad.sockets.has(a.id)).toBe(true);
    // a long catch-up burst (a 5 s stall of a talking client) is dropped down to the forward rate, never a kick
    await wait(1100);
    for (let i = 0; i < 300; i++) a.sendVoice(frame);
    await wait(300);
    expect(srv.squad.sockets.has(a.id)).toBe(true);
    // size: an oversized frame disconnects
    let why = '';
    a.onDisconnect = (r) => (why = r);
    a.sendVoice(new Uint8Array(VOICE.maxFrameBytes + 1));
    await until(() => why !== '');
    expect(why).toMatch(/bad message/i);
    // binary before joining is refused
    const r = await raw([new Uint8Array([0x56, 1, 2]) as any]);
    expect(r.closed).toBe(true);
    for (const x of [a, b, c]) x.close();
    await until(() => srv.squad.stage === 'shop' && !srv.squad.sim);
  });

  it('kicks a flooding client (rate limit)', async () => {
    const c = new ClientSession();
    await c.join(URL, '', 'Spammer', 'sesame');
    let why = '';
    c.onDisconnect = (r) => (why = r);
    // a stalled client catching up (5 s of inputs at once) is fine
    for (let i = 0; i < 150; i++) c.t.send({ t: 'to_host', d: { k: 'hello', v: NET_VERSION } });
    await wait(300);
    expect(why).toBe('');
    for (let i = 0; i < 1000; i++) c.t.send({ t: 'to_host', d: { k: 'hello', v: NET_VERSION } });
    await until(() => why !== '');
    expect(why).toMatch(/too many/i);
    c.close();
  });

  it('ready timer deploys unready players with the starter kit', async () => {
    const s2 = await startDedicated({ ...DEFAULTS, port: 0, readyTimeout: 1 }, diskAssets('dist'), () => {});
    const u = `ws://localhost:${s2.port}/ws`;
    const a = new ClientSession(), b = new ClientSession();
    await a.join(u, '', 'Eager', ''); await b.join(u, '', 'Idle', '');
    await until(() => b.lobby?.players.length === 2);
    a.ready({ ...emptyLoadout(), primary: 'sr4' });
    await until(() => b.lobby?.deployIn === 1);
    await until(() => !!b.view, 3000);
    expect(s2.squad.sim!.player(b.id)!.loadout).toEqual(emptyLoadout());
    a.close(); b.close();
    await s2.close();
  });
});
