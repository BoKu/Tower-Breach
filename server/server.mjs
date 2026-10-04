// TOWER BREACH server: serves the built game (dist/) and relays multiplayer traffic over WebSocket (/ws).
// The game is host-authoritative: one player's browser runs the simulation; this relay only routes messages.
// For a server that runs the game itself (no player hosts, cross-play with the desktop apps) see src/server/dedicated.ts.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');
const relayOnly = process.argv.includes('--relay-only');
const PORT = Number(process.env.PORT || (relayOnly ? 8787 : 8080));
const MAX_PLAYERS = 5;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  if (relayOnly) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('TOWER BREACH relay'); return; }
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.normalize(path.join(DIST, url === '/' ? 'index.html' : url));
  if (!file.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(DIST, 'index.html');
    fs.readFile(file, (e2, data) => {
      if (e2) { res.writeHead(404); res.end('Not found - run `npm run build` first'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
});

/** rooms: code -> { host: ws, clients: Map<id, ws>, nextId } */
const rooms = new Map();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 });

function code() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const send = (ws, m) => { if (ws.readyState === 1) ws.send(typeof m === 'string' ? m : JSON.stringify(m)); };

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw, isBinary) => {
    // proximity voice (src/net/voice.ts): a client's [0x56][opus] goes to its host tagged with the sender id;
    // the host (which knows positions) answers [0x57][speaker][n][ids][opus] and the relay fans that out
    if (isBinary) {
      const r = rooms.get(ws.room);
      if (!r || raw.length < 2 || raw.length > 2048) return;
      if (!ws.isHost && raw[0] === 0x56) {
        const out = Buffer.alloc(raw.length + 4);
        out[0] = 0x56; out.writeUInt32LE(ws.pid, 1); raw.copy(out, 5, 1);
        if (r.host.readyState === 1) r.host.send(out);
      } else if (ws.isHost && raw[0] === 0x57 && raw.length > 6) {
        const n = raw[5], body = 6 + n * 4;
        if (raw.length <= body) return;
        const out = Buffer.concat([Buffer.from([0x56]), raw.subarray(1, 5), raw.subarray(body)]);
        for (let i = 0; i < n; i++) { const c = r.clients.get(raw.readUInt32LE(6 + i * 4)); if (c && c.readyState === 1) c.send(out); }
      }
      return;
    }
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.t === 'host') {
      const c = code();
      rooms.set(c, { host: ws, clients: new Map(), nextId: 2 });
      ws.room = c; ws.pid = 1; ws.isHost = true;
      send(ws, { t: 'hosted', code: c, id: 1 });
    } else if (m.t === 'join') {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return send(ws, { t: 'error', msg: 'No squad found with that code.' });
      if (r.clients.size + 1 >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Squad is full (5 operators max).' });
      const id = r.nextId++;
      r.clients.set(id, ws);
      ws.room = String(m.code).toUpperCase(); ws.pid = id; ws.isHost = false;
      send(ws, { t: 'joined', id, code: ws.room });
      send(r.host, { t: 'peer', id, name: String(m.name || 'Operator').slice(0, 16) });
    } else if (m.t === 'to_host') {
      const r = rooms.get(ws.room);
      if (r && !ws.isHost) send(r.host, JSON.stringify({ t: 'from', id: ws.pid, d: m.d }));
    } else if (m.t === 'to') {
      const r = rooms.get(ws.room);
      if (!r || !ws.isHost) return;
      const payload = JSON.stringify({ t: 'data', d: m.d });
      if (m.id === 'all') for (const c of r.clients.values()) send(c, payload);
      else { const c = r.clients.get(m.id); if (c) send(c, payload); }
    } else if (m.t === 'kick') {
      const r = rooms.get(ws.room);
      if (r && ws.isHost) { const c = r.clients.get(m.id); if (c) { send(c, { t: 'error', msg: m.msg || 'Removed by host.' }); c.close(); } }
    }
  });
  ws.on('close', () => {
    const r = rooms.get(ws.room);
    if (!r) return;
    if (ws.isHost) {
      for (const c of r.clients.values()) { send(c, { t: 'host_left' }); c.close(); }
      rooms.delete(ws.room);
    } else {
      r.clients.delete(ws.pid);
      send(r.host, { t: 'peer_left', id: ws.pid });
    }
  });
});

setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 15000);

server.listen(PORT, () => console.log(`TOWER BREACH ${relayOnly ? 'relay' : 'server'} on http://localhost:${PORT}  (ws path /ws)`));
