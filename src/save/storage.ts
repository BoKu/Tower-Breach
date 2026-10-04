/** localStorage wrapper that never throws (private mode, quota, disabled storage). */
const PREFIX = 'towerbreach.';
let memory: Record<string, string> = {};
let available: boolean | null = null;

function ok(): boolean {
  if (available !== null) return available;
  try {
    const k = PREFIX + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export function storageAvailable() { return ok(); }

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = ok() ? localStorage.getItem(PREFIX + key) : memory[key] ?? null;
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  try {
    if (ok()) { localStorage.setItem(PREFIX + key, raw); return true; }
  } catch { /* quota or disabled: fall through */ }
  memory[key] = raw;
  return false;
}

export function remove(key: string) {
  try { if (ok()) localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  delete memory[key];
}

/** test hook */
export function _resetMemory() { memory = {}; available = null; }
