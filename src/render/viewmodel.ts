import * as THREE from 'three';
import { buildGun, type GunKind, type GunModel } from './operator';

/**
 * First person: the gun in your hands, drawn in front of the camera (a child of it) on the overlay layer: rendered last,
 * after a depth clear, so walls, road markings and glowing props never cover it and mirrors never show it. It brings
 * its own light (scene lights don't reach that pass). Kicks back on each shot, dips while reloading, sways as you move.
 */
export class ViewModel {
  readonly root = new THREE.Group();
  private gun: GunModel | null = null;
  private key = '';
  private kick = 0;
  private bob = 0;

  constructor(camera: THREE.Camera, private layer: number) {
    camera.add(this.root); this.root.visible = false;
    const fill = new THREE.HemisphereLight(0xdfe6f0, 0x2a2a28, 2.4);
    const key = new THREE.DirectionalLight(0xffffff, 3.2); // from above and to the left, so its edges read
    key.position.set(-1, 1.5, 0.5); key.target.position.set(0, 0, -0.4);
    for (const l of [fill, key]) { l.layers.set(layer); this.root.add(l); }
    this.root.add(key.target);
  }

  set(kind: GunKind | null, suppressed: boolean) {
    const key = `${kind}|${suppressed}`;
    if (key === this.key) return;
    this.key = key;
    if (this.gun) { this.root.remove(this.gun.g); this.gun.g.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
    this.gun = null;
    if (!kind) return;
    const gm = buildGun(kind, true, suppressed);
    const glove = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.8 });
    for (const at of [gm.grip, gm.fore]) { // gloved hands on the grip and the foregrip
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.1), glove);
      hand.position.copy(at).add(new THREE.Vector3(0, -0.02, 0));
      gm.g.add(hand);
    }
    gm.g.rotation.y = Math.PI; // the model points +z; the camera looks down -z
    gm.g.traverse((o) => { o.layers.set(this.layer); o.castShadow = false; });
    this.root.add(gm.g);
    this.gun = gm;
  }

  onShot() { this.kick = 1; }

  /** reload: 0..1 progress or -1; moving: walking (sway) */
  update(dt: number, show: boolean, reload: number, moving: boolean, aiming: boolean) {
    this.root.visible = show && !!this.gun;
    if (!this.gun) return;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.bob += dt * (moving ? 8 : 1.5);
    const sway = moving ? 0.012 : 0.003;
    const dip = reload >= 0 ? Math.sin(Math.min(1, reload) * Math.PI) * 0.18 : 0;
    // hip: low right; aiming: brought in toward the centre
    const x = aiming ? 0.06 : 0.2, y = aiming ? -0.16 : -0.22;
    this.root.position.set(x + Math.sin(this.bob) * sway, y + Math.abs(Math.cos(this.bob)) * sway - dip, -0.42 + this.kick * 0.06);
    this.root.rotation.set(this.kick * 0.12 - dip * 1.5, 0, 0);
  }

  /** The muzzle in world space (sim coordinates), for bullet trails. */
  muzzleWorld(): { x: number; y: number; z: number } | null {
    if (!this.gun || !this.root.visible) return null;
    this.root.updateWorldMatrix(true, true);
    const v = this.gun.muzzle.clone().applyMatrix4(this.gun.g.matrixWorld);
    return { x: v.x, y: v.z, z: v.y };
  }
}
