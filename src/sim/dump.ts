import { checkDesign, nodeName } from './check';
import { PARTS } from './parts';
import { score } from './score';
import { encodeDesign } from '../share';
import { designCost, idleGateways, IDLE_GATEWAY_EXTRA, type Sim } from './engine';
import { REQ_TYPES, type Design, type Level } from './types';

const OPT_SHORT: Record<string, string> = { healthCheck: 'hc', retry: 'retry', breaker: 'breaker', bulkhead: 'bulkhead', saga: 'saga' };

// A compact, readable account of a design, what the checker thinks of it, and
// (if it ran) what happened. Meant to be pasted into a bug report: it has
// everything needed to reproduce the run, and nothing else.
export function dumpState(level: Level, design: Design, sim: Sim | null): string {
  const L: string[] = [];
  const cost = designCost(design);
  L.push(`LEVEL ${level.id} "${level.title}"  cost $${cost}${level.maxCost ? `/${level.maxCost}` : ''} par $${level.parCost}  budget ${level.errorBudget}  slo p99<${level.slo.p99}ms ok>=${level.slo.success * 100}%`);

  // Traffic: one line per point where the mix changes.
  let mix = level.traffic[0].mix ?? { read: 1 };
  const tr = level.traffic.map((p) => {
    const note = p.mix && p.mix !== mix ? ` ${REQ_TYPES.filter((k) => p.mix![k]).map((k) => `${k[0]}${Math.round(p.mix![k]! * 100)}`).join('/')}` : '';
    if (p.mix) mix = p.mix;
    return `${p.at}s:${p.rps}rps${note}`;
  });
  L.push(`TRAFFIC ${tr.join(' ')}  mix0 ${REQ_TYPES.filter((k) => (level.traffic[0].mix ?? { read: 1 })[k]).map((k) => `${k[0]}${Math.round((level.traffic[0].mix ?? { read: 1 })[k]! * 100)}`).join('/')}`);
  if (level.needs) L.push(`NEEDS ${Object.entries(level.needs).map(([t, n]) => `${t}:${n!.join('+')}`).join(' ')}`);
  if (level.chaos.length) L.push(`CHAOS ${level.chaos.map((c) => `${c.at}s ${c.kind} ${typeof c.target === 'string' ? c.target : 'kind' in c.target ? `${c.target.kind}/${c.target.pick}` : c.target.region}`).join(', ')}`);
  if (level.cacheHit !== undefined) L.push(`CACHEHIT ${level.cacheHit}`);

  L.push('NODES ' + design.nodes.map((n) => {
    const o = Object.entries(n.opts ?? {}).filter(([, v]) => v).map(([k]) => OPT_SHORT[k] ?? k);
    return `${n.id}:${n.kind}${n.fixed ? '*' : ''}${o.length ? `[${o.join(',')}]` : ''}`;
  }).join(' '));

  // Edges grouped by source: a>b,c
  const by = new Map<string, string[]>();
  for (const e of design.edges) by.set(e.from, [...(by.get(e.from) ?? []), e.to]);
  L.push('EDGES ' + [...by].map(([f, t]) => `${f}>${t.join(',')}`).join('  '));

  const idle = idleGateways(design);
  if (idle.length) L.push(`IDLEGATEWAY ${idle.join(' ')} (+$${idle.length * IDLE_GATEWAY_EXTRA})`);
  const c = checkDesign(level, design);
  if (c.badWires.length) L.push('IGNORED ' + c.badWires.map((b) => `${b.from}>${b.to}`).join(' '));
  L.push('CHECK ' + c.types.map((t) => `${t.type}${Math.round(t.share * 100)}%:${t.ok ? 'ok' : `NO(stuck ${t.stuck!.path.join('>')} needs ${t.stuck!.needs.join('+')})`}`).join(' '));
  if (c.unreachable.length) L.push('UNREACHABLE ' + c.unreachable.join(' '));
  if (c.deadEnds.length) L.push('DEADEND ' + c.deadEnds.join(' '));
  for (const n of c.notes) L.push('NOTE ' + n);

  if (sim) {
    const s = sim.stats;
    const r = score(sim, design);
    L.push(`RUN ${sim.state} t=${(sim.t / 20).toFixed(1)}/${level.duration}s budget ${sim.budget}/${level.errorBudget} success ${(r.success * 100).toFixed(2)}% p50/95/99 ${r.p50}/${r.p95}/${r.p99}ms stars ${r.stars.map((x) => (x ? '*' : '-')).join('')}`);
    L.push(`OUTCOME ok=${s.ok} failed=${s.failed}(drop ${s.dropped} timeout ${s.timeout} async-lost ${s.asyncLost}) waf-blocked=${s.blocked} bots-served=${s.botok} bots-lost-elsewhere=${s.botLost} halfdone=${s.halfDone} strikes=${s.strikes}`);
    L.push('BYTYPE ' + REQ_TYPES.map((t) => `${t} ${s.byType[t].ok}ok/${s.byType[t].failed}fail`).join('  '));
    const why = Object.entries(s.why).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (why.length) L.push('WHY ' + why.map(([k, v]) => `${k}:${v}`).join('  '));
    const peak: Record<string, number> = {};
    const peakQ: Record<string, number> = {};
    for (const sn of sim.snapshots) {
      for (const [id, u] of Object.entries(sn.util)) peak[id] = Math.max(peak[id] ?? 0, u);
      for (const [id, q] of Object.entries(sn.queue)) peakQ[id] = Math.max(peakQ[id] ?? 0, q);
    }
    L.push('PEAK ' + design.nodes.filter((n) => PARTS[n.kind].capacity < 9999 || peakQ[n.id]).map((n) => `${n.id} ${Math.round((peak[n.id] ?? 0) * 100)}%${peakQ[n.id] ? ` q${peakQ[n.id]}` : ''}`).join('  '));
    const nodeServed = [...sim.nodes.values()].filter((n) => n.served || n.failed).map((n) => `${n.spec.id} served ${n.served} failed ${n.failed}`);
    L.push('NODESTATS ' + nodeServed.join('  '));
    if (sim.events.length) L.push('EVENTS ' + sim.events.slice(0, 6).map((e) => `${(e.t / 20).toFixed(0)}s ${e.text}`).join(' | '));
  }
  L.push(`CODE ${level.id} ${encodeDesign(design)}`);
  return L.join('\n');
}

export { nodeName };
