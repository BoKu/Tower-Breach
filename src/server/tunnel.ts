// Cloudflare quick tunnel for the dedicated server (--tunnel): a free https://….trycloudflare.com address in front of
// the local port, so friends can join without port forwarding and browsers get https (which voice chat needs).
// Uses Cloudflare's `cloudflared`: from --tunnel-bin, the PATH, or downloaded once into ~/.towerbreach.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, renameSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const RELEASES = 'https://github.com/cloudflare/cloudflared/releases/latest/download/';
export const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/** The cloudflared release asset for this machine, or null when Cloudflare doesn't publish one. */
export function cloudflaredAsset(platform = process.platform, arch = process.arch): string | null {
  const a = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : null;
  if (!a) return null;
  if (platform === 'win32') return a === 'amd64' ? 'cloudflared-windows-amd64.exe' : null;
  if (platform === 'darwin') return `cloudflared-darwin-${a}.tgz`;
  if (platform === 'linux') return `cloudflared-linux-${a}`;
  return null;
}

const runs = (bin: string) => { try { execFileSync(bin, ['--version'], { stdio: 'ignore', timeout: 10_000 }); return true; } catch { return false; } };

/** A cloudflared that runs: the given one, one on the PATH, our cached copy, or a fresh download. */
async function findCloudflared(given: string, log: (s: string) => void): Promise<string> {
  if (given) { if (runs(given)) return given; throw new Error(`--tunnel-bin ${given} doesn't run`); }
  if (runs('cloudflared')) return 'cloudflared';
  const dir = path.join(os.homedir(), '.towerbreach');
  const bin = path.join(dir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (existsSync(bin) && runs(bin)) return bin;
  const asset = cloudflaredAsset();
  if (!asset) throw new Error(`Cloudflare has no cloudflared for ${process.platform}-${process.arch}: install it yourself and pass --tunnel-bin`);
  log(`downloading Cloudflare's tunnel tool (cloudflared, Apache-2.0) from ${RELEASES}${asset} …`);
  const res = await fetch(RELEASES + asset);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, asset + '.part');
  writeFileSync(tmp, new Uint8Array(await res.arrayBuffer()));
  if (asset.endsWith('.tgz')) { execFileSync('tar', ['-xzf', tmp, '-C', dir]); rmSync(tmp); } else renameSync(tmp, bin);
  if (process.platform !== 'win32') chmodSync(bin, 0o755);
  if (!runs(bin)) throw new Error(`the downloaded cloudflared doesn't run (${bin})`);
  log(`saved to ${bin} (reused next time)`);
  return bin;
}

export interface Tunnel { url: string; stop: () => void }

/** Start a quick tunnel to the local server and resolve with its public https address. */
export async function startTunnel(port: number, tls: boolean, bin: string, log: (s: string) => void): Promise<Tunnel> {
  const exe = await findCloudflared(bin, log);
  const args = ['tunnel', '--no-autoupdate', '--url', `${tls ? 'https' : 'http'}://localhost:${port}`, ...(tls ? ['--no-tls-verify'] : [])];
  const p: ChildProcess = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => { if (p.exitCode === null) p.kill(); };
  return new Promise((resolve, reject) => {
    let out = '', up = false;
    const timer = setTimeout(() => { stop(); reject(new Error('no tunnel address from Cloudflare after 45 s (are you online?)')); }, 45_000);
    const read = (d: Buffer) => {
      out = (out + d).slice(-8000);
      // the address is printed first, the edge connection a moment later: announce it once it can carry traffic
      const m = TUNNEL_URL.exec(out);
      if (m && !up && /Registered tunnel connection/.test(out)) { up = true; clearTimeout(timer); resolve({ url: m[0], stop }); }
    };
    p.stdout!.on('data', read); p.stderr!.on('data', read);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('exit', (code) => { if (up) { log(`the Cloudflare tunnel closed (${code}): restart the server for a new address`); return; } clearTimeout(timer); reject(new Error(`cloudflared exited (${code}): ${out.trim().split('\n').slice(-3).join(' | ')}`)); });
  });
}
