import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import { HOLIDAYS, setHolidayOverride, type Holiday } from './config/holiday';
import { App } from './game/app';
import { BOT_CLASSES } from './config/bots';
import type { SquadPick } from './sim/bot';

// Debug / test hook: ?dev=1&floor=N&diff=hard&torch=1&god=1&ammo=1&squad=medic,gunner,random,recon
const q = new URLSearchParams(location.search);
// ?holiday=xmas|easter|halloween|none overrides today's date in any game (normal play or dev);
// dev sandboxes pick theirs from the floor name: sandbox (plain), sandbox-xmas, sandbox-easter, sandbox-halloween
const fl = q.get('floor') ?? '0', sandbox = !!q.get('dev') && (fl === 'sandbox' || fl.startsWith('sandbox-'));
const hol = sandbox ? fl.slice(8) : q.get('holiday');
if (hol && (HOLIDAYS as string[]).includes(hol)) setHolidayOverride(hol as Holiday);
else if (sandbox || hol === 'none') setHolidayOverride(null);

const app = new App();
(window as any).__app = app;
if (q.get('dev') === 'portraits') {
  // portrait exporter: renders every officer from their look (config/npcs.ts) with a download link per PNG.
  // Save them into public/portraits/ to regenerate the shipped images (or edit those files directly).
  void Promise.all([import('./render/portrait'), import('./config/npcs')]).then(([m, n]) => {
    const ids = [-1, ...n.STREET_CAST.map((_, i) => i)];
    const wrap = document.createElement('div');
    wrap.id = 'portrait-export';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:999;overflow:auto;background:#0f1c30;color:#cde;font:12px sans-serif;padding:12px;display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start';
    for (const i of ids) {
      const url = m.officerPortrait(i)!, file = n.portraitFile(i);
      const a = document.createElement('a');
      a.href = url; a.download = file; a.dataset.file = file;
      a.style.cssText = 'color:#9ff;text-align:center;text-decoration:none';
      a.innerHTML = `<img src="${url}" width="128" height="128" style="display:block;background:radial-gradient(#2a4a78,#0f1c30)">${file}`;
      wrap.appendChild(a);
    }
    document.body.appendChild(wrap);
  });
} else if (q.get('dev') === 'credits') {
  // preview the end credits: a click (needed for sound) plays them, then back to the main menu
  void import('./ui/credits').then(({ playCredits }) => {
    const go = document.createElement('button');
    go.textContent = 'Play the end credits';
    go.style.cssText = 'position:fixed;z-index:999;left:50%;top:50%;transform:translate(-50%,-50%);padding:14px 28px;font:600 18px sans-serif;background:#35d8ff;border:0;cursor:pointer';
    go.onclick = () => { go.remove(); const a = (app as any).audio; a.unlock(); a.setMenuMusic(false); playCredits(document.body, a, () => app.mainMenu()); };
    document.body.appendChild(go);
  });
} else if (q.get('dev')) {
  const squad = (q.get('squad') ?? '').split(',').filter(Boolean).slice(0, 4).map((c) => (c === 'random' || (BOT_CLASSES as string[]).includes(c) ? c : null)) as SquadPick[];
  app.devStart((q.get('diff') as any) || 'normal', sandbox ? -1 : Number(fl), q.get('torch') === '1', sandbox ? { god: true, ammo: true, torch: true } : { god: q.get('god') === '1', ammo: q.get('ammo') === '1', torch: q.get('torch') === '1' }, sandbox ? [] : squad);
}
