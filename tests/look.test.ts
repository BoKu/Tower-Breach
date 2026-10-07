import { test, expect } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_LOOK, sanitizeLook, randomLook, lookToWire, lookFromWire, SKIN_TONES, type PlayerLook } from '../src/config/look';
import { loadLook, saveLook } from '../src/save/settings';
import { OperatorRig } from '../src/render/operator';
import { setHolidayOverride, HOLIDAYS } from '../src/config/holiday';
import { Sim } from '../src/sim/sim';
import { emptyLoadout } from '../src/sim/loadout';

const A: PlayerLook = { skin: 7, h: 33, s: 0.3, l: 0.42, camo: 'desert', contrast: 0.8, balaclava: false };
const B: PlayerLook = { skin: 0, h: 210, s: 0.07, l: 0.38, camo: 'urban', contrast: 0.4, balaclava: false };

test('looks are sanitised: garbage -> default, numbers clamped, unknown camo / skin rejected', () => {
  for (const g of [null, undefined, 42, 'x', [], { skin: 'a' }]) expect(sanitizeLook(g).camo).toBe(DEFAULT_LOOK.camo);
  expect(sanitizeLook(null)).toEqual(DEFAULT_LOOK);
  const c = sanitizeLook({ skin: 99, h: 999, s: -3, l: 5, camo: 'clown', contrast: 1e9 });
  expect(c).toEqual({ skin: DEFAULT_LOOK.skin, h: 359, s: 0, l: 0.6, camo: DEFAULT_LOOK.camo, contrast: 1, balaclava: false });
  expect(sanitizeLook({ ...A, h: NaN, skin: -1, contrast: Infinity })).toMatchObject({ h: DEFAULT_LOOK.h, skin: DEFAULT_LOOK.skin, contrast: DEFAULT_LOOK.contrast });
  expect(sanitizeLook({ ...A, skin: 2.7 }).skin).toBe(2);
  expect(sanitizeLook(A)).toEqual(A);
  for (let i = 0; i < 50; i++) { const r = randomLook(); expect(sanitizeLook(r)).toEqual(r); }
  expect(lookFromWire(lookToWire(A))).toEqual(A);
  expect(lookFromWire(undefined)).toBeUndefined();
  // balaclava: only a real true counts (junk -> off), and it survives the network form both ways
  expect(sanitizeLook({ ...A, balaclava: 'yes' }).balaclava).toBe(false);
  for (const b of [true, false]) expect(lookFromWire(lookToWire({ ...A, balaclava: b }))!.balaclava).toBe(b);
  expect(lookFromWire(['x', 1e6, 9, 9, 99, -1])).toMatchObject({ camo: DEFAULT_LOOK.camo, h: 359, contrast: 0 });
});

test('the look is kept on the device and in the single-player save', () => {
  saveLook(A);
  expect(loadLook()).toEqual(A);
  const sim = new Sim({ seed: 5, difficulty: 'normal', mode: 'single', holiday: null });
  const p = sim.addPlayer(1, 'Op', emptyLoadout());
  p.look = B;
  const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.exportSave(p))), 1).player(1)!;
  expect(back.look).toEqual(B);
});

const geos = (r: OperatorRig) => { const g: THREE.BufferGeometry[] = []; r.root.traverse((x) => { if ((x as THREE.Mesh).geometry) g.push((x as THREE.Mesh).geometry); }); return g; };
/** materials, minus the IR strobe's (cloned per rig so it pulses per rig) */
const mats = (r: OperatorRig) => { const m = new Set<THREE.Material>(); r.root.traverse((x) => { const mm = (x as THREE.Mesh).material; if (mm && !Array.isArray(mm) && x !== (r as any).strobe) m.add(mm); }); return m; };
const chestGeo = (r: OperatorRig) => ((r as any).chest.children[0].children[0] as THREE.Mesh).geometry;

test('rigs: each look gets its own geometry and camo materials; the same look reuses the cached template', () => {
  const a = OperatorRig.make(0x35d8ff, { player: A }), a2 = OperatorRig.make(0x35d8ff, { player: { ...A } }), b = OperatorRig.make(0x35d8ff, { player: B });
  expect(geos(a2)).toEqual(geos(a));
  expect([...mats(a2)]).toEqual([...mats(a)]);
  const shared = [...mats(a)].filter((m) => mats(b).has(m));
  for (const m of shared) expect((m as any).isMeshBasicMaterial || (m as any).metalness > 0.5, 'only emissive/gun materials are shared').toBe(true);
  expect(chestGeo(a).getAttribute('color')).not.toBe(chestGeo(b).getAttribute('color'));
  expect(Array.from(chestGeo(a).getAttribute('color').array)).not.toEqual(Array.from(chestGeo(b).getAttribute('color').array));
  // uniform cloth is tagged for the camo shader, gear is not
  const camo = Array.from(chestGeo(a).getAttribute('camo').array as Float32Array);
  expect(camo.some((v) => v > 0.5) && camo.some((v) => v === 0)).toBe(true);
  const key = (m: THREE.Material) => m.customProgramCacheKey();
  expect([...mats(a)].some((m) => key(m).includes('camo'))).toBe(true);
});

test('A-pose: arms hang down and out (~40 degrees), not horizontal', () => {
  const r = OperatorRig.make(0x35d8ff, { player: A });
  r.update({ dt: 0.016, t: 1, x: 0, y: 0, z: 0, facing: 0, crouch: false, aiming: false, sprinting: false, firingRecently: false, life: 'alive', gun: null, aimPitch: 0, reload: -1, hurt: false, pose: 'apose', vel: { vx: 0, vy: 0 } });
  for (const [s, sx] of [['L', -1], ['R', 1]] as const) {
    const d = new THREE.Vector3(0, -1, 0).applyQuaternion((r as any).arm[s].up.quaternion);
    const fromDown = THREE.MathUtils.radToDeg(d.angleTo(new THREE.Vector3(0, -1, 0)));
    expect(fromDown).toBeGreaterThan(28); expect(fromDown).toBeLessThan(50);
    expect(Math.sign(d.x)).toBe(sx);
  }
  expect((r as any).knife.visible).toBe(false);
});

test('holiday themes never change the player operator look', () => {
  const colors = (r: OperatorRig) => geos(r).map((g) => Array.from(g.getAttribute('color')?.array ?? []).join());
  const prev = setHolidayOverride(null);
  const plain = colors(OperatorRig.make(0x35d8ff, { player: A }));
  for (const h of HOLIDAYS) { setHolidayOverride(h); expect(colors(OperatorRig.make(0x35d8ff, { player: A })), h).toEqual(plain); }
  setHolidayOverride(prev);
  expect(SKIN_TONES.length).toBe(8);
});
