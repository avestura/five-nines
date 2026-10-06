// Plays every level headless. Each reference design must win, and each naive
// design must fail at least its first star. Exits non-zero otherwise.
import { LEVELS } from '../src/levels';
import { Sim } from '../src/sim/engine';
import { score, starCount } from '../src/sim/score';
import { GLOBAL_STRIP, type Design, type Level } from '../src/sim/types';

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
    sim,
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
  // Every part in a reference must earn its place. A part that never saw a request is a rule bug.
  for (const nd of ref.sim.nodes.values()) {
    if (nd.spec.fixed || nd.spec.kind === 'pubsub' || nd.served > 0) continue;
    console.log(`  !! ${nd.spec.id} (${nd.spec.kind}) never served a request in the reference`); bad++;
  }
  if (starCount(ref.r) < 3) { console.log('  !! reference does not get 3 stars'); bad++; }
  // Shortcut check: Fans wired straight to every data store must never pass.
  const stores = level.reference.nodes.filter((x) => ['db', 'replica', 'readmodel', 'cache', 'payment'].includes(x.kind));
  if (stores.length) {
    const cheat = { nodes: level.reference.nodes, edges: stores.map((x) => ({ from: 'fans', to: x.id })) };
    const ch = fmt('cheat', level, cheat);
    if (ch.r.stars[0]) { console.log(ch.line + '\n  !! fans wired straight to the data still passes'); bad++; }
  }
  // Shortcut check: Fans wired straight to any non-front-door part must never pass.
  for (const x of level.reference.nodes) {
    if (['users', 'waf', 'cdn', 'lb', 'gateway', 'dns', 'web'].includes(x.kind) || x.kind === 'payment') continue;
    const ch = fmt('cheat', level, { nodes: level.reference.nodes, edges: [...level.reference.edges.filter((e) => e.from !== 'fans'), { from: 'fans', to: x.id }] });
    if (ch.r.stars[0]) { console.log(ch.line + `
  !! fans wired straight to ${x.id} (${x.kind}) still passes`); bad++; }
  }
  // Shortcut check: a rate limiter or CDN wired to every server in place of the load balancer must not pass.
  for (const lbNode of level.reference.nodes.filter((x) => x.kind === 'lb')) {
    const feeders = level.reference.edges.filter((e) => e.to === lbNode.id).map((e) => e.from)
      .filter((id) => ['waf', 'cdn'].includes(level.reference.nodes.find((x) => x.id === id)?.kind ?? ''));
    if (!feeders.length) continue;
    const behind = level.reference.edges.filter((e) => e.from === lbNode.id).map((e) => e.to);
    const cheat = {
      nodes: level.reference.nodes.filter((x) => x.id !== lbNode.id),
      edges: [
        ...level.reference.edges.filter((e) => e.from !== lbNode.id && e.to !== lbNode.id),
        ...behind.map((to) => ({ from: feeders[0], to })),
      ],
    };
    const ch = fmt('wafLB', level, cheat);
    if (ch.r.stars[0]) { console.log(ch.line + `
  !! ${feeders[0]} spreading traffic in place of the load balancer still passes`); bad++; }
  }
  // Shortcut check: everything in the south region. The failing region is whichever you lean on.
  if (level.regions) {
    const moved = { nodes: level.reference.nodes.map((x) => (!x.fixed && x.x >= GLOBAL_STRIP && x.y < 336 ? { ...x, y: x.y + 336 } : x)), edges: level.reference.edges };
    const ch = fmt('south', level, moved);
    if (ch.r.stars[0]) { console.log(ch.line + ' !! everything moved into one region still passes'); bad++; }
  }
  // Shortcut check: skip the front door and let Fans spread traffic themselves.
  const doors = level.reference.nodes.filter((x) => ['lb', 'gateway', 'dns'].includes(x.kind)).map((x) => x.id);
  if (doors.length) {
    const behind = level.reference.edges.filter((e) => doors.includes(e.from)).map((e) => e.to).filter((id) => !doors.includes(id));
    const cheat = {
      nodes: level.reference.nodes.filter((x) => !doors.includes(x.id)),
      edges: [
        ...level.reference.edges.filter((e) => !doors.includes(e.from) && !doors.includes(e.to) && e.from !== 'fans'),
        ...behind.map((to) => ({ from: 'fans', to })),
      ],
    };
    const ch = fmt('spread', level, cheat);
    if (ch.r.stars[0]) { console.log(ch.line + '\n  !! fans spreading traffic themselves still passes'); bad++; }
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
