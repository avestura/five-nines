import { PARTS } from './parts';
import type { Sim } from './engine';
import type { Design, Level, NodeOpts, NodeSpec, PartKind } from './types';

// Turns what a run measured into a cause and a fix. Everything here is read
// from the run (stats.why, byType, halfDone) and the design, never from the
// level's canned text. Every inspector switch has a symptom detector, so a
// level that teaches a switch can say "you left it off" when it matters.

export interface Diagnosis {
  headline: string | null; // the biggest measured cause, one sentence
  fixes: string[]; // concrete things to try, most useful first
}

export function parseWhy(key: string) {
  const m = /^([a-z-]+)(?:\(([a-z]+)\))?@(.*)$/.exec(key);
  return m ? { reason: m[1], need: m[2] ?? '', node: m[3] } : null;
}

interface Cand {
  n: number;
  headline: string;
  fixes: string[];
}

export function diagnose(sim: Sim, level: Level, design: Design): Diagnosis {
  const byId = new Map(design.nodes.map((x) => [x.id, x]));
  const has = (k: PartKind) => level.catalog.includes(k);
  const optAvail = (o: keyof NodeOpts) => !!level.options?.includes(o);
  const label = (x: NodeSpec) => `${x.label ?? PARTS[x.kind].name.toLowerCase()} (${x.id})`;
  const labels = (xs: NodeSpec[]) => {
    const by = new Map<PartKind, NodeSpec[]>();
    for (const x of xs) by.set(x.kind, [...(by.get(x.kind) ?? []), x]);
    return [...by].map(([k, g]) => (g.length === 1 ? label(g[0]) : `${g.length} ${PARTS[k].name.toLowerCase()}s (${g.map((x) => x.id).join(', ')})`)).join(' and ');
  };
  const oneEach = (xs: NodeSpec[]) => [...new Map(xs.map((x) => [x.kind, x])).values()];
  const upstream = (id: string) => design.edges.filter((e) => e.to === id).map((e) => byId.get(e.from)).filter(Boolean) as NodeSpec[];
  const offOn = (xs: NodeSpec[], o: keyof NodeOpts) => xs.filter((x) => !x.fixed && !x.opts?.[o]);
  const mine = (kinds: PartKind[]) => design.nodes.filter((x) => kinds.includes(x.kind) && !x.fixed);
  const how = (o: keyof NodeOpts) => `Select the part and tick "${OPT_NAME[o]}" in its inspector.`;

  const sums = new Map<string, { n: number; at: Set<string> }>();
  for (const [k, n] of Object.entries(sim.stats.why)) {
    const p = parseWhy(k);
    if (!p) continue;
    const g = sums.get(p.reason) ?? { n: 0, at: new Set<string>() };
    g.n += n;
    g.at.add(p.node);
    sums.set(p.reason, g);
  }
  const nodes = (ids: Set<string>) => [...ids].map((i) => byId.get(i)).filter(Boolean) as NodeSpec[];
  const chaos = level.chaos.map((c) => c.kind);
  const slowChaos = chaos.includes('slow') || chaos.includes('hang');
  const cands: Cand[] = [];

  // A part was down and requests were still sent to it.
  const down = level.regions ? undefined : sums.get('node-down');
  if (down) {
    const dead = nodes(down.at);
    const deadWebs = dead.filter((d) => d.kind === 'web');
    const fronts = new Set<NodeSpec>();
    for (const d of deadWebs) for (const u of upstream(d.id)) if (['lb', 'gateway', 'dns'].includes(u.kind)) fronts.add(u);
    const off = offOn([...fronts].filter((f) => f.kind !== 'dns'), 'healthCheck');
    const fixes: string[] = [];
    let headline = `${down.n} requests were sent to ${labels(dead)} while it was down.`;
    if (off.length && optAvail('healthCheck')) {
      headline += ` Health checks are off on ${labels(off)}, so it kept sending fans to a dead part.`;
      fixes.push(`Turn on health checks on ${labels(off)}. It then skips parts that are down. ${how('healthCheck')}`);
    } else if (deadWebs.length && !fronts.size && has('lb')) {
      fixes.push('Nothing in front of those web servers can skip a dead one. Put a load balancer in front of them and turn on its health checks.');
    }
    if (deadWebs.length) fixes.push('Keep one more web server than the peak needs, so the survivors can absorb the share of the dead one.');
    cands.push({ n: down.n, headline, fixes });
  }

  // Calls that failed at random and nothing retried them.
  const flaky = sums.get('flaky');
  if (flaky) {
    const targets = nodes(flaky.at);
    const callers = new Map<string, NodeSpec>();
    for (const t of targets) for (const u of upstream(t.id)) if (['web', 'worker'].includes(u.kind)) callers.set(u.id, u);
    const off = offOn([...callers.values()], 'retry');
    const fixes: string[] = [];
    let headline = `${flaky.n} calls to ${labels(targets)} failed at random.`;
    if (off.length && optAvail('retry')) {
      headline += ` Retry is off on ${labels(off)}, so one failed call was final.`;
      fixes.push(`Turn on retry with backoff on ${labels(off)}. A call that fails at random usually works the second time. ${how('retry')}`);
    } else {
      fixes.push('Retries were on and some calls still failed three times in a row. Spend less elsewhere or add a second route.');
    }
    cands.push({ n: flaky.n, headline, fixes });
  }

  // Fans gave up waiting, usually behind a slow dependency.
  const slow = sums.get('timeout');
  if (slow) {
    const where = nodes(slow.at);
    const callers = mine(['web', 'worker']);
    const fixes: string[] = [];
    let headline = `${slow.n} fans gave up after 3 seconds while their request was at ${labels(where)}.`;
    if (slowChaos) {
      const noBreaker = offOn(callers, 'breaker');
      if (noBreaker.length && optAvail('breaker')) {
        headline += ' A dependency was slow or hung, and each call held a slot while it waited.';
        fixes.push(`Turn on circuit breakers on ${labels(noBreaker)}. They stop calling a failing dependency and fail fast, which frees the slots. ${how('breaker')}`);
      }
      const retrying = callers.filter((x) => x.opts?.retry);
      if (retrying.length && optAvail('breaker')) fixes.push(`Retry is on for ${labels(retrying)}. Retrying a dependency that is drowning adds load to it. Turn retry off there, or let the breaker stop the calls.`);
      const noBulk = offOn(mine(['web']), 'bulkhead');
      if (noBulk.length && optAvail('bulkhead') && sim.stats.byType.read.failed > 0) {
        fixes.push(`Reads failed too. Slow checkouts were holding every slot. Turn on the bulkhead on ${labels(noBulk)} so writes can only use half. ${how('bulkhead')}`);
      }
    }
    cands.push({ n: slow.n, headline, fixes: fixes.concat(oneEach(where).slice(0, 1).flatMap(capacityFix)) });
  }

  // Slots and queue both full.
  const over = sums.get('overflow');
  if (over) {
    const where = nodes(over.at);
    const fixes: string[] = [];
    for (const w of oneEach(where).slice(0, 2)) fixes.push(...capacityFix(w));
    const noBulk = offOn(mine(['web']), 'bulkhead');
    if (slowChaos && noBulk.length && optAvail('bulkhead') && where.some((w) => w.kind === 'web') && sim.stats.byType.read.failed > 0) {
      fixes.unshift(`Slow checkouts may be hogging web slots. Try the bulkhead on ${labels(noBulk)}. ${how('bulkhead')}`);
    }
    const held = slowChaos && where.some((w) => ['web', 'worker'].includes(w.kind)) ? ' Their slots were tied up by calls waiting on a slow dependency.' : '';
    cands.push({ n: over.n, headline: `${over.n} requests were turned away because ${labels(where)} had no free slots and a full queue.${held}`, fixes });
  }

  // Orders still waiting in a queue when time ran out.
  const aged = sums.get('async-expired');
  if (aged) {
    const fixes = ['The queue filled faster than the workers drained it, or the database behind them could not take what they sent.'];
    if (has('worker')) fixes.push('Add workers, or wire a shard map and a second database behind them.');
    cands.push({ n: aged.n, headline: `${aged.n} queued orders were never processed in time.`, fixes });
  }

  // Half an order.
  if (level.sagaRule && sim.stats.halfDone > 0) {
    const off = offOn(mine(['web', 'worker']), 'saga');
    const fixes: string[] = [];
    let headline = `${sim.stats.halfDone} orders failed halfway: one step finished and nothing undid it.`;
    if (off.length && optAvail('saga')) {
      headline += ` Saga is off on ${labels(off)}.`;
      fixes.push(`Turn on saga on ${labels(off)}. A failed save then undoes the charge. ${how('saga')}`);
    }
    cands.push({ n: sim.stats.halfDone * 2, headline, fixes });
  }

  // A region went dark and only one region had parts.
  if (level.regions && level.chaos.some((c) => typeof c.target === 'object' && 'region' in c.target)) {
    const inNorth = design.nodes.filter((x) => !x.fixed && x.x >= 192 && x.y < 336).length;
    const inSouth = design.nodes.filter((x) => !x.fixed && x.x >= 192 && x.y >= 336).length;
    if (!inNorth || !inSouth) {
      cands.push({
        n: sim.stats.failed,
        headline: `Everything you built sits in one region, so losing it lost everything.`,
        fixes: ['Build a complete copy of the stack in the other region and put a global router in the left strip in front of both.'],
      });
    }
  }

  cands.sort((a, b) => b.n - a.n);
  const fixes: string[] = [];
  for (const c of cands) for (const f of c.fixes) if (!fixes.includes(f)) fixes.push(f);
  // A switch you left off is cheaper to fix than building more, so it goes first.
  fixes.sort((a, b) => Number(/tick "/.test(b)) - Number(/tick "/.test(a)));
  return { headline: cands[0]?.headline ?? null, fixes: fixes.slice(0, 5) };

  function capacityFix(x?: NodeSpec): string[] {
    if (!x) return [];
    const opts = (ks: [PartKind, string][]) => ks.filter(([k]) => has(k)).map(([, t]) => t);
    const list = (xs: string[]) => (xs.length ? ` Or take load off it: ${xs.join(', ')}.` : '');
    switch (x.kind) {
      case 'web':
        return [`The web servers ran out of slots.${has('lb') ? ' Add web servers behind a load balancer.' : ''}${list(opts([['cdn', 'a CDN for files'], ['cache', 'a cache for reads'], ['queue', 'a queue for writes']]))}`];
      case 'db':
        return [`${label(x)} is the bottleneck.${list(opts([['cache', 'a cache for repeated reads'], ['replica', 'a read replica for reads'], ['queue', 'a queue with workers to smooth writes'], ['shardrouter', 'a shard map and a second database']]))}`];
      case 'worker':
        return [`${label(x)} cannot keep up. Add more workers behind the queue.`];
      case 'queue':
        return ['The queue itself overflowed. Add workers so it drains.'];
      case 'payment':
        return ['The Payments API cannot be scaled. Send it fewer calls: fail fast with a breaker, or queue the orders.'];
      case 'users':
        return [];
      default:
        return [`${label(x)} ran out of room. Add another one beside it.`];
    }
  }
}

const OPT_NAME: Record<keyof NodeOpts, string> = {
  healthCheck: 'Health checks',
  retry: 'Retry failed calls with backoff',
  breaker: 'Circuit breaker on outgoing calls',
  bulkhead: 'Bulkhead',
  saga: 'Saga',
};
