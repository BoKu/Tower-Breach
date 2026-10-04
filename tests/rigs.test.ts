import { test, expect } from 'vitest';
import * as THREE from 'three';
import { OperatorRig } from '../src/render/operator';
import { Pigeon } from '../src/render/critters';
import { setHolidayOverride } from '../src/config/holiday';

// Rigs are built once per look and copied (cloneRig): a copy must own its bones and share its geometry.
test('rig copies own their bones and share geometry', () => {
  const a = OperatorRig.make(0xff2020, { outfit: 'loyalist', skin: 0x8a5a3c }), b = OperatorRig.make(0xff2020, { outfit: 'loyalist', skin: 0x8a5a3c });
  expect(a.root).not.toBe(b.root);
  const inTree = (r: OperatorRig, o: THREE.Object3D) => { let hit = false; r.root.traverse((x) => { if (x === o) hit = true; }); return hit; };
  for (const k of ['hips', 'chest', 'head', 'gunHolder', 'knife', 'strobe']) expect(inTree(b, (b as any)[k]), k).toBe(true);
  expect(inTree(b, (b as any).arm.R.hand)).toBe(true);
  const geos = (r: OperatorRig) => { const g: THREE.BufferGeometry[] = []; r.root.traverse((x) => { if ((x as THREE.Mesh).geometry) g.push((x as THREE.Mesh).geometry); }); return g; };
  expect(geos(a)).toEqual(geos(b));
  expect((a as any).strobe.material).not.toBe((b as any).strobe.material); // the IR strobe pulses per rig
  // animating one copy leaves the other alone
  b.setGun('rifle');
  b.update({ dt: 0.016, t: 1, x: 3, y: 4, z: 0, facing: 0, crouch: true, aiming: true, sprinting: false, firingRecently: false, life: 'alive', gun: 'rifle', aimPitch: 0, reload: -1, hurt: false, ground: 0 } as any);
  expect(b.root.position.x).toBe(3);
  expect(a.root.position.x).toBe(0);
  expect((a as any).gunHolder.children.length).toBe(0);
  expect(Pigeon.make(1).root).not.toBe(Pigeon.make(5).root);
});

// Holiday looks are part of the template key: an Easter dentist must not leak into normal play (or back).
test('Easter rigs are cached apart from the everyday look', () => {
  const geoCount = (r: { root: THREE.Object3D }) => { let n = 0; r.root.traverse((x) => { if ((x as THREE.Mesh).geometry) n++; }); return n; };
  const firstGeo = (r: OperatorRig) => { let g: THREE.BufferGeometry | undefined; (r as any).head.traverse((x: any) => { if (!g && x.geometry) g = x.geometry; }); return g; };
  const prev = setHolidayOverride(null);
  const plain = OperatorRig.make(0xff2020, { outfit: 'cyborg', skin: 0x8a5a3c });
  setHolidayOverride('easter');
  const easter = OperatorRig.make(0xff2020, { outfit: 'cyborg', skin: 0x8a5a3c });
  expect(firstGeo(easter)).not.toBe(firstGeo(plain));
  expect(geoCount(Pigeon.make(2))).toBeGreaterThan(0);
  setHolidayOverride(null);
  expect(firstGeo(OperatorRig.make(0xff2020, { outfit: 'cyborg', skin: 0x8a5a3c }))).toBe(firstGeo(plain));
  setHolidayOverride(prev);
});

// Walk cycle direction: a lifted foot must swing forward and a planted foot push back (not a moonwalk).
test('warden and ogre feet swing forward in the air and push back on the ground', async () => {
  const { WardenRig } = await import('../src/render/beasts');
  for (const ogre of [false, true]) {
    const w = new WardenRig(ogre), ankle = (w as any).legs[0].ankle as THREE.Object3D, v = new THREE.Vector3();
    const samples: { y: number; z: number }[] = [];
    // facing +z (root.rotation.y = 0), standing still in place with a walking velocity
    for (let i = 0; i < 400; i++) {
      w.update({ dt: 1 / 60, t: i / 60, x: 0, y: 0, facing: Math.PI / 2, state: 'chase', ground: 0, alert: false, vel: { vx: 0, vy: 1 } });
      w.root.updateMatrixWorld(true);
      ankle.getWorldPosition(v);
      if (i > 100) samples.push({ y: v.y, z: v.z });
    }
    const ys = samples.map((s) => s.y), mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    let air = 0, ground = 0;
    for (let i = 1; i < samples.length; i++) {
      const dz = samples[i].z - samples[i - 1].z;
      if (samples[i].y > mid) air += dz; else ground += dz;
    }
    expect(air, ogre ? 'ogre' : 'mech').toBeGreaterThan(0);
    expect(ground, ogre ? 'ogre' : 'mech').toBeLessThan(0);
  }
});
