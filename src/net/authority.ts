import { encodeSnapshot, SNAP_HZ, InputPacket, NET_VERSION, versionMismatch, cleanName, sanitizeInputPacket } from './protocol';
import { Sim } from '../sim/sim';
import type { Loadout, SimEvent } from '../sim/state';
import { emptyInput } from '../sim/state';
import type { Difficulty } from '../config/difficulty';
import { randomSeed } from '../core/rng';
import { validLoadout, emptyLoadout, sanitizeLoadout } from '../sim/loadout';
import { isWalkableTile } from '../gen/floor';
import { currentHoliday, type Holiday } from '../config/holiday';
import { collides, BODY_R } from '../sim/nav';
import { VOICE, voiceTargets } from './voice';
import { sanitizeLook, type PlayerLook } from '../config/look';

export interface LobbyPeer { id: number; name: string; ready: boolean; loadout: Loadout | null; connected: boolean; look?: PlayerLook }

/**
 * The authoritative co-op squad: lobby, armory readiness, deploy, the Sim, input validation and snapshot
 * fan-out. Transport-agnostic: the browser host (HostSession, over the relay) and the dedicated server
 * (src/server/dedicated.ts, over its own WebSocket) subclass it and only supply sendTo/kick.
 * hostId is the browser host's own operator (id 1); a dedicated server has none (null).
 */
export abstract class SquadAuthority {
  hostId: number | null = 1;
  hostName = 'Host';
  hostLoadout: Loadout | null = null;
  hostLook: PlayerLook | undefined;
  peers = new Map<number, LobbyPeer>();
  difficulty: Difficulty = 'normal';
  friendlyFire = false;
  /** undefined = follow today's date at deploy; null = no holiday; a Holiday = force it */
  holiday: Holiday | null | undefined = undefined;
  seed = 0;
  stage: 'lobby' | 'shop' | 'game' = 'lobby';
  sim: Sim | null = null;
  /**
   * Join/leave window: until the first operator enters the tower (floor >= 1) the squad is open: new callsigns
   * join the run from the armory and leavers are dropped from it. After that it is locked: leavers stay as
   * offline teammates who can rejoin by callsign, strangers are refused.
   */
  locked = false;
  protected outbox = new Map<number, SimEvent[]>();
  /** operators who have voice chat on (they asked with {k:'vc'}; the browser host adds its own id) */
  voiceListeners = new Set<number>();
  private voiceRate = new Map<number, { t: number; n: number }>();
  /** sim time of each operator's last accepted position report (how far the next one may move) */
  private lastMove = new Map<number, number>();
  private snapT = 0;
  private contT = 0;
  onChange: () => void = () => {};
  onStart: (sim: Sim) => void = () => {};
  onInfo: (text: string) => void = () => {};
  /** the squad entered the tower: the join window just closed */
  onLock: () => void = () => {};

  protected abstract sendTo(id: number | 'all', d: unknown): void;
  protected abstract kick(id: number, msg: string): void;
  /** Deliver one Opus frame from `speaker` to these listeners (already proximity-filtered). */
  protected abstract sendVoice(to: number[], speaker: number, opus: Uint8Array): void;
  /** Extra lobby fields (the dedicated server adds its name, MOTD and deploy countdown). */
  protected lobbyExtra(): object { return {}; }

  connectedPeers() { return [...this.peers.values()].filter((p) => p.connected); }

  broadcastLobby() {
    const host = this.hostId === null ? [] : [{ id: this.hostId, name: this.hostName, ready: !!this.hostLoadout, host: true }];
    const players = [...host, ...this.connectedPeers().map((p) => ({ id: p.id, name: p.name, ready: p.ready, host: false }))];
    const msg = { k: 'lobby', players, difficulty: this.difficulty, ff: this.friendlyFire, stage: this.stage, seed: this.seed, ...this.lobbyExtra() };
    const sim = this.sim;
    if (sim && this.stage === 'game') {
      // mid-run: a late joiner still choosing a loadout is in "their" armory; everyone else ignores lobby updates
      for (const p of this.connectedPeers()) this.sendTo(p.id, sim.player(p.id) ? msg : { ...msg, stage: 'shop', late: true });
    } else this.sendTo('all', msg);
    this.onChange();
  }

  setDifficulty(d: Difficulty) { this.difficulty = d; this.broadcastLobby(); }
  setFriendlyFire(on: boolean) { this.friendlyFire = on; this.broadcastLobby(); }

  goShop() {
    this.seed = randomSeed();
    this.stage = 'shop';
    this.locked = false;
    this.hostLoadout = null;
    for (const p of this.peers.values()) { p.ready = false; p.loadout = null; }
    this.broadcastLobby();
  }

  setHostLoadout(lo: Loadout, look?: PlayerLook) { this.hostLoadout = lo; this.hostLook = look && sanitizeLook(look); this.broadcastLobby(); this.tryDeploy(); }

  allReady() {
    const peers = this.connectedPeers();
    return (this.hostId === null ? peers.length > 0 : !!this.hostLoadout) && peers.every((p) => p.ready);
  }

  tryDeploy(force = false) {
    if (this.stage !== 'shop' || (!this.allReady() && !force)) return;
    if (this.hostId !== null ? !this.hostLoadout : !this.connectedPeers().length) return;
    const sim = new Sim({ seed: this.seed, difficulty: this.difficulty, mode: 'coop', friendlyFire: this.friendlyFire, holiday: this.holiday === undefined ? currentHoliday() : this.holiday });
    if (this.hostId !== null) sim.addPlayer(this.hostId, this.hostName, this.hostLoadout!).look = this.hostLook;
    for (const p of this.connectedPeers().sort((a, b) => a.id - b.id)) {
      sim.addPlayer(p.id, p.name, p.loadout && validLoadout(p.loadout, this.difficulty) ? p.loadout : emptyLoadout()).look = p.look;
      sim.external.add(p.id);
      this.outbox.set(p.id, []);
    }
    this.sim = sim;
    this.stage = 'game';
    this.locked = false;
    this.sendTo('all', this.startMsg());
    this.onStart(sim);
  }

  private startMsg() {
    const sim = this.sim!;
    return { k: 'start', seed: this.seed, difficulty: this.difficulty, hol: sim.cfg.holiday ?? null, players: sim.players.map((p) => ({ id: p.id, name: p.name, slot: p.slot })) };
  }

  /** Called after each authoritative sim tick with the drained events. */
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
    if (!this.locked && this.sim.players.some((p) => p.floor >= 1)) {
      this.locked = true;
      this.sim.msg(null, 'The squad is in the tower: no new operators can join this run.', 'info');
      this.onLock();
    }
    this.snapT += dt; this.contT += dt;
    if (this.snapT < 1 / SNAP_HZ) return;
    this.snapT = Math.min(this.snapT - 1 / SNAP_HZ, 1 / SNAP_HZ); // keep the cadence instead of drifting late
    const withC = this.contT > 0.4;
    if (withC) this.contT = 0;
    for (const [id, box] of this.outbox) {
      const p = this.sim.player(id);
      if (!p || !p.connected) continue;
      this.sendTo(id, encodeSnapshot(this.sim, id, box, withC));
      box.length = 0;
    }
  }

  /** Why a player with this (clean) callsign can't come in right now, or null. */
  admissionError(name: string): string | null {
    if (this.sim && this.stage === 'game') {
      if (this.rejoinTarget(name)) return null;
      if (this.locked || this.sim.phase !== 'playing') return 'Mission in progress: the squad has already entered the tower. Wait for the run to end, or rejoin with your old callsign.';
    }
    if ((this.hostId !== null && name === this.hostName) || this.connectedPeers().some((p) => p.name === name)) return `Callsign "${name}" is already in the squad. Pick another.`;
    return null;
  }

  /** The offline in-run operator this callsign takes back, if any (only after the lock: earlier leavers are dropped). */
  rejoinTarget(name: string) {
    return this.sim?.players.find((p) => !p.connected && p.name === name && p.id !== this.hostId);
  }

  /** A player arrived (relay `peer` / dedicated join). Name is untrusted. */
  peerJoined(id: number, rawName: string) {
    const name = cleanName(rawName) || 'Operator';
    const refuse = this.admissionError(name);
    if (refuse) { this.kick(id, refuse); return; }
    const sim = this.sim;
    const old = this.rejoinTarget(name);
    if (sim && this.stage === 'game' && !old) {
      // join window still open: this operator picks a loadout in the armory, then deploys on the street (deployLate)
      this.peers.set(id, { id, name, ready: false, loadout: null, connected: true });
      sim.msg(null, `${name} joined the squad and is gearing up in the armory.`, 'info');
      this.broadcastLobby();
      return;
    }
    if (sim && old) {
      // reconnect: same name as a disconnected in-game player takes that operator back
      sim.external.delete(old.id);
      this.outbox.delete(old.id);
      this.peers.delete(old.id);
      old.id = id;
      old.connected = true;
      old.input = emptyInput(); old.last = emptyInput();
      sim.external.add(id);
      this.outbox.set(id, []);
      this.peers.set(id, { id, name, ready: true, loadout: null, connected: true });
      this.sendTo(id, this.startMsg());
      sim.msg(null, `${name} reconnected.`, 'good');
      this.onInfo(`${name} reconnected`);
      return;
    }
    if (this.stage !== 'lobby' && this.stage !== 'shop') return;
    this.peers.set(id, { id, name, ready: false, loadout: null, connected: true });
    this.onInfo(`${name} joined the squad`);
    this.broadcastLobby();
  }

  peerLeft(id: number) {
    this.voiceListeners.delete(id);
    this.voiceRate.delete(id);
    const p = this.peers.get(id);
    if (!p) return;
    p.connected = false;
    const sim = this.sim;
    const sp = sim?.player(id);
    if (sim && sp && this.locked) {
      sp.connected = false; sp.input = emptyInput(); sp.hold = null;
      sim.msg(null, `${sp.name} disconnected. They can rejoin with the same name.`, 'warn');
    } else {
      // before the squad enters the tower a leaver is out of the run entirely (callsign free, not counted for the end)
      this.peers.delete(id);
      if (sim && sp) {
        sim.players = sim.players.filter((q) => q !== sp);
        sim.external.delete(id);
        this.outbox.delete(id);
        sim.msg(null, `${sp.name} left the squad.`, 'warn');
      }
    }
    this.onInfo(`${p.name} left`);
    this.broadcastLobby();
    this.tryDeploy();
  }

  /** A client message (`d` of to_host). Everything here is untrusted and validated before use. */
  fromPeer(id: number, d: any) {
    const peer = this.peers.get(id);
    if (!d || typeof d !== 'object' || !peer) return;
    if (d.k === 'hello') { if (d.v !== NET_VERSION) this.kick(id, versionMismatch(d.v)); }
    else if (d.k === 'ready' && this.stage === 'shop') {
      const lo = sanitizeLoadout(d.loadout);
      if (!lo) return;
      peer.loadout = lo; peer.ready = true; peer.look = sanitizeLook(d.look); // cosmetic: bad input becomes the default look
      this.broadcastLobby();
      this.tryDeploy();
    } else if (d.k === 'ready' && this.stage === 'game' && this.sim && !this.sim.player(id)) {
      const lo = sanitizeLoadout(d.loadout);
      if (lo) { peer.look = sanitizeLook(d.look); this.deployLate(peer, lo); }
    } else if (d.k === 'vc') {
      if (d.on === true) this.voiceListeners.add(id); else this.voiceListeners.delete(id);
    } else if (d.k === 'in' && this.sim) {
      const pk = sanitizeInputPacket(d);
      if (pk) this.applyInput(id, pk);
    }
  }

  /**
   * Proximity voice: one Opus frame from `id` goes only to listeners on the same floor within VOICE.range.
   * Oversized frames and frames over the speaker's per-second budget are dropped.
   */
  voiceFrom(id: number, opus: Uint8Array) {
    const sim = this.sim;
    if (!sim || this.stage !== 'game' || !opus.length || opus.length > VOICE.maxFrameBytes) return;
    const now = Date.now();
    let r = this.voiceRate.get(id);
    if (!r || now - r.t >= 1000) { r = { t: now, n: 0 }; this.voiceRate.set(id, r); }
    if (++r.n > VOICE.framesPerSec) return;
    const to = voiceTargets(sim.players, id, (l) => this.voiceListeners.has(l));
    if (to.length) this.sendVoice(to, id, opus);
  }

  /** A late joiner (admitted before the lock) confirmed a loadout: spawn them on the street by the start. */
  private deployLate(peer: LobbyPeer, lo: Loadout) {
    const sim = this.sim!;
    peer.loadout = lo; peer.ready = true;
    sim.addPlayer(peer.id, peer.name, validLoadout(lo, this.difficulty) ? lo : emptyLoadout()).look = peer.look;
    sim.external.add(peer.id);
    this.outbox.set(peer.id, []);
    this.sendTo(peer.id, this.startMsg());
    sim.msg(null, `${peer.name} deployed on the street.`, 'good');
  }

  private applyInput(id: number, pk: InputPacket) {
    const sim = this.sim!;
    const p = sim.player(id);
    if (!p) return;
    // input counters are monotonic; a restarted client resets them
    if (pk.i.jump < p.last.jump || pk.i.reload < p.last.reload) p.last = { ...pk.i };
    p.input = pk.i;
    if (p.life !== 'alive' || p.ride) return;
    if (pk.tp !== ((p as any).tp ?? 0)) return; // client hasn't applied a teleport yet
    const L = sim.floorState(p.floor).L;
    const d = Math.hypot(pk.x - p.x, pk.y - p.y);
    // the client predicts its own movement; allow what it could cover since its last accepted report, plus slack
    const since = Math.min(1, sim.t - (this.lastMove.get(id) ?? sim.t));
    if (d < 1.5 + 8 * since && isWalkableTile(L, Math.floor(pk.x), Math.floor(pk.y), true) && !collides(L, pk.x, pk.y, BODY_R * 0.7, true)) {
      p.x = pk.x; p.y = pk.y;
      this.lastMove.set(id, sim.t);
    } else {
      // refused: bump the teleport counter so the client snaps back to the server's position (see ClientView.apply)
      // instead of walking on where nobody else sees it
      (p as any).tp = ((p as any).tp ?? 0) + 1;
      this.lastMove.set(id, sim.t);
    }
    p.z = Math.max(0, Math.min(1.2, pk.z));
    p.crouch = pk.cr; p.moving = pk.mv;
  }
}
