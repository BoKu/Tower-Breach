/**
 * `?perf=1`: floor-change timing for stutter reports. Each floor switch (and the first floor of a run) prints one
 * console line + table: the main-thread ms of the first 10 frames, where the milliseconds went (generation, sim state,
 * view build stages, first render, per-frame sim/audio/HUD), shader programs linked (with the new programs' names),
 * MB of buffers and textures uploaded, and the slowest idle-time prefetch task before the switch. Idle tasks over
 * 30 ms are logged as they run. Records also collect in `window.__perf`.
 * Off (the default, and always on the server): every helper here is a plain call.
 */
export const perfOn = typeof location !== 'undefined' && new URLSearchParams(location.search).get('perf') === '1';

type Programs = () => { name: string }[];
interface Rec { label: string; stages: Record<string, number>; frames: number[]; programs: Set<object>; gl: typeof glCount; idle: number }
/** GL work counted while ?perf=1: shader programs linked, buffer bytes and textures uploaded */
const glCount = { links: 0, bufferMB: 0, textures: 0 };
let programs: Programs = () => [];
/** Count the GL work of this context; `list` = the renderer's live programs (renderer.info.programs). */
export function perfWatchGL(gl: WebGLRenderingContext | WebGL2RenderingContext, list: Programs) {
  if (!perfOn) return;
  programs = list;
  const g = gl as any, link = g.linkProgram.bind(gl), buf = g.bufferData.bind(gl), tex = g.texImage2D.bind(gl), sub = g.bufferSubData.bind(gl);
  g.linkProgram = (p: WebGLProgram) => { glCount.links++; link(p); };
  g.bufferData = (...a: any[]) => { if (a[1]?.byteLength) glCount.bufferMB += a[1].byteLength / 1048576; buf(...a); };
  g.bufferSubData = (...a: any[]) => { if (a[2]?.byteLength) glCount.bufferMB += a[2].byteLength / 1048576; sub(...a); };
  g.texImage2D = (...a: any[]) => { glCount.textures++; tex(...a); };
}
/** stages timed before the renderer notices the switch (the sim generates the floor inside its tick) */
let pending: Record<string, number> = {};
let rec: Rec | null = null;
const FRAMES = 10;

/** Time `fn` into the current switch's record (or the next one's). An empty stage name skips timing. */
export function perfTime<T>(stage: string, fn: () => T): T {
  if (!perfOn || !stage || inIdle) return fn();
  const t = performance.now();
  try { return fn(); } finally { const s = rec?.stages ?? pending; s[stage] = (s[stage] ?? 0) + performance.now() - t; }
}

/** Like perfTime, for code that runs every frame: timed only during a switch's record (summed over its frames). */
export function perfFrameStage<T>(stage: string, fn: () => T): T {
  return rec ? perfTime(stage, fn) : fn();
}

/** Run one idle-time prefetch task; the slowest one since the last record is reported with the next. */
let idleWorst = 0, inIdle = false;
export function perfIdle(task: () => void) {
  if (!perfOn) { task(); return; }
  const t = performance.now();
  inIdle = true; // its view-build stages are not part of a floor switch
  try { task(); } finally { inIdle = false; }
  const ms = performance.now() - t;
  idleWorst = Math.max(idleWorst, ms);
  if (ms > 30) console.log(`[perf] slow idle task ${Math.round(ms)} ms: ${(task as any).label ?? task.name}`);
}

/** A floor switch starts: adopt the stages timed so far. */
export function perfBegin(label: string) {
  if (!perfOn) return;
  if (rec) perfEnd();
  rec = { label, stages: pending, frames: [], programs: new Set(programs()), gl: { ...glCount }, idle: idleWorst };
  idleWorst = 0;
  pending = {};
}

/** Main-thread ms of one whole frame (sim + render); the record prints after FRAMES frames. */
export function perfFrame(ms: number) {
  if (!rec) return;
  rec.frames.push(ms);
  if (rec.frames.length >= FRAMES) perfEnd();
}

function perfEnd() {
  const r = rec!;
  rec = null;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const stages = Object.fromEntries(Object.entries(r.stages).map(([k, v]) => [k, r1(v)]));
  const gl = { links: glCount.links - r.gl.links, uploadMB: r1(glCount.bufferMB - r.gl.bufferMB), textures: glCount.textures - r.gl.textures };
  const fresh = programs().filter((p) => !r.programs.has(p)).map((p) => p.name);
  const out = { label: r.label, worst: r1(Math.max(0, ...r.frames)), frames: r.frames.map(r1), gl, newPrograms: fresh, idleTaskBefore: r1(r.idle), stages };
  ((window as any).__perf ??= []).push(out);
  console.log(`[perf] ${out.label}: worst frame ${out.worst} ms, frames ${out.frames.join(' ')}; ${gl.links} shaders linked${fresh.length ? ` (${fresh.join(', ')})` : ''}, ${gl.uploadMB} MB buffers + ${gl.textures} textures uploaded; slowest idle prefetch task before it ${out.idleTaskBefore} ms`);
  console.table(stages);
}
