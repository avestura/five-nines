import type { Design, Level, NodeSpec } from './sim/types';
import { ONE_NEXT_HOP, wireProblem, wouldCycle } from './sim/parts';

// Compact form: only the player's own parts, fixed ones come from the level.
interface Packed {
  n: [string, string, number, number, string?][];
  e: [string, string][];
}

export function encodeDesign(d: Design): string {
  const p: Packed = {
    n: d.nodes.filter((x) => !x.fixed).map((x) => {
      const o = x.opts ? Object.keys(x.opts).filter((k) => (x.opts as Record<string, boolean>)[k]).join(',') : '';
      return o ? [x.id, x.kind, x.x, x.y, o] : [x.id, x.kind, x.x, x.y];
    }),
    e: d.edges.map((e) => [e.from, e.to]),
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/=+$/, '');
}

export function decodeDesign(s: string, level: Level): Design | null {
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(s)))) as Packed;
    const nodes: NodeSpec[] = [
      ...level.fixed.map((f) => ({ ...f })),
      ...p.n.map(([id, kind, x, y, o]) => ({
        id, kind: kind as NodeSpec['kind'], x, y,
        opts: o ? Object.fromEntries(o.split(',').map((k) => [k, true])) : undefined,
      })),
    ];
    const kind = new Map(nodes.map((x) => [x.id, x.kind]));
    // Drop wires the editor would refuse today (saves from before a rule existed).
    const ok = ([a, b]: [string, string]) => kind.has(a) && kind.has(b) && !wireProblem(kind.get(a)!, kind.get(b)!);
    const wired = new Set<string>();
    const oneAddress = ([a]: [string, string]) => {
      if (!ONE_NEXT_HOP.includes(kind.get(a)!)) return true;
      if (wired.has(a)) return false;
      wired.add(a);
      return true;
    };
    const edges = [...(level.fixedEdges ?? [])];
    for (const [from, to] of p.e.filter(ok).filter(oneAddress)) if (!wouldCycle(edges, from, to)) edges.push({ from, to });
    return { nodes, edges };
  } catch {
    return null;
  }
}

export function shareUrl(levelId: string, d: Design) {
  const base = location.href.split('#')[0];
  return `${base}#L=${encodeURIComponent(levelId)}&d=${encodeDesign(d)}`;
}

export function readHash(): { level?: string; design?: string } {
  const h = new URLSearchParams(location.hash.slice(1));
  return { level: h.get('L') ?? undefined, design: h.get('d') ?? undefined };
}
