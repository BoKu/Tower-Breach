import { Transport, RelayMsg } from './transport';
import { SquadAuthority } from './authority';
import { packFanout, unpackVoice } from './voice';

/**
 * Browser-hosted squad over the relay (server/server.mjs). The host player's browser owns the Sim
 * (see SquadAuthority) and is operator id 1; app.ts ticks the sim and calls distribute/update.
 */
export class HostSession extends SquadAuthority {
  t = new Transport();
  code = '';
  id = 1;
  onDisconnect: (reason: string) => void = () => {};
  /** a voice frame for the host's own ears (the host is a listener like any operator) */
  onVoice: (speaker: number, opus: Uint8Array) => void = () => {};

  async open(url: string, name: string): Promise<string> {
    this.hostName = name;
    await this.t.connect(url);
    this.t.onMsg = (m) => this.handle(m);
    this.t.onBinary = (b) => { const v = unpackVoice(b); if (v) this.voiceFrom(v.speaker, v.opus); }; // relay tags the sender
    this.t.onClose = (r) => this.onDisconnect(r);
    return new Promise((resolve, reject) => {
      const prev = this.t.onMsg;
      this.t.onMsg = (m) => {
        if (m.t === 'hosted') { this.code = m.code; this.t.onMsg = prev; resolve(m.code); }
        else if (m.t === 'error') reject(new Error(m.msg));
      };
      this.t.send({ t: 'host', name });
    });
  }

  close() { this.t.close(); }

  protected sendTo(id: number | 'all', d: unknown) { this.t.send({ t: 'to', id, d }); }
  protected kick(id: number, msg: string) { this.t.send({ t: 'kick', id, msg }); }
  protected sendVoice(to: number[], speaker: number, opus: Uint8Array) {
    if (to.includes(this.id)) this.onVoice(speaker, opus);
    const others = to.filter((id) => id !== this.id);
    if (others.length) this.t.sendBinary(packFanout(speaker, others, opus));
  }

  private handle(m: RelayMsg) {
    if (m.t === 'peer') this.peerJoined(m.id, m.name);
    else if (m.t === 'peer_left') this.peerLeft(m.id);
    else if (m.t === 'from') this.fromPeer(m.id, m.d);
  }
}
