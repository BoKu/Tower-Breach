/**
 * Player appearance (cosmetic only: no effect on stealth or gameplay). Shared by the armory UI, the renderer, the
 * single-player save and co-op (the authority sanitises what clients send). No DOM or three.js imports here.
 */
export const CAMOS = ['solid', 'woodland', 'desert', 'urban', 'tiger'] as const;
export type Camo = (typeof CAMOS)[number];
export const CAMO_NAME: Record<Camo, string> = { solid: 'Solid', woodland: 'Woodland', desert: 'Desert digital', urban: 'Urban', tiger: 'Tiger stripe' };

/** skin: index into SKIN_TONES; h (degrees), s, l: the uniform's base colour; contrast: camo strength 0..1; balaclava: knit face cover (eyes only) */
export interface PlayerLook { skin: number; h: number; s: number; l: number; camo: Camo; contrast: number; balaclava: boolean }

/** Light to deep. */
export const SKIN_TONES = [0xe6c1a2, 0xe4b897, 0xd09d78, 0xb88c6a, 0x9a6a4a, 0x7c5034, 0x5c3a24, 0x3e2618];
/** Slider ranges (brightness stays mid-dark so operators read as operators, never glowing white). */
export const LOOK_RANGE = { h: [0, 359], s: [0, 0.8], l: [0.12, 0.6], contrast: [0, 1] } as const;
/** Uniform presets [h, s, l]: olive drab, ranger green, coyote, khaki, tan, navy, urban grey, black, maroon, slate. */
export const UNIFORM_PRESETS: [number, number, number][] = [
  [75, 0.14, 0.28], [90, 0.16, 0.24], [33, 0.3, 0.4], [45, 0.32, 0.5], [38, 0.24, 0.44], [220, 0.35, 0.2], [210, 0.07, 0.38], [220, 0.06, 0.13], [355, 0.38, 0.24], [200, 0.16, 0.32],
];
export const DEFAULT_LOOK: PlayerLook = { skin: 3, h: 75, s: 0.14, l: 0.28, camo: 'woodland', contrast: 0.55, balaclava: false };

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Untrusted (network / old save) look -> a valid one: numbers clamped, unknown camo or skin -> default. Never throws. */
export function sanitizeLook(x: unknown): PlayerLook {
  if (!x || typeof x !== 'object') return { ...DEFAULT_LOOK };
  const o = x as Record<string, unknown>, d = DEFAULT_LOOK, r2 = (v: number) => Math.round(v * 100) / 100;
  const skin = num(o.skin);
  return {
    skin: skin !== null && skin >= 0 && skin < SKIN_TONES.length ? Math.floor(skin) : d.skin,
    h: Math.round(clamp(num(o.h) ?? d.h, LOOK_RANGE.h)), s: r2(clamp(num(o.s) ?? d.s, LOOK_RANGE.s)), l: r2(clamp(num(o.l) ?? d.l, LOOK_RANGE.l)),
    camo: (CAMOS as readonly unknown[]).includes(o.camo) ? (o.camo as Camo) : d.camo,
    contrast: r2(clamp(num(o.contrast) ?? d.contrast, LOOK_RANGE.contrast)),
    balaclava: o.balaclava === true,
  };
}

export function randomLook(rnd = Math.random): PlayerLook {
  const [h, s, l] = UNIFORM_PRESETS[Math.floor(rnd() * UNIFORM_PRESETS.length)];
  return sanitizeLook({ skin: Math.floor(rnd() * SKIN_TONES.length), h: (h + (rnd() - 0.5) * 30 + 360) % 360, s: s * (0.8 + rnd() * 0.4), l: l * (0.85 + rnd() * 0.3), camo: CAMOS[Math.floor(rnd() * CAMOS.length)], contrast: 0.3 + rnd() * 0.6, balaclava: rnd() < 0.3 });
}

/** Compact snapshot form [skin, h, s, l, camo index, contrast, balaclava 0/1] (sent for every player, so kept small). */
export const lookToWire = (l: PlayerLook) => [l.skin, l.h, l.s, l.l, CAMOS.indexOf(l.camo), l.contrast, l.balaclava ? 1 : 0];
export const lookFromWire = (a: unknown): PlayerLook | undefined =>
  Array.isArray(a) ? sanitizeLook({ skin: a[0], h: a[1], s: a[2], l: a[3], camo: CAMOS[a[4]], contrast: a[5], balaclava: a[6] === 1 }) : undefined;
