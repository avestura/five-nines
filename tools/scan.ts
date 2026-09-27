// Balance helper: scales a level's traffic and reports stars for the
// reference and naive designs, plus where failures happen.
import { LEVELS } from '../src/levels';
import { Sim } from '../src/sim/engine';
import { score, starCount } from '../src/sim/score';
import type { Design, Level } from '../src/sim/types';

const id = process.argv[2];
const base = LEVELS.find((l) => l.id === id)!;
const scaled = (k: number): Level => ({ ...base, traffic: base.traffic.map((p) => ({ ...p, rps: p.rps * k })) });
function play(l: Level, d: Design) {
  const sim = new Sim(l, structuredClone(d));
  sim.runToEnd();
  const r = score(sim, d);
  const where = [...sim.nodes.values()].filter((n) => n.failed).map((n) => `${n.spec.id}:${n.failed}`).join(' ');
  return `${'*'.repeat(starCount(r)).padEnd(3)} ${r.survived ? 'held ' : 'PAGED'} fail=${sim.stats.failed} async=${sim.stats.asyncLost} p99=${r.p99} [${where}]`;
}
for (const k of (process.argv[3] ?? '0.6,0.8,1,1.2,1.4,1.6').split(',').map(Number)) {
  console.log(`x${k.toFixed(2)}  ref ${play(scaled(k), base.reference)}   |  naive ${base.naive ? play(scaled(k), base.naive) : '-'}`);
}
