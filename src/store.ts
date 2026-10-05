// Progress and settings. localStorage can be missing or throw (private
// windows, blocked storage), so every access is guarded.
export type Naming = 'generic' | 'azure' | 'aws';

export interface Save {
  stars: Record<string, number>; // level id -> best stars
  designs: Record<string, string>; // level id -> last design (encoded)
  seenCards: string[];
  naming: Naming;
  muted: boolean;
  debug: boolean; // show the Debug button and the design check
}

const KEY = 'five-nines-v1';

const blank = (): Save => ({ stars: {}, designs: {}, seenCards: [], naming: 'generic', muted: false, debug: false });

let cache: Save | null = null;

export function load(): Save {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...blank(), ...JSON.parse(raw) } : blank();
  } catch {
    cache = blank();
  }
  return cache!;
}

export function save(mut: (s: Save) => void) {
  const s = load();
  mut(s);
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable, keep going in memory */
  }
}
