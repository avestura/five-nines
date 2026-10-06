import { Sim } from './engine';
import { PARTS, ONE_NEXT_HOP, SHARD_OWNED, ownedByShardMap, wireProblem, wouldCycle } from './parts';
import { REQ_TYPES, type Design, type Level, type Need, type ReqType } from './types';

// A static look at a design before it runs: which wires the engine will
// ignore, whether each kind of request has a path to everything it needs, and
// which parts are cut off or lead nowhere. It reads the same graph the engine
// builds, so it cannot disagree with the run.

const DEFAULT_NEEDS: Record<ReqType, Need[]> = { read: ['data'], write: ['write'], static: ['static'], bot: ['data'] };

export const NEED_WHO: Record<Need, string> = {
  data: 'a database, a replica or a read model (a cache only helps if a database sits behind it)',
  write: 'a database',
  static: 'a CDN or a web server',
  pay: 'the Payments API',
};

export interface BadWire {
  from: string;
  to: string;
  why: string;
}

export interface TypeCheck {
  type: ReqType;
  share: number; // largest share of traffic at any point in the level
  ok: boolean;
  path?: string[]; // one working route, node ids
  stuck?: { path: string[]; needs: Need[] }; // how far the best attempt got
}

export interface Check {
  badWires: BadWire[];
  types: TypeCheck[];
  unreachable: string[]; // placed parts no fan request can ever reach
  deadEnds: string[]; // reachable parts that cannot pass a request anywhere useful
  notes: string[];
  problems: string[]; // everything above as plain sentences, most important first
}

function usedTypes(level: Level): Map<ReqType, number> {
  const share = new Map<ReqType, number>();
  let mix: Partial<Record<ReqType, number>> = level.traffic[0].mix ?? { read: 1 };
  for (const p of level.traffic) {
    if (p.mix) mix = p.mix;
    const sum = REQ_TYPES.reduce((s, k) => s + (mix[k] ?? 0), 0) || 1;
    for (const k of REQ_TYPES) {
      const f = (mix[k] ?? 0) / sum;
      if (f > 0) share.set(k, Math.max(share.get(k) ?? 0, f));
    }
  }
  return share;
}

export function nodeName(d: Design, id: string) {
  const n = d.nodes.find((x) => x.id === id);
  return n ? (n.label ?? PARTS[n.kind].name) + (n.label ? '' : ` (${id})`) : id;
}

export function checkDesign(level: Level, design: Design): Check {
  const sim = new Sim(level, structuredClone(design));
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  const kindOf = (id: string) => byId.get(id)!.kind;

  // Wires the engine drops.
  const badWires: BadWire[] = [];
  const seenFrom = new Map<string, number>();
  const accepted: { from: string; to: string }[] = [];
  const owned = ownedByShardMap(design.nodes, design.edges);
  for (const e of design.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) { badWires.push({ ...e, why: 'one end is missing' }); continue; }
    const p = wireProblem(a.kind, b.kind);
    if (p) { badWires.push({ ...e, why: p }); continue; }
    if (ONE_NEXT_HOP.includes(a.kind)) {
      const n = (seenFrom.get(e.from) ?? 0) + 1;
      seenFrom.set(e.from, n);
      if (n > 1) { badWires.push({ ...e, why: `${PARTS[a.kind].name} only uses its first wire.${a.kind === 'users' ? '' : ' Put a load balancer after it to spread traffic.'}` }); continue; }
    }
    if (owned.has(e.to) && a.kind !== 'shardrouter') { badWires.push({ ...e, why: SHARD_OWNED }); continue; }
    if (wouldCycle(accepted, e.from, e.to)) { badWires.push({ ...e, why: 'It makes a loop.' }); continue; }
    accepted.push(e);
  }

  const fans = design.nodes.filter((n) => n.kind === 'users').map((n) => n.id);

  // Reachability from the fans, along wires the engine keeps.
  const seen = new Set<string>(fans);
  const stack = [...fans];
  while (stack.length) {
    const id = stack.pop()!;
    for (const to of sim.out.get(id) ?? []) if (!seen.has(to)) { seen.add(to); stack.push(to); }
  }
  for (const id of sim.assetCdns) seen.add(id);
  const unreachable = design.nodes.filter((n) => !seen.has(n.id) && n.kind !== 'payment' && !n.fixed).map((n) => n.id);
  // A CDN is a sink for files, and a cache may sit beside the database (cache-aside).
  const sinks: string[] = ['db', 'replica', 'readmodel', 'payment', 'users', 'cdn', 'cache'];
  const deadEnds = design.nodes
    .filter((n) => seen.has(n.id) && !sinks.includes(n.kind) && !(sim.out.get(n.id) ?? []).length)
    .map((n) => n.id);

  // Does each kind of request have a route to everything it needs?
  const types: TypeCheck[] = [];
  for (const [type, share] of usedTypes(level)) {
    const start: Need[] = [...(level.needs?.[type] ?? DEFAULT_NEEDS[type])];
    let best: { path: string[]; needs: Need[] } = { path: [], needs: start };
    let found: string[] | undefined;
    // A web server or worker holds the request and calls its downstream parts
    // one after another (charge the card, then save the order). Anything else
    // just passes it along. walk returns the needs still unmet afterwards.
    const walk = (id: string, needs: Need[], path: string[]): Need[] => {
      const node = sim.nodes.get(id)!;
      let left = needs;
      if (node.spec.kind === 'cache') {
        if (type === 'read' || type === 'bot') left = left.filter((n) => n !== 'data');
      } else if (!(node.spec.kind === 'readmodel' && !sim.subscribed.has(id))) {
        const got = PARTS[node.spec.kind].provides(type, 0.5);
        left = left.filter((n) => !got.includes(n));
      }
      const here = [...path, id];
      if (left.length < best.needs.length || (left.length === best.needs.length && here.length > best.path.length)) best = { path: here, needs: left };
      if (!left.length) { found ??= here; return left; }
      const dumb = ['lb', 'users', 'dns'].includes(node.spec.kind);
      const kids = (sim.out.get(id) ?? []).filter((to) => {
        if (here.includes(to)) return false;
        const reach = sim.reach.get(to);
        if (!reach?.size) return false;
        return dumb || left.some((n) => reach.has(n));
      });
      if (PARTS[node.spec.kind].holds) {
        for (let progress = true; progress && left.length; ) {
          progress = false;
          for (const to of kids) {
            const r = walk(to, left, here);
            if (r.length < left.length) { left = r; progress = true; }
          }
        }
        return left;
      }
      let bestLeft = left;
      for (const to of kids) {
        const r = walk(to, left, here);
        if (r.length < bestLeft.length) bestLeft = r;
        if (!bestLeft.length) break;
      }
      return bestLeft;
    };
    const ok = fans.some((f) => walk(f, start, []).length === 0);
    types.push({ type, share, ok, path: ok ? found : undefined, stuck: ok ? undefined : best });
  }
  types.sort((a, b) => b.share - a.share);

  const notes: string[] = [];
  const queues = design.nodes.filter((n) => n.kind === 'queue' && seen.has(n.id));
  for (const q of queues) {
    const to = sim.out.get(q.id) ?? [];
    if (!to.some((t) => kindOf(t) === 'worker')) notes.push(`${nodeName(design, q.id)} has no worker behind it, so its jobs are never done.`);
  }
  for (const n of design.nodes.filter((x) => x.kind === 'readmodel' && seen.has(x.id))) {
    const miss = sim.stale.get(n.id);
    if (miss) notes.push(`${miss.map((m) => nodeName(design, m)).join(', ')} save${miss.length > 1 ? '' : 's'} to the database but ${miss.length > 1 ? 'do' : 'does'} not publish to a topic feeding ${nodeName(design, n.id)}, so the read model misses those writes and answers nothing.`);
    else if (!sim.subscribed.has(n.id)) notes.push(`${nodeName(design, n.id)} is not fed by an event topic that something publishes to, so it answers nothing.`);
  }
  if (level.maxCost) {
    const cost = design.nodes.reduce((s, n) => s + (n.fixed ? 0 : PARTS[n.kind].cost), 0);
    if (cost > level.maxCost) notes.push(`Costs $${cost}/mo, over the $${level.maxCost} cap. Run is disabled.`);
  }

  // Plain sentences, most important first.
  const problems: string[] = [];
  const fansWired = fans.some((f) => (sim.out.get(f) ?? []).length);
  if (!fansWired) problems.push('Fans are not wired to anything usable.');
  for (const t of types) {
    if (t.ok || !fansWired) continue;
    const s = t.stuck!;
    const route = s.path.map((id) => nodeName(design, id)).join(' > ');
    const pct = Math.round(t.share * 100);
    problems.push(`${t.type} requests (${pct}%) have no working route. Best attempt: ${route || 'nowhere'}, still missing "${s.needs[0]}". That needs ${NEED_WHO[s.needs[0]]}.`);
  }
  for (const b of badWires) problems.push(`Ignored wire ${nodeName(design, b.from)} > ${nodeName(design, b.to)}: ${b.why}`);
  for (const id of deadEnds) problems.push(`${nodeName(design, id)} is a dead end: it is wired in but has nothing after it.`);
  for (const id of unreachable) problems.push(`${nodeName(design, id)} can never receive a request (nothing wired from the fans reaches it). You are paying for it anyway.`);
  problems.push(...notes);

  return { badWires, types, unreachable, deadEnds, notes, problems };
}
