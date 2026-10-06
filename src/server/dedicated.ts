// TOWER BREACH dedicated co-op server: runs the authoritative Sim headless in Node/Bun (no player hosts it),
// serves the web build so browser players can just open http://IP:port, and speaks the same WebSocket
// envelope as the relay (join / to_host -> data), so ClientSession works against either.
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fsp, existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';
import { SquadAuthority } from '../net/authority';
import { NET_VERSION, versionMismatch, cleanName } from '../net/protocol';
import { DEDICATED_PORT } from '../net/transport';
import { VOICE, VOICE_UP, packVoice } from '../net/voice';
import { DIFFICULTIES, type Difficulty } from '../config/difficulty';
import { APP_VERSION } from '../config/version';
import { HOLIDAYS, type Holiday } from '../config/holiday';

export interface ServerConfig {
  port: number;
  difficulty: Difficulty;
  maxPlayers: number;
  friendlyFire: boolean;
  /** '' = no password */
  password: string;
  name: string;
  motd: string;
  holiday: 'auto' | 'none' | Holiday;
  /** seconds after the first READY before unready players are deployed anyway (0 = wait for everyone) */
  readyTimeout: number;
  /** serve the web build from this folder instead of the embedded copy ('' = embedded, or ./dist from source) */
  webRoot: string;
  /** PEM certificate + private key files: serve https/wss (browser voice chat needs a secure page). '' = plain http */
  tlsCert: string;
  tlsKey: string;
}

export const DEFAULTS: ServerConfig = {
  port: DEDICATED_PORT, difficulty: 'normal', maxPlayers: 5, friendlyFire: false, password: '', name: 'Tower Breach server', motd: '',
  holiday: 'auto', readyTimeout: 90, webRoot: '', tlsCert: '', tlsKey: '',
};

/** Internet-facing limits. */
export const LIMITS = {
  maxMsgBytes: 16 * 1024, // client messages are inputs (~400 B) and loadouts (~300 B)
  // rates are token buckets: a burst (a client catching up after a network or main-thread stall) is fine; past the
  // burst, messages are dropped; a client still pushing a full burst past that is flooding and gets disconnected
  msgsPerSec: 90, // clients send 30 inputs/s
  msgBurst: 300,
  maxConns: 32,
  maxConnsPerIp: 8,
  joinTimeoutMs: 10_000,
  pwFailsPerMin: 5,
  // proximity voice: binary frames [0x56][opus] (50/s while talking) with their own bucket, outside msgsPerSec.
  // SquadAuthority.voiceFrom forwards at most VOICE.framesPerSec (60) per speaker and drops the rest; a frame over
  // maxVoiceBytes or any other binary message disconnects.
  maxVoiceBytes: 1 + VOICE.maxFrameBytes,
  voiceMsgsPerSec: 120,
  voiceBurst: 300,
};

/** Token bucket: 'ok' within rate + burst, 'drop' past it, 'flood' once a whole further burst has been dropped. */
function bucket(perSec: number, burst: number) {
  let tokens = burst, at = Date.now();
  return (): 'ok' | 'drop' | 'flood' => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - at) * perSec) / 1000);
    at = now;
    tokens--;
    return tokens >= 0 ? 'ok' : tokens < -burst ? 'flood' : 'drop';
  };
}

const TICK = 1 / 60;
const END_HOLD_MS = 12_000; // the end screen plays out before the squad goes back to the armory
const CONFIG_FILE = 'towerbreach-server.json';

export const USAGE = `TOWER BREACH dedicated co-op server

Options (flags beat environment variables, which beat the config file):
  -p, --port <n>            TCP port for the web page + game traffic   (TB_PORT, default ${DEFAULTS.port})
  -d, --difficulty <d>      normal | hard | insane                      (TB_DIFFICULTY, default normal)
      --max-players <n>     1-5                                         (TB_MAX_PLAYERS, default 5)
      --friendly-fire       allow team damage inside the tower          (TB_FRIENDLY_FIRE=1)
      --password <text>     players must enter this to join             (TB_PASSWORD)
      --name <text>         server name shown in the armory             (TB_NAME)
      --motd <text>         message of the day shown in the armory      (TB_MOTD)
      --holiday <h>         auto | none | xmas | easter | halloween     (TB_HOLIDAY, default auto)
      --ready-timeout <s>   deploy unready players this long after the  (TB_READY_TIMEOUT, default 90,
                            first READY (0 = wait for everyone)          0 = off)
      --web-root <dir>      serve the game from this folder instead of the built-in copy (TB_WEB_ROOT)
      --tls-cert <file>     PEM certificate (e.g. Let's Encrypt fullchain.pem): serve https + wss, which
      --tls-key <file>      browser players need for voice chat       (TB_TLS_CERT, TB_TLS_KEY)
  -c, --config <file>       JSON config file (default: ./${CONFIG_FILE} if present)
  -v, --version             print the server version
  -h, --help                this text

Config file keys: port, difficulty, maxPlayers, friendlyFire, password, name, motd, holiday, readyTimeout, webRoot, tlsCert, tlsKey.
`;

/**
 * `npm run server --holiday xmas` (without "--") never reaches us as flags: npm keeps --options for itself and exports
 * them as npm_config_* (an option it doesn't know becomes "true" and its value a bare argument). Turn them back into
 * flags; when the split-off values can't be paired up unambiguously, say how to run it instead.
 */
function npmFlags(argv: string[], env: Record<string, string | undefined>): string[] {
  const VALUE = ['port', 'difficulty', 'max-players', 'password', 'name', 'motd', 'holiday', 'ready-timeout', 'web-root', 'tls-cert', 'tls-key', 'config'];
  const flags: string[] = [], split: string[] = [];
  for (const o of [...VALUE, 'friendly-fire']) {
    const v = env['npm_config_' + o.replace(/-/g, '_')];
    if (!v) continue;
    if (o === 'friendly-fire') { if (v !== 'false') flags.push('--friendly-fire'); } else if (v === 'true') split.push(o); else flags.push(`--${o}`, v);
  }
  const bare = argv.filter((a) => !a.startsWith('-')), rest = argv.filter((a) => a.startsWith('-') || !bare.includes(a));
  if (split.length === 1 && bare.length === 1) return [...flags, `--${split[0]}`, bare[0], ...rest];
  if (split.length || bare.length) {
    // npm doesn't say which value belonged to which option, so don't guess
    const fix = [...split.map((o) => `--${o} <value>`), ...flags.map((f) => (f.includes(' ') ? JSON.stringify(f) : f))].join(' ');
    throw new Error(`npm kept your options for itself. Put "--" before them: npm run server -- ${fix}`);
  }
  return [...flags, ...argv];
}

/** Merge defaults < config file < environment < flags. Returns null for --help; throws a readable Error on bad input. */
export function parseConfig(argv: string[], env: Record<string, string | undefined> = {}): ServerConfig | null {
  if (env.npm_lifecycle_event) argv = npmFlags(argv, env);
  const { values: f } = parseArgs({
    args: argv, strict: true, allowPositionals: false,
    options: {
      port: { type: 'string', short: 'p' }, difficulty: { type: 'string', short: 'd' }, 'max-players': { type: 'string' }, 'friendly-fire': { type: 'boolean' },
      password: { type: 'string' }, name: { type: 'string' }, motd: { type: 'string' }, holiday: { type: 'string' }, 'ready-timeout': { type: 'string' },
      'web-root': { type: 'string' }, 'tls-cert': { type: 'string' }, 'tls-key': { type: 'string' }, config: { type: 'string', short: 'c' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (f.help) return null;
  const file = f.config ?? env.TB_CONFIG ?? (existsSync(CONFIG_FILE) ? CONFIG_FILE : '');
  let j: any = {};
  if (file) {
    try { j = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { throw new Error(`Could not read config file ${file}: ${(e as Error).message}`); }
  }
  const pick = (flag: unknown, envKey: string, key: keyof ServerConfig) => flag ?? env[envKey] ?? j[key] ?? DEFAULTS[key];
  const int = (v: unknown, what: string, lo: number, hi: number) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${what} must be a whole number from ${lo} to ${hi} (got "${v}")`);
    return n;
  };
  const bool = (v: unknown) => v === true || /^(1|true|yes|on)$/i.test(String(v ?? ''));
  const cfg: ServerConfig = {
    port: int(f.port ?? env.TB_PORT ?? env.PORT ?? j.port ?? DEFAULTS.port, 'port', 1, 65535),
    difficulty: String(pick(f.difficulty, 'TB_DIFFICULTY', 'difficulty')).toLowerCase() as Difficulty,
    maxPlayers: int(pick(f['max-players'], 'TB_MAX_PLAYERS', 'maxPlayers'), 'max-players', 1, 5),
    friendlyFire: bool(f['friendly-fire'] ?? env.TB_FRIENDLY_FIRE ?? j.friendlyFire),
    password: String(pick(f.password, 'TB_PASSWORD', 'password')),
    name: String(pick(f.name, 'TB_NAME', 'name')).slice(0, 40),
    motd: String(pick(f.motd, 'TB_MOTD', 'motd')).slice(0, 200),
    holiday: String(pick(f.holiday, 'TB_HOLIDAY', 'holiday')).toLowerCase() as ServerConfig['holiday'],
    readyTimeout: int(pick(f['ready-timeout'], 'TB_READY_TIMEOUT', 'readyTimeout'), 'ready-timeout', 0, 3600),
    webRoot: String(pick(f['web-root'], 'TB_WEB_ROOT', 'webRoot')),
    tlsCert: String(pick(f['tls-cert'], 'TB_TLS_CERT', 'tlsCert')),
    tlsKey: String(pick(f['tls-key'], 'TB_TLS_KEY', 'tlsKey')),
  };
  if (!cfg.tlsCert !== !cfg.tlsKey) throw new Error('--tls-cert and --tls-key go together');
  if (!DIFFICULTIES.includes(cfg.difficulty)) throw new Error(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (cfg.holiday !== 'auto' && cfg.holiday !== 'none' && !HOLIDAYS.includes(cfg.holiday)) throw new Error(`holiday must be auto, none or one of ${HOLIDAYS.join(', ')}`);
  return cfg;
}

/** Returns the bytes of a web-build file by URL path ('/index.html'), or null. */
export type AssetReader = (urlPath: string) => Promise<Uint8Array | null>;

export function diskAssets(root: string): AssetReader {
  const base = path.resolve(root);
  return async (url) => {
    const file = path.resolve(base, '.' + url);
    const rel = path.relative(base, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null; // no escaping the web root
    try { return (await fsp.stat(file)).isFile() ? await fsp.readFile(file) : null; } catch { return null; }
  };
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain' };

const send = (ws: WebSocket | undefined, m: unknown) => { if (ws && ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };

/** The squad on a dedicated server: no host operator; difficulty / friendly fire come from the config. */
class DedicatedSquad extends SquadAuthority {
  sockets = new Map<number, WebSocket>();
  /** Date.now() when unready players get deployed anyway (0 = no countdown) */
  deployAt = 0;
  private shownCountdown = -1;
  /** Date.now() when a finished run returns to the armory (0 = run not over) */
  endAt = 0;
  maxFloor = 0;

  constructor(private cfg: ServerConfig, private log: (s: string) => void) {
    super();
    this.hostId = null;
    this.difficulty = cfg.difficulty;
    this.friendlyFire = cfg.friendlyFire;
    this.holiday = cfg.holiday === 'auto' ? undefined : cfg.holiday === 'none' ? null : cfg.holiday;
    this.onStart = (sim) => {
      this.deployAt = 0;
      log(`Squad deployed on the street: ${sim.players.map((p) => p.name).join(', ')} · ${this.difficulty}${this.friendlyFire ? ' · friendly fire' : ''} · seed ${this.seed}${sim.cfg.holiday ? ` · ${sim.cfg.holiday}` : ''}`);
    };
    this.onLock = () => log(`Run started: the squad entered the tower (${this.sim!.players.filter((p) => p.connected).map((p) => p.name).join(', ')}). Squad locked: leavers can rejoin by callsign, new callsigns wait for the next run.`);
    this.goShop();
  }

  protected sendTo(id: number | 'all', d: unknown) {
    const s = JSON.stringify({ t: 'data', d });
    if (id === 'all') for (const ws of this.sockets.values()) send(ws, s);
    else send(this.sockets.get(id), s);
  }
  protected kick(id: number, msg: string) {
    const ws = this.sockets.get(id);
    if (ws) { send(ws, { t: 'error', msg }); ws.close(); }
  }
  protected sendVoice(to: number[], speaker: number, opus: Uint8Array) {
    const b = packVoice(VOICE_UP, speaker, opus);
    for (const id of to) { const ws = this.sockets.get(id); if (ws && ws.readyState === 1 && ws.bufferedAmount < 256 * 1024) ws.send(b); } // a choked socket skips voice, not game state
  }
  protected lobbyExtra() {
    return { srv: { name: this.cfg.name, motd: this.cfg.motd }, deployIn: this.deployAt ? Math.max(0, Math.ceil((this.deployAt - Date.now()) / 1000)) : null };
  }

  /** One server frame: the fixed-step sim while a run is live, the ready countdown in the armory. */
  frame(steps: number, dt: number) {
    const sim = this.sim;
    if (sim && this.stage === 'game') {
      for (let i = 0; i < steps; i++) sim.tick(TICK);
      this.distribute(sim.drainEvents());
      this.update(dt);
      if (sim.stats.maxFloor > this.maxFloor) { this.maxFloor = sim.stats.maxFloor; this.log(`Squad reached floor ${this.maxFloor}`); }
      if (sim.phase !== 'playing' && !this.endAt) {
        this.endAt = Date.now() + END_HOLD_MS;
        const secs = Math.round(sim.stats.endT - sim.stats.startT);
        this.log(`Run ${sim.phase === 'won' ? 'WON' : `lost (${sim.lostReason})`} · highest floor ${sim.stats.maxFloor} · ${sim.stats.kills} kills · ${Math.floor(secs / 60)}m${secs % 60}s`);
      }
      // run over and its end screen shown, or everyone has left (mid-run too): reset for a new round
      if (!this.connectedPeers().length || (this.endAt && Date.now() >= this.endAt)) this.backToArmory();
    } else if (this.stage === 'shop') this.countdown();
  }

  private countdown() {
    const peers = this.connectedPeers();
    if (this.cfg.readyTimeout > 0 && peers.some((p) => p.ready)) {
      if (!this.deployAt) this.deployAt = Date.now() + this.cfg.readyTimeout * 1000;
      if (Date.now() >= this.deployAt) { this.log('Ready timer ran out: deploying unready players with the starter kit'); this.tryDeploy(true); return; }
      const left = Math.ceil((this.deployAt - Date.now()) / 1000);
      if (left !== this.shownCountdown) { this.shownCountdown = left; this.broadcastLobby(); }
    } else if (this.deployAt) { this.deployAt = 0; this.shownCountdown = -1; this.broadcastLobby(); }
  }

  backToArmory() {
    this.sim = null;
    this.outbox.clear();
    this.endAt = 0; this.maxFloor = 0; this.deployAt = 0;
    for (const p of [...this.peers.values()]) if (!p.connected) this.peers.delete(p.id);
    this.goShop();
    this.log(`Back in the armory (${this.connectedPeers().length} connected)`);
  }
}

export interface RunningServer { port: number; squad: DedicatedSquad; close(): Promise<void> }

export async function startDedicated(cfg: ServerConfig, assets: AssetReader, log: (s: string) => void = stamp): Promise<RunningServer> {
  const squad = new DedicatedSquad(cfg, log);
  const pwHash = (s: string) => crypto.createHash('sha256').update(s).digest();
  const pwOk = (given: unknown) => !cfg.password || crypto.timingSafeEqual(pwHash(String(given ?? '')), pwHash(cfg.password));
  const pwFails = new Map<string, number[]>(); // ip -> failure times in the last minute
  const perIp = new Map<string, number>();
  let nextId = 1;

  const tls = cfg.tlsCert ? { cert: readFileSync(cfg.tlsCert), key: readFileSync(cfg.tlsKey) } : null;
  const server: http.Server = tls ? https.createServer(tls) : http.createServer();
  server.on('request', async (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let url: string;
    try { url = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
    const head = { 'x-content-type-options': 'nosniff' };
    if (url === '/server-info') {
      res.writeHead(200, { ...head, 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ dedicated: true, name: cfg.name, motd: cfg.motd, players: squad.sockets.size, maxPlayers: cfg.maxPlayers, password: !!cfg.password, stage: squad.stage, difficulty: cfg.difficulty, version: NET_VERSION }));
      return;
    }
    if (url === '/') url = '/index.html';
    const data = await assets(url);
    if (!data) {
      res.writeHead(404, { ...head, 'content-type': 'text/plain' });
      res.end(url === '/index.html' ? 'Web build not found: run `npm run build` (or pass --web-root <dir>).' : 'Not found');
      return;
    }
    res.writeHead(200, { ...head, 'content-type': MIME[path.extname(url).toLowerCase()] ?? 'application/octet-stream', 'cache-control': url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.maxMsgBytes });
  wss.on('error', () => {}); // ws re-emits the http server's errors; listen failures are reported below
  const alive = new WeakSet<WebSocket>();

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress ?? '?';
    const refuse = (msg: string) => { send(ws, { t: 'error', msg }); ws.close(); };
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    ws.on('error', () => ws.terminate()); // oversized frame, bad UTF-8...: drop the socket, never crash the server
    let id = 0;
    let joinTimer: ReturnType<typeof setTimeout> | undefined;
    ws.on('close', () => {
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
      clearTimeout(joinTimer);
      if (id && squad.sockets.get(id) === ws) {
        const name = squad.peers.get(id)?.name ?? '?';
        squad.sockets.delete(id);
        squad.peerLeft(id);
        log(`- ${name} disconnected (${squad.sockets.size}/${cfg.maxPlayers})`);
      }
    });
    if (wss.clients.size > LIMITS.maxConns || perIp.get(ip)! > LIMITS.maxConnsPerIp) { refuse('Server busy: too many connections. Try again shortly.'); return; }
    joinTimer = setTimeout(() => { if (!id) ws.close(); }, LIMITS.joinTimeoutMs);
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    const msgs = bucket(LIMITS.msgsPerSec, LIMITS.msgBurst), voice = bucket(LIMITS.voiceMsgsPerSec, LIMITS.voiceBurst);
    ws.on('message', (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const v = voice();
        if (v === 'flood') { refuse('Disconnected: too many messages.'); return; }
        if (v === 'drop') return;
        if (!id || raw.length > LIMITS.maxVoiceBytes || raw[0] !== VOICE_UP) { refuse('Disconnected: bad message.'); return; }
        squad.voiceFrom(id, raw.subarray(1));
        return;
      }
      const now = Date.now();
      const r = msgs();
      if (r === 'flood') { refuse('Disconnected: too many messages.'); return; }
      if (r === 'drop') return;
      if (raw.length > LIMITS.maxMsgBytes) { refuse('Disconnected: bad message.'); return; }
      let m: any;
      try { m = JSON.parse(raw.toString()); } catch { refuse('Disconnected: bad message.'); return; }
      if (!m || typeof m !== 'object') { refuse('Disconnected: bad message.'); return; }
      if (!id) {
        if (m.t === 'host') { refuse('This is a dedicated server: use "Join server" with its address instead of hosting a squad.'); return; }
        if (m.t !== 'join') { refuse('Disconnected: unexpected message.'); return; }
        if (m.v !== NET_VERSION) { refuse(versionMismatch(m.v)); return; }
        const fails = (pwFails.get(ip) ?? []).filter((t) => now - t < 60_000);
        if (fails.length >= LIMITS.pwFailsPerMin) { refuse('Too many wrong passwords. Wait a minute and try again.'); return; }
        if (!pwOk(m.pw)) {
          pwFails.set(ip, [...fails, now]);
          log(`Wrong password from ${ip}`);
          refuse(m.pw ? 'Wrong server password.' : 'This server needs a password.');
          return;
        }
        const name = cleanName(m.name);
        if (!name) { refuse('Enter a callsign first.'); return; }
        if (squad.sockets.size >= cfg.maxPlayers) { refuse(`Server is full (${cfg.maxPlayers} operators).`); return; }
        const why = squad.admissionError(name);
        if (why) { refuse(why); return; }
        id = nextId++;
        squad.sockets.set(id, ws);
        send(ws, { t: 'joined', id, code: '', srv: { name: cfg.name, motd: cfg.motd } });
        log(`+ ${name} ${squad.rejoinTarget(name) ? 'rejoined the run' : squad.stage === 'game' ? 'joined the deployed squad (armory, then the street)' : 'joined'} from ${ip} (${squad.sockets.size}/${cfg.maxPlayers})`);
        squad.peerJoined(id, name);
        return;
      }
      if (m.t !== 'to_host' || !m.d || !['hello', 'ready', 'in', 'vc'].includes(m.d.k)) { refuse('Disconnected: unexpected message.'); return; }
      squad.fromPeer(id, m.d);
    });
  });

  // dead connections (sleeping laptops, pulled cables) are dropped within ~30 s
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!alive.has(ws)) { ws.terminate(); continue; } alive.delete(ws); ws.ping(); }
  }, 15_000);

  let last = performance.now(), acc = 0;
  const loop = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 6) { acc -= TICK; steps++; }
    if (steps >= 6) acc = 0; // a stalled host machine skips ahead instead of spiralling
    squad.frame(steps, dt);
  }, 1000 * TICK);

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(cfg.port, () => resolve()); });
  const port = (server.address() as { port: number }).port;

  return {
    port, squad,
    close: () => new Promise<void>((resolve) => {
      clearInterval(loop); clearInterval(heartbeat);
      for (const ws of wss.clients) { send(ws, { t: 'error', msg: 'The server is shutting down.' }); ws.close(); }
      wss.close();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }),
  };
}

function stamp(s: string) { console.log(`[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${s}`); }

/** LAN IPv4 addresses, for the startup banner. */
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
}

/** Command-line entry (npm run server, and the standalone binaries with the web build embedded). */
export async function cli(embedded?: AssetReader) {
  if (process.argv.includes('--version') || process.argv.includes('-v')) { console.log(APP_VERSION); return; }
  let cfg: ServerConfig | null;
  try { cfg = parseConfig(process.argv.slice(2), process.env); } catch (e) { console.error(`Error: ${(e as Error).message}\n\n${USAGE}`); process.exit(2); }
  if (!cfg) { console.log(USAGE); return; }
  const webRoot = cfg.webRoot || (embedded ? '' : 'dist');
  const assets = webRoot ? diskAssets(webRoot) : embedded!;
  let srv: RunningServer;
  try { srv = await startDedicated(cfg, assets); } catch (e) {
    const err = e as NodeJS.ErrnoException;
    console.error(err.code === 'EADDRINUSE' ? `Port ${cfg.port} is already in use: stop the other program or pick another with --port.` : `Could not start: ${err.message}`);
    process.exit(1);
  }
  stamp(`TOWER BREACH dedicated server v${APP_VERSION} "${cfg.name}" · protocol v${NET_VERSION}`);
  stamp(`difficulty ${cfg.difficulty} · up to ${cfg.maxPlayers} players · friendly fire ${cfg.friendlyFire ? 'ON' : 'off'} · password ${cfg.password ? 'ON' : 'off'} · holiday ${cfg.holiday} · ready timeout ${cfg.readyTimeout || 'off'}${cfg.readyTimeout ? ' s' : ''}`);
  stamp(`web build: ${webRoot ? path.resolve(webRoot) : 'built in'}`);
  stamp(`listening on TCP port ${srv.port}. Players join with:`);
  const web = cfg.tlsCert ? 'https' : 'http';
  for (const a of ['localhost', ...lanAddresses()]) stamp(`   ${a}:${srv.port}   (browser: ${web}://${a}:${srv.port})`);
  if (!cfg.tlsCert) stamp('   browser players get voice chat only over https: see --tls-cert in docs/HOSTING.md');
  stamp(`   <your public IP>:${srv.port} from the internet once the port is forwarded (see docs/HOSTING.md)`);
  stamp('Ctrl+C to stop.');
  let stopping = false;
  const stop = async (sig: string) => {
    if (stopping) process.exit(1); // second Ctrl+C: don't wait
    stopping = true;
    stamp(`${sig}: shutting down, disconnecting ${srv.squad.sockets.size} player(s)…`);
    await srv.close();
    stamp('Stopped.');
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}
