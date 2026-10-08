/**
 * Minecraft-style hotbar: slots 0-2 are the primary, secondary and knife; 3-7 are the item belt
 * (health, battery, plate, drink, snack). The mouse wheel steps through them, skipping a weapon slot you have no gun in.
 */
export const HOTBAR = 8;
export function hotbarStep(i: number, delta: number, has: { primary: boolean; secondary: boolean }): number {
  const dir = Math.sign(delta) || 1;
  for (let n = 0; n < HOTBAR; n++) {
    i = (((i + dir) % HOTBAR) + HOTBAR) % HOTBAR;
    if ((i === 0 && !has.primary) || (i === 1 && !has.secondary)) continue;
    return i;
  }
  return i;
}

/** Standard-gamepad buttons, laid out like Minecraft on console (LS click sprint, RS click sneak, B drop, Y interact, bumpers = hotbar). */
export const PAD = { jump: 0, drop: 1, reload: 2, interact: 3, hotPrev: 4, hotNext: 5, aim: 6, fire: 7, ping: 8, pause: 9, sprint: 10, crouch: 11, torch: 12, use: 13, knife: 14, grenade: 15 } as const;

/** D-pad right: tap = throw; hold = switch grenade type (after 0.35 s, then every 0.5 s); releasing after a hold doesn't throw. */
export function grenadeButton(down: boolean, s: { t: number; cycled: number }, dt: number): { s: { t: number; cycled: number }; out: 'throw' | 'cycle' | null } {
  if (down) {
    const t = s.t + dt;
    if (t >= 0.35 + 0.5 * s.cycled) return { s: { t, cycled: s.cycled + 1 }, out: 'cycle' };
    return { s: { t, cycled: s.cycled }, out: null };
  }
  return { s: { t: 0, cycled: 0 }, out: s.t > 0 && s.cycled === 0 ? 'throw' : null };
}

/**
 * Right mouse: hold to aim, or a quick click (under 250 ms, e.g. a two-finger trackpad tap on a Mac, which can't
 * hold a right-click and left-click at once) to lock the scope on; the next quick click releases it.
 */
export function scopeClick(s: { latched: boolean; downAt: number }, ev: 'down' | 'up', now: number): { latched: boolean; downAt: number } {
  if (ev === 'down') return { ...s, downAt: now };
  return { latched: now - s.downAt < 250 ? !s.latched : false, downAt: 0 };
}

/**
 * Ctrl/Cmd + wheel zooms (a trackpad pinch arrives as Ctrl + small fractional deltas), but with Ctrl as the sprint key
 * a real mouse-wheel step while sprinting is a hotbar step, not a zoom.
 */
export function wheelIsZoom(e: { ctrlKey: boolean; metaKey: boolean; deltaY: number }, ctrlSprinting: boolean): boolean {
  if (e.metaKey) return true;
  if (!e.ctrlKey) return false;
  return !(ctrlSprinting && Math.abs(e.deltaY) >= 40);
}
