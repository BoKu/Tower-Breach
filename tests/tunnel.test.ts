import { it, expect } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTunnel, cloudflaredAsset } from '../src/server/tunnel';
import { startDedicated, diskAssets, DEFAULTS, LIMITS } from '../src/server/dedicated';
import { normalizeServerAddress } from '../src/net/transport';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

it('picks the right cloudflared download for each OS', () => {
  expect(cloudflaredAsset('linux', 'x64')).toBe('cloudflared-linux-amd64');
  expect(cloudflaredAsset('darwin', 'arm64')).toBe('cloudflared-darwin-arm64.tgz');
  expect(cloudflaredAsset('win32', 'x64')).toBe('cloudflared-windows-amd64.exe');
  expect(cloudflaredAsset('win32', 'arm64')).toBeNull();
  expect(cloudflaredAsset('freebsd', 'x64')).toBeNull();
  // the desktop app's address box takes the bare tunnel host
  expect(normalizeServerAddress('calm-blue-fox.trycloudflare.com')).toBe('wss://calm-blue-fox.trycloudflare.com/ws');
  expect(normalizeServerAddress('https://calm-blue-fox.trycloudflare.com')).toBe('wss://calm-blue-fox.trycloudflare.com/ws');
});

it('starts cloudflared on the server port and reports the trycloudflare address', async () => {
  // a stand-in cloudflared: answers --version, and for `tunnel` logs an address the way the real one does
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tb-cf-'));
  const fake = path.join(dir, 'cloudflared'), argsFile = path.join(dir, 'args.json');
  writeFileSync(fake, `#!/usr/bin/env node
if (process.argv[2] === '--version') process.exit(0);
require('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
setTimeout(() => console.error('INF |  https://calm-blue-fox.trycloudflare.com  |'), 100);
setTimeout(() => console.error('INF Registered tunnel connection connIndex=0 location=mel02'), 250);
setInterval(() => {}, 1000);
`);
  chmodSync(fake, 0o755);
  const t = await startTunnel(18123, false, fake, () => {});
  expect(t.url).toBe('https://calm-blue-fox.trycloudflare.com');
  expect(JSON.parse(readFileSync(argsFile, 'utf8'))).toEqual(['tunnel', '--no-autoupdate', '--url', 'http://localhost:18123']);
  t.stop();
  await expect(startTunnel(1, false, path.join(dir, 'nope'), () => {})).rejects.toThrow(/doesn't run/);
  expect(existsSync(fake)).toBe(true);
});

it("through the tunnel, per-address limits use Cloudflare's client address (trusted from localhost only)", async () => {
  const open = async (port: number, ip: string) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers: { 'cf-connecting-ip': ip } });
    let closed = false;
    ws.on('close', () => (closed = true)); ws.on('error', () => {});
    await new Promise((r) => ws.on('open', r));
    await wait(30);
    return { ws, get closed() { return closed; } };
  };
  for (const tunnel of [true, false]) {
    const s = await startDedicated({ ...DEFAULTS, port: 0, tunnel }, diskAssets('dist'), () => {});
    const socks = [];
    for (let i = 0; i <= LIMITS.maxConnsPerIp; i++) socks.push(await open(s.port, `203.0.113.${i + 1}`));
    await wait(100);
    // with the tunnel each is its own player; without it the header is ignored and the 9th from localhost is refused
    expect(socks.filter((x) => x.closed).length, `tunnel ${tunnel}`).toBe(tunnel ? 0 : 1);
    for (const x of socks) x.ws.close();
    await s.close();
  }
});
