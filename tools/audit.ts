// "Real-world arrangements" audit. Each case is a layout an engineer would
// draw for a part. The part must be accepted by the wiring rules AND must do
// something (serve requests) in a run. Anything that fails is a design bug in
// the game, not in the player's drawing. Add a case whenever you add a part or
// a wiring rule. See AGENTS.md.
import { SANDBOX } from '../src/levels/sandbox';
import { Sim } from '../src/sim/engine';
import { checkDesign } from '../src/sim/check';
import { FANS } from '../src/levels/act1';
import type { EdgeSpec, Level, NodeSpec, PartKind } from '../src/sim/types';

const level: Level = { ...structuredClone(SANDBOX), duration: 30, errorBudget: 99999,
  traffic: [{ at: 0, rps: 60, mix: { read: 0.5, write: 0.15, static: 0.3, bot: 0.05 } }] };

type Case = { name: string; part: string; nodes: [string, PartKind][]; edges: string }; // edges: "a>b,c d>e"
const web2 = (extra: string) => `fans>lb lb>w1,w2 ${extra}`;
const base: [string, PartKind][] = [['lb', 'lb'], ['w1', 'web'], ['w2', 'web']];
const cases: Case[] = [
  { name: 'cdn in front', part: 'cdn', nodes: [...base, ['cdn', 'cdn'], ['db', 'db']], edges: 'fans>cdn cdn>lb lb>w1,w2 w1>db w2>db' },
  { name: 'cdn named by web', part: 'cdn', nodes: [...base, ['cdn', 'cdn'], ['db', 'db']], edges: web2('w1>cdn w2>cdn w1>db w2>db') },
  { name: 'cdn beside, pulls from origin', part: 'cdn', nodes: [...base, ['cdn', 'cdn'], ['db', 'db']], edges: web2('cdn>lb w1>db w2>db') },
  { name: 'waf in front', part: 'waf', nodes: [...base, ['waf', 'waf'], ['db', 'db']], edges: 'fans>waf waf>lb lb>w1,w2 w1>db w2>db' },
  { name: 'waf behind cdn', part: 'waf', nodes: [...base, ['waf', 'waf'], ['cdn', 'cdn'], ['db', 'db']], edges: 'fans>cdn cdn>waf waf>lb lb>w1,w2 w1>db w2>db' },
  { name: 'waf before gateway', part: 'waf', nodes: [['waf', 'waf'], ['gw', 'gateway'], ['w1', 'web'], ['db', 'db']], edges: 'fans>waf waf>gw gw>w1 w1>db' },
  { name: 'gateway in front', part: 'gateway', nodes: [['gw', 'gateway'], ['w1', 'web'], ['w2', 'web'], ['db', 'db']], edges: 'fans>gw gw>w1,w2 w1>db w2>db' },
  { name: 'gateway behind lb', part: 'gateway', nodes: [...base, ['gw', 'gateway'], ['db', 'db']], edges: 'fans>lb lb>gw gw>w1,w2 w1>db w2>db' },
  { name: 'cache between web and db', part: 'cache', nodes: [...base, ['cache', 'cache'], ['db', 'db']], edges: web2('w1>cache w2>cache cache>db') },
  { name: 'cache-aside (web wired to both)', part: 'cache', nodes: [...base, ['cache', 'cache'], ['db', 'db']], edges: web2('w1>cache,db w2>cache,db') },
  { name: 'replica beside db', part: 'replica', nodes: [...base, ['rr', 'replica'], ['db', 'db']], edges: web2('w1>db,rr w2>db,rr') },
  { name: 'replica behind cache', part: 'replica', nodes: [...base, ['cache', 'cache'], ['rr', 'replica'], ['db', 'db']], edges: web2('w1>cache w2>cache cache>db,rr') },
  { name: 'queue and worker', part: 'queue', nodes: [...base, ['mq', 'queue'], ['k', 'worker'], ['db', 'db']], edges: web2('w1>mq,db w2>mq,db mq>k k>db') },
  { name: 'worker', part: 'worker', nodes: [...base, ['mq', 'queue'], ['k', 'worker'], ['db', 'db']], edges: web2('w1>mq,db w2>mq,db mq>k k>db') },
  { name: 'gateway straight to queue', part: 'queue', nodes: [['gw', 'gateway'], ['w1', 'web'], ['mq', 'queue'], ['k', 'worker'], ['db', 'db']], edges: 'fans>gw gw>w1,mq w1>db mq>k k>db' },
  { name: 'shard map', part: 'shardrouter', nodes: [...base, ['shd', 'shardrouter'], ['a', 'db'], ['b', 'db']], edges: web2('w1>shd w2>shd shd>a,b') },
  { name: 'global router', part: 'dns', nodes: [['dns', 'dns'], ['l1', 'lb'], ['l2', 'lb'], ['w1', 'web'], ['w2', 'web'], ['db', 'db']], edges: 'fans>dns dns>l1,l2 l1>w1 l2>w2 w1>db w2>db' },
  { name: 'event topic feeds a read model (topic itself only relays)', part: 'readmodel', nodes: [...base, ['mq', 'queue'], ['k', 'worker'], ['db', 'db'], ['t', 'pubsub'], ['v', 'readmodel']], edges: web2('w1>mq,v w2>mq,v mq>k k>db,t t>v') },
  { name: 'read model', part: 'readmodel', nodes: [...base, ['mq', 'queue'], ['k', 'worker'], ['db', 'db'], ['t', 'pubsub'], ['v', 'readmodel']], edges: web2('w1>mq,v w2>mq,v mq>k k>db,t t>v') },
];

// Things that must NOT work, because they are not how the real parts behave.
const negatives: { name: string; nodes: [string, PartKind][]; edges: string; failType?: 'read' | 'write'; quiet?: string }[] = [
  { name: 'reading through an event topic', nodes: [...base, ['mq', 'queue'], ['k', 'worker'], ['db', 'db'], ['t', 'pubsub'], ['v', 'readmodel']], edges: web2('w1>mq,t w2>mq,t mq>k k>db,t t>v'), failType: 'read' },
  { name: 'read model when only one of two writers publishes', nodes: [...base, ['db', 'db'], ['t', 'pubsub'], ['v', 'readmodel']], edges: web2('w1>db,v,t w2>db,v t>v'), quiet: 'v' },
];

let bad = 0;
for (const c of negatives) {
  const d = { nodes: [FANS, ...c.nodes.map(([id, kind], i) => ({ id, kind, x: 300 + i * 20, y: 300 }))], edges: c.edges.split(/\s+/).flatMap((g) => { const [a, bs] = g.split('>'); return bs.split(',').map((b) => ({ from: a, to: b })); }) };
  const sim = new Sim(level, d);
  sim.runToEnd();
  if (c.quiet && sim.nodes.get(c.quiet)!.served > 0) { bad++; console.log(`FAIL (should not work) ${c.name}: ${c.quiet} served requests`); }
  if (c.failType && sim.stats.byType[c.failType].ok > 0) { bad++; console.log(`FAIL (should not work) ${c.name}: ${sim.stats.byType[c.failType].ok} ${c.failType}s succeeded`); }
}
for (const c of cases) {
  const nodes: NodeSpec[] = [FANS, ...c.nodes.map(([id, kind], i) => ({ id, kind, x: 300 + i * 20, y: 300 }))];
  const edges: EdgeSpec[] = c.edges.split(/\s+/).flatMap((g) => {
    const [a, bs] = g.split('>');
    return bs.split(',').map((b) => ({ from: a, to: b }));
  });
  const d = { nodes, edges };
  const chk = checkDesign(level, d);
  const sim = new Sim(level, d);
  sim.runToEnd();
  const partId = c.nodes.find(([, k]) => k === c.part)![0];
  const part = sim.nodes.get(partId)!;
  const issues = [
    ...chk.badWires.map((b) => `wire refused ${b.from}>${b.to}: ${b.why}`),
    ...(part.served === 0 ? [`${c.part} served nothing`] : []),
    ...(sim.stats.failed > 5 ? [`${sim.stats.failed} requests failed: ${JSON.stringify(sim.stats.why)}`] : []),
  ];
  if (issues.length) { bad++; console.log(`FAIL ${c.name}\n  ${issues.join('\n  ')}`); }
}
console.log(bad ? `\n${bad} real-world arrangement(s) rejected or useless` : `all ${cases.length} real-world arrangements work`);
process.exit(bad ? 1 : 0);
