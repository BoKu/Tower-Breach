import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { genSignature } from './support/genSignature';

// The dedicated server binaries are compiled with Bun (JavaScriptCore); players run V8 (Electron, Chrome, Edge).
// Floors are generated on both sides from the seed, so they must match exactly or the server's walls and doors
// disagree with what players see (v1.9.0: a random-comparator sort made Bun build different floors).
const BUN = process.env.BUN ?? path.join(os.homedir(), '.bun/bin/bun');
const haveBun = existsSync(BUN);

it.skipIf(!haveBun)('Bun (dedicated server) and V8 (players) generate identical floors', () => {
  const v8 = genSignature();
  const bun = execFileSync(BUN, [path.join(__dirname, 'support/genSignature.bun.ts')], { encoding: 'utf8', timeout: 120_000 }).trim().split('\n');
  expect(bun.length).toBe(v8.length);
  const diff = v8.filter((l, i) => l !== bun[i]);
  expect(diff, `differ: ${diff.map((l) => l.split(' ')[0]).join(', ')}`).toEqual([]);
}, 180_000);
