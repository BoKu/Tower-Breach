import { load, save } from './storage';
import type { Quality } from '../render/renderer';
import { sanitizeLook, type PlayerLook } from '../config/look';

export type Action =
  | 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'sprint' | 'crouch' | 'jump' | 'reload' | 'melee' | 'interact'
  | 'use' | 'cycleItem' | 'swap' | 'slot1' | 'slot2' | 'slot3' | 'grenade' | 'cycleGrenade' | 'torch' | 'ping' | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'zoomIn' | 'zoomOut' | 'pause' | 'voice' | 'drop';

export const ACTION_LABEL: Record<Action, string> = {
  moveUp: 'Move up', moveDown: 'Move down', moveLeft: 'Move left', moveRight: 'Move right', sprint: 'Sprint (hold)', crouch: 'Crouch',
  jump: 'Jump / vault', reload: 'Reload', melee: 'Knife attack', interact: 'Interact / loot / revive', use: 'Use selected item',
  cycleItem: 'Cycle item', swap: 'Swap weapon', slot1: 'Primary weapon', slot2: 'Secondary weapon', slot3: 'Knife',
  grenade: 'Throw grenade', cycleGrenade: 'Cycle grenade', torch: 'Toggle torch', ping: 'Ping / mark enemy',
  item1: 'Select health kit (belt 1)', item2: 'Select battery (belt 2)', item3: 'Select armour plate (belt 3)', item4: 'Select energy drink (belt 4)', item5: 'Select snack (belt 5)',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', pause: 'Pause / menu', voice: 'Push-to-talk (co-op voice)', drop: 'Drop a Health Kit (for a squadmate)',
};

export const DEFAULT_BINDINGS: Record<Action, string> = {
  // Minecraft-style: Ctrl sprints, Shift sneaks, Q drops, F swaps, 1-8 is the hotbar (weapons 1-3, belt 4-8)
  moveUp: 'KeyW', moveDown: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD', sprint: 'ControlLeft', crouch: 'ShiftLeft', jump: 'Space',
  reload: 'KeyR', melee: 'KeyV', interact: 'KeyE', use: 'KeyC', cycleItem: 'KeyX', swap: 'KeyF', drop: 'KeyQ',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', grenade: 'KeyG', cycleGrenade: 'KeyB', torch: 'KeyT', ping: 'KeyZ',
  item1: 'Digit4', item2: 'Digit5', item3: 'Digit6', item4: 'Digit7', item5: 'Digit8', zoomIn: 'Equal', zoomOut: 'Minus', pause: 'Escape',
  voice: 'KeyH', // V (the usual push-to-talk key) is the knife here
};

/** The desktop app (Electron) can use Ctrl; a browser can't (Ctrl+W closes the tab before the page sees it). */
export const isDesktop = () => /Electron/i.test(globalThis.navigator?.userAgent ?? '');
/** Default keys: Minecraft-style in the desktop app; in a browser sprint/crouch move off Ctrl (Shift / C). */
export function defaultBindings(desktop = isDesktop()): Record<Action, string> {
  return desktop ? { ...DEFAULT_BINDINGS } : { ...DEFAULT_BINDINGS, sprint: 'ShiftLeft', crouch: 'KeyC', use: 'KeyX', cycleItem: 'KeyN' };
}

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
  /** co-op proximity voice chat (src/audio/voice.ts) */
  voiceOn: boolean;
  /** ptt: hold the Push-to-talk key; open: transmit whenever you speak */
  voiceMode: 'ptt' | 'open';
  /** microphone deviceId ('' = system default) */
  voiceDevice: string;
  voiceVol: number;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 'medium', masterVol: 0.8, sfxVol: 0.9, musicVol: 0.7, crouchToggle: true, aimAssist: true, mouseAimAssist: true, showFps: false,
  bindings: defaultBindings(), deadzone: 0.18, screenShake: true, reflections: 'mirrors',
  voiceOn: true, voiceMode: 'ptt', voiceDevice: '', voiceVol: 1,
};

/** v3 (1.11.0): Minecraft-style defaults (Ctrl sprint, Shift crouch, Q drop, hotbar 1-8). Older saved bindings are reset. */
export const BINDINGS_VERSION = 3;

export function loadSettings(): Settings {
  const s = load<Partial<Settings> & { bindingsVersion?: number }>('settings', {});
  const saved = (s.bindingsVersion ?? 1) >= BINDINGS_VERSION ? s.bindings ?? {} : {};
  const bindings = defaultBindings();
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

/** The operator's appearance (armory Appearance tab), kept on this device. */
export const loadLook = (): PlayerLook => sanitizeLook(load('look', null));
export function saveLook(l: PlayerLook) { save('look', l); }

// ------------------------------------------------------------------ score records (Hall of Records)
/**
 * One finished run, won or lost. date: ISO 8601 (e.g. 2026-10-01T09:30:00.000Z); time: run clock in seconds
 * (from entering the tower, fractional). score and the stats after it arrived in 1.10.0; older records lack them.
 */
export interface ScoreRecord {
  name: string; difficulty: 'normal' | 'hard' | 'insane'; floor: number; kills: number; time: number; won: boolean; date: string;
  score?: number; knife?: number; accuracy?: number; hacks?: number; searches?: number; speed?: number;
  /** squadmates taken on the run (1.11.0+) */
  bots?: number;
}
const MAX_RECORDS = 100;
/** Score board: highest score first (records without a score last), then faster. */
export function rankRecords(a: ScoreRecord, b: ScoreRecord) {
  return (b.score ?? -1) - (a.score ?? -1) || a.time - b.time;
}
/** Speed board: wins first, then furthest floor, then fastest. */
export function rankBySpeed(a: ScoreRecord, b: ScoreRecord) {
  return Number(b.won) - Number(a.won) || b.floor - a.floor || a.time - b.time;
}
export function loadRecords(): ScoreRecord[] { return load<ScoreRecord[]>('records', []); }
/** Store a run; returns its 1-based rank within its difficulty. */
export function addRecord(r: ScoreRecord): number {
  const all = [...loadRecords(), r].sort(rankRecords).slice(0, MAX_RECORDS);
  save('records', all);
  return all.filter((x) => x.difficulty === r.difficulty).indexOf(r) + 1;
}
