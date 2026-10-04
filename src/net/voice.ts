import type { PlayerState } from '../sim/state';

/**
 * Proximity voice chat, shared by the client, the browser host and the dedicated server.
 * Opus frames travel as binary WebSocket messages through the game server (no peer-to-peer, so no NAT setup):
 *   client -> server   [0x56][opus]                       (uplink; the server knows who sent it)
 *   server -> client   [0x56][speaker u32 LE][opus]       (also relay -> browser host for a client's uplink)
 *   host   -> relay    [0x57][speaker u32][n u8][n x listener u32][opus]   (relay fans out as 0x56 frames)
 * The authority forwards each frame only to listeners on the speaker's floor within VOICE.range (it has the
 * authoritative positions, so nobody can eavesdrop from across the tower). Receivers set the volume themselves
 * from snapshot positions with voiceGain.
 */
export const VOICE = {
  /** full volume up to here (metres) */
  full: 3,
  /** silent from here; the server's forwarding cutoff */
  range: 10,
  /** largest accepted Opus frame: 24 kbps x 20 ms is ~60 B, loud transients a little more */
  maxFrameBytes: 400,
  /** per-speaker budget: 50 frames/s nominal, slack for a burst after a stalled tab; extra frames are dropped */
  framesPerSec: 60,
  bitrate: 24_000,
  sampleRate: 48_000,
  frameMs: 20,
};
export const VOICE_UP = 0x56;
export const VOICE_FANOUT = 0x57;

/** Who hears `speaker` right now: connected, in the world, same floor, within range, listening; never the speaker. */
export function voiceTargets(players: PlayerState[], speaker: number, listening: (id: number) => boolean): number[] {
  const s = players.find((p) => p.id === speaker);
  if (!s || !s.connected || s.life === 'out') return [];
  return players.filter((p) => p.id !== speaker && p.connected && p.life !== 'out' && p.floor === s.floor && listening(p.id) && Math.hypot(p.x - s.x, p.y - s.y) <= VOICE.range).map((p) => p.id);
}

/** Receiver-side loudness 0..1: full within VOICE.full, smooth fade to silence at VOICE.range; a wall in between muffles it. */
export function voiceGain(d: number, occluded = false): number {
  if (d >= VOICE.range) return 0;
  const t = Math.max(0, (d - VOICE.full) / (VOICE.range - VOICE.full));
  const g = 1 - t * t * (3 - 2 * t); // smoothstep fade
  return occluded ? g * 0.4 : g;
}

/** [tag][speaker u32][opus] */
export function packVoice(tag: number, speaker: number, opus: Uint8Array): Uint8Array {
  const b = new Uint8Array(5 + opus.length);
  b[0] = tag;
  new DataView(b.buffer).setUint32(1, speaker, true);
  b.set(opus, 5);
  return b;
}
export function unpackVoice(b: Uint8Array): { speaker: number; opus: Uint8Array } | null {
  if (b.length < 6 || b[0] !== VOICE_UP) return null;
  return { speaker: new DataView(b.buffer, b.byteOffset, b.length).getUint32(1, true), opus: b.subarray(5) };
}
/** Browser host -> relay: one frame for several listeners. */
export function packFanout(speaker: number, to: number[], opus: Uint8Array): Uint8Array {
  const b = new Uint8Array(6 + to.length * 4 + opus.length);
  const v = new DataView(b.buffer);
  b[0] = VOICE_FANOUT;
  v.setUint32(1, speaker, true);
  b[5] = to.length;
  to.forEach((id, i) => v.setUint32(6 + i * 4, id, true));
  b.set(opus, 6 + to.length * 4);
  return b;
}
