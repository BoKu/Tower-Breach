// Fingerprint of everything generation decides that affects play (walls, solids, doors, props, loot, lights, cameras,
// spawns). The dedicated server runs on Bun (JavaScriptCore) and players on V8: both must produce identical floors.
import { BuildingPlan } from '../../src/gen/building';
import { generateFloor } from '../../src/gen/floor';

const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
const arr = (a: ArrayLike<number>) => fnv(Array.prototype.join.call(a, ','));
const r = (v: number) => Math.round(v * 1000) / 1000;

export const SIG_SEEDS = [12345, 987654, 42, 7777777, 2026, 31337];
export const SIG_FLOORS = [0, 1, 5, 12, 25, 60, 120, 199, 200];

export function genSignature(): string[] {
  const out: string[] = [];
  for (const seed of SIG_SEEDS) for (const f of SIG_FLOORS) {
    const L: any = generateFloor(new BuildingPlan(seed, 'normal'), f);
    out.push([
      `${seed}:${f}`, arr(L.tiles), arr(L.solid), arr(L.roomAt),
      fnv(JSON.stringify((L.doors ?? []).map((d: any) => [d.tiles, d.init]))),
      fnv(JSON.stringify((L.props ?? []).map((p: any) => [p.kind, r(p.x), r(p.y), r(p.rot ?? 0)]))),
      fnv(JSON.stringify(L.containers.map((c: any) => [c.kind, r(c.x), r(c.y), c.items]))),
      fnv(JSON.stringify(L.lights.map((l: any) => [l.kind, r(l.x), r(l.y), l.broken]))),
      fnv(JSON.stringify(L.cameras.map((c: any) => [r(c.x), r(c.y), r(c.angle)]))),
      fnv(JSON.stringify(L.spawns.map((s: any) => [s.type, r(s.x), r(s.y)]))),
      fnv(JSON.stringify(L.hacks)),
    ].join(' '));
  }
  return out;
}
