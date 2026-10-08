import { HackUI } from '../ui/hack';
import { CheckInUI } from '../ui/checkin';
import { portraitImg } from '../render/portrait';
import { equipLoadout } from '../sim/player';
import { DialogueUI } from '../ui/dialogue';
import { npcFor } from '../config/npcs';
import { h, clear } from '../ui/dom';
import { Shop, emptyLoadout } from '../ui/shop';
import { HUD } from '../ui/hud';
import { Skyline } from '../ui/skyline';
import { GameRenderer, Quality } from '../render/renderer';
import { GameAudio } from '../audio/audio';
import { Input } from '../input/input';
import { Sim } from '../sim/sim';
import { HostSession } from '../net/host';
import { ClientSession, ClientView } from '../net/client';
import { defaultServerUrl, normalizeServerAddress } from '../net/transport';
import { loadSettings, saveSettings, Settings, ACTION_LABEL, defaultBindings, isDesktop, keyLabel, Action, loadRecords, addRecord, loadLook, rankRecords, rankBySpeed, type ScoreRecord } from '../save/settings';
import { finalScore, runTime, fmtRunTime, scoreRows } from '../sim/score';
import { playCredits } from '../ui/credits';
import { keypadCode } from '../sim/hack';
import { makeSquad, type SquadPick } from '../sim/bot';
import { BOT_CLASS, BOT_CLASSES, SQUAD_MEMBERS } from '../config/bots';
import { load, save, remove, storageAvailable } from '../save/storage';
import { randomSeed } from '../core/rng';
import { DIFFICULTIES, Difficulty, DIFF_BASE, FINAL_FLOOR } from '../config/difficulty';
import { weapon } from '../config/weapons';
import { dist, angleTo, fmtTime } from '../core/math';
import { canSee } from '../sim/combat';
import type { Loadout, PlayerState } from '../sim/state';
import type { ViewSource } from '../render/view';
import { currentHoliday } from '../config/holiday';
import { NameTags } from '../ui/nametags';
import { VoiceChat, voiceUnsupported } from '../audio/voice';
import { voiceGain } from '../net/voice';
import { lineOfSight } from '../sim/nav';
import { perfOn, perfFrame, perfFrameStage } from '../core/perf';

/**
 * Gamepad focus step on screen: the nearest item in the pushed direction (so 2-D grids like the hacking console's
 * key cells work), falling back to the next/previous item in document order at the edges.
 */
function spatialStep(items: HTMLElement[], cur: number, dx: number, dy: number): number {
  const r = items.map((i) => i.getBoundingClientRect());
  const cx = (k: number) => r[k].left + r[k].width / 2, cy = (k: number) => r[k].top + r[k].height / 2;
  let best = -1, bestS = Infinity;
  for (let k = 0; k < items.length; k++) {
    if (k === cur || !r[k].width) continue;
    const ox = cx(k) - cx(cur), oy = cy(k) - cy(cur);
    const along = dx ? ox * dx : oy * dy, across = dx ? Math.abs(oy) : Math.abs(ox);
    if (along <= 2) continue;
    const s = along + across * 2;
    if (s < bestS) { bestS = s; best = k; }
  }
  if (best >= 0) return best;
  const step = dx + dy > 0 ? 1 : -1;
  return (cur + step + items.length) % items.length;
}

/** Running inside the Electron desktop app (desktop/main.cjs) rather than a browser. */
const DESKTOP = navigator.userAgent.includes('Electron');
/** Why the microphone didn't open, in words a player can act on (macOS needs the app allowed in System Settings). */
const micBlockedWhy = (e: unknown) => (e as Error)?.name === 'NotAllowedError'
  ? (DESKTOP && /Mac/.test(navigator.platform) ? 'macOS blocked the microphone: allow Tower Breach in System Settings → Privacy & Security → Microphone, then restart the game' : 'the microphone was blocked: allow it for this page')
  : (e as Error)?.message || 'microphone blocked';
import { APP_VERSION } from '../config/version';
import { TEAM_CSS } from '../render/view';

type Session =
  | { kind: 'local'; sim: Sim }
  | { kind: 'host'; sim: Sim; host: HostSession }
  | { kind: 'client'; client: ClientSession; view: ClientView };

const KANJI: [string, string][] = [
  ['continue', '続行'], ['single player', '単独作戦'], ['co-op (up to 5)', '協力作戦'], ['settings', '設定'], ['controls', '操作'], ['resume', '再開'],
  ['back', '戻る'], ['done', '完了'], ['leave squad', '分隊離脱'], ['leave', '離脱'], ['host a squad', '分隊結成'], ['join squad', '合流'], ['join server', '接続'], ['back to server lobby', '待機室へ'], ['proceed to armory', '武器庫へ'],
  ['deploy', '出撃'], ['force deploy', '強制出撃'], ['main menu', '主画面'], ['new run', '新作戦'], ['cancel', '取消'], ['save & quit', '保存終了'], ['quit to menu without saving', '破棄終了'], ['quit without saving', '破棄終了'],
  ['reset to defaults', '初期化'], ['select difficulty', '難易度'], ['co-op', '協力作戦'], ['squad lobby', '待機室'], ['paused', '一時停止'], ['menu (game continues)', '作戦中'],
  ['armory', '武器庫'], ['squad armory', '武器庫'], ['lift', '昇降機'], ['normal', '標準'], ['hard', '困難'], ['insane', '狂気'],
];

const DIFF_DESC: Record<Difficulty, string> = {
  normal: 'Standard pressure. Loyalists hesitate, supplies are fair.',
  hard: 'Sharper eyes, harder hits, thinner loot, more traps.',
  insane: 'Relentless AI coordination. Every bullet counts.',
};

export class App {
  settings: Settings = loadSettings();
  canvas = document.getElementById('game') as HTMLCanvasElement;
  ui = document.getElementById('ui') as HTMLElement;
  renderer!: GameRenderer;
  audio = new GameAudio();
  input: Input;
  hud: HUD;
  session: Session | null = null;
  localId = 1;
  private screen: HTMLElement | null = null;
  private skyline = new Skyline();
  private paused = false;
  private acc = 0;
  private last = performance.now();
  private overlay = { vignette: h('div', { class: 'vignette' }), hurt: h('div', { class: 'hurtflash' }), white: h('div', { class: 'whiteflash' }), low: h('div', { class: 'lowhp' }) };
  private crosshair = h('div', { class: 'crosshair' }, h('div', { class: 'ring' }), h('div', { class: 'dot' }));
  private cursor = h('div', { class: 'cursor' });
  private tags = new NameTags();
  /** co-op proximity voice for the current session (null: single player, voice off or unsupported) */
  private voice: VoiceChat | null = null;
  private micTried = '';
  private voiceInd = h('div', { class: 'voice-ind' }, h('i', { class: 'mic' }), 'TRANSMITTING');
  private elevPanel: HTMLElement | null = null;
  private hackUI: HackUI | null = null;
  private talkUI: DialogueUI | null = null;
  private checkinUI = false;
  /** callsign for this session: kept between rounds while the game is open, never saved to storage */
  private callsign = '';
  /** dedicated-server password: memory only, like the callsign */
  private serverPw = '';
  private armory: Shop | null = null;
  private armoryClose: () => void = () => {};
  private endShown = false;
  private menuFocus = 0;
  private lastHp = 100;

  /** the next single-player run's tower, picked early so the menus can build its street ahead (renderer.warmup) */
  private nextSeed = randomSeed();

  constructor() {
    // browsers: closing the tab mid-run (or a stray Ctrl+W) asks first
    if (!isDesktop()) window.addEventListener('beforeunload', (e) => { if (this.session && !this.endShown) { e.preventDefault(); e.returnValue = ''; } });
    this.input = new Input(this.canvas, this.settings);
    this.hud = new HUD(this.settings);
    this.hud.onSandboxAnim = (on) => this.renderer.setShowcaseAnim(on);
    try {
      this.renderer = new GameRenderer(this.canvas, this.settings.quality);
      this.renderer.setReflections(this.settings.reflections);
      this.renderer.mouseAssistPx = this.settings.mouseAimAssist ? 40 : 0;
      // build models and compile shaders while the menus are up: for the saved run's floor and the next new run
      const saved = load<any>('run', null);
      this.renderer.warmup([{ seed: this.nextSeed, difficulty: 'normal' as Difficulty, floors: [0, 1] }, ...(saved?.seed ? [{ seed: saved.seed, difficulty: saved.difficulty, floors: [saved.floor] }] : [])]);
    } catch (e) {
      this.fatal('WebGL is not available in this browser. Enable hardware acceleration or try a current Chrome / Firefox / Edge / Safari.');
      throw e;
    }
    this.audio.setVolumes(this.settings.masterVol, this.settings.sfxVol, this.settings.musicVol);
    this.ui.append(this.tags.root, this.overlay.vignette, this.overlay.low, this.overlay.hurt, this.overlay.white, this.crosshair, this.cursor);
    this.input.onAction = (a) => this.onAction(a);
    window.addEventListener('pointerdown', () => { this.audio.unlock(); this.voice?.resume(); }, { capture: true });
    window.addEventListener('keydown', () => { this.audio.unlock(); this.voice?.resume(); }, { capture: true });
    this.hud.root.append(this.voiceInd);
    // Keys go to the browser chrome when the page isn't focused: say so instead of silently ignoring input.
    const focusHint = h('div', { class: 'focushint' }, 'Game not focused — click here to take control');
    focusHint.addEventListener('click', () => { window.focus(); focusHint.style.display = 'none'; });
    this.ui.append(focusHint);
    const syncFocus = () => { focusHint.style.display = this.session && !this.screen && !document.hasFocus() ? 'block' : 'none'; };
    window.addEventListener('blur', syncFocus);
    window.addEventListener('focus', syncFocus);
    setInterval(syncFocus, 500);
    window.addEventListener('mousemove', (e) => { this.cursor.style.left = e.clientX + 'px'; this.cursor.style.top = e.clientY + 'px'; });
    this.mainMenu();
    requestAnimationFrame((t) => this.frame(t));
    // Browsers stop requestAnimationFrame in background tabs; a co-op host must keep simulating.
    setInterval(() => { if (document.hidden && this.session && this.session.kind !== 'local') this.frame(performance.now(), true); }, 33);
  }

  private fatal(msg: string) {
    this.ui.append(h('div', { class: 'screen solid' }, h('h1', { class: 'title' }, 'TOWER ', h('span', {}, 'BREACH')), h('div', { class: 'panel', style: { maxWidth: '520px' } }, msg)));
  }

  // ================================================================== screens
  /** Adds the Japanese sub-label (kanji) to buttons, headings and cards on a freshly built screen. */
  private kanji(root: HTMLElement) {
    const k = (t: string) => { const x = t.trim().toLowerCase(); for (const [key, v] of KANJI) if (x === key || x.startsWith(key)) return v; return null; };
    for (const el of root.querySelectorAll<HTMLElement>('.btn, .h2, .card h3')) {
      if (el.querySelector('.k')) continue;
      const v = k(el.textContent ?? '');
      if (v) el.append(h('span', { class: 'k' }, v));
    }
  }

  private show(el: HTMLElement | null) {
    if (el) this.kanji(el);
    this.input.capture = null; // never leave a half-finished key rebind armed
    this.screen?.remove();
    this.screen = el;
    this.menuFocus = 0;
    if (el) { this.ui.append(el); this.input.enabled = false; this.canvas.style.cursor = 'default'; }
    else { this.input.enabled = true; }
    this.cursor.style.display = el || this.elevPanel ? 'block' : 'none';
  }
  private sfx(k: 'click' | 'hover' | 'buy' | 'error' | 'open' | 'back') { this.audio.ui(k); }
  private btn(label: string, fn: () => void, cls = '', disabled = false) {
    return h('button', { class: `btn ${cls}`, disabled, onclick: () => { this.sfx('click'); fn(); }, onmouseenter: () => this.sfx('hover') }, label);
  }

  mainMenu() {
    this.endSession();
    this.audio.setMenuMusic(true);
    // browsers only allow sound after a click or key press: gate the title once so that gesture starts the theme
    if (!this.audio.unlocked && !document.querySelector('.press-start')) {
      const gate = h('div', { class: 'press-start' }, h('div', {}, 'Click or press any key to start'), h('small', {}, 'クリックして開始'));
      const go = () => { gate.remove(); window.removeEventListener('keydown', go, true); };
      gate.addEventListener('pointerdown', go);
      window.addEventListener('keydown', go, true);
      this.ui.append(gate);
    }
    this.skyline.start(document.body);
    const saveData = load<any>('run', null);
    const el = h('div', { class: 'screen' },
      h('div', { class: 'rail-big' }, '突破', h('small', {}, '塔・二百階')),
      h('h1', { class: 'title' }, 'TOWER ', h('span', {}, 'BREACH')),
      h('div', { class: 'title-jp' }, 'タワー・ブリーチ'),
      h('div', { class: 'subtitle' }, 'Two hundred floors between you and the mainframe.'),
      h('div', { class: 'menu' },
        saveData ? this.btn(`Continue — Floor ${saveData.floor} (${saveData.difficulty})`, () => this.continueRun(saveData), 'primary') : null,
        this.btn('Single Player', () => this.difficultyScreen((d) => this.squadScreen(d))),
        this.btn('Co-op (up to 5)', () => this.coopScreen()),
        this.btn('Hall of Records', () => this.recordsScreen(() => this.mainMenu())),
        this.btn('Settings', () => this.settingsScreen(() => this.mainMenu())),
        this.btn('Controls', () => this.controlsScreen(() => this.mainMenu())),
        DESKTOP ? this.btn('Quit to desktop', () => window.close(), 'small') : null),
      h('div', { class: 'hint', style: { marginTop: '28px', textAlign: 'center', maxWidth: '560px' } },
        'A maleficent AI runs the country from the top of this tower. Carry the virus to floor 200, upload it, and survive the shutdown. ',
        h('div', { style: { opacity: 0.55, marginTop: '10px', letterSpacing: '0.1em' } }, `v${APP_VERSION}`),
        !storageAvailable() ? h('div', { style: { color: '#ff8080', marginTop: '8px' } }, 'Browser storage is unavailable: settings and saves will not persist.') : null));
    this.show(el);
  }

  private difficultyScreen(next: (d: Difficulty) => void, back = () => this.mainMenu()) {
    const el = h('div', { class: 'screen' },
      h('div', { class: 'h2' }, 'Select difficulty'),
      h('div', { class: 'cards' }, ...DIFFICULTIES.map((d) => h('div', { class: `card d-${d}`, tabindex: 0, onclick: () => { this.sfx('click'); next(d); }, onmouseenter: () => this.sfx('hover') },
        h('h3', {}, d), h('p', {}, DIFF_DESC[d]), h('div', { class: 'stat' }, `Budget $${DIFF_BASE[d].cash} · Enemy dmg ×${DIFF_BASE[d].damage} · Loot ×${DIFF_BASE[d].loot}`)))),
      h('div', { class: 'hint', style: { margin: '18px 0' } }, 'Pressure rises every 10 floors on all difficulties. Darkness begins at floor 20.'),
      this.btn('Back', back, 'small'));
    this.show(el);
  }

  /** Single player: up to four AI squadmates, then the street. The choice is remembered. */
  private squadScreen(diff: Difficulty) {
    const picks: SquadPick[] = [...load<SquadPick[]>('squad', [])].slice(0, 4);
    while (picks.length < 4) picks.push(null);
    const opts: [string, string][] = [['', 'Empty'], ['random', 'Random class'], ...BOT_CLASSES.map((c) => [c, BOT_CLASS[c].name] as [string, string])];
    // who is in the squad this run: the same seed startLocal uses, so these are exactly the people who deploy
    const ids = makeSquad(this.nextSeed, ['random', 'random', 'random', 'random']);
    const card = (i: number) => {
      const desc = h('div', { class: 'sq-desc' });
      const el = h('div', { class: 'sq-card' });
      const paint = () => { const v = picks[i]; desc.textContent = !v ? 'Slot empty.' : v === 'random' ? 'A random class each run.' : BOT_CLASS[v].desc; el.classList.toggle('empty', !v); };
      const sel = h('select', { class: 'text', onchange: () => { picks[i] = (sel.value || null) as SquadPick; paint(); } },
        ...opts.map(([v, t]) => h('option', { value: v, selected: (picks[i] ?? '') === v }, t))) as HTMLSelectElement;
      el.append(h('img', { class: 'sq-pic', alt: '', src: `${import.meta.env.BASE_URL}portraits/${SQUAD_MEMBERS[i].portrait}` }),
        h('div', { class: 'sq-name' }, h('span', {}, ids[i].rank), ids[i].surname), sel, desc);
      paint();
      return el;
    };
    this.show(h('div', { class: 'screen' },
      h('div', { class: 'h2' }, 'Squad'),
      h('div', { class: 'hint' }, 'Take up to four squadmates. They follow you floor to floor, fight, heal and revive you. Leave every slot empty to go in alone (one life).'),
      h('div', { class: 'sq-cards' }, ...[0, 1, 2, 3].map(card)),
      h('div', { class: 'menu' },
        this.btn('Deploy', () => { save('squad', picks); this.spStart(diff, picks); }, 'primary'),
        this.btn('Back', () => this.difficultyScreen((d) => this.squadScreen(d)), 'small'))));
  }

  /** Single player: straight to the street. Check in at the command tent, then gear up at the armory. */
  private spStart(diff: Difficulty, squad: SquadPick[] = []) { this.startLocal(diff, emptyLoadout(), squad); }

  /** Street armory for the local player (opened by Police Chief Hollis after check-in; re-openable while on the street). */
  private openArmory(p: PlayerState, diff: Difficulty) {
    // however the armory closes (Confirm, Close or ESC) what you bought is what you carry, and the panel is released
    const tips = ['Health kits first. Nobody carries you out of there.', "Armour plates are cheaper than a funeral.", 'A suppressor buys you floors. Noise brings the whole tower.', 'Batteries. It gets dark past twenty.', "There's no coming back down for more. Spend it like you mean it."];
    const chief = h('div', { class: 'chief-card' }, portraitImg(-1), h('div', {}, h('div', { class: 'cc-name' }, 'Police Chief Hollis'), h('div', { class: 'cc-line' }, `"${tips[Math.floor(Math.random() * tips.length)]}"`)));
    const shop = new Shop(diff, `Armory: ${diff.toUpperCase()}`, chief, p.loadout, 'Confirm loadout', 'Close');
    const finish = () => {
      if (this.armory !== shop) return;
      this.armory = null;
      const changed = JSON.stringify(shop.lo) !== JSON.stringify(p.loadout);
      if (changed) equipLoadout(p, shop.lo);
      p.look = shop.look; // cosmetic: applies however the armory closes
      this.show(null);
      p.input.closeSeq++; (p as any).panel = null;
      this.hud.message(changed ? 'Loadout confirmed. The tower door is open to you.' : 'Armory closed. Your gear is unchanged.', changed ? 'good' : 'info');
      this.saveRun();
    };
    shop.sound = (k) => this.sfx(k);
    shop.onRendered = () => this.kanji(shop.root);
    shop.onBack = finish;
    shop.onDeploy = finish;
    this.armory = shop;
    this.armoryClose = finish;
    this.show(shop.root);
  }

  /** Hall of Records: every finished run, won or lost. Score board or speed board; click a run for its stats. */
  private recordsScreen(back: () => void, board: 'score' | 'speed' = 'score') {
    const recs = [...loadRecords()].sort(board === 'score' ? rankRecords : rankBySpeed);
    const detail = (r: ScoreRecord) => r.score === undefined ? `${r.kills} kills · recorded before scores` :
      `${r.kills} kills (${r.knife ?? 0} knife) · ${Math.round((r.accuracy ?? 0) * 100)}% accuracy · ${r.hacks ?? 0} hacks · ${r.searches ?? 0} searched · speed +${(r.speed ?? 0).toLocaleString('en-US')} · ${new Date(r.date).toLocaleDateString()}`;
    const table = (d: Difficulty) => {
      const rows = recs.filter((r) => r.difficulty === d).slice(0, 15);
      return h('div', { class: 'rec-col' }, h('h3', {}, d),
        rows.length ? h('div', { class: 'rec-list' }, ...rows.map((r, i) => {
          const row = h('div', { class: `rec ${r.won ? 'won' : ''}`, title: detail(r), onclick: () => row.classList.toggle('open') },
            h('span', { class: 'rk' }, String(i + 1)), h('span', { class: 'nm' }, r.name, r.bots ? h('small', { class: 'rec-bots' }, ` +${r.bots} bots`) : null), h('span', { class: 'fl' }, r.won ? 'WON' : `F${r.floor}`),
            h('span', { class: 'kl' }, r.score === undefined ? '—' : r.score.toLocaleString('en-US')), h('span', { class: 'tm' }, r.score === undefined ? fmtTime(r.time) : fmtRunTime(r.time)),
            h('div', { class: 'det' }, detail(r)));
          return row;
        }))
          : h('div', { class: 'hint' }, 'No runs yet.'));
    };
    const tab = (b: 'score' | 'speed', label: string) => this.btn(label, () => this.recordsScreen(back, b), `small ${board === b ? 'primary' : ''}`);
    this.show(h('div', { class: 'screen' }, h('div', { class: 'h2' }, 'Hall of Records'),
      h('div', { class: 'rec-tabs' }, tab('score', 'Top scores'), tab('speed', 'Fastest')),
      h('div', { class: 'rec-cols' }, ...DIFFICULTIES.map(table)), this.btn('Back', back, 'small')));
  }

  private continueRun(s: any) {
    try {
      const sim = Sim.fromSave(s, 1);
      sim.players[0].look ??= loadLook(); // saves from before appearances
      this.beginSession({ kind: 'local', sim });
      this.hud.showBanner(`FLOOR ${sim.players[0].floor}`, 'Run resumed');
    } catch {
      remove('run');
      this.mainMenu();
    }
  }

  /** squad: dev test squad (?squad=medic,gunner,random,...); bots arrive on the dev floor with you */
  devStart(diff: Difficulty, floor: number, torch: boolean, cheats: { god?: boolean; ammo?: boolean; torch?: boolean } = {}, squad: SquadPick[] = []) {
    this.startLocal(diff, { primary: "sr4", secondary: "p9", armor: "vesthelm", grenades: { frag: 1, flash: 1, smoke: 1 }, items: { medkit: 2, battery: 1 }, mods: { bypass: true, torchmod: false, pouch: false } }, squad);
    const s = this.session;
    if (s && s.kind === "local") { const p = s.sim.players[0]; p.checkedIn = true; if (floor !== 0) s.sim.travel(p, floor, floor < 0 ? "start" : "stair0", "debug"); p.torchOn = torch; p.cheats = cheats; if (cheats.ammo) p.grenades = { frag: 1, flash: 2, smoke: 1, incendiary: 1, decoy: 1 }; if (cheats.god || cheats.ammo || cheats.torch) this.hud.message(`Dev mode:${cheats.god ? ' GOD' : ''}${cheats.ammo ? ' INFINITE AMMO' : ''}${cheats.torch ? ' INFINITE TORCH' : ''}`, 'good'); }
  }

  private startLocal(diff: Difficulty, lo: Loadout, squad: SquadPick[] = []) {
    const sim = new Sim({ seed: this.nextSeed, difficulty: diff, mode: 'single', holiday: currentHoliday() });
    this.nextSeed = randomSeed();
    const p = sim.addPlayer(1, 'Operator', lo); // callsign is registered fresh at the Chief's check-in
    p.look = loadLook();
    for (const info of makeSquad(sim.cfg.seed, squad)) sim.addBot(info);
    this.beginSession({ kind: 'local', sim });
    this.hud.showBanner('POLICE CORDON', lo.primary ? 'Safe zone. Breach the tower when ready.' : 'Check in with Police Chief Hollis at the blue tent, then gear up.', '警察封鎖線');
    this.saveRun();
  }

  private saveRun() {
    const s = this.session;
    if (!s || s.kind !== 'local') return;
    const me = s.sim.players[0];
    if (me.life !== 'alive' || me.floor < 0) return; // never save the sandbox
    save('run', s.sim.exportSave(me));
  }

  // ------------------------------------------------------------------ co-op
  private coopScreen(err = '') {
    const name = h('input', { class: 'text', value: this.callsign, maxlength: 16, placeholder: 'Enter your callsign' }) as HTMLInputElement;
    const addr = h('input', { class: 'text', value: load('dedAddr', ''), maxlength: 200, placeholder: 'Server address, e.g. 203.0.113.7:8787' }) as HTMLInputElement;
    const pw = h('input', { class: 'text', type: 'password', value: this.serverPw, maxlength: 100, placeholder: 'Password (if the server has one)' }) as HTMLInputElement;
    const code = h('input', { class: 'text', maxlength: 5, placeholder: 'CODE', style: { width: '130px', textTransform: 'uppercase' } }) as HTMLInputElement;
    const server = h('input', { class: 'text', value: load('server', defaultServerUrl()), style: { width: '100%', fontSize: '12px' } }) as HTMLInputElement;
    const errEl = h('div', { class: 'err' }, err);
    // the callsign lives in memory for this session only (kept between rounds, never written to storage)
    const saveName = () => {
      const n = name.value.replace(/[^\w .\-']/g, '').trim().slice(0, 16);
      if (!n) { name.classList.add('bad'); name.focus(); return false; }
      this.callsign = n; save('server', server.value); return true;
    };
    const joinServer = async () => {
      if (!saveName()) return;
      let url: string;
      try { url = normalizeServerAddress(addr.value); if (!addr.value.trim()) throw 0; }
      catch { addr.classList.add('bad'); addr.focus(); errEl.textContent = 'Enter the server address, e.g. 203.0.113.7:8787'; return; }
      save('dedAddr', addr.value.trim()); this.serverPw = pw.value;
      errEl.textContent = 'Connecting…';
      const cl = new ClientSession();
      try { await cl.join(url, '', this.callsign, pw.value); this.clientLobby(cl); }
      catch (e) { cl.close(); this.coopScreen((e as Error).message); }
    };
    // squads hosted in a player's browser, through the relay that served this page (browser only)
    const relay = h('div', { style: { display: DESKTOP ? 'none' : 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'hint', style: { marginTop: '8px' } }, 'OR HOST IN YOUR BROWSER (relay)'),
      this.btn('Host a squad', async () => {
        if (!saveName()) return;
        const host = new HostSession();
        try { await host.open(server.value, this.callsign); this.hostLobby(host); }
        catch (e) { this.coopScreen((e as Error).message); }
      }),
      h('div', { class: 'row' }, code, this.btn('Join squad', async () => {
        if (!saveName()) return;
        const cl = new ClientSession();
        try { await cl.join(server.value, code.value, this.callsign); this.clientLobby(cl); }
        catch (e) { this.coopScreen((e as Error).message); }
      })),
      h('div', { class: 'hint' }, 'RELAY'), server);
    const info = h('div', { class: 'hint' });
    const el = h('div', { class: 'screen' },
      h('div', { class: 'h2' }, 'Co-op'),
      h('div', { class: 'panel', style: { width: '460px', display: 'flex', flexDirection: 'column', gap: '12px' } },
        h('div', { class: 'hint' }, 'CALLSIGN'), name,
        h('div', { class: 'hint' }, 'DEDICATED SERVER (Windows · macOS · Linux · browser)'), addr, pw, info,
        this.btn('Join server', joinServer, 'primary'),
        relay,
        errEl,
        h('div', { class: 'hint' }, 'Up to 5 operators. One life each: a downed teammate can be revived within 60 s with a Health Kit. Running your own server: see docs/HOSTING.md.')),
      h('div', { style: { marginTop: '16px' } }, this.btn('Back', () => this.mainMenu(), 'small')));
    addr.addEventListener('keydown', (e) => { if (e.key === 'Enter') void joinServer(); });
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') void joinServer(); });
    this.show(el);
    // page served by a dedicated server: offer that server and hide the relay (it has none)
    if (!DESKTOP) {
      fetch('server-info').then((r) => r.json()).then((si) => {
        if (!si?.dedicated || !el.isConnected) return;
        relay.style.display = 'none';
        if (!addr.value) addr.value = location.host;
        info.textContent = `${si.name} · ${si.players}/${si.maxPlayers} online · ${String(si.difficulty).toUpperCase()}${si.password ? ' · password' : ''}`;
      }).catch(() => { /* relay / dev server: no info endpoint */ });
    }
  }

  private lobbyList(players: { id: number; name: string; ready: boolean; host: boolean }[], me: number) {
    const others = players.filter((p) => p.id !== me).sort((a, b) => a.id - b.id);
    return h('div', { class: 'lobbylist' }, ...players.map((p) => {
      const col = p.id === me ? '#f0f0f0' : TEAM_CSS[others.indexOf(p) % 4];
      return h('div', { class: 'lobbyrow' }, h('i', { class: 'sw', style: { background: col } }), h('span', { style: { color: col, fontWeight: '700' } }, p.name + (p.id === me ? ' (you)' : '')), h('span', { class: 'tag' }, `${p.host ? 'HOST · ' : ''}${p.ready ? 'READY' : 'NOT READY'}`));
    }));
  }

  private hostLobby(host: HostSession) {
    this.session = null;
    const render = () => {
      if (host.stage === 'shop') return;
      const players = [{ id: 1, name: host.hostName, ready: false, host: true }, ...[...host.peers.values()].filter((p) => p.connected).map((p) => ({ id: p.id, name: p.name, ready: p.ready, host: false }))];
      const el = h('div', { class: 'screen' },
        h('div', { class: 'h2' }, 'Squad lobby'),
        h('div', { class: 'hint' }, 'SHARE THIS CODE'), h('div', { class: 'code' }, host.code),
        this.lobbyList(players, 1),
        h('div', { class: 'seg', style: { margin: '6px 0 10px' } }, ...DIFFICULTIES.map((d) => h('button', { class: host.difficulty === d ? 'on' : '', onclick: () => { host.setDifficulty(d); render(); } }, d))),
        h('div', { class: 'srow', style: { margin: '0 0 16px', justifyContent: 'center', gap: '14px' } }, h('span', {}, 'Friendly fire (inside the tower)'),
          h('div', { class: 'seg' }, ...(['off', 'on'] as const).map((v) => h('button', { class: (v === 'on') === host.friendlyFire ? 'on' : '', onclick: () => { host.setFriendlyFire(v === 'on'); this.sfx('click'); render(); } }, v)))),
        h('div', { class: 'row' }, this.btn('Proceed to armory', () => { host.goShop(); this.mpShop(host.difficulty, host, null); }, 'primary'), this.btn('Leave', () => { host.close(); this.mainMenu(); }, 'small')));
      this.show(el);
    };
    host.onChange = () => { if (host.stage === 'lobby') render(); else this.updateMpShopStatus(host, null); };
    host.onDisconnect = (r) => { if (this.session?.kind !== 'host') this.coopScreen(r); else this.hud.message(r, 'warn'); };
    host.onStart = (sim) => { this.beginSession({ kind: 'host', sim, host }); this.localId = 1; this.hud.showBanner('STREET LEVEL', `Squad of ${sim.players.length} · ${host.difficulty}${host.friendlyFire ? ' · friendly fire ON' : ''}`); };
    host.onInfo = (t) => this.hud.message(t, 'info');
    render();
  }

  private clientLobby(cl: ClientSession) {
    this.mpShopEl = null; // a fresh visit: the armory opens as soon as the lobby says so
    const render = () => {
      if (this.session) return; // in the field (or on its end screen): lobby updates wait
      const lb = cl.lobby;
      if (lb?.stage === 'shop') { if (!this.mpShopEl) this.mpShop(lb.difficulty, null, cl); else this.updateMpShopStatus(null, cl); return; }
      this.mpShopEl = null;
      const el = h('div', { class: 'screen' },
        h('div', { class: 'h2' }, 'Squad lobby'), h('div', { class: 'code' }, cl.server ? cl.server.name : cl.code),
        lb ? this.lobbyList(lb.players, cl.id) : h('div', { class: 'hint' }, 'Connecting…'),
        h('div', { class: 'hint', style: { margin: '10px 0 16px' } }, lb ? `Difficulty: ${lb.difficulty.toUpperCase()} · Friendly fire in the tower: ${lb.ff ? 'ON' : 'OFF'} · ${cl.server ? (lb.stage === 'game' ? 'a run is wrapping up: the armory opens in a moment' : 'waiting for the server') : 'waiting for the host to open the armory'}` : ''),
        this.btn('Leave', () => { cl.close(); this.mainMenu(); }, 'small'));
      this.show(el);
    };
    cl.onLobby = render;
    cl.onStart = (v) => { this.localId = cl.id; this.mpShopEl = null; this.beginSession({ kind: 'client', client: cl, view: v }); this.hud.showBanner('STREET LEVEL', 'Squad deployed'); };
    cl.onDisconnect = (r) => { this.endSession(); this.coopScreen(r); };
    render();
  }

  private mpShopEl: HTMLElement | null = null;
  private mpStatus = h('div', { class: 'hint' });
  private mpShop(diff: Difficulty, host: HostSession | null, cl: ClientSession | null) {
    const srv = cl?.server;
    const extra = h('div', {}, srv?.motd ? h('div', { class: 'hint', style: { color: 'var(--cyan)' } }, srv.motd) : null, this.mpStatus, host ? this.btn('Force deploy (skip unready)', () => host.tryDeploy(true), 'small') : null);
    const shop = new Shop(diff, `${srv ? srv.name : 'Squad armory'} — ${diff.toUpperCase()}`, extra);
    shop.sound = (k) => this.sfx(k);
    shop.onRendered = () => this.kanji(shop.root);
    shop.onBack = () => { if (host) { host.close(); } else cl?.close(); this.mainMenu(); };
    shop.onDeploy = (lo) => {
      if (host) host.setHostLoadout(lo, shop.look); else cl!.ready(lo, shop.look);
      this.mpStatus.textContent = 'READY — waiting for the squad…';
    };
    this.mpShopEl = shop.root;
    this.show(shop.root);
    this.updateMpShopStatus(host, cl);
  }
  private updateMpShopStatus(host: HostSession | null, cl: ClientSession | null) {
    let players: { name: string; ready: boolean }[] = [];
    if (host) players = [{ name: host.hostName, ready: !!host.hostLoadout }, ...[...host.peers.values()].filter((p) => p.connected)];
    else if (cl?.lobby) players = cl.lobby.players;
    const t = cl?.lobby?.deployIn;
    // joined while the squad waits on the street: confirming the loadout drops you in next to them
    if (cl?.lobby?.late) { this.mpStatus.textContent = 'The squad is on the street, not yet in the tower. Confirm your loadout to deploy next to them.'; return; }
    this.mpStatus.textContent = players.map((p) => `${p.name}: ${p.ready ? 'ready' : 'shopping'}`).join(' · ') + (t != null ? ` · deploying in ${t} s` : '');
  }

  // ------------------------------------------------------------------ settings
  settingsScreen(back: () => void, tab: 'graphics' | 'audio' | 'controls' | 'gameplay' = 'graphics') {
    const s = this.settings;
    const apply = () => { saveSettings(s); this.input.setSettings(s); this.hud.setSettings(s); this.audio.setVolumes(s.masterVol, s.sfxVol, s.musicVol); this.voice?.setVolume(s.voiceVol); this.syncVoice(); };
    const seg = <T extends string>(vals: T[], cur: T, set: (v: T) => void) => h('div', { class: 'seg' }, ...vals.map((v) => h('button', { class: v === cur ? 'on' : '', onclick: () => { set(v); apply(); this.sfx('click'); this.settingsScreen(back, tab); } }, v)));
    const slider = (label: string, v: number, set: (x: number) => void) => {
      const out = h('span', {}, `${Math.round(v * 100)}%`);
      const r = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: v, oninput: (e: Event) => { const x = Number((e.target as HTMLInputElement).value); set(x); out.textContent = `${Math.round(x * 100)}%`; apply(); } });
      return h('div', { class: 'srow' }, h('span', {}, label), r, out);
    };
    const toggle = (label: string, v: boolean, set: (x: boolean) => void) => h('div', { class: 'srow' }, h('span', {}, label), seg(['on', 'off'], v ? 'on' : 'off', (x) => set(x === 'on')), h('span'));
    const body = h('div', { class: 'sbody' });
    if (tab === 'graphics') {
      body.append(
        h('div', { class: 'srow' }, h('span', {}, 'Quality preset'), seg<Quality>(['low', 'medium', 'high', 'ultra'], s.quality, (q) => { s.quality = q; this.renderer.setQuality(q); }), h('span')),
        h('div', { class: 'hint', style: { margin: '6px 0 12px' } }, 'Low: 4 dynamic lights, no bloom. Medium: 6 lights + bloom. High: 8 lights, torch shadows, anti-aliasing (AA applies after reload). Ultra: 10 lights, full resolution.'),
        h('div', { class: 'srow' }, h('span', {}, 'Reflections'), seg(['off', 'mirrors', 'ray-traced'], s.reflections === 'raytraced' ? 'ray-traced' : s.reflections, (x) => { s.reflections = x === 'ray-traced' ? 'raytraced' : (x as 'off' | 'mirrors'); this.renderer.setReflections(s.reflections); }), h('span')),
        h('div', { class: 'hint', style: { margin: '6px 0 12px' } }, 'Mirrors: bathroom mirrors show a live reflection (2 nearest). Ray-traced: every mirror in range plus screen-space ray-marched floor reflections of lights, screens and people. Costs frame rate.'),
        toggle('Show FPS', s.showFps, (x) => (s.showFps = x)),
        toggle('Screen shake', s.screenShake, (x) => (s.screenShake = x)));
    } else if (tab === 'audio') {
      body.append(slider('Master volume', s.masterVol, (x) => (s.masterVol = x)), slider('Effects volume', s.sfxVol, (x) => (s.sfxVol = x)), slider('Music & stingers', s.musicVol, (x) => (s.musicVol = x)));
      body.append(...this.voiceSettings(s, apply, () => this.settingsScreen(back, 'audio')));
    } else if (tab === 'gameplay') {
      body.append(
        toggle('Crouch is a toggle', s.crouchToggle, (x) => (s.crouchToggle = x)),
        toggle('Mouse aim assist (light)', s.mouseAimAssist, (x) => { s.mouseAimAssist = x; this.renderer.mouseAssistPx = x ? 40 : 0; }),
        h('div', { class: 'hint', style: { margin: '-2px 0 10px' } }, 'Mouse: the crosshair snaps to a visible enemy when it is close to them on screen. Off = exact aim.'),
        toggle('Controller aim assist', s.aimAssist, (x) => (s.aimAssist = x)),
        h('div', { class: 'hint', style: { margin: '-2px 0 10px' } }, 'Gamepad: stick aim snaps to the nearest visible enemy in the direction you push.'),
        slider('Stick deadzone', s.deadzone, (x) => (s.deadzone = Math.max(0.05, Math.min(0.5, x)))));
    } else {
      for (const a of Object.keys(ACTION_LABEL) as Action[]) {
        const b = h('button', { class: 'bind', onclick: () => {
          b.classList.add('wait'); b.textContent = 'press a key…';
          this.input.capture = (code) => { if (code !== 'Escape' || a === 'pause') { for (const k of Object.keys(s.bindings) as Action[]) if (s.bindings[k] === code && k !== a) s.bindings[k] = s.bindings[a]; s.bindings[a] = code; } apply(); this.settingsScreen(back, 'controls'); };
        } }, keyLabel(s.bindings[a]));
        body.append(h('div', { class: 'srow' }, h('span', {}, ACTION_LABEL[a]), b, h('span')));
      }
      body.append(h('div', { class: 'srow' }, h('span', {}, 'Fire / Aim'), h('span', { class: 'hint' }, 'Left mouse / Right mouse (fixed; a quick right-click locks the scope). Middle mouse: ping. Wheel: hotbar 1-8. Pinch or Cmd + wheel: zoom.'), h('span')));
      body.append(h('div', { style: { marginTop: '10px' } }, this.btn('Reset to defaults', () => { s.bindings = defaultBindings(); apply(); this.settingsScreen(back, 'controls'); }, 'small')));
    }
    const el = h('div', { class: 'screen' },
      h('div', { class: 'panel settings' },
        h('div', { class: 'h2' }, 'Settings'),
        h('div', { class: 'tabs seg' }, ...(['graphics', 'audio', 'controls', 'gameplay'] as const).map((t) => h('button', { class: t === tab ? 'on' : '', onclick: () => this.settingsScreen(back, t) }, t))),
        body,
        h('div', { style: { marginTop: '16px' } }, this.btn('Done', back, 'small'))));
    this.show(el);
  }

  /** Settings → Audio: co-op voice chat rows (on/off, mode, volume, microphone + level meter). */
  private voiceSettings(s: Settings, apply: () => void, redraw: () => void): HTMLElement[] {
    const seg = <T extends string>(vals: T[], cur: T, set: (v: T) => void) => h('div', { class: 'seg' }, ...vals.map((v) => h('button', { class: v === cur ? 'on' : '', onclick: () => { set(v); apply(); this.sfx('click'); redraw(); } }, v)));
    const vol = h('input', { type: 'range', min: 0, max: 1.5, step: 0.05, value: s.voiceVol, oninput: (e: Event) => { s.voiceVol = Number((e.target as HTMLInputElement).value); volOut.textContent = `${Math.round(s.voiceVol * 100)}%`; apply(); } });
    const volOut = h('span', {}, `${Math.round(s.voiceVol * 100)}%`);
    const dev = h('select', { class: 'text', style: { maxWidth: '260px' }, onchange: () => { s.voiceDevice = dev.value; apply(); } }, h('option', { value: '' }, 'System default')) as HTMLSelectElement;
    navigator.mediaDevices?.enumerateDevices?.().then((ds) => {
      ds.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default').forEach((d, i) => dev.append(h('option', { value: d.deviceId }, d.label || `Microphone ${i + 1}`)));
      dev.value = s.voiceDevice;
    }).catch(() => {});
    // mic test: reuses the live voice mic in co-op, otherwise opens one just for the meter (closed when the screen goes)
    const bar = h('i');
    const meter = h('span', { class: 'mic-meter' }, bar);
    const note = h('span', { class: 'hint' });
    const test = this.btn('Test mic', async () => {
      let v = this.voice?.micOn ? this.voice : null;
      let own: VoiceChat | null = null;
      if (!v) {
        try { own = v = new VoiceChat(); await v.startMic(s.voiceDevice); note.textContent = 'Speak: the bar should move.'; }
        catch (e) { own?.close(); note.textContent = `Microphone unavailable: ${micBlockedWhy(e)}`; return; }
      }
      const iv = setInterval(() => {
        if (!meter.isConnected) { clearInterval(iv); own?.close(); return; }
        bar.style.width = `${Math.min(100, v!.level * 100)}%`;
      }, 60);
    }, 'small');
    const why = voiceUnsupported(true);
    return [
      h('div', { class: 'hint', style: { margin: '14px 0 6px' } }, 'CO-OP VOICE CHAT (proximity)'),
      h('div', { class: 'srow' }, h('span', {}, 'Voice chat'), seg(['on', 'off'], s.voiceOn ? 'on' : 'off', (x) => (s.voiceOn = x === 'on')), h('span')),
      h('div', { class: 'srow' }, h('span', {}, 'Transmit'), seg(['push-to-talk', 'open mic'], s.voiceMode === 'ptt' ? 'push-to-talk' : 'open mic', (x) => (s.voiceMode = x === 'open mic' ? 'open' : 'ptt')), h('span')),
      h('div', { class: 'srow' }, h('span', {}, 'Voice volume'), vol, volOut),
      h('div', { class: 'srow' }, h('span', {}, 'Microphone'), dev, h('span')),
      h('div', { class: 'srow' }, h('span', {}, 'Mic level'), h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, test, meter), note),
      h('div', { class: 'hint', style: { margin: '6px 0 0', lineHeight: '1.6' } },
        `Push-to-talk: hold ${keyLabel(s.bindings.voice)} (rebind under Controls; controllers have no free button, use open mic). You hear squadmates on your floor within about 10 m: full volume within 3 m, fading out with distance, muffled through walls. Voice goes through the game server, nothing to set up.`,
        why ? h('div', { style: { color: '#ff8080', marginTop: '6px' } }, `Voice: ${why}.`) : null),
    ];
  }

  /** Starts / stops co-op voice to match the settings and the session (single player: never). */
  private syncVoice() {
    const s = this.session;
    const net = s?.kind === 'host' ? s.host : s?.kind === 'client' ? s.client : null;
    if (!net || !this.settings.voiceOn || voiceUnsupported(false)) {
      if (this.voice) { this.voice.close(); this.voice = null; }
      if (s?.kind === 'client') s.client.setVoice(false);
      if (s?.kind === 'host') s.host.voiceListeners.delete(1);
      this.voiceInd.classList.remove('on');
      return;
    }
    let v = this.voice;
    if (!v) {
      v = this.voice = new VoiceChat();
      this.micTried = '\0';
      const vc = v;
      if (s!.kind === 'client') { const cl = s!.client; cl.onVoice = (id, b) => vc.receive(id, b); vc.send = (b) => cl.sendVoice(b); cl.setVoice(true); }
      else if (s!.kind === 'host') { const host = s!.host; host.onVoice = (id, b) => vc.receive(id, b); vc.send = (b) => host.voiceFrom(host.id, b); host.voiceListeners.add(host.id); }
    }
    v.setVolume(this.settings.voiceVol);
    // the microphone: once per device choice (a refusal is reported once, listening keeps working)
    if (this.micTried !== this.settings.voiceDevice) {
      this.micTried = this.settings.voiceDevice;
      const vc = v;
      vc.startMic(this.settings.voiceDevice).then(
        () => { if (this.voice === vc) this.hud.message(this.settings.voiceMode === 'ptt' ? `Voice chat on: hold ${keyLabel(this.settings.bindings.voice)} to talk.` : 'Voice chat on: open mic.', 'info'); },
        (e) => { if (this.voice === vc) this.hud.message(`Voice chat: listening only (${micBlockedWhy(e)}).`, 'warn'); });
    }
  }

  /** Per frame: push-to-talk / open mic, and each speaker's distance volume, wall muffling and stereo side. */
  private updateVoice(view: ViewSource, me: PlayerState) {
    const v = this.voice;
    if (!v) return;
    v.openMic = this.settings.voiceMode === 'open';
    v.wantTalk = me.connected && me.life !== 'out' && (v.openMic || this.input.isHeld('voice'));
    this.voiceInd.classList.toggle('on', v.transmitting);
    const L = view.floorState(me.floor).L;
    const mine = this.renderer.worldToScreen(me.x, me.y, 1.5).x;
    const w = this.canvas.clientWidth || window.innerWidth;
    for (const id of v.speakerIds()) {
      const p = view.players.find((q) => q.id === id);
      if (!p || p.floor !== me.floor || !p.connected) { v.setSpatial(id, 0, 0, false); continue; }
      const occluded = !lineOfSight(L, me.x, me.y, p.x, p.y);
      const pan = (this.renderer.worldToScreen(p.x, p.y, 1.5).x - mine) / (w * 0.35);
      v.setSpatial(id, voiceGain(dist(me.x, me.y, p.x, p.y), occluded), pan * 0.8, occluded);
    }
  }

  controlsScreen(back: () => void) {
    const b = this.settings.bindings;
    const K = (a: Action) => keyLabel(b[a]);
    const rows: [string, string][] = [
      ['Move', `${K('moveUp')}${K('moveLeft')}${K('moveDown')}${K('moveRight')} / Left stick`], ['Aim', 'Mouse / Right stick'], ['Fire', 'LMB / RT'], ['Aim down sights', 'RMB / LT'],
      ['Sprint (loud)', `${K('sprint')} / L-stick click`], ['Crouch / sneak (quiet)', `${K('crouch')} / R-stick click`], ['Jump / vault / clear tripwires', `${K('jump')} / A`], ['Reload', `${K('reload')} / X`],
      ['Knife', `${K('melee')} / D-pad ←`], ['Interact · loot · revive', `${K('interact')} / Y`], ['Swap to last weapon', `${K('swap')}`], ['Weapons (hotbar 1-3)', `${K('slot1')} ${K('slot2')} ${K('slot3')}`],
      ['Belt (hotbar 4-8)', `${K('item1')}–${K('item5')}`], ['Step through hotbar', 'Mouse wheel / LB · RB'], ['Use selected item', `${K('use')} / D-pad ↓`], ['Drop a Health Kit (for a squadmate)', `${K('drop')} / B`],
      ['Throw grenade', `${K('grenade')} / tap D-pad →`], ['Switch grenade type', `${K('cycleGrenade')} / hold D-pad →`], ['Torch on/off', `${K('torch')} / D-pad ↑`], ['Cycle belt item', `${K('cycleItem')}`],
      ['Ping / mark enemy', `${K('ping')} or MMB / View`], ['Pause', `${K('pause')} / Menu`], ['Push-to-talk (co-op voice)', `hold ${K('voice')}`], ['Zoom', `Pinch / Cmd + wheel or ${K('zoomOut')} / ${K('zoomIn')}`],
    ];
    const el = h('div', { class: 'screen' }, h('div', { class: 'panel settings' },
      h('div', { class: 'h2' }, 'Controls'),
      h('div', { class: 'sbody' },
      h('div', { class: 'ctrl-ref' }, ...rows.map(([a, k]) => h('div', {}, h('span', {}, a), h('span', { class: 'kbd' }, k)))),
      h('div', { class: 'hint', style: { marginTop: '14px', lineHeight: '1.6' } },
        'Controllers: any standard-mapping USB/Bluetooth pad (Xbox, Logitech, PlayStation). Menus, lift panels, hacking and conversations: D-pad / left stick to move, A to choose, B to back out. ', this.input.padName ? `Detected: ${this.input.padName}` : 'No controller detected yet — press a button on it.', h('br'),
        'Stealth: sprinting and gunfire make noise; crouching in the dark hides you. Torches reveal traps but make you visible. CCTV beams are visible — avoid them or shoot the camera (the AI will know where you are).')),
      h('div', { style: { marginTop: '16px' } }, this.btn('Back', back, 'small'))));
    this.show(el);
  }

  private pauseMenu() {
    if (!this.session) return;
    const local = this.session.kind === 'local';
    const downedQuit = this.session.kind === 'local' && this.session.sim.quitCountsAsLoss();
    this.paused = local;
    const el = h('div', { class: 'screen' },
      h('div', { class: 'h2' }, local ? 'Paused' : 'Menu (game continues)'),
      h('div', { class: 'menu' },
        this.btn('Resume', () => this.resume(), 'primary'),
        this.btn('Settings', () => this.settingsScreen(() => this.pauseMenu())),
        this.btn('Controls', () => this.controlsScreen(() => this.pauseMenu())),
        this.btn(local ? (downedQuit ? 'Quit (you are down: counts as KIA)' : 'Save & quit to menu') : 'Leave squad', () => { if (local) { if (downedQuit) remove('run'); else this.saveRun(); } this.mainMenu(); }, 'danger'),
        local ? this.btn('Quit to menu without saving', () => this.quitNoSave(), 'danger') : null));
    this.show(el);
  }

  /** Leaves the run without saving. The last autosave (made on each floor change) stays, so Continue resumes from there. */
  private quitNoSave() {
    this.show(h('div', { class: 'screen' },
      h('div', { class: 'h2' }, 'Quit without saving?'),
      h('div', { class: 'hint', style: { maxWidth: '420px', margin: '0 auto 14px', lineHeight: '1.6' } }, 'Progress since you entered this floor is lost. Continue resumes from the last autosave.'),
      h('div', { class: 'menu' },
        this.btn('Quit without saving', () => this.mainMenu(), 'danger'),
        this.btn('Cancel', () => this.pauseMenu(), 'primary'))));
  }
  private resume() { this.paused = false; this.show(null); }

  private onAction(a: Action) {
    if (a === 'pause') {
      if (this.input.capture) return;
      if (this.elevPanel) { this.closeElevator(0); return; }
      if (this.hackUI || this.talkUI) return; // these panels handle their own ESC
      if (this.armory) { this.armoryClose(); return; } // ESC in the street armory keeps your purchases
      if (!this.session || this.endShown) return;
      if (this.screen) this.resume(); else this.pauseMenu();
    }
  }

  // ================================================================== session
  private beginSession(s: Session) {
    this.audio.setMenuMusic(false);
    this.skyline.stop();
    this.endSession(false);
    this.input.reset();
    this.session = s;
    this.endShown = false;
    this.paused = false;
    this.acc = 0;
    this.show(null);
    if (!this.hud.root.isConnected) this.ui.prepend(this.hud.root);
    this.hud.root.style.display = 'block';
    this.tags.root.style.display = 'block';
    if (s.kind !== 'client') {
      s.sim.onTravel = (p) => { if (s.kind === 'local' && p.id === this.localId) this.saveRun(); };
      this.localId = s.kind === 'local' ? s.sim.players[0].id : 1;
    }
    this.audio.unlock();
    this.syncVoice();
  }

  private endSession(closeNet = true) {
    const s = this.session;
    if (s && closeNet) { if (s.kind === 'host') s.host.close(); if (s.kind === 'client') s.client.close(); }
    this.session = null;
    this.syncVoice();
    this.audio.stopWorld();
    this.hud.root.style.display = 'none';
    this.tags.root.style.display = 'none';
    this.closeElevator(null);
  }

  private view(): ViewSource | null {
    const s = this.session;
    if (!s) return null;
    return s.kind === 'client' ? s.view : s.sim;
  }

  private assist(me: PlayerState) {
    return (dx: number, dy: number) => {
      const v = this.view()!;
      const fs = v.floorState(me.floor);
      let best: { x: number; y: number } | null = null, bs = 0.96;
      for (const e of fs.enemies) {
        if (e.state === 'dead') continue;
        const d = dist(me.x, me.y, e.x, e.y);
        if (d > 16) continue;
        const c = (Math.cos(angleTo(me.x, me.y, e.x, e.y)) * dx + Math.sin(angleTo(me.x, me.y, e.x, e.y)) * dy);
        if (c > bs && canSee(fs, me.x, me.y, e.x, e.y)) { bs = c; best = { x: e.x, y: e.y }; }
      }
      return best;
    };
  }

  private frame(now: number, background = false) {
    if (!background) requestAnimationFrame((t) => this.frame(t));
    const t0 = performance.now();
    this.frameInner(now, background);
    if (perfOn && !background) perfFrame(performance.now() - t0);
  }

  private frameInner(now: number, background: boolean) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const s = this.session;
    this.menuNav();
    if (!s) { this.renderer.idle(); return; }
    const view = this.view()!;
    const me = view.players.find((p) => p.id === this.localId);
    if (!me) return;
    const ground = (x: number, y: number) => this.renderer.groundPoint(x, y, view, this.localId);
    let events;
    if (s.kind === 'client') {
      this.input.build(me.input, me, ground, this.assist(me));
      s.client.update(dt);
      events = s.view.drainEvents();
    } else {
      if (!this.paused) {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= 1 / 60 && steps < 6) {
          this.input.build(me.input, me, ground, this.assist(me));
          perfFrameStage('frames: sim', () => s.sim.tick(1 / 60));
          this.acc -= 1 / 60;
          steps++;
        }
        if (steps >= 6) this.acc = 0;
      }
      events = s.sim.drainEvents();
      if (s.kind === 'host') { s.host.distribute(events); s.host.update(dt); }
    }
    if (background) return; // hidden tab: keep the authoritative sim + network alive, skip presentation
    if (this.input.zoomSteps) { this.renderer.setZoom(this.renderer.zoom + this.input.zoomSteps * 0.06); this.input.zoomSteps = 0; }
    if (!this.settings.screenShake) this.renderer.fx.shake = 0;
    this.renderer.update(view, this.localId, dt, events);
    perfFrameStage('frames: audio', () => {
      this.audio.onEvents(events, view, this.localId);
      this.audio.update(view, this.localId, dt);
      this.audio.ambientSounds(this.renderer.drainAmbientSounds());
    });
    perfFrameStage('frames: hud', () => this.hud.onEvents(events, this.localId, view));
    const focus = this.renderer.focusPlayer(view, this.localId);
    this.updateVoice(view, me);
    if (focus) this.tags.update(view, this.localId, focus.floor, (x, y, z) => this.renderer.worldToScreen(x, y, z), (id) => !!this.voice?.speaking(id));
    perfFrameStage('frames: hud', () => this.hud.update(view, this.localId, dt, focus?.id ?? this.localId));
    this.updateOverlays(me, dt);
    this.updateElevator(me);
    this.checkEnd(view, me);
  }

  private updateOverlays(me: PlayerState, dt: number) {
    const hurt = me.hp < this.lastHp - 0.5;
    this.lastHp = me.hp;
    if (hurt) { this.overlay.hurt.style.transition = 'none'; this.overlay.hurt.style.opacity = '1'; requestAnimationFrame(() => { this.overlay.hurt.style.transition = 'opacity 0.5s'; this.overlay.hurt.style.opacity = '0'; }); }
    this.overlay.low.style.opacity = me.life === 'alive' && me.hp < 35 ? String(0.3 + (35 - me.hp) / 50) : '0';
    this.overlay.white.style.opacity = me.flashT > 0 ? String(Math.min(1, me.flashT / 1.5)) : '0';
    // crosshair: bloom-aware spread ring
    const show = !this.screen && me.life === 'alive' && !this.elevPanel;
    this.crosshair.style.display = show ? 'block' : 'none';
    if (show) {
      let x = this.input.mousePx.x, y = this.input.mousePx.y;
      if (this.input.usingPad) { const p = this.renderer.worldToScreen(me.aimX, me.aimY, 0.9); x = p.x; y = p.y; }
      this.crosshair.style.left = x + 'px'; this.crosshair.style.top = y + 'px';
      const wi = me.sel === 'knife' ? null : me.weapons[me.sel];
      const sp = wi ? (me.aiming ? weapon(wi.id).aimSpread : weapon(wi.id).spread) + me.bloom + (me.moving ? 0.03 : 0) : 0.05;
      const d = Math.hypot(me.aimX - me.x, me.aimY - me.y);
      const px = Math.max(10, Math.min(120, Math.tan(sp) * d * 38));
      (this.crosshair.firstChild as HTMLElement).style.transform = `scale(${px / 17})`;
      (this.crosshair.firstChild as HTMLElement).style.borderColor = wi && wi.mag === 0 ? 'rgba(255,60,50,0.9)' : 'rgba(255,255,255,0.8)';
    }
    void dt;
  }

  // ------------------------------------------------------------------ elevator panel
  private updateElevator(me: PlayerState) {
    const panel = (me as any).panel as { kind: string; elev: number; dests: number[]; id: number; hk: 'security' | 'lights'; floor: number } | null;
    // hacking console
    if (panel?.kind === 'hack') {
      if (!this.hackUI && !this.screen) {
        const id = panel.id;
        this.hackUI = new HackUI(panel.floor, panel.hk, (r) => {
          this.hackUI = null;
          const m = this.view()?.players.find((p) => p.id === this.localId);
          if (m) { m.input.hackId = id; m.input.hackOk = r; m.input.hackSeq++; if (this.session?.kind === 'client') (m as any).panel = null; }
          if (!this.screen) { this.input.enabled = true; this.cursor.style.display = 'none'; }
        }, (k) => this.audio.hack(k), keypadCode(this.view()!.cfg.seed, panel.floor), !!this.view()?.codesFound.has(panel.floor));
        this.ui.append(this.hackUI.el);
        this.cursor.style.display = 'block';
        this.input.enabled = false;
        this.sfx('open');
      }
      return;
    }
    if (!panel && this.hackUI) { const u = this.hackUI; this.hackUI = null; u.close(-1); } // walked away / downed
    // command-tent check-in and armory (single player)
    if (panel?.kind === 'checkin') {
      const s = this.session;
      if (this.checkinUI && !this.armory && !document.querySelector('.dialogue') && !this.screen) { this.checkinUI = false; me.input.closeSeq++; (me as any).panel = null; return; }
      if (!this.checkinUI && !this.screen && s?.kind === 'local') {
        if (me.checkedIn) { this.checkinUI = true; this.openArmory(me, s.sim.cfg.difficulty); }
        else {
          const ui = new CheckInUI('', (name) => { // each new run starts with a blank callsign
            this.cursor.style.display = 'none';
            if (name === null) { me.input.closeSeq++; (me as any).panel = null; this.input.enabled = true; return; }
            me.name = name; me.checkedIn = true;
            this.callsign = name; // remembered for this session's rounds only
            this.hud.message(`Checked in as ${name}. The armory is open.`, 'good');
            this.input.enabled = true;
            this.openArmory(me, s.sim.cfg.difficulty);
          }, portraitImg(-1));
          this.checkinUI = true;
          this.ui.append(ui.el);
          this.cursor.style.display = 'block';
          this.input.enabled = false;
          this.sfx('open');
        }
      }
      return;
    }
    if (this.checkinUI && panel?.kind !== 'checkin') this.checkinUI = false;
    // NPC conversation
    if (panel?.kind === 'talk') {
      const npc = npcFor((panel as any).npc);
      if (npc && !this.talkUI && !this.screen) {
        this.talkUI = new DialogueUI(npc, () => {
          this.talkUI = null;
          const m = this.view()?.players.find((p) => p.id === this.localId);
          if (m) { m.input.closeSeq++; (m as any).panel = null; }
          if (!this.screen) { this.input.enabled = true; this.cursor.style.display = 'none'; }
        }, () => this.sfx('click'), portraitImg((panel as any).npc));
        this.ui.append(this.talkUI.el);
        this.cursor.style.display = 'block';
        this.input.enabled = false;
        this.sfx('open');
      }
      return;
    }
    if (!panel && this.talkUI) this.talkUI.close(); // officer walked off
    if (panel && !this.elevPanel && !this.screen) {
      const el = h('div', { class: 'elev panel' },
        h('div', { class: 'h2' }, `Lift ${panel.elev + 1} · Floor ${me.floor}`),
        h('div', { class: 'hint' }, 'Powered car. It can only travel a few floors on this power segment.'),
        h('div', { class: 'grid' }, ...panel.dests.map((f) => h('button', { class: `fb ${f > me.floor ? 'up' : 'down'}`, onclick: () => { this.sfx('click'); this.closeElevator(f); } }, String(f)))),
        this.btn('Cancel', () => this.closeElevator(0), 'small'));
      this.elevPanel = el;
      this.ui.append(el);
      this.cursor.style.display = 'block';
      this.input.enabled = false;
    } else if (!panel && this.elevPanel) this.closeElevator(null);
  }
  private closeElevator(to: number | null) {
    if (to !== null) {
      const v = this.view();
      const me = v?.players.find((p) => p.id === this.localId);
      if (me) { me.input.elevTo = to; me.input.elevSeq++; if (this.session?.kind === 'client') (me as any).panel = null; }
    }
    this.elevPanel?.remove();
    this.elevPanel = null;
    if (!this.screen) { this.input.enabled = true; this.cursor.style.display = 'none'; }
  }

  // ------------------------------------------------------------------ end of run
  private checkEnd(view: ViewSource, me: PlayerState) {
    if (this.endShown) return;
    const phase = view instanceof Sim ? view.phase : (view as ClientView).phase;
    if (phase === 'playing') return;
    this.endShown = true;
    const stats = view instanceof Sim ? view.stats : (view as ClientView).stats;
    const reason = view instanceof Sim ? view.lostReason : (view as ClientView).lostReason;
    const won = phase === 'won';
    if (this.session?.kind === 'local') remove('run');
    const kills = view.players.reduce((a, p) => a + p.kills, 0);
    const bots = view.players.filter((p) => p.bot).length;
    const floor = Math.max(stats.maxFloor, me.floor);
    const time = runTime(stats, view.t);
    const fin = finalScore(me.score, won);
    // every finished run goes on the record, won or lost, so players can track their improvement (Hall of Records)
    const rank = addRecord({
      name: me.name || this.callsign || 'Operator', difficulty: view.cfg.difficulty as Difficulty, floor, kills: me.kills, time, won, date: new Date().toISOString(),
      score: fin.total, knife: me.score.knife, accuracy: fin.accuracy, hacks: me.score.hacks, searches: me.score.searches, speed: me.score.speed, bots: bots || undefined,
    });
    const breakdown = () => h('div', { class: 'score-break' }, ...scoreRows(me.score, won).flatMap(([k, v]) => [h('span', {}, k), h('span', {}, v)]));
    const statLines = () => [
      h('div', { class: 'score-total' }, `${fin.total.toLocaleString('en-US')} PTS`),
      breakdown(),
      h('div', {}, `Run time: ${fmtRunTime(time)} · Highest floor ${floor} / ${FINAL_FLOOR}${view.players.length === 1 ? '' : ` · Squad kills ${kills}`}`),
      h('div', {}, `Difficulty: ${view.cfg.difficulty.toUpperCase()} · Tower seed ${view.cfg.seed}`),
      rank > 0 ? h('div', { style: { color: 'var(--cyan)' } }, `${me.name}: #${rank} in the ${view.cfg.difficulty} Hall of Records`) : null,
    ];
    const sess = this.session;
    // after the credits: home (dedicated-server players: the server's armory), unless a new run already started meanwhile
    const leave = () => { if (this.session !== sess) return; if (sess?.kind === 'client' && sess.client.server) this.backToServerLobby(); else this.mainMenu(); };
    if (won) {
      // upload done and the floor is dead: 3 s, congratulations, then fade to black and roll the credits
      this.audio.prepareCredits();
      setTimeout(() => {
        let rolled = false;
        const roll = () => {
          if (rolled) return;
          rolled = true;
          this.show(null);
          this.input.enabled = false;
          playCredits(this.ui, this.audio, leave);
        };
        this.show(h('div', { class: 'screen congrats' },
          h('div', { class: 'big-jp', style: { color: 'var(--good)' } }, '任務完了'),
          h('h1', { class: 'big green' }, 'AI SHUTDOWN'),
          h('div', { class: 'subtitle' }, `Well done, ${me.name || 'Operator'}. LULLABY is in, SOVEREIGN is gone and the tower is dark. Mission complete.`),
          h('div', { class: 'stats' }, ...statLines()),
          h('div', { class: 'menu' }, this.btn('Continue', roll, 'primary'))));
        this.audio.stinger('victory');
        setTimeout(roll, 9000);
      }, 3000);
      return;
    }
    setTimeout(() => {
      const el = h('div', { class: 'screen' },
        h('div', { class: 'big-jp', style: { color: 'var(--magenta)' } }, view.cfg.mode === 'single' ? '戦死' : '作戦失敗'),
        h('h1', { class: 'big red' }, view.cfg.mode === 'single' ? 'KILLED IN ACTION' : 'SQUAD LOST'),
        h('div', { class: 'subtitle' }, reason),
        h('div', { class: 'stats' }, ...statLines()),
        h('div', { class: 'menu' },
          view.cfg.mode === 'single' ? this.btn('New run (new tower)', () => { const d = view.cfg.difficulty as Difficulty; this.endSession(); this.spStart(d, load<SquadPick[]>('squad', [])); }, 'primary') : null,
          this.session?.kind === 'client' && this.session.client.server ? this.btn('Back to server lobby', () => this.backToServerLobby(), 'primary') : null,
          this.btn('Hall of Records', () => this.recordsScreen(() => this.mainMenu())),
          this.btn('Main menu', () => this.mainMenu())));
      this.show(el);
      this.audio.stinger('death');
    }, 2200);
  }

  /** Dedicated server: stay connected after a run and go back to its armory for the next one. */
  private backToServerLobby() {
    const s = this.session;
    if (s?.kind !== 'client') return;
    this.endSession(false);
    this.audio.setMenuMusic(true);
    this.clientLobby(s.client);
  }

  // ------------------------------------------------------------------ gamepad menu navigation
  private menuNav() {
    // menus, the lift panel, the hacking console and officer conversations all take the pad
    const root = this.elevPanel ?? this.hackUI?.el ?? this.talkUI?.el ?? this.screen;
    if (!root) return;
    const pad = this.input.menuPad();
    const items = [...root.querySelectorAll<HTMLElement>('.btn:not([disabled]), .card, .fb, .item, .cat, .seg button, .hk-word:not([disabled]), .hk-cell, .dl-opt')];
    if (!items.length) return;
    this.menuFocus = Math.min(this.menuFocus, items.length - 1);
    const nav = pad.up || pad.down || pad.left || pad.right;
    if (nav) this.menuFocus = spatialStep(items, this.menuFocus, pad.left ? -1 : pad.right ? 1 : 0, pad.up ? -1 : pad.down ? 1 : 0);
    const cur = items[this.menuFocus];
    // the hacking console redraws every frame, so keep re-marking the focused element while a pad is in use
    if (nav || (this.input.usingPad && !cur.classList.contains('focus'))) {
      items.forEach((i) => i.classList.remove('focus'));
      cur.classList.add('focus');
      if (nav) cur.scrollIntoView({ block: 'nearest' });
    }
    if (pad.ok) { cur.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); cur.click(); } // hack words/cells act on mousedown
    if (pad.back) {
      if (this.elevPanel) this.closeElevator(0);
      else if (this.hackUI) this.hackUI.el.querySelector<HTMLElement>('.hk-foot .btn')?.click(); // disconnect
      else if (this.talkUI) this.talkUI.close();
      else if (this.session && !this.endShown) this.resume();
    }
  }
}
