import { Transport, RelayMsg } from './transport';
import { encodeSnapshot, SNAP_HZ, InputPacket } from './protocol';
import { Sim } from '../sim/sim';
import type { Loadout, SimEvent } from '../sim/state';
import { emptyInput } from '../sim/state';
import type { Difficulty } from '../config/difficulty';
import { randomSeed } from '../core/rng';
import { validLoadout, emptyLoadout } from '../ui/shop';
import { isWalkableTile } from '../gen/floor';
import { currentHoliday } from '../config/holiday';
import { collides, BODY_R } from '../sim/nav';

export interface LobbyPeer { id: number; name: string; ready: boolean; loadout: Loadout | null; connected: boolean }

/**
 * Host-authoritative session. The host's browser owns the Sim: enemies, loot, hazards, objective
 * and damage are resolved here and replicated to every client.
 */
export class HostSession {
  t = new Transport();
  code = '';
  id = 1;
  peers = new Map<number, LobbyPeer>();
  difficulty: Difficulty = 'normal';
  friendlyFire = false;
  seed = 0;
  stage: 'lobby' | 'shop' | 'game' = 'lobby';
  sim: Sim | null = null;
  hostName = 'Host';
  hostLoadout: Loadout | null = null;
  private outbox = new Map<number, SimEvent[]>();
  private snapT = 0;
  private contT = 0;
  onChange: () => void = () => {};
  onStart: (sim: Sim) => void = () => {};
  onInfo: (text: string) => void = () => {};
  onDisconnect: (reason: string) => void = () => {};

  async open(url: string, name: string): Promise<string> {
    this.hostName = name;
    await this.t.connect(url);
    this.t.onMsg = (m) => this.handle(m);
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

  private sendTo(id: number | 'all', d: unknown) { this.t.send({ t: 'to', id, d }); }

  broadcastLobby() {
    const players = [{ id: this.id, name: this.hostName, ready: !!this.hostLoadout, host: true }, ...[...this.peers.values()].filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name, ready: p.ready, host: false }))];
    this.sendTo('all', { k: 'lobby', players, difficulty: this.difficulty, ff: this.friendlyFire, stage: this.stage, seed: this.seed });
    this.onChange();
  }

  setDifficulty(d: Difficulty) { this.difficulty = d; this.broadcastLobby(); }
  setFriendlyFire(on: boolean) { this.friendlyFire = on; this.broadcastLobby(); }

  goShop() {
    this.seed = randomSeed();
    this.stage = 'shop';
    this.hostLoadout = null;
    for (const p of this.peers.values()) { p.ready = false; p.loadout = null; }
    this.broadcastLobby();
  }

  setHostLoadout(lo: Loadout) { this.hostLoadout = lo; this.broadcastLobby(); this.tryDeploy(); }

  allReady() { return !!this.hostLoadout && [...this.peers.values()].filter((p) => p.connected).every((p) => p.ready); }

  tryDeploy(force = false) {
    if (this.stage !== 'shop' || (!this.allReady() && !force) || !this.hostLoadout) return;
    const sim = new Sim({ seed: this.seed, difficulty: this.difficulty, mode: 'coop', friendlyFire: this.friendlyFire, holiday: currentHoliday() });
    sim.addPlayer(this.id, this.hostName, this.hostLoadout);
    for (const p of [...this.peers.values()].filter((p) => p.connected).sort((a, b) => a.id - b.id)) {
      sim.addPlayer(p.id, p.name, p.loadout && validLoadout(p.loadout, this.difficulty) ? p.loadout : emptyLoadout());
      sim.external.add(p.id);
      this.outbox.set(p.id, []);
    }
    this.sim = sim;
    this.stage = 'game';
    this.sendTo('all', { k: 'start', seed: this.seed, difficulty: this.difficulty, players: sim.players.map((p) => ({ id: p.id, name: p.name, slot: p.slot })) });
    this.onStart(sim);
  }

  /** Called after each host sim tick with the drained events. */
  distribute(events: SimEvent[]) {
    if (!this.sim) return;
    for (const [id, box] of this.outbox) {
      const p = this.sim.player(id);
      if (!p) continue;
      for (const ev of events) {
        if ('f' in ev) { if (ev.f === p.floor) box.push(ev); }
        else if (ev.e === 'msg') { if (ev.pid === -1 || ev.pid === id) box.push(ev); }
        else box.push(ev);
      }
      if (box.length > 400) box.splice(0, box.length - 400);
    }
  }

  update(dt: number) {
    if (!this.sim) return;
    this.snapT += dt; this.contT += dt;
    if (this.snapT < 1 / SNAP_HZ) return;
    this.snapT = 0;
    const withC = this.contT > 0.4;
    if (withC) this.contT = 0;
    for (const [id, box] of this.outbox) {
      const p = this.sim.player(id);
      if (!p || !p.connected) continue;
      this.sendTo(id, encodeSnapshot(this.sim, id, box, withC));
      box.length = 0;
    }
  }

  private handle(m: RelayMsg) {
    if (m.t === 'peer') {
      // reconnect: same name as a disconnected in-game player takes that operator back
      const sim = this.sim;
      if (sim && this.stage === 'game') {
        const old = sim.players.find((p) => !p.connected && p.name === m.name && p.id !== this.id);
        if (!old) { this.t.send({ t: 'kick', id: m.id, msg: 'Mission already in progress.' }); return; }
        sim.external.delete(old.id);
        this.outbox.delete(old.id);
        this.peers.delete(old.id);
        old.id = m.id;
        old.connected = true;
        old.input = emptyInput(); old.last = emptyInput();
        sim.external.add(m.id);
        this.outbox.set(m.id, []);
        this.peers.set(m.id, { id: m.id, name: m.name, ready: true, loadout: null, connected: true });
        this.sendTo(m.id, { k: 'start', seed: this.seed, difficulty: this.difficulty, players: sim.players.map((p) => ({ id: p.id, name: p.name, slot: p.slot })) });
        sim.msg(null, `${m.name} reconnected.`, 'good');
        return;
      }
      if (this.stage !== 'lobby' && this.stage !== 'shop') return;
      this.peers.set(m.id, { id: m.id, name: m.name, ready: false, loadout: null, connected: true });
      this.onInfo(`${m.name} joined the squad`);
      this.broadcastLobby();
    } else if (m.t === 'peer_left') {
      const p = this.peers.get(m.id);
      if (p) p.connected = false;
      if (this.sim) {
        const sp = this.sim.player(m.id);
        if (sp) { sp.connected = false; this.sim.msg(null, `${sp.name} disconnected. They can rejoin with the same name.`, 'warn'); }
      } else this.peers.delete(m.id);
      this.onInfo(`${p?.name ?? 'A player'} left`);
      this.broadcastLobby();
      this.tryDeploy();
    } else if (m.t === 'from') {
      const d = m.d;
      const peer = this.peers.get(m.id);
      if (!d || !peer) return;
      if (d.k === 'hello') { peer.name = String(d.name).slice(0, 16); this.broadcastLobby(); }
      else if (d.k === 'ready' && this.stage === 'shop') {
        peer.loadout = d.loadout; peer.ready = true;
        this.broadcastLobby();
        this.tryDeploy();
      } else if (d.k === 'in' && this.sim) this.applyInput(m.id, d as InputPacket);
    }
  }

  private applyInput(id: number, pk: InputPacket) {
    const sim = this.sim!;
    const p = sim.player(id);
    if (!p || !pk.i) return;
    // input counters are monotonic; a restarted client resets them
    if (pk.i.jump < p.last.jump || pk.i.reload < p.last.reload) p.last = { ...pk.i };
    p.input = pk.i;
    if (p.input.az === null || p.input.az === undefined) p.input.az = NaN; // JSON turns NaN into null
    if (p.life !== 'alive' || p.ride) return;
    if ((pk.tp ?? 0) !== ((p as any).tp ?? 0)) return; // client hasn't applied a teleport yet
    const L = sim.floorState(p.floor).L;
    const d = Math.hypot(pk.x - p.x, pk.y - p.y);
    const allowLow = pk.z > 0.1;
    if (d < 2.5 && isWalkableTile(L, Math.floor(pk.x), Math.floor(pk.y), true) && !collides(L, pk.x, pk.y, BODY_R * 0.7, allowLow || true)) {
      p.x = pk.x; p.y = pk.y;
    }
    p.z = Math.max(0, Math.min(1.2, pk.z));
    p.crouch = pk.cr; p.moving = pk.mv;
  }
}
