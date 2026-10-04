import { describe, it, expect, beforeEach } from 'vitest';
import { setup } from './helpers';
import { BELT } from '../src/sim/player';
import { damagePlayer } from '../src/sim/combat';
import { loadSettings, saveSettings, DEFAULT_BINDINGS } from '../src/save/settings';
import { _resetMemory, save } from '../src/save/storage';

describe('item belt', () => {
  it('hotkeys 1-5 only select the belt item; F uses it', () => {
    const { sim, p } = setup();
    expect(BELT).toEqual(['medkit', 'battery', 'plate', 'drink', 'food']);
    p.items = { medkit: 1, battery: 1, plate: 1, drink: 1, food: 1 };
    (p as any).vest = true;
    damagePlayer(sim, p, 40, 1, 'fire'); p.armor = 30; p.battery = 0.2;
    const sel = (n: number) => { p.input.useItem = n; p.input.useItemSeq++; sim.tick(1 / 60); };
    const use = () => { p.input.use++; sim.tick(1 / 60); };
    const hp0 = p.hp;
    sel(1); expect(p.itemSel).toBe('medkit'); expect(p.hp).toBe(hp0); expect(p.items.medkit).toBe(1);
    use(); expect(p.hp).toBe(100); expect(p.items.medkit).toBe(0);
    sel(2); expect(p.battery).toBe(0.2); use(); expect(p.battery).toBe(1);
    sel(3); use(); expect(p.armor).toBe(75);
    sel(4); expect(p.boostT).toBe(0); use(); expect(p.boostT).toBeGreaterThan(59);
    p.hp = 50; sel(5); expect(p.hp).toBe(50); use(); expect(p.hp).toBe(75);
  });
  it('mouse-wheel selection sets the selected slot used by the Use key', () => {
    const { sim, p } = setup();
    p.items.drink = 1;
    p.input.selItem = 3; p.input.selItemSeq++; sim.tick(1 / 60);
    expect(p.itemSel).toBe('drink');
    p.input.use++; sim.tick(1 / 60);
    expect(p.boostT).toBeGreaterThan(59);
  });
});

describe('key binding migration', () => {
  beforeEach(() => {
    _resetMemory();
    const m: Record<string, string> = {};
    (globalThis as any).localStorage = { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => (m[k] = v), removeItem: (k: string) => delete m[k] };
  });
  it('old (v1) saved bindings are reset so 1-5 belong to the belt', () => {
    save('settings', { quality: 'high', bindings: { ...DEFAULT_BINDINGS, slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', cycleGrenade: 'Digit4' } });
    const s = loadSettings();
    expect(s.quality).toBe('high');
    expect(s.bindings.item1).toBe('Digit1');
    expect(s.bindings.slot1).toBe('F1');
    const values = Object.values(s.bindings);
    expect(new Set(values).size).toBe(values.length); // no duplicate keys
  });
  it('current-version custom bindings are kept', () => {
    const s = loadSettings();
    s.bindings.item5 = 'KeyK';
    saveSettings(s);
    expect(loadSettings().bindings.item5).toBe('KeyK');
  });
});

describe('dev cheats', () => {
  it('god takes no damage; ammo never spends rounds or grenades', () => {
    const { sim, fs, p } = setup();
    p.cheats = { god: true, ammo: true };
    damagePlayer(sim, p, 500, 1, 'bullet');
    expect(p.hp).toBe(100); expect(p.life).toBe('alive');
    const mag = p.weapons.primary!.mag;
    p.input.ax = p.x + 5; p.input.ay = p.y; p.input.fire = true;
    for (let i = 0; i < 60; i++) sim.tick(1 / 60);
    p.input.fire = false;
    expect(p.weapons.primary!.mag).toBe(mag);
    p.grenades.frag = 1; p.grenadeSel = 'frag'; p.input.grenade++; sim.tick(1 / 60);
    expect(p.grenades.frag).toBe(1);
    expect(fs.grenades.length).toBe(1);
  });
});
