// Usage: npx vite-node scripts/dumpFloor.ts <seed> <floor>   (or via vitest helper)
import { BuildingPlan } from '../src/gen/building';
import { generateFloor, FW, FH, idx, T_WALL, T_DOOR, T_WINDOW, T_FLOOR } from '../src/gen/floor';

export function dump(seed: number, floor: number): string {
  const plan = new BuildingPlan(seed, 'normal');
  const L = generateFloor(plan, floor);
  const g: string[][] = [];
  for (let y = 0; y < FH; y++) {
    const row: string[] = [];
    for (let x = 0; x < FW; x++) {
      const t = L.tiles[idx(x, y)];
      let c = t === T_WALL ? '#' : t === T_DOOR ? '+' : t === T_WINDOW ? '=' : t === T_FLOOR ? '.' : ' ';
      if (t === T_FLOOR && L.solid[idx(x, y)] === 1) c = 'o';
      if (t === T_FLOOR && L.solid[idx(x, y)] === 2) c = 'X';
      const rt = L.rooms[L.roomAt[idx(x, y)]]?.type;
      if (t === T_FLOOR && c === '.' && rt === 'stair') c = 'S';
      if (t === T_FLOOR && c === '.' && rt === 'elevator') c = 'E';
      row.push(c);
    }
    g.push(row);
  }
  for (const s of L.spawns) g[Math.floor(s.y)][Math.floor(s.x)] = s.type[0].toUpperCase();
  for (const c of L.cameras) g[Math.floor(c.y)][Math.floor(c.x)] = 'C';
  for (const t of L.traps) g[Math.floor(t.y)][Math.floor(t.x)] = t.kind === 'mine' ? '*' : '~';
  return `floor ${floor} theme=${L.theme} rooms=${L.rooms.length} props=${L.props.length} spawns=${L.spawns.length} cams=${L.cameras.length} traps=${L.traps.length} lights=${L.lights.length} containers=${L.containers.length} vend=${L.vendings.length}\n` + g.map((r) => r.join('')).join('\n');
}
