/** Thin WebSocket wrapper for the relay protocol. */
export type RelayMsg =
  | { t: 'hosted'; code: string; id: number }
  | { t: 'joined'; code: string; id: number }
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

export class Transport {
  ws: WebSocket | null = null;
  onMsg: (m: RelayMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  bytesOut = 0;
  bytesIn = 0;

  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      try { this.ws = new WebSocket(url); } catch (e) { reject(new Error('Invalid server address')); return; }
      const to = setTimeout(() => { if (!settled) { settled = true; reject(new Error('Connection timed out')); this.ws?.close(); } }, 6000);
      this.ws.onopen = () => { settled = true; clearTimeout(to); resolve(); };
      this.ws.onerror = () => { if (!settled) { settled = true; clearTimeout(to); reject(new Error('Could not reach the multiplayer server. Is `npm run relay` (dev) or `npm start` running?')); } };
      this.ws.onclose = () => { this.onClose('Connection lost'); };
      this.ws.onmessage = (ev) => {
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
  close() { if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = null; } }
}
