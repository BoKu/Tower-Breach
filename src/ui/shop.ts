import { h, clear } from './dom';
import { WEAPONS, WeaponDef, CATEGORY_LABEL, AMMO_NAMES } from '../config/weapons';
import { GEAR, GEAR_BY_ID, GRENADE_MAX_TOTAL, GrenadeType, ItemType } from '../config/items';
import { DIFF_BASE, Difficulty } from '../config/difficulty';
import type { Loadout } from '../sim/state';
import { GRENADE_CAP } from '../sim/inventory';
import { armoryArt } from '../render/armoryArt';
import { createPlayer } from '../sim/player';

const art = (id: string, weaponItem: boolean) => { const u = armoryArt(id, weaponItem); return u ? h('img', { class: 'art', src: u, alt: '', draggable: 'false' }) : null; };

type Cat = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'sniper' | 'machine_gun' | 'armor' | 'grenade' | 'gear';
const CATS_JP: Record<string, string> = { pistol: '拳銃', smg: '短機関銃', shotgun: '散弾銃', rifle: '小銃', sniper: '狙撃銃', machine_gun: '機関銃', armor: '防具', grenade: '手榴弾', gear: '装備' };
const CATS: [Cat, string][] = [
  ['pistol', 'Pistols'], ['smg', 'SMGs'], ['shotgun', 'Shotguns'], ['rifle', 'Rifles'], ['sniper', 'Sniper / Marksman'],
  ['machine_gun', 'Machine Guns'], ['armor', 'Armour'], ['grenade', 'Grenades'], ['gear', 'Mission Gear'],
];

export function emptyLoadout(): Loadout {
  return { primary: null, secondary: 'p9', armor: 'none', grenades: {}, items: {}, mods: { bypass: false, torchmod: false, pouch: false } };
}

export function loadoutCost(lo: Loadout): number {
  let c = 0;
  if (lo.primary) c += WEAPONS.find((w) => w.id === lo.primary)!.price;
  if (lo.secondary !== 'p9') c += WEAPONS.find((w) => w.id === lo.secondary)!.price;
  if (lo.armor !== 'none') c += GEAR_BY_ID[lo.armor].price;
  for (const [g, n] of Object.entries(lo.grenades)) c += GEAR_BY_ID[g].price * (n ?? 0);
  for (const [i, n] of Object.entries(lo.items)) c += GEAR_BY_ID[i].price * (n ?? 0);
  for (const [m, on] of Object.entries(lo.mods)) if (on) c += GEAR_BY_ID[m].price;
  return c;
}

/** Validates a loadout against the budget and carry limits (also used by the multiplayer host). */
export function validLoadout(lo: Loadout, diff: Difficulty): boolean {
  if (loadoutCost(lo) > DIFF_BASE[diff].cash) return false;
  const tot = Object.values(lo.grenades).reduce((a, b) => a + (b ?? 0), 0);
  if (tot > GRENADE_MAX_TOTAL) return false;
  for (const [g, n] of Object.entries(lo.grenades)) if ((n ?? 0) > GRENADE_CAP[g as GrenadeType]) return false;
  for (const [i, n] of Object.entries(lo.items)) if ((n ?? 0) > GEAR_BY_ID[i].max) return false;
  if (lo.primary && WEAPONS.find((w) => w.id === lo.primary)?.slot !== 'primary') return false;
  if (WEAPONS.find((w) => w.id === lo.secondary)?.slot !== 'secondary') return false;
  return true;
}

export class Shop {
  root: HTMLElement;
  lo: Loadout;
  private cat: Cat = 'rifle';
  private budget: number;
  onDeploy: (lo: Loadout) => void = () => {};
  onBack: () => void = () => {};
  sound: (k: 'buy' | 'error' | 'click' | 'back') => void = () => {};
  onRendered: () => void = () => {};

  /** initial: start from an existing loadout (street re-kit); deployLabel: text of the confirm button */
  constructor(private diff: Difficulty, private title: string, private extra?: HTMLElement, initial?: Loadout, private deployLabel = 'Deploy', private backLabel = 'Back') {
    this.budget = DIFF_BASE[diff].cash;
    this.lo = initial ? JSON.parse(JSON.stringify(initial)) : emptyLoadout();
    this.root = h('div', { class: 'screen solid' });
    this.render();
  }
  get cash() { return this.budget - loadoutCost(this.lo); }

  private buyWeapon(w: WeaponDef) {
    const prev = w.slot === 'primary' ? this.lo.primary : this.lo.secondary;
    if (prev === w.id) { this.sell(w.slot); return; }
    const refund = prev ? (prev === 'p9' ? 0 : WEAPONS.find((x) => x.id === prev)!.price) : 0;
    if (w.price - refund > this.cash) { this.sound('error'); return; }
    if (w.slot === 'primary') this.lo.primary = w.id; else this.lo.secondary = w.id;
    this.sound('buy');
    this.render();
  }
  private sell(slot: string) {
    if (slot === 'primary') this.lo.primary = null;
    else if (slot === 'secondary') this.lo.secondary = 'p9';
    else if (slot === 'armor') this.lo.armor = 'none';
    this.sound('back');
    this.render();
  }
  private buyGear(id: string) {
    const g = GEAR_BY_ID[id];
    if (g.kind === 'armor') {
      if (this.lo.armor === id) return this.sell('armor');
      const refund = this.lo.armor !== 'none' ? GEAR_BY_ID[this.lo.armor].price : 0;
      if (g.price - refund > this.cash) return this.sound('error');
      this.lo.armor = id as Loadout['armor'];
    } else if (g.kind === 'grenade') {
      const n = this.lo.grenades[id as GrenadeType] ?? 0;
      const tot = Object.values(this.lo.grenades).reduce((a, b) => a + (b ?? 0), 0);
      if (n >= GRENADE_CAP[id as GrenadeType] || tot >= GRENADE_MAX_TOTAL || g.price > this.cash) return this.sound('error');
      this.lo.grenades[id as GrenadeType] = n + 1;
    } else if (g.kind === 'item') {
      const n = this.lo.items[id as ItemType] ?? 0;
      if (n >= g.max || g.price > this.cash) return this.sound('error');
      this.lo.items[id as ItemType] = n + 1;
    } else {
      const m = id as keyof Loadout['mods'];
      if (this.lo.mods[m]) this.lo.mods[m] = false;
      else { if (g.price > this.cash) return this.sound('error'); this.lo.mods[m] = true; }
    }
    this.sound('buy');
    this.render();
  }
  private dec(kind: 'g' | 'i', id: string) {
    const bag = (kind === 'g' ? this.lo.grenades : this.lo.items) as Record<string, number>;
    bag[id] = Math.max(0, (bag[id] ?? 0) - 1);
    if (!bag[id]) delete bag[id];
    this.sound('back');
    this.render();
  }

  render() {
    clear(this.root);
    const itemsEl = h('div', { class: 'items' });
    const wcat = (w: WeaponDef) => (w.category === 'heavy_pistol' ? 'pistol' : w.category);
    if (['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'machine_gun'].includes(this.cat)) {
      for (const w of WEAPONS.filter((w) => w.droppable && wcat(w) === this.cat)) {
        const owned = this.lo.primary === w.id || this.lo.secondary === w.id;
        const price = w.id === 'p9' ? 0 : w.price;
        const bar = (label: string, v: number) => [h('span', {}, label), h('div', { class: 'bar' }, h('i', { style: { width: `${Math.round(Math.max(0.04, Math.min(1, v)) * 100)}%` } }))];
        itemsEl.append(h('div', { class: `item ${owned ? 'owned' : ''} ${!owned && price > this.cash ? 'cant' : ''}`, onclick: () => this.buyWeapon(w) },
          art(w.id, true), h('div', { class: 'nm' }, w.name), h('div', { class: 'pr' }, price ? `$${price}` : 'ISSUED'),
          h('div', { class: 'ds' }, `${CATEGORY_LABEL[w.category]} · ${AMMO_NAMES[w.ammo]} · ${w.mag} rds${w.burst ? ' · burst' : w.auto ? ' · auto' : ''}. ${w.desc}`),
          h('div', { class: 'bars' }, ...bar('DAMAGE', (w.damage * w.pellets) / 170), ...bar('FIRE RATE', w.rps / 17), ...bar('ACCURACY', 1 - w.aimSpread / 0.12), ...bar('ARMOUR PEN', w.pen), ...bar('MOBILITY', (w.move - 0.75) / 0.25), ...bar('NOISE', w.noise / 34))));
      }
    } else {
      const gTot = Object.values(this.lo.grenades).reduce((a, b) => a + (b ?? 0), 0);
      const kind = this.cat === 'armor' ? 'armor' : this.cat === 'grenade' ? 'grenade' : null;
      for (const g of GEAR.filter((g) => (kind ? g.kind === kind : g.kind === 'item' || g.kind === 'mod'))) {
        const count = g.kind === 'grenade' ? this.lo.grenades[g.id as GrenadeType] ?? 0 : g.kind === 'item' ? this.lo.items[g.id as ItemType] ?? 0 : g.kind === 'armor' ? (this.lo.armor === g.id ? 1 : 0) : this.lo.mods[g.id as keyof Loadout['mods']] ? 1 : 0;
        itemsEl.append(h('div', { class: `item ${count ? 'owned' : ''} ${g.price > this.cash && !count ? 'cant' : ''}`, onclick: () => this.buyGear(g.id), oncontextmenu: (e: Event) => { e.preventDefault(); if (g.kind === 'grenade') this.dec('g', g.id); else if (g.kind === 'item') this.dec('i', g.id); } },
          art(g.id, false), h('div', { class: 'nm' }, g.name), h('div', { class: 'pr' }, `$${g.price}`),
          h('div', { class: 'ds' }, g.desc), h('div', { class: 'hint' }, g.kind === 'grenade' ? `×${count} · ${gTot}/${GRENADE_MAX_TOTAL} grenades carried · right-click to remove` : `${count}/${g.max}${g.kind === 'item' ? ' · right-click to remove' : ''}`)));
      }
    }
    const nameOf = (id: string) => WEAPONS.find((w) => w.id === id)!.name;
    // ammo you'll actually carry: the same kit builder the game uses (so the pouch bonus and caps are exact)
    const kit = createPlayer(0, 0, '', this.lo);
    const plain = this.lo.mods.pouch ? createPlayer(0, 0, '', { ...this.lo, mods: { ...this.lo.mods, pouch: false } }) : kit;
    const ammoLine = (id: string | null) => {
      if (!id) return null;
      const w = WEAPONS.find((x) => x.id === id)!;
      const res = kit.ammo[w.ammo], bonus = res - plain.ammo[w.ammo];
      return h('div', { class: 'ammo-line' }, `${w.mag} in mag · ${res} reserve`, bonus > 0 ? h('b', {}, ` (+${bonus} pouch)`) : '', h('span', {}, ` · ${AMMO_NAMES[w.ammo]}`));
    };
    const shared = this.lo.primary && WEAPONS.find((x) => x.id === this.lo.primary)!.ammo === WEAPONS.find((x) => x.id === this.lo.secondary)!.ammo;
    const slots: HTMLElement[] = [
      h('div', { class: 'slot col' }, h('div', { class: 'row1' }, h('span', {}, `Primary: ${this.lo.primary ? nameOf(this.lo.primary) : '— none —'}`), this.lo.primary ? h('span', { class: 'x', onclick: () => this.sell('primary') }, '✕') : null), ammoLine(this.lo.primary)),
      h('div', { class: 'slot col' }, h('div', { class: 'row1' }, h('span', {}, `Secondary: ${nameOf(this.lo.secondary)}`), this.lo.secondary !== 'p9' ? h('span', { class: 'x', onclick: () => this.sell('secondary') }, '✕') : null), shared ? h('div', { class: 'ammo-line' }, 'shares the primary\'s ammo pool') : ammoLine(this.lo.secondary)),
      h('div', { class: 'slot' }, h('span', {}, 'Melee: Combat Knife (never lost)')),
      h('div', { class: 'slot' }, h('span', {}, `Armour: ${this.lo.armor === 'none' ? '— none —' : GEAR_BY_ID[this.lo.armor].name}`), this.lo.armor !== 'none' ? h('span', { class: 'x', onclick: () => this.sell('armor') }, '✕') : null),
      h('div', { class: 'slot' }, h('span', {}, 'Mission: USB virus payload')),
    ];
    for (const [g, n] of Object.entries(this.lo.grenades)) if (n) slots.push(h('div', { class: 'slot' }, h('span', {}, `${GEAR_BY_ID[g].name} ×${n}`), h('span', { class: 'x', onclick: () => this.dec('g', g) }, '−')));
    for (const [i, n] of Object.entries(this.lo.items)) if (n) slots.push(h('div', { class: 'slot' }, h('span', {}, `${GEAR_BY_ID[i].name} ×${n}`), h('span', { class: 'x', onclick: () => this.dec('i', i) }, '−')));
    for (const [m, on] of Object.entries(this.lo.mods)) if (on) slots.push(h('div', { class: 'slot' }, h('span', {}, GEAR_BY_ID[m].name), h('span', { class: 'x', onclick: () => this.buyGear(m) }, '✕')));
    const warn = !this.lo.items.medkit ? h('div', { class: 'hint', style: { color: '#ff8080' } }, 'No health kits — injuries will slow you by 25% and you cannot revive teammates.') : null;
    this.root.append(
      h('div', { class: 'h2' }, this.title),
      h('div', { class: 'shop' },
        h('div', { class: 'cats panel' }, ...CATS.map(([c, n]) => h('div', { class: `cat ${c === this.cat ? 'on' : ''}`, onclick: () => { this.cat = c; this.sound('click'); this.render(); } }, h('span', {}, n), h('span', { class: 'k' }, CATS_JP[c])))),
        h('div', { class: 'panel', style: { display: 'flex', flexDirection: 'column', minHeight: 0 } }, itemsEl),
        h('div', { class: 'panel loadout' },
          h('div', { class: 'hint' }, 'Funds · 資金'), h('div', { class: 'cash' }, `$${this.cash}`),
          // the list scrolls so the confirm/back buttons always stay visible, however much gear is bought
          h('div', { class: 'lo-list' }, ...slots, warn, this.extra ? h('div', { style: { marginTop: 'auto' } }, this.extra) : null),
          h('button', { class: 'btn primary', onclick: () => this.onDeploy(this.lo) }, this.deployLabel),
          h('button', { class: 'btn small', onclick: () => this.onBack() }, this.backLabel))),
    );
    this.onRendered();
  }
}
