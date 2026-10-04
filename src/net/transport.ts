/** Thin WebSocket wrapper for the relay / dedicated-server protocol (same envelope for both). */
export type RelayMsg =
  | { t: 'hosted'; code: string; id: number }
  | { t: 'joined'; code: string; id: number; srv?: { name: string; motd: string } }
  | { t: 'error'; msg: string }
  | { t: 'peer'; id: number; name: string }
  | { t: 'peer_left'; id: number }
  | { t: 'host_left' }
  | { t: 'from'; id: number; d: any }
  | { t: 'data'; d: any };

export function defaultServerUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** Default port of the dedicated server (src/server/dedicated.ts). */
export const DEDICATED_PORT = 8787;

/**
 * What a player types ("1.2.3.4", "myhost:8787", "ws://...", "https://...") -> a WebSocket URL.
 * No scheme = plain ws:// on the default port; the /ws path is added when missing.
 */
export function normalizeServerAddress(addr: string): string {
  let a = addr.trim().replace(/^http(s?):\/\//i, 'ws$1://');
  if (!/^wss?:\/\//i.test(a)) {
    const hostPort = a.split('/')[0];
    const hasPort = /^\[.*\]:\d+$/.test(hostPort) || /^[^:\[\]]+:\d+$/.test(hostPort);
    a = `ws://${hasPort ? a : a.replace(hostPort, `${hostPort}:${DEDICATED_PORT}`)}`;
  }
  const u = new URL(a);
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/ws';
  return u.toString();
}

export class Transport {
  ws: WebSocket | null = null;
  onMsg: (m: RelayMsg) => void = () => {};
  /** binary messages: voice frames (src/net/voice.ts) */
  onBinary: (b: Uint8Array) => void = () => {};
  onClose: (reason: string) => void = () => {};
  bytesOut = 0;
  bytesIn = 0;

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      try { this.ws = new WebSocket(url); } catch (e) { reject(new Error('Invalid server address')); return; }
      this.ws.binaryType = 'arraybuffer';
      const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Connection timed out')); this.ws?.close(); } }, 6000);
      this.ws.onopen = () => { settled = true; clearTimeout(to); resolve(); };
      this.ws.onerror = () => { if (!settled) { settled = true; clearTimeout(to); reject(new Error('Could not reach the server. Check the address and port, that the server is running, and that its port is forwarded / allowed through the firewall.')); } };
      this.ws.onclose = () => { this.onClose('Connection lost'); };
      this.ws.onmessage = (ev) => {
        if (ev.data instanceof ArrayBuffer) { this.bytesIn += ev.data.byteLength; this.onBinary(new Uint8Array(ev.data)); return; }
        this.bytesIn += (ev.data as string).length;
        try { this.onMsg(JSON.parse(ev.data as string)); } catch { /* ignore malformed */ }
      };
    });
  }
  send(m: unknown) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const s = JSON.stringify(m);
    this.bytesOut += s.length;
    this.ws.send(s);
  }
  sendBinary(b: Uint8Array) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.bytesOut += b.length;
    this.ws.send(b as Uint8Array<ArrayBuffer>);
  }
  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } }
}
