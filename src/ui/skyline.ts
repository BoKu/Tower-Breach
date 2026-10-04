/** Animated procedural menu backdrop: the tower at night, rain, searchlights, the AI's red eye. */
export class Skyline {
  canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private raf = 0;
  private drops: { x: number; y: number; v: number }[] = [];
  private windows: { x: number; y: number; on: boolean; t: number }[] = [];
  constructor() {
    this.canvas.className = 'skyline';
    for (let i = 0; i < 260; i++) this.drops.push({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.8 });
    for (let y = 0; y < 60; y++) for (let x = 0; x < 9; x++) this.windows.push({ x, y, on: Math.random() < (y < 12 ? 0.02 : 0.12), t: Math.random() * 10 });
  }
  start(parent: HTMLElement) {
    parent.prepend(this.canvas);
    const loop = (t: number) => { this.draw(t / 1000); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.raf); this.canvas.remove(); }
  private draw(t: number) {
    const c = this.canvas, g = this.ctx;
    const W = (c.width = innerWidth), H = (c.height = innerHeight);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#020d12'); sky.addColorStop(0.7, '#06222c'); sky.addColorStop(1, '#1a0a18');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    // searchlights
    for (let i = 0; i < 3; i++) {
      const a = Math.sin(t * 0.2 + i * 2) * 0.5 - Math.PI / 2;
      const x0 = W * (0.2 + i * 0.3), y0 = H;
      g.fillStyle = 'rgba(53,216,255,0.04)';
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a - 0.05) * H * 1.5, y0 + Math.sin(a - 0.05) * H * 1.5); g.lineTo(x0 + Math.cos(a + 0.05) * H * 1.5, y0 + Math.sin(a + 0.05) * H * 1.5); g.fill();
    }
    // background buildings
    g.fillStyle = '#041519';
    for (let i = 0; i < 16; i++) { const bw = W / 14, bh = H * (0.15 + ((i * 7919) % 17) / 45); g.fillRect(i * bw - 20, H - bh, bw - 6, bh); }
    // the tower
    const tw = Math.min(W * 0.16, 220), tx = W / 2 - tw / 2, top = H * 0.05;
    g.fillStyle = '#02090c';
    g.fillRect(tx, top, tw, H - top);
    g.fillRect(W / 2 - 3, top - 60, 6, 60);
    const cw = tw / 9, ch = (H - top) / 60;
    for (const w of this.windows) {
      const flick = w.on && Math.sin(t * 3 + w.t * 7) > -0.95;
      if (!flick) continue;
      g.fillStyle = w.y < 20 ? 'rgba(255,61,139,0.55)' : 'rgba(53,216,255,0.32)';
      g.fillRect(tx + w.x * cw + 3, top + w.y * ch + 3, cw - 6, ch - 5);
    }
    // the eye
    const pulse = 0.6 + Math.sin(t * 2) * 0.4;
    const eg = g.createRadialGradient(W / 2, top - 60, 0, W / 2, top - 60, 40);
    eg.addColorStop(0, `rgba(255,40,30,${pulse})`); eg.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = eg; g.fillRect(W / 2 - 40, top - 100, 80, 80);
    // rain
    g.strokeStyle = 'rgba(120,220,255,0.16)'; g.lineWidth = 1;
    g.beginPath();
    for (const d of this.drops) {
      d.y += d.v * 0.012; d.x -= 0.0015;
      if (d.y > 1) { d.y = 0; d.x = Math.random() * 1.1; }
      g.moveTo(d.x * W, d.y * H); g.lineTo(d.x * W - 3, d.y * H + 14);
    }
    g.stroke();
  }
}
