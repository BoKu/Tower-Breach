import { load, save } from './storage';
import type { Quality } from '../render/renderer';

export type Action =
  | 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'sprint' | 'crouch' | 'jump' | 'reload' | 'melee' | 'interact'
  | 'use' | 'cycleItem' | 'swap' | 'slot1' | 'slot2' | 'slot3' | 'grenade' | 'cycleGrenade' | 'torch' | 'ping' | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'zoomIn' | 'zoomOut' | 'pause';

export const ACTION_LABEL: Record<Action, string> = {
  moveUp: 'Move up', moveDown: 'Move down', moveLeft: 'Move left', moveRight: 'Move right', sprint: 'Sprint (hold)', crouch: 'Crouch',
  jump: 'Jump / vault', reload: 'Reload', melee: 'Knife attack', interact: 'Interact / loot / revive', use: 'Use selected item',
  cycleItem: 'Cycle item', swap: 'Swap weapon', slot1: 'Primary weapon', slot2: 'Secondary weapon', slot3: 'Knife',
  grenade: 'Throw grenade', cycleGrenade: 'Cycle grenade', torch: 'Toggle torch', ping: 'Ping / mark enemy',
  item1: 'Select health kit (belt 1)', item2: 'Select battery (belt 2)', item3: 'Select armour plate (belt 3)', item4: 'Select energy drink (belt 4)', item5: 'Select snack (belt 5)',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', pause: 'Pause / menu',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD', sprint: 'ShiftLeft', crouch: 'KeyC', jump: 'Space',
  reload: 'KeyR', melee: 'KeyV', interact: 'KeyE', use: 'KeyF', cycleItem: 'KeyX', swap: 'KeyQ', slot1: 'F1', slot2: 'F2',
  slot3: 'F3', grenade: 'KeyG', cycleGrenade: 'KeyB', torch: 'KeyT', ping: 'KeyZ',
  item1: 'Digit1', item2: 'Digit2', item3: 'Digit3', item4: 'Digit4', item5: 'Digit5', zoomIn: 'Equal', zoomOut: 'Minus', pause: 'Escape',
};

export interface Settings {
  quality: Quality;
  masterVol: number; sfxVol: number; musicVol: number;
  crouchToggle: boolean;
  aimAssist: boolean;
  /** light mouse assist: the crosshair snaps to a visible enemy within ~40 px (off = exact aim, no snap) */
  mouseAimAssist: boolean;
  showFps: boolean;
  bindings: Record<Action, string>;
  deadzone: number;
  screenShake: boolean;
  /** off | mirrors (live planar mirrors) | raytraced (mirrors + screen-space ray-marched floor reflections) */
  reflections: 'off' | 'mirrors' | 'raytraced';
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium', masterVol: 0.8, sfxVol: 0.9, musicVol: 0.7, crouchToggle: true, aimAssist: true, mouseAimAssist: true, showFps: false,
  bindings: { ...DEFAULT_BINDINGS }, deadzone: 0.18, screenShake: true, reflections: 'mirrors',
};

/** v2: number keys moved to the item belt (1-5); weapon slots to F1-F3. Older saved bindings are reset. */
export const BINDINGS_VERSION = 2;

export function loadSettings(): Settings {
  const s = load<Partial<Settings> & { bindingsVersion?: number }>('settings', {});
  const saved = (s.bindingsVersion ?? 1) >= BINDINGS_VERSION ? s.bindings ?? {} : {};
  const bindings = { ...DEFAULT_BINDINGS } as Record<Action, string>;
  for (const [a, c] of Object.entries(saved)) if (a in DEFAULT_BINDINGS) bindings[a as Action] = c as string;
  delete (s as { name?: string }).name; // callsigns are no longer stored (older saves had one)
  return { ...DEFAULT_SETTINGS, ...s, bindings };
}
export function saveSettings(s: Settings) { save('settings', { ...s, bindingsVersion: BINDINGS_VERSION }); }

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { Equal: '=', Minus: '-', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', Space: 'Space', Escape: 'Esc', Tab: 'Tab', AltLeft: 'L-Alt', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Mouse3: 'Mouse4', Mouse4: 'Mouse5', CapsLock: 'Caps' };
  return map[code] ?? code;
}

// ------------------------------------------------------------------ score records (Hall of Records)
/** One finished run. date: ISO 8601 (e.g. 2026-10-01T09:30:00.000Z); time: run length in seconds. */
export interface ScoreRecord { name: string; difficulty: 'normal' | 'hard' | 'insane'; floor: number; kills: number; time: number; won: boolean; date: string }
const MAX_RECORDS = 50;
/** Rank: wins first, then highest floor, then more kills, then faster. */
export function rankRecords(a: ScoreRecord, b: ScoreRecord) {
  return Number(b.won) - Number(a.won) || b.floor - a.floor || b.kills - a.kills || a.time - b.time;
}
export function loadRecords(): ScoreRecord[] { return load<ScoreRecord[]>('records', []); }
/** Store a run; returns its 1-based rank within its difficulty. */
export function addRecord(r: ScoreRecord): number {
  const all = [...loadRecords(), r].sort(rankRecords).slice(0, MAX_RECORDS);
  save('records', all);
  return all.filter((x) => x.difficulty === r.difficulty).indexOf(r) + 1;
}
