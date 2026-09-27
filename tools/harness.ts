// Plays every level headless. Each reference design must win, and each naive
// design must fail at least its first star. Exits non-zero otherwise.
import { LEVELS } from '../src/levels';
import { Sim } from '../src/sim/engine';
import { score, starCount } from '../src/sim/score';
import type { Design, Level } from '../src/sim/types';

const only = process.argv[2];
let bad = 0;

function run(level: Level, d: Design) {
  const sim = new Sim(level, d);
  sim.runToEnd();
  return { sim, r: score(sim, d) };
}

function fmt(label: string, level: Level, d: Design) {
  const { sim, r } = run(level, d);
  const s = sim.stats;
  return {
    r,
    line:
      `  ${label.padEnd(5)} ${'*'.repeat(starCount(r)).padEnd(3)} ` +
      `${r.survived ? 'held ' : 'PAGED'} ok=${s.ok} fail=${s.failed} (drop ${s.dropped}, t/o ${s.timeout}, async ${s.asyncLost}) ` +
      `blocked=${s.blocked} budget=${sim.budget}/${level.errorBudget} ` +
      `succ=${(r.success * 100).toFixed(2)}% p50=${r.p50} p99=${r.p99} slo=${level.slo.p99} $${r.cost}/par ${level.parCost}`,
  };
}

for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  console.log(`${level.id} ${level.title}`);
  const ref = fmt('ref', level, level.reference);
  console.log(ref.line);
  if (starCount(ref.r) < 3) { console.log('  !! reference does not get 3 stars'); bad++; }
  // Shortcut check: Fans wired straight to every data store must never pass.
  const stores = level.reference.nodes.filter((x) => ['db', 'replica', 'readmodel', 'cache', 'payment'].includes(x.kind));
  if (stores.length) {
    const cheat = { nodes: level.reference.nodes, edges: stores.map((x) => ({ from: 'fans', to: x.id })) };
    const ch = fmt('cheat', level, cheat);
    if (ch.r.stars[0]) { console.log(ch.line + '\n  !! fans wired straight to the data still passes'); bad++; }
  }
  if (level.naive) {
    const nv = fmt('naive', level, level.naive);
    console.log(nv.line);
    if (nv.r.stars[0]) { console.log('  !! naive design still passes'); bad++; }
  }
}

if (bad) {
  console.log(`\n${bad} balance problem(s)`);
  process.exit(1);
}
console.log('\nall levels balanced');
