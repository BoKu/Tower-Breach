import type { PlayerInput, PlayerState } from '../sim/state';
import { hotbarStep, PAD, grenadeButton, scopeClick, wheelIsZoom } from './hotbar';
import type { Action, Settings } from '../save/settings';

/** Camera-relative movement basis: camera sits at +x,+z looking toward -x,-z. */
const UP = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
const RIGHT = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };

const PRESS_ACTIONS: Partial<Record<Action, keyof PlayerInput>> = {
  jump: 'jump', reload: 'reload', melee: 'melee', use: 'use', swap: 'swap', grenade: 'grenade', cycleGrenade: 'cycleGrenade',
  cycleItem: 'cycleItem', torch: 'torch', ping: 'ping', drop: 'drop',
};

type Pad = { buttons: boolean[]; axes: number[] };

/** Fixed alternates that always work in addition to the (remappable) primary binding. */
const ALT_KEYS: Partial<Record<Action, string[]>> = {
  moveUp: ['ArrowUp'], moveDown: ['ArrowDown'], moveLeft: ['ArrowLeft'], moveRight: ['ArrowRight'], crouch: ['ShiftRight'],
};

export class Input {
  held = new Set<string>();
  counters: Record<string, number> = {};
  mouseNdc = { x: 0, y: 0 };
  mousePx = { x: 0, y: 0 };
  mouseL = false;
  mouseR = false;
  /** quick right-click scope lock (Mac trackpads) */
  private scope = { latched: false, downAt: 0 };
  wheel = 0;
  crouchOn = false;
  sprintPadOn = false;
  usingPad = false;
  padName = '';
  private prevPad: boolean[] = [];
  private slotSeq = 0;
  private pendingInteract = false;
  private useItemIdx = 0; private useItemSeq = 0;
  private selIdx = -1; private selSeq = 0; private selT = 0;
  /** hotbar cursor (0-2 weapons, 3-7 belt) for the mouse wheel; -1 = follow the equipped weapon */
  private hotIdx = -1;
  /** D-pad right tap/hold state (tap throws, hold switches grenade type) */
  private padGrenade = { t: 0, cycled: 0 };
  private padT = 0;
  /** pending camera zoom steps (Ctrl+wheel, -/= keys) */
  zoomSteps = 0;
  private slot = -1;
  private padAim = { x: 1, y: 0 };
  onAction: ((a: Action) => void) | null = null;
  /** When set, the next key/mouse press is captured for rebinding. */
  capture: ((code: string) => void) | null = null;
  enabled = true;

  constructor(private el: HTMLElement, private settings: Settings) {
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => { this.held.clear(); this.mouseL = this.mouseR = false; this.scope = { latched: false, downAt: 0 }; });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      this.mousePx = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.mouseNdc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
      this.usingPad = false;
    });
    el.addEventListener('mousedown', (e) => {
      if (this.capture) { this.capture('Mouse' + e.button); this.capture = null; e.preventDefault(); return; }
      // macOS turns Ctrl+click into a right-click; Ctrl is sprint here, so treat it as the left button (fire)
      const btn = e.button === 2 && e.ctrlKey && /Mac/i.test(navigator.platform) ? 0 : e.button;
      if (btn === 0) this.mouseL = true;
      if (btn === 2) { this.mouseR = true; this.scope = scopeClick(this.scope, 'down', performance.now()); }
      if (e.button === 1) { this.bump('ping'); e.preventDefault(); }
      this.usingPad = false;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 || (e.button === 2 && !this.mouseR)) this.mouseL = false;
      if (e.button === 2 && this.mouseR) { this.mouseR = false; this.scope = scopeClick(this.scope, 'up', performance.now()); }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // wheel scrolls the item belt; Ctrl/Cmd + wheel (or pinch) zooms the camera
    el.addEventListener('wheel', (e) => {
      const ctrlSprint = /^Control/.test(this.settings.bindings.sprint) && this.down('sprint');
      if (wheelIsZoom(e, ctrlSprint)) this.zoomSteps += Math.sign(e.deltaY); else this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('gamepadconnected', (e) => { this.padName = (e as GamepadEvent).gamepad.id; });
  }

  setSettings(s: Settings) { this.settings = s; }

  private actionFor(code: string): Action | null {
    for (const [a, c] of Object.entries(this.settings.bindings)) if (c === code) return a as Action;
    if (code === 'ControlLeft') return 'crouch';
    return null;
  }

  /** New session: the sim's fresh players start with zeroed press counters, so stale counts would replay as presses (torch, items). */
  reset() {
    this.counters = {}; this.crouchOn = false; this.sprintPadOn = false; this.pendingInteract = false;
    this.slot = -1; this.slotSeq = 0; this.useItemIdx = 0; this.useItemSeq = 0; this.selIdx = -1; this.selSeq = 0;
  }
  private bump(a: Action) { this.counters[a] = (this.counters[a] ?? 0) + 1; }

  private key(e: KeyboardEvent, down: boolean) {
    if (this.capture && down) { e.preventDefault(); this.capture(e.code); this.capture = null; return; }
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const a = this.actionFor(e.code);
    // keep game keys from triggering browser shortcuts (F1 help, Tab focus, space scroll, arrows)
    if ((a && ['Tab', 'Space', 'ControlLeft', 'KeyF', 'F1', 'F2', 'F3', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Equal', 'Minus'].includes(e.code)) || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.ctrlKey && a) e.preventDefault(); // Ctrl held (sprint): game keys must not fire browser shortcuts (Ctrl+S, Ctrl+D…)
    if (down) {
      if (e.repeat) return;
      this.held.add(e.code);
      this.usingPad = false;
      if (!a) return;
      if (a === 'pause') { this.onAction?.('pause'); return; }
      if (!this.enabled) return;
      if (a === 'crouch') this.crouchOn = !this.crouchOn;
      if (a === 'slot1' || a === 'slot2' || a === 'slot3') { this.slot = a === 'slot1' ? 0 : a === 'slot2' ? 1 : 2; this.slotSeq++; this.hotIdx = this.slot; }
      if (a.startsWith('item')) { this.useItemIdx = Number(a.slice(4)); this.useItemSeq++; this.selIdx = this.useItemIdx - 1; this.selT = performance.now(); this.hotIdx = 3 + this.selIdx; }
      if (a === 'zoomIn') this.zoomSteps -= 1;
      if (a === 'zoomOut') this.zoomSteps += 1;
      if (a === 'interact') this.pendingInteract = true;
      if (a === 'interact' || a === 'moveUp' || a === 'moveDown') this.onAction?.(a);
      if (PRESS_ACTIONS[a]) this.bump(a);
    } else this.held.delete(e.code);
  }

  /** A held binding (push-to-talk), whatever has focus in the game. */
  isHeld(a: Action) { return this.down(a); }

  private down(a: Action): boolean {
    const c = this.settings.bindings[a];
    if (c === 'Mouse0') return this.mouseL;
    if (c === 'Mouse2') return this.mouseR;
    if (this.held.has(c)) return true;
    const alt = ALT_KEYS[a];
    return !!alt && alt.some((k) => this.held.has(k));
  }

  private pollPad(): Pad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      this.padName = gp.id;
      return { buttons: gp.buttons.map((b) => b.pressed || b.value > 0.5), axes: gp.axes.slice() };
    }
    return null;
  }

  /**
   * Build the local player's input for this tick. `ground` converts mouse NDC to a world point.
   * `nearestEnemyDir` supports light aim assist for controllers.
   */
  build(inp: PlayerInput, p: PlayerState, ground: (x: number, y: number) => { x: number; y: number; h?: number }, assist?: (dirX: number, dirY: number) => { x: number; y: number } | null): void {
    const pad = this.pollPad();
    const dz = this.settings.deadzone;
    let mx = 0, my = 0;
    const ax = (this.down('moveRight') ? 1 : 0) - (this.down('moveLeft') ? 1 : 0);
    const ay = (this.down('moveUp') ? 1 : 0) - (this.down('moveDown') ? 1 : 0);
    if (!this.enabled) { inp.mx = 0; inp.my = 0; inp.fire = false; inp.aim = false; inp.interact = false; inp.sprint = false; return; }
    mx = RIGHT.x * ax + UP.x * ay;
    my = RIGHT.y * ax + UP.y * ay;
    let fire: boolean = this.mouseL;
    let aim = this.mouseR || this.scope.latched;
    let sprint = this.down('sprint');
    let interact = this.down('interact') || this.pendingInteract;
    let padCrouch = false;
    this.pendingInteract = false;
    let aimPt: { x: number; y: number; h?: number } = ground(this.mouseNdc.x, this.mouseNdc.y);
    if (pad) {
      const b = pad.buttons, a = pad.axes;
      const edge = (i: number) => this.prevPad.length > 0 && b[i] && !this.prevPad[i];
      const lx = Math.abs(a[0]) > dz ? a[0] : 0, ly = Math.abs(a[1]) > dz ? a[1] : 0;
      const rx = Math.abs(a[2]) > dz ? a[2] : 0, ry = Math.abs(a[3]) > dz ? a[3] : 0;
      // A pad only takes over on a fresh button press or a stick pushed well past the deadzone, so an idle
      // controller or a drifting stick can never swallow keyboard/mouse input.
      const freshButton = this.prevPad.length > 0 && b.some((x, i) => x && !this.prevPad[i]);
      const stickActive = Math.hypot(lx, ly) > 0.5 || Math.hypot(rx, ry) > 0.5;
      if (freshButton || stickActive) this.usingPad = true;
      if (this.usingPad) {
        if (!ax && !ay) {
          mx = RIGHT.x * lx + UP.x * -ly;
          my = RIGHT.y * lx + UP.y * -ly;
        }
        if (rx || ry) {
          const dx = RIGHT.x * rx + UP.x * -ry, dy = RIGHT.y * rx + UP.y * -ry;
          const l = Math.hypot(dx, dy);
          this.padAim = { x: dx / l, y: dy / l };
        } else if (lx || ly) {
          const l = Math.hypot(mx, my);
          if (l > 0.3 && !b[6]) this.padAim = { x: mx / l, y: my / l };
        }
        const reach = b[6] ? 11 : 7;
        aimPt = { x: p.x + this.padAim.x * reach, y: p.y + this.padAim.y * reach, h: NaN }; // stick aim fires flat
        if (this.settings.aimAssist && assist) { const t = assist(this.padAim.x, this.padAim.y); if (t) aimPt = { ...t, h: NaN }; }
        // Minecraft-on-console layout (see PAD in input/hotbar.ts)
        fire = b[PAD.fire] || fire;
        aim = b[PAD.aim] || aim;
        if (edge(PAD.sprint)) this.sprintPadOn = !this.sprintPadOn;
        if (!(lx || ly)) this.sprintPadOn = false;
        sprint = this.sprintPadOn || sprint;
        interact = b[PAD.interact] || interact;
        if (edge(PAD.jump)) this.bump('jump');
        if (edge(PAD.crouch)) this.crouchOn = !this.crouchOn;
        padCrouch = !!b[PAD.crouch]; // hold-to-crouch mode
        if (edge(PAD.reload)) this.bump('reload');
        if (edge(PAD.drop)) this.bump('drop');
        if (edge(PAD.knife)) this.bump('melee');
        if (edge(PAD.ping)) this.bump('ping');
        if (edge(PAD.pause)) this.onAction?.('pause');
        if (edge(PAD.torch)) this.bump('torch');
        if (edge(PAD.use)) this.bump('use');
        if (edge(PAD.interact)) this.onAction?.('interact');
        if (edge(PAD.hotPrev) || edge(PAD.hotNext)) this.wheel += edge(PAD.hotNext) ? 1 : -1; // bumpers step the hotbar like the mouse wheel
        const now = performance.now(), pdt = Math.min(0.1, (now - (this.padT || now)) / 1000);
        this.padT = now;
        const gb = grenadeButton(!!b[PAD.grenade], this.padGrenade, pdt);
        this.padGrenade = gb.s;
        if (gb.out === 'throw') this.bump('grenade');
        if (gb.out === 'cycle') this.bump('cycleGrenade');
      }
      this.prevPad = b;
    }
    inp.mx = mx; inp.my = my;
    inp.ax = aimPt.x; inp.ay = aimPt.y; inp.az = aimPt.h ?? NaN;
    inp.fire = fire; inp.aim = aim; inp.sprint = sprint; inp.interact = interact;
    inp.crouch = this.settings.crouchToggle ? this.crouchOn : this.down('crouch') || padCrouch;
    if (!this.settings.crouchToggle) this.crouchOn = false;
    if (sprint && this.crouchOn && (mx || my)) { this.crouchOn = false; inp.crouch = false; }
    for (const [a, k] of Object.entries(PRESS_ACTIONS)) (inp as any)[k] = this.counters[a] ?? 0;
    inp.slot = this.slot; inp.slotSeq = this.slotSeq;
    inp.useItem = this.useItemIdx; inp.useItemSeq = this.useItemSeq;
    // wheel -> Minecraft-style hotbar 1-8 (weapons 1-3 equip, belt 4-8 select); tracks its own cursor so fast
    // scrolls don't wait for a (network) round trip
    if (this.wheel) {
      let i = this.hotIdx >= 0 ? this.hotIdx : p.sel === 'primary' ? 0 : p.sel === 'secondary' ? 1 : 2;
      const has = { primary: !!p.weapons.primary, secondary: !!p.weapons.secondary };
      for (let n = 0; n < Math.abs(this.wheel); n++) i = hotbarStep(i, this.wheel, has);
      this.hotIdx = i;
      if (i < 3) { this.slot = i; this.slotSeq++; } else { this.selIdx = i - 3; this.selSeq++; this.selT = performance.now(); }
      this.wheel = 0;
    }
    inp.selItem = Math.max(0, this.selIdx); inp.selItemSeq = this.selSeq;
  }

  /** Menu navigation for gamepads: returns edge-triggered d-pad/face buttons. */
  menuPad(): { up: boolean; down: boolean; left: boolean; right: boolean; ok: boolean; back: boolean } {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((g) => g && g.connected);
    const r = { up: false, down: false, left: false, right: false, ok: false, back: false };
    if (!gp) return r;
    const b = gp.buttons.map((x) => x.pressed);
    const prev = (this as any)._menuPrev ?? [];
    const e = (i: number) => b[i] && !prev[i];
    const ay = gp.axes[1] ?? 0;
    const prevAy = (this as any)._menuAy ?? 0;
    r.up = e(12) || (ay < -0.6 && prevAy >= -0.6);
    r.down = e(13) || (ay > 0.6 && prevAy <= 0.6);
    r.left = e(14); r.right = e(15); r.ok = e(0); r.back = e(1) || e(9);
    (this as any)._menuPrev = b;
    (this as any)._menuAy = ay;
    return r;
  }
}
