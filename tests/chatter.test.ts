import { describe, it, expect } from 'vitest';
import { Chatter } from '../src/ui/chatter';
import LINES from '../src/config/botLines.json';

const rng = (s = 1) => () => ((s = (s * 48271) % 2147483647) / 2147483647);

describe('bot chatter', () => {
  it('about one line a minute, one bot at a time, never two within 45 s, none while you are down', () => {
    const c = new Chatter(rng(7));
    const said: { t: number; id: number; line: number }[] = [];
    const bots = [{ id: 100, member: 0 }, { id: 101, member: 1 }, { id: 102, member: 2 }];
    for (let i = 0; i < 20 * 60 * 10; i++) { // 20 minutes at 10 Hz
      const t = i / 10;
      const down = t > 600 && t < 700;
      const r = c.tick(0.1, bots, down);
      if (r) { said.push({ t, ...r }); expect(down).toBe(false); expect(bots.map((b) => b.id)).toContain(r.id); }
    }
    expect(said.length).toBeGreaterThanOrEqual(10);
    expect(said.length).toBeLessThanOrEqual(26);
    for (let i = 1; i < said.length; i++) expect(said[i].t - said[i - 1].t).toBeGreaterThanOrEqual(45);
    for (const s of said) { expect(s.line).toBeGreaterThanOrEqual(0); expect(s.line).toBeLessThan(LINES.length); }
    // one recorded voice per line: the men (members 0, 2) say the even lines, the women (1, 3) the odd ones
    for (const s of said) expect(s.line % 2).toBe(bots.find((b) => b.id === s.id)!.member % 2);
    const lines = said.map((s) => s.line);
    for (let i = 0; i < lines.length; i++) expect(lines.slice(Math.max(0, i - 15), i)).not.toContain(lines[i]); // no quick repeats
  });
  it('nobody near you: nothing said', () => {
    const c = new Chatter(rng(3));
    let n = 0;
    for (let i = 0; i < 6000; i++) if (c.tick(0.1, [], false)) n++;
    expect(n).toBe(0);
  });
});
