import type { SimEvent } from '../sim/state';

type P = { x: number; y: number; z: number };
/**
 * Where a shot's trail and flash start: the shooter's gun muzzle on the 3D model (drawn larger than life, so the
 * sim's own shot point sits at stomach height), unless there is no rig or its last pose is far from the shot (a
 * teleport, an off-screen shooter).
 */
export function shotStart(ev: Extract<SimEvent, { e: 'shot' }>, muzzle: P | null): P {
  const sim = { x: ev.x, y: ev.y, z: ev.z ?? 1.25 };
  if (!muzzle || Math.hypot(muzzle.x - ev.x, muzzle.y - ev.y) > 2) return sim;
  return muzzle;
}
