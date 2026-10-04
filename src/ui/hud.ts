import { h, clear } from './dom';
import { weapon, AMMO_NAMES } from '../config/weapons';
import { armoryArt } from '../render/armoryArt';
import { ITEM_NAMES, GRENADE_NAMES, ItemType, INJURY_THRESHOLD } from '../config/items';
import { bracketInfo, fmtTimeSafe } from './format';
import { Minimap } from './minimap';
import { TEAM_CSS, teamColorIndex, ViewSource } from '../render/view';
import { keyLabel, Settings, Action } from '../save/settings';
import type { SimEvent, PlayerState } from '../sim/state';
import { currentHoliday, HOLIDAY_NAME } from '../config/holiday';
import { torchCapacityMul } from '../sim/player';

/** Line icons for the item belt (24×24 viewBox, stroke = currentColor). */
const ICON_SVG: Record<ItemType, string> = {
  medkit: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2"/><path d="M12 10v7M8.5 13.5h7" stroke-width="2.4"/>',
  battery: '<rect x="7" y="4" width="10" height="17" rx="1.5"/><path d="M10 2.5h4"/><path d="M13 7.5l-3 5h4l-3 5" stroke-width="1.8"/>',
  plate: '<path d="M12 3l7 2.5v6c0 4.5-3 7.5-7 9.5-4-2-7-5-7-9.5v-6z"/><path d="M8.5 10.5l3.5 2.5 3.5-2.5"/><path d="M8.5 14.5l3.5 2.5 3.5-2.5"/>',
  drink: '<path d="M7.5 5.5h9l-.8 15a1.5 1.5 0 0 1-1.5 1.4H9.8a1.5 1.5 0 0 1-1.5-1.4z"/><path d="M8 3.5h8"/><path d="M13 9l-2.5 4h3L11 17" stroke-width="1.8"/>',
  food: '<path d="M4 11a8 5 0 0 1 16 0z"/><path d="M4 14.5h16"/><path d="M5 17.5h14a1 1 0 0 1-1 2H6a1 1 0 0 1-1-2z"/><path d="M8 8.5h.01M12 7.5h.01M15.5 8.5h.01" stroke-width="2.4"/>',
};
const GRENADE_SVG: Record<string, string> = {
  frag: '<ellipse cx="12" cy="14" rx="6" ry="7"/><path d="M9 5h6v2H9z"/><path d="M15 6l3-2"/><path d="M8 12h8M8 16h8M12 7v14"/>',
  flash: '<rect x="8" y="6" width="8" height="15" rx="2"/><path d="M9 4h6v2H9z"/><path d="M15 5l3-2"/><path d="M12 10l-2 4h4l-2 4"/>',
  smoke: '<rect x="7" y="8" width="10" height="13" rx="2"/><path d="M9 6h6v2H9z"/><path d="M5 5c1-2 3-2 4 0s3 2 4 0"/>',
  incendiary: '<rect x="8" y="8" width="8" height="13" rx="2"/><path d="M10 6h4v2h-4z"/><path d="M12 11c2 2 2 4 0 6-2-2-2-4 0-6z"/>',
  decoy: '<rect x="7" y="8" width="10" height="13" rx="2"/><path d="M9 6h6v2H9z"/><path d="M4 12c-1 2-1 4 0 6M20 12c1 2 1 4 0 6"/>',
};
const grenadeIcon = (g: string) => {
  const el = h('span', { class: 'gi' });
  el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GRENADE_SVG[g] ?? GRENADE_SVG.frag}</svg>`;
  return el;
};
const icon = (it: ItemType) => {
  const el = document.createElement('span');
  el.className = 'ic';
  el.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_SVG[it]}</svg>`;
  return el;
};

export class HUD {
  root = h('div', { class: 'hud' });
  private floorEl = h('div', { class: 'fl' });
  private bracketEl = h('div', { class: 'brk' });
  private objEl = h('div', { class: 'obj' });
  private teamEl = h('div', { class: 'team' });
  private hpBar = h('i'); private arBar = h('i'); private batBar = h('i');
  private hpBox = h('div', { class: 'vbar hp' }, this.hpBar);
  private arBox = h('div', { class: 'vbar ar' }, this.arBar, h('div', { class: 'cracks' }));
  private batBox = h('div', { class: 'vbar bat' }, this.batBar);
  private hpTxt = h('span'); private arTxt = h('span'); private batTxt = h('span');
  private status = h('div', { class: 'status' });
  private belt = h('div', { class: 'belt' });
  private wn = h('div', { class: 'wn' });
  private wimg = h('img', { class: 'wimg', alt: '' }) as HTMLImageElement;
  private wimgId = '';
  private am = h('div', { class: 'am' });
  private sub = h('div', { class: 'sub' });
  /** loadout strip: every carried weapon (primary / secondary / knife) with its key, thumbnail and ammo */
  private slots = h('div', { class: 'wslots' });
  private slotsKey = '';
  /** grenade row: one chip per carried type, the selected one highlighted ([cycle] switches, [throw] throws) */
  private gren = h('div', { class: 'wgren' });
  private grenKey = '';
  private rl = h('i');
  private feed = h('div', { class: 'feed' });
  private prompt = h('div', { class: 'prompt' });
  private holdBar = h('i');
  private hold = h('div', { class: 'hold' }, this.holdBar);
  private center = h('div', { class: 'center' });
  private banner = h('div', { class: 'banner' }, h('div', { class: 'b0' }), h('div', { class: 'b1' }), h('div', { class: 'b2' }));
  private spect = h('div', { class: 'spect' });
  private fps = h('div', { class: 'fps' });
  /** sandbox only: freeze / resume every exhibit animation */
  onSandboxAnim: (on: boolean) => void = () => {};
  private sbxAnim = true;
  private sbxBtn = h('button', { class: 'sbx-toggle', onclick: () => { this.sbxAnim = !this.sbxAnim; this.onSandboxAnim(this.sbxAnim); this.paintSbx(); } });
  private paintSbx() { this.sbxBtn.replaceChildren(h('span', { class: 'k' }, 'ANIMATIONS'), h('span', { class: `v ${this.sbxAnim ? 'on' : 'off'}` }, this.sbxAnim ? 'ON' : 'OFF')); }
  private mapFloor = h('div', { class: 'mf' });
  minimap = new Minimap();
  private cache = new Map<string, string>();
  private bannerT = 0;
  private fpsAcc = { t: 0, n: 0, v: 0 };

  constructor(private settings: Settings) {
    this.paintSbx();
    this.root.append(
      h('div', { class: 'tl' }, h('div', { class: 'floorbox' }, h('span', { class: 'jp' }, '階層・任務'), this.floorEl, this.bracketEl, this.objEl, h('i', { class: 'ticks' })), this.teamEl),
      this.feed,
      h('div', { class: 'bl' },
        h('div', { class: 'vitals' }, h('span', { class: 'jp' }, '体力・装甲'), h('i', { class: 'ticks' }),
          h('div', { class: 'vrow' }, h('span', {}, 'HEALTH'), this.hpBox, this.hpTxt),
          h('div', { class: 'vrow' }, h('span', {}, 'ARMOUR'), this.arBox, this.arTxt),
          h('div', { class: 'vrow' }, h('span', {}, 'TORCH'), this.batBox, this.batTxt),
          this.status),
        this.belt),
      h('div', { class: 'br' }, h('div', { class: 'weapon' }, h('span', { class: 'jp right' }, '武装'), this.wimg, this.wn, this.am, this.sub, h('div', { class: 'rl' }, this.rl), this.slots, this.gren), h('div', { class: 'minimap' }, h('span', { class: 'jp right' }, '地図'), this.minimap.canvas, this.mapFloor)),
      this.prompt, this.hold, this.center, this.banner, this.spect, this.fps, this.sbxBtn,
    );
  }

  setSettings(s: Settings) { this.settings = s; }
  setSandboxAnim(on: boolean) { this.sbxAnim = on; this.paintSbx(); }
  private k(a: Action) { return keyLabel(this.settings.bindings[a]); }
  private set(el: HTMLElement, key: string, v: string, html = false) {
    if (this.cache.get(key) === v) return;
    this.cache.set(key, v);
    if (html) el.innerHTML = v; else el.textContent = v;
  }

  showBanner(a: string, b: string, jp = '') {
    (this.banner.children[0] as HTMLElement).textContent = jp;
    (this.banner.children[1] as HTMLElement).textContent = a;
    (this.banner.children[2] as HTMLElement).textContent = b;
    this.banner.style.opacity = '1';
    this.bannerT = 3.5;
  }

  message(text: string, kind: string) {
    const m = h('div', { class: `msg ${kind}` }, text);
    this.feed.prepend(m);
    while (this.feed.children.length > 6) this.feed.lastChild!.remove();
    setTimeout(() => { m.style.transition = 'opacity 0.6s'; m.style.opacity = '0'; setTimeout(() => m.remove(), 700); }, 5200);
  }

  onEvents(evs: SimEvent[], localId: number, view: ViewSource) {
    for (const ev of evs) {
      if (ev.e === 'msg' && (ev.pid === -1 || ev.pid === localId)) this.message(ev.text, ev.k);
      if (ev.e === 'travel' && ev.pid === localId) {
        const bi = bracketInfo(ev.to);
        this.showBanner(ev.to === 0 ? 'POLICE CORDON' : `FLOOR ${ev.to}`, `${bi.name}${ev.via === 'elevator' ? ', by lift' : ev.via === 'stairs' ? ', by stairwell' : ''}`, ev.to === 0 ? '警察封鎖線' : `第${ev.to}階`);
      }
    }
    void view;
  }

  update(view: ViewSource, localId: number, dt: number, focusId: number) {
    const me = view.players.find((p) => p.id === localId);
    if (!me) return;
    const fp = view.players.find((p) => p.id === focusId) ?? me;
    this.fpsAcc.t += dt; this.fpsAcc.n++;
    if (this.fpsAcc.t > 0.5) { this.fpsAcc.v = Math.round(this.fpsAcc.n / this.fpsAcc.t); this.fpsAcc.t = 0; this.fpsAcc.n = 0; }
    this.set(this.fps, 'fps', this.settings.showFps ? `${this.fpsAcc.v} FPS` : '');
    // floor + objective
    const bi = bracketInfo(fp.floor);
    this.sbxBtn.style.display = fp.floor < 0 ? 'flex' : 'none';
    this.set(this.floorEl, 'fl', fp.floor < 0 ? 'SANDBOX' : fp.floor === 0 ? 'STREET' : `FLOOR ${fp.floor} / 200`);
    this.set(this.bracketEl, 'br', `${bi.name}${fp.floor >= 20 ? ` · darkness ${Math.round(view.floorState(fp.floor).L.darkness * 100)}%` : ''}`);
    const obj = view.objective.uploadStarted ? 'Hold the mainframe until the AI shuts down.' : fp.floor < 0 ? `Asset sandbox${currentHoliday() ? ` (${HOLIDAY_NAME[currentHoliday()!]})` : ''} — every model on display. No AI.` : fp.floor === 0 && !fp.checkedIn ? 'Check in with Police Chief Hollis at the blue tent, then gear up' : fp.floor === 0 ? 'Safe zone — check your gear, then breach the tower entrance (north).' : fp.floor >= 200 ? 'Reach the mainframe terminal and upload the virus.' : 'Find a working route up: stairwells ▲ or a powered lift.';
    this.set(this.objEl, 'obj', obj);
    this.set(this.mapFloor, 'mf', fp.floor < 0 ? 'SANDBOX' : fp.floor === 0 ? 'STREET' : `FL ${fp.floor}`);
    // team panel (coop)
    const others = view.players.filter((p) => p.id !== localId).sort((a, b) => a.slot - b.slot);
    const teamKey = others.map((p) => `${p.id}:${p.floor}:${p.life}:${Math.round(p.hp)}:${Math.ceil(p.downT)}:${p.connected}`).join('|');
    if (this.cache.get('team') !== teamKey) {
      this.cache.set('team', teamKey);
      clear(this.teamEl);
      for (const p of others) {
        const ci = teamColorIndex(view.players, localId, p.id);
        const col = TEAM_CSS[ci % 4];
        const d = p.floor - me.floor;
        const where = !p.connected ? 'OFFLINE' : d === 0 ? `FL ${p.floor} · here` : `FL ${p.floor} ${d > 0 ? '▲' : '▼'}${Math.abs(d)}`;
        const state = p.life === 'down' ? `DOWN ${Math.ceil(p.downT)}s` : p.life === 'out' ? 'KIA' : '';
        this.teamEl.append(h('div', { class: `tm ${p.life}` }, h('i', { class: 'sw', style: { background: col } }),
          h('span', { class: 'n', style: { color: col } }, p.name), h('span', { class: 'f' }, state || where),
          h('div', { class: 'hb' }, h('i', { style: { width: `${Math.max(0, p.hp)}%`, background: p.life === 'down' ? '#e04444' : undefined } }))));
      }
    }
    // vitals
    const hp = Math.max(0, me.hp);
    this.hpBar.style.width = `${hp}%`;
    this.hpBox.classList.toggle('low', hp < 35);
    this.set(this.hpTxt, 'hp', `${Math.ceil(hp)}`);
    this.arBar.style.width = `${me.armor}%`;
    // cracks show degradation: denser as armour wears
    (this.arBox.lastChild as HTMLElement).style.opacity = `${(1 - me.armor / 100) * ((me as any).vest ? 0.9 : 0)}`;
    this.set(this.arTxt, 'ar', (me as any).vest ? `${Math.ceil(me.armor)}` : '—');
    this.batBar.style.width = `${me.battery * 100}%`;
    this.batBox.classList.toggle('low', me.battery < 0.15);
    this.set(this.batTxt, 'bat', `${Math.round(me.battery * 240 * torchCapacityMul(me) / 60)}m`);
    const chips: string[] = [];
    if (me.injured) chips.push(`<span class="chip inj">INJURED −25% SPEED</span>`);
    if (me.boostT > 0) chips.push(`<span class="chip boost">BOOST ${Math.ceil(me.boostT)}s</span>`);
    if (me.torchOn) chips.push(`<span class="chip torch">TORCH ON</span>`);
    const fs = view.floorState(me.floor);
    const hunted = fs.enemies.some((e) => e.state === 'alert' && e.target === me.id);
    const searching = fs.enemies.some((e) => (e.state === 'search' || e.state === 'investigate' || e.state === 'suspicious'));
    chips.push(hunted ? `<span class="chip seen">HUNTED</span>` : searching ? `<span class="chip seen" style="opacity:.7">SUSPICION</span>` : me.exposure < 0.4 ? `<span class="chip stealth">HIDDEN</span>` : `<span class="chip stealth" style="opacity:.6">EXPOSED ${Math.round(me.exposure * 100)}%</span>`);
    if (me.cheats?.god) chips.push(`<span class="chip" style="color:#ffc24a;border-color:#7a5a1a">GOD</span>`);
    if (me.cheats?.ammo) chips.push(`<span class="chip" style="color:#ffc24a;border-color:#7a5a1a">∞ AMMO</span>`);
    if (me.helmet) chips.push(`<span class="chip" style="color:#9ab;border-color:#456">HELMET</span>`);
    this.set(this.status, 'chips', chips.join(''), true);
    // belt
    const beltKey = `${me.itemSel}:${Object.values(me.items).join(',')}`;
    if (this.cache.get('belt') !== beltKey) {
      this.cache.set('belt', beltKey);
      clear(this.belt);
      (['medkit', 'battery', 'plate', 'drink', 'food'] as ItemType[]).forEach((it, i) => {
        const key = this.k(`item${i + 1}` as Action);
        const label = { medkit: 'Health', battery: 'Battery', plate: 'Armour', drink: 'Energy', food: 'Snack' }[it];
        this.belt.append(h('div', { class: `bi ${me.itemSel === it ? 'sel' : ''} ${me.items[it] ? '' : 'zero'}`, title: `${ITEM_NAMES[it]} — ${key} to select, ${this.k('use')} to use` },
          h('span', { class: 'k' }, key), icon(it), h('span', { class: 'lb' }, label), h('span', { class: 'ct' }, String(me.items[it]))));
      });
    }
    // weapon
    const wi = me.sel === 'knife' ? null : me.weapons[me.sel];
    const artId = wi ? wi.id : '';
    if (artId !== this.wimgId) {
      this.wimgId = artId;
      const url = artId ? armoryArt(artId, true) : null;
      if (url) this.wimg.src = url;
      this.wimg.style.display = url ? 'block' : 'none';
      this.wimg.parentElement?.classList.toggle('noimg', !url);
    }
    if (wi) {
      const w = weapon(wi.id);
      this.set(this.wn, 'wn', `${w.name}${me.reloadT > 0 ? ' · RELOADING' : ''}`);
      const empty = wi.mag === 0;
      this.am.classList.toggle('empty', empty && me.ammo[w.ammo] === 0);
      this.set(this.am, 'am', `${wi.mag}<small> / ${me.ammo[w.ammo]}</small>`, true);
      this.rl.style.width = me.reloadT > 0 ? `${(1 - me.reloadT / (me.reloadDur || w.reload)) * 100}%` : '0%';
      this.set(this.sub, 'sub', `${AMMO_NAMES[w.ammo]} · knife [${this.k('melee')}]`);
    } else {
      this.set(this.wn, 'wn', 'COMBAT KNIFE');
      this.am.classList.remove('empty');
      this.set(this.am, 'am', '∞<small> melee</small>', true);
      this.rl.style.width = '0%';
      this.set(this.sub, 'sub', 'Back-stab unaware targets');
    }
    // loadout strip
    const P = me.weapons.primary, S = me.weapons.secondary;
    const sk = `${me.sel}|${P?.id}:${P?.mag}|${S?.id}:${S?.mag}|${P ? me.ammo[weapon(P.id).ammo] : ''}|${S ? me.ammo[weapon(S.id).ammo] : ''}`;
    if (sk !== this.slotsKey) {
      this.slotsKey = sk;
      const chip = (slot: 'primary' | 'secondary' | 'knife', key: string, wi: { id: string; mag: number } | null) => {
        const w = wi ? weapon(wi.id) : null;
        const url = w ? armoryArt(wi!.id, true) : null;
        return h('div', { class: `wslot ${me.sel === slot ? 'on' : ''} ${slot !== 'knife' && !wi ? 'empty' : ''}` },
          h('span', { class: 'k' }, key),
          url ? h('img', { src: url, alt: '' }) : h('span', { class: 'ico' }, slot === 'knife' ? '🗡' : '—'),
          h('span', { class: 'nm' }, slot === 'knife' ? 'Knife' : w ? w.name : 'Empty'),
          h('span', { class: 'ct' }, w ? `${wi!.mag}/${me.ammo[w.ammo]}` : slot === 'knife' ? '∞' : ''));
      };
      this.slots.replaceChildren(chip('primary', this.k('slot1'), P), chip('secondary', this.k('slot2'), S), chip('knife', this.k('slot3'), null));
    }
    // grenade row
    const types = (Object.keys(GRENADE_NAMES) as (keyof typeof GRENADE_NAMES)[]).filter((g) => me.grenades[g] > 0);
    const gk = `${me.grenadeSel}|${types.map((g) => g + me.grenades[g]).join(',')}|${this.k('cycleGrenade')}${this.k('grenade')}`;
    if (gk !== this.grenKey) {
      this.grenKey = gk;
      if (!types.length) this.gren.replaceChildren(h('div', { class: 'wg-none' }, 'No grenades'));
      else this.gren.replaceChildren(
        h('div', { class: 'wg-keys' }, h('span', {}, `Grenades`), h('span', {}, `[${this.k('cycleGrenade')}] switch · [${this.k('grenade')}] throw`)),
        h('div', { class: 'wg-row' }, ...types.map((g) => h('div', { class: `wg${g === me.grenadeSel ? ' on' : ''}`, title: GRENADE_NAMES[g] }, grenadeIcon(g), h('span', { class: 'nm' }, GRENADE_NAMES[g]), h('span', { class: 'ct' }, `×${me.grenades[g]}`)))));
    }
    // prompt & hold
    const pr = me.prompt ? me.prompt.replaceAll('{interact}', `<kbd>${this.k('interact')}</kbd>`) : '';
    this.set(this.prompt, 'prompt', me.life === 'alive' && !(me as any).panel ? pr : '', true);
    this.hold.style.display = me.hold ? 'block' : 'none';
    if (me.hold) this.holdBar.style.width = `${(me.hold.t / me.hold.need) * 100}%`;
    // center: upload timer
    if (view.objective.uploadStarted && !view.objective.done) this.set(this.center, 'c', `<div class="upload">VIRUS UPLOAD · AI SHUTDOWN IN</div><div class="upload"><span class="t">${fmtTimeSafe(view.objective.uploadT)}</span></div>`, true);
    else if (me.ride) this.set(this.center, 'c', `<div class="upload">ELEVATOR · FLOOR ${me.ride.to}</div>`, true);
    else this.set(this.center, 'c', '');
    // spectate / downed
    let sp = '';
    if (me.life === 'down') sp = `YOU ARE DOWN — ${Math.ceil(me.downT)}s<br><span style="color:#aaa;font-size:12px">A teammate must reach you with a Health Kit</span>`;
    else if (me.life === 'out' && fp.id !== me.id) sp = `ELIMINATED — spectating ${fp.name}`;
    this.set(this.spect, 'sp', sp, true);
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.banner.style.opacity = '0'; }
    this.minimap.draw(view, localId, focusId);
    void INJURY_THRESHOLD;
  }
}
