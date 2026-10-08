import LINES from '../config/botLines.json';

export const BOT_LINES: string[] = LINES;

/**
 * Squad chatter (single player, cosmetic): roughly once a minute (45-90 s apart, the first after 20-40 s) one bot
 * near you says a line. Nothing while you're down; no line repeats within the last 15.
 */
export class Chatter {
  private wait: number;
  private recent: number[] = [];
  constructor(private rnd: () => number = Math.random) { this.wait = 20 + rnd() * 20; }
  /** bots: living squadmates near you. Returns who speaks and which line, or null. */
  tick(dt: number, bots: { id: number; member: number }[], youAreDown: boolean): { id: number; member: number; line: number } | null {
    this.wait -= dt;
    if (this.wait > 0 || youAreDown || !bots.length) return null;
    this.wait = 45 + this.rnd() * 45;
    const b = bots[Math.floor(this.rnd() * bots.length)];
    let line = 0;
    // each line was recorded once: the men (members 0, 2) have the even lines, the women (1, 3) the odd ones
    for (let k = 0; k < 20; k++) { line = Math.floor(this.rnd() * (BOT_LINES.length / 2)) * 2 + (b.member % 2); if (!this.recent.includes(line)) break; }
    this.recent.push(line);
    if (this.recent.length > 15) this.recent.shift();
    return { id: b.id, member: b.member, line };
  }
}
