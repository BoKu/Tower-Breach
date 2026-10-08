import { describe, it, expect } from 'vitest';
import { OperatorRig, type GunKind } from '../src/render/operator';

const pose = (gun: GunKind, facing: number) => ({
  dt: 0.016, t: 1, x: 10, y: 20, z: 0, facing, crouch: false, aiming: true, sprinting: false, firingRecently: true,
  life: 'alive' as const, gun, aimPitch: 0, reload: -1, hurt: false, ground: 0, vel: { vx: 0, vy: 0 },
});

describe('muzzle position (bullet trails start at the gun, not the stomach)', () => {
  for (const gun of ['pistol', 'rifle', 'smg', 'shotgun', 'sniper', 'lmg'] as GunKind[]) {
    it(`${gun}: the muzzle is well in front of the body at gun height`, () => {
      const rig = OperatorRig.make(0xffffff, { player: undefined });
      rig.setGun(gun);
      for (const facing of [0, Math.PI / 2, 2.4]) {
        for (let i = 0; i < 30; i++) rig.update(pose(gun, facing));
        rig.root.updateMatrixWorld(true);
        const m = rig.muzzleWorld();
        expect(m, `${gun}`).not.toBeNull();
        const fwd = (m!.x - 10) * Math.cos(facing) + (m!.y - 20) * Math.sin(facing);
        expect(fwd, `${gun} facing ${facing}: ahead of the body`).toBeGreaterThan(0.5);
        expect(m!.z, `${gun}: height`).toBeGreaterThan(1.05);
        expect(m!.z).toBeLessThan(2.0); // the operator model is drawn ~1.25x life size (2.36 m tall)
      }
    });
  }
});

import { shotStart } from '../src/render/muzzle';
describe('shot effects use the muzzle', () => {
  const ev = { e: 'shot', f: 3, x: 1, y: 1, x2: 9, y2: 1, z: 1.25, z2: 1, w: 'sr4', src: 'p', id: 1, hit: 'none' } as const;
  it('a shot with a known muzzle starts there', () => {
    expect(shotStart(ev as any, { x: 2, y: 1.1, z: 1.77 })).toEqual({ x: 2, y: 1.1, z: 1.77 });
  });
  it("no rig in view (or a muzzle far from the sim's shot point): the sim's own point", () => {
    expect(shotStart(ev as any, null)).toEqual({ x: 1, y: 1, z: 1.25 });
    expect(shotStart(ev as any, { x: 7, y: 7, z: 1.7 })).toEqual({ x: 1, y: 1, z: 1.25 }); // stale pose after a teleport
  });
});
