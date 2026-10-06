// Plays many hand-written solutions on every level, some that should work and
// some that should not, and prints where the game disagrees with the author.
//   npx tsx tools/playtest.ts [level-id]
// expect: 'pass' (stays up, meets the success SLO), 'fail', or 'either' (exploring).
import { LEVELS, levelById } from '../src/levels';
import { Sim, designCost } from '../src/sim/engine';
import { score } from '../src/sim/score';
import { checkDesign } from '../src/sim/check';
import { diagnose } from '../src/sim/diagnose';
import { GLOBAL_STRIP, type Design, type Level, type NodeOpts, type NodeSpec, type PartKind } from '../src/sim/types';

type Expect = 'pass' | 'fail' | 'either';
interface Scn { lvl: string; name: string; expect: Expect; nodes?: string; edges?: string; from?: (d: Design) => Design; note?: string }

// ---- tiny DSL ----
const range = (tok: string): string[] => {
  const m = /^(.*?)(\d+)\.\.(\d+)$/.exec(tok);
  if (!m) return [tok];
  return Array.from({ length: +m[3] - +m[2] + 1 }, (_, i) => `${m[1]}${+m[2] + i}`);
};
function parseNodes(spec: string, region: boolean): NodeSpec[] {
  const out: NodeSpec[] = [];
  for (const tok of spec.split(/\s+/).filter(Boolean)) {
    // id[..range]:kind[opt,opt]@tag
    const m = /^([^:]+):([a-z]+)(?:\[([^\]]*)\])?(?:@([nsg]))?$/.exec(tok);
    if (!m) throw new Error('bad node ' + tok);
    const opts: NodeOpts = {};
    for (const o of (m[3] ?? '').split(',').filter(Boolean)) (opts as Record<string, boolean>)[o] = true;
    const tag = m[4] ?? (region ? 'n' : 'x');
    for (const id of range(m[1])) {
      out.push({ id, kind: m[2] as PartKind, x: tag === 'g' ? 204 : GLOBAL_STRIP + 300, y: tag === 'n' ? 168 : tag === 's' ? 504 : tag === 'g' ? 200 : 100, opts: Object.keys(opts).length ? { ...opts } : undefined });
    }
  }
  return out;
}
function parseEdges(spec: string) {
  const out: { from: string; to: string }[] = [];
  for (const tok of spec.split(/\s+/).filter(Boolean)) {
    const [a, b] = tok.split('>');
    for (const f of a.split(',').flatMap(range)) for (const t of b.split(',').flatMap(range)) out.push({ from: f, to: t });
  }
  return out;
}
const base = (l: Level): Design => ({ nodes: l.fixed.map((n) => ({ ...n })), edges: [...(l.fixedEdges ?? [])] });
export function build(s: Scn, l: Level): Design {
  if (s.from) return s.from(structuredClone(l.reference));
  const d = base(l);
  d.nodes.push(...parseNodes(s.nodes ?? '', !!l.regions));
  d.edges.push(...parseEdges(s.edges ?? ''));
  return d;
}
// mutate a copy of the reference
const without = (...ids: string[]) => (d: Design): Design => ({
  nodes: d.nodes.filter((n) => !ids.includes(n.id)),
  edges: d.edges.filter((e) => !ids.includes(e.from) && !ids.includes(e.to)),
});
const setOpts = (kind: PartKind, opts: NodeOpts | undefined, only?: (n: NodeSpec) => boolean) => (d: Design): Design => {
  for (const n of d.nodes) if (n.kind === kind && !n.fixed && (!only || only(n))) n.opts = opts;
  return d;
};
const chain = (...fs: ((d: Design) => Design)[]) => (d: Design) => fs.reduce((acc, f) => f(acc), d);
const addEdges = (spec: string) => (d: Design): Design => { d.edges.push(...parseEdges(spec)); return d; };

const W = (p: string, n: number, kind = 'web', o = '') => `${p}1..${n}:${kind}${o}`;

export const S: Scn[] = [
  // ---------------- 1.1 ----------------
  { lvl: '1-1', name: 'web + database', expect: 'pass', nodes: 'w:web d:db', edges: 'fans>w w>d' },
  { lvl: '1-1', name: 'web only', expect: 'fail', nodes: 'w:web', edges: 'fans>w' },
  { lvl: '1-1', name: 'fans straight to the database', expect: 'fail', nodes: 'w:web d:db', edges: 'fans>d d>w' },
  { lvl: '1-1', name: 'wired backwards (db > web)', expect: 'fail', nodes: 'w:web d:db', edges: 'fans>w d>w' },
  { lvl: '1-1', name: 'nothing wired', expect: 'fail', nodes: 'w:web d:db', edges: '' },

  // ---------------- 1.2 ----------------
  { lvl: '1-2', name: 'lb + 3 webs + db', expect: 'pass', nodes: `lb:lb ${W('w', 3)} d:db`, edges: 'fans>lb lb>w1..3 w1..3>d' },
  { lvl: '1-2', name: 'lb + 2 webs + db', expect: 'pass', nodes: `lb:lb ${W('w', 2)} d:db`, edges: 'fans>lb lb>w1..2 w1..2>d' },
  { lvl: '1-2', name: 'lb + 4 webs + db', expect: 'pass', nodes: `lb:lb ${W('w', 4)} d:db`, edges: 'fans>lb lb>w1..4 w1..4>d' },
  { lvl: '1-2', name: 'one web, no lb', expect: 'fail', nodes: 'w:web d:db', edges: 'fans>w w>d' },
  { lvl: '1-2', name: 'lb with a single web', expect: 'fail', nodes: 'lb:lb w:web d:db', edges: 'fans>lb lb>w w>d' },
  { lvl: '1-2', name: 'lb + 3 webs, no database', expect: 'fail', nodes: `lb:lb ${W('w', 3)}`, edges: 'fans>lb lb>w1..3' },
  { lvl: '1-2', name: 'one of 3 webs forgot its db wire', expect: 'fail', nodes: `lb:lb ${W('w', 3)} d:db`, edges: 'fans>lb lb>w1..3 w1..2>d' },

  // ---------------- 1.3 ----------------
  { lvl: '1-3', name: 'lb + 4 webs + cache + db', expect: 'pass', nodes: `lb:lb ${W('w', 4)} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>c c>d' },
  { lvl: '1-3', name: 'lb + 3 webs + cache + db', expect: 'pass', nodes: `lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '1-3', name: 'cache-aside: web wired to cache and db', expect: 'pass', nodes: `lb:lb ${W('w', 4)} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>c,d' },
  { lvl: '1-3', name: 'cache-aside without cache>db', expect: 'pass', nodes: `lb:lb ${W('w', 4)} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>c,d' },
  { lvl: '1-3', name: 'no cache', expect: 'fail', nodes: `lb:lb ${W('w', 4)} d:db`, edges: 'fans>lb lb>w1..4 w1..4>d' },
  { lvl: '1-3', name: 'cache not connected to db (dead end)', expect: 'fail', nodes: `lb:lb ${W('w', 4)} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>c' },
  { lvl: '1-3', name: 'cache beside, nothing wired to it', expect: 'fail', nodes: `lb:lb ${W('w', 4)} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>d c>d' },
  { lvl: '1-3', name: '2 webs + cache + db', expect: 'either', nodes: `lb:lb ${W('w', 2)} c:cache d:db`, edges: 'fans>lb lb>w1..2 w1..2>c c>d' },

  // ---------------- 1.4 ----------------
  { lvl: '1-4', name: 'fans>cdn>lb chain', expect: 'pass', nodes: `cdn:cdn lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>cdn cdn>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '1-4', name: 'cdn named by each web (assets host)', expect: 'pass', nodes: `lb:lb ${W('w', 3)} cdn:cdn c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>c,cdn c>d' },
  { lvl: '1-4', name: 'cdn beside, pulling from lb', expect: 'pass', nodes: `lb:lb ${W('w', 3)} cdn:cdn c:cache d:db`, edges: 'fans>lb lb>w1..3 cdn>lb w1..3>c c>d' },
  { lvl: '1-4', name: 'cdn with 2 webs only', expect: 'either', nodes: `cdn:cdn lb:lb ${W('w', 2)} c:cache d:db`, edges: 'fans>cdn cdn>lb lb>w1..2 w1..2>c c>d' },
  { lvl: '1-4', name: 'no cdn, 3 webs', expect: 'fail', nodes: `lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '1-4', name: 'cdn placed but never wired', expect: 'fail', nodes: `cdn:cdn lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '1-4', name: 'fans>cdn and cdn leads nowhere', expect: 'fail', nodes: `cdn:cdn lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>cdn lb>w1..3 w1..3>c c>d' },
  { lvl: '1-4', name: 'cdn behind the lb (lb>cdn)', expect: 'fail', nodes: `cdn:cdn lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>lb lb>cdn cdn>w1..3 w1..3>c c>d' },

  // ---------------- 1.5 ----------------
  { lvl: '1-5', name: 'lb with health check + 4 webs', expect: 'pass', nodes: `cdn:cdn lb:lb[healthCheck] ${W('w', 4)} c:cache d:db`, edges: 'fans>cdn cdn>lb lb>w1..4 w1..4>c c>d' },
  { lvl: '1-5', name: 'health check, cdn beside', expect: 'pass', nodes: `lb:lb[healthCheck] ${W('w', 4)} cdn:cdn c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>cdn,c c>d' },
  { lvl: '1-5', name: 'no health check, 4 webs', expect: 'fail', nodes: `cdn:cdn lb:lb ${W('w', 4)} c:cache d:db`, edges: 'fans>cdn cdn>lb lb>w1..4 w1..4>c c>d' },
  { lvl: '1-5', name: 'health check but only 2 webs', expect: 'either', nodes: `cdn:cdn lb:lb[healthCheck] ${W('w', 2)} c:cache d:db`, edges: 'fans>cdn cdn>lb lb>w1..2 w1..2>c c>d' },
  { lvl: '1-5', name: 'health check, 3 webs', expect: 'either', nodes: `cdn:cdn lb:lb[healthCheck] ${W('w', 3)} c:cache d:db`, edges: 'fans>cdn cdn>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '1-5', name: 'no lb: one web only', expect: 'fail', nodes: 'w:web c:cache d:db', edges: 'fans>w w>c c>d' },

  // ---------------- 2.1 ----------------
  { lvl: '2-1', name: 'reference', expect: 'pass', from: (d) => d },
  { lvl: '2-1', name: 'queue + 2 workers + cache, 4 webs (two is too few)', expect: 'fail', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 2, 'worker')} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>mq,c mq>k1..2 k1..2>c c>d' },
  { lvl: '2-1', name: 'queue + workers write straight to db', expect: 'pass', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 3, 'worker')} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>mq,c mq>k1..3 k1..3>d c>d' },
  { lvl: '2-1', name: 'queue with 1 worker', expect: 'either', nodes: `lb:lb ${W('w', 4)} mq:queue k:worker c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>mq,c mq>k k>d c>d' },
  { lvl: '2-1', name: 'no queue, 5 webs + cache', expect: 'fail', nodes: `lb:lb ${W('w', 5)} c:cache d:db`, edges: 'fans>lb lb>w1..5 w1..5>c c>d' },
  { lvl: '2-1', name: 'queue but no workers', expect: 'fail', nodes: `lb:lb ${W('w', 4)} mq:queue c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>mq,c c>d' },
  { lvl: '2-1', name: 'queue + workers, webs cannot read (no cache or db)', expect: 'fail', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 3, 'worker')} d:db`, edges: 'fans>lb lb>w1..4 w1..4>mq mq>k1..3 k1..3>d' },
  { lvl: '2-1', name: 'queue, webs also wired to db for reads, no cache', expect: 'either', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 3, 'worker')} d:db`, edges: 'fans>lb lb>w1..4 w1..4>mq,d mq>k1..3 k1..3>d' },
  { lvl: '2-1', name: 'queue only wired to some webs', expect: 'either', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 3, 'worker')} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..2>mq w1..4>c mq>k1..3 k1..3>d c>d' },
  { lvl: '2-1', name: 'fans straight to the queue', expect: 'fail', nodes: `mq:queue ${W('k', 3, 'worker')} d:db`, edges: 'fans>mq mq>k1..3 k1..3>d' },

  // ---------------- 2.2 ----------------
  { lvl: '2-2', name: 'reference', expect: 'pass', from: (d) => d },
  { lvl: '2-2', name: 'web wired to db and replica (no cache)', expect: 'pass', nodes: `lb:lb ${W('w', 5)} d:db r:replica`, edges: 'fans>lb lb>w1..5 w1..5>d,r' },
  { lvl: '2-2', name: 'cache > db + replica, queue for writes', expect: 'pass', nodes: `lb:lb ${W('w', 4)} c:cache mq:queue k:worker d:db r:replica`, edges: 'fans>lb lb>w1..4 w1..4>c,mq mq>k k>d c>d,r' },
  { lvl: '2-2', name: 'two replicas', expect: 'either', nodes: `lb:lb ${W('w', 4)} c:cache d:db r1:replica r2:replica`, edges: 'fans>lb lb>w1..4 w1..4>c c>d,r1,r2' },
  { lvl: '2-2', name: 'no replica', expect: 'fail', nodes: `lb:lb ${W('w', 5)} c:cache d:db`, edges: 'fans>lb lb>w1..5 w1..5>c c>d' },
  { lvl: '2-2', name: 'replica placed but not wired', expect: 'fail', nodes: `lb:lb ${W('w', 5)} c:cache d:db r:replica`, edges: 'fans>lb lb>w1..5 w1..5>c c>d' },
  { lvl: '2-2', name: 'replica only, no primary', expect: 'fail', nodes: `lb:lb ${W('w', 5)} c:cache r:replica`, edges: 'fans>lb lb>w1..5 w1..5>c c>r' },
  { lvl: '2-2', name: 'replication wire db>replica', expect: 'fail', nodes: `lb:lb ${W('w', 5)} c:cache d:db r:replica`, edges: 'fans>lb lb>w1..5 w1..5>c c>d d>r' },

  // ---------------- 2.3 ----------------
  { lvl: '2-3', name: 'reference (waf>cdn>lb)', expect: 'pass', from: (d) => d },
  { lvl: '2-3', name: 'waf>lb', expect: 'pass', nodes: `waf:waf lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>waf waf>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '2-3', name: 'cdn>waf>lb', expect: 'pass', nodes: `cdn:cdn waf:waf lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>cdn cdn>waf waf>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '2-3', name: 'no waf', expect: 'fail', nodes: `cdn:cdn lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>cdn cdn>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '2-3', name: 'waf placed but off the path', expect: 'fail', nodes: `waf:waf cdn:cdn lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>cdn cdn>lb lb>w1..3 w1..3>c c>d waf>lb' },
  { lvl: '2-3', name: 'waf behind the lb (refused)', expect: 'fail', nodes: `waf:waf lb:lb ${W('w', 3)} c:cache d:db`, edges: 'fans>lb lb>waf waf>w1..3 w1..3>c c>d' },
  { lvl: '2-3', name: 'waf straight to 3 webs (no lb)', expect: 'fail', nodes: `waf:waf ${W('w', 3)} c:cache d:db`, edges: 'fans>waf waf>w1..3 w1..3>c c>d' },
  { lvl: '2-3', name: 'waf + lb, only 2 webs', expect: 'either', nodes: `waf:waf lb:lb ${W('w', 2)} c:cache d:db`, edges: 'fans>waf waf>lb lb>w1..2 w1..2>c c>d' },

  // ---------------- 2.4 ----------------
  { lvl: '2-4', name: 'reference (retry on webs)', expect: 'pass', from: (d) => d },
  { lvl: '2-4', name: 'queue + worker with retry does payment', expect: 'pass', nodes: `lb:lb ${W('w', 3)} mq:queue k:worker[retry] c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>mq,c mq>k k>pay,c c>d' },
  { lvl: '2-4', name: 'retry on 2 of 3 webs', expect: 'either', from: (d) => { d.nodes.find((n) => n.id === 'web-1')!.opts = undefined; return d; } },
  { lvl: '2-4', name: 'no retry anywhere', expect: 'fail', from: setOpts('web', undefined) },
  { lvl: '2-4', name: 'retry but webs never wired to Payments', expect: 'fail', nodes: `lb:lb ${W('w', 3, 'web', '[retry]')} c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>c c>d' },
  { lvl: '2-4', name: 'queue + worker without retry', expect: 'fail', nodes: `lb:lb ${W('w', 3)} mq:queue k:worker c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>mq,c mq>k k>pay,c c>d' },
  { lvl: '2-4', name: 'health check on lb (wrong switch)', expect: 'fail', nodes: `lb:lb[healthCheck] ${W('w', 3)} c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>pay,c c>d' },

  // ---------------- 2.5 ----------------
  { lvl: '2-5', name: 'reference (cdn>gateway)', expect: 'pass', from: (d) => d },
  { lvl: '2-5', name: 'gateway alone', expect: 'pass', nodes: 'gw:gateway', edges: 'fans>gw gw>tix-1,tix-2,browse-1,browse-2,browse-3' },
  { lvl: '2-5', name: 'lb > gateway > apps', expect: 'either', nodes: 'lb:lb gw:gateway', edges: 'fans>lb lb>gw gw>tix-1,tix-2,browse-1,browse-2,browse-3' },
  { lvl: '2-5', name: 'waf > gateway > apps', expect: 'pass', nodes: 'waf:waf gw:gateway', edges: 'fans>waf waf>gw gw>tix-1,tix-2,browse-1,browse-2,browse-3' },
  { lvl: '2-5', name: 'plain lb to all apps (naive)', expect: 'fail', nodes: 'lb:lb', edges: 'fans>lb lb>tix-1,tix-2,browse-1,browse-2,browse-3' },
  { lvl: '2-5', name: 'gateway to Tickets only', expect: 'fail', nodes: 'gw:gateway', edges: 'fans>gw gw>tix-1,tix-2' },
  { lvl: '2-5', name: 'gateway to Browse only', expect: 'fail', nodes: 'gw:gateway', edges: 'fans>gw gw>browse-1,browse-2,browse-3' },
  { lvl: '2-5', name: 'cdn in front of an lb (no routing)', expect: 'fail', nodes: 'cdn:cdn lb:lb', edges: 'fans>cdn cdn>lb lb>tix-1,tix-2,browse-1,browse-2,browse-3' },
  { lvl: '2-5', name: 'gateway + extra lb behind it', expect: 'either', nodes: 'gw:gateway lb:lb', edges: 'fans>gw gw>lb,tix-1,tix-2 lb>browse-1,browse-2,browse-3' },

  // ---------------- 3.1 ----------------
  { lvl: '3-1', name: 'reference (breakers on webs)', expect: 'pass', from: (d) => d },
  { lvl: '3-1', name: 'async payment via queue + worker', expect: 'pass', nodes: `lb:lb ${W('w', 3)} mq:queue k:worker c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>mq,c mq>k k>pay,c c>d' },
  { lvl: '3-1', name: 'async payment, breaker on worker', expect: 'pass', nodes: `lb:lb ${W('w', 3)} mq:queue k:worker[breaker] c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>mq,c mq>k k>pay,c c>d' },
  { lvl: '3-1', name: 'breakers on webs + retry too', expect: 'either', from: setOpts('web', { breaker: true, retry: true }) },
  { lvl: '3-1', name: 'breaker on 2 of 4 webs', expect: 'either', from: (d) => { let i = 0; for (const n of d.nodes) if (n.kind === 'web') n.opts = i++ < 2 ? { breaker: true } : undefined; return d; } },
  { lvl: '3-1', name: 'retry only (the trap)', expect: 'fail', from: setOpts('web', { retry: true }) },
  { lvl: '3-1', name: 'no switches', expect: 'fail', from: setOpts('web', undefined) },
  { lvl: '3-1', name: 'health check only', expect: 'fail', nodes: `lb:lb[healthCheck] ${W('w', 4)} c:cache d:db`, edges: 'fans>lb lb>w1..4 w1..4>pay,c c>d' },

  // ---------------- 3.2 ----------------
  { lvl: '3-2', name: 'reference (bulkhead)', expect: 'pass', from: (d) => d },
  { lvl: '3-2', name: 'async payment via queue + worker', expect: 'pass', nodes: `lb:lb ${W('w', 3)} mq:queue k:worker c:cache d:db`, edges: 'fans>lb lb>w1..3 w1..3>mq,c mq>k k>pay,c c>d' },
  { lvl: '3-2', name: 'breaker instead of bulkhead', expect: 'either', from: setOpts('web', { breaker: true }) },
  { lvl: '3-2', name: 'bulkhead + breaker', expect: 'either', from: setOpts('web', { bulkhead: true, breaker: true }) },
  { lvl: '3-2', name: 'no switches', expect: 'fail', from: setOpts('web', undefined) },
  { lvl: '3-2', name: 'retry only', expect: 'fail', from: setOpts('web', { retry: true }) },
  { lvl: '3-2', name: 'bulkhead on 2 of 4 webs', expect: 'either', from: (d) => { let i = 0; for (const n of d.nodes) if (n.kind === 'web') n.opts = i++ < 2 ? { bulkhead: true } : undefined; return d; } },

  // ---------------- 3.3 ----------------
  { lvl: '3-3', name: 'reference (queue, workers, shard map, 2 dbs)', expect: 'pass', from: (d) => d },
  { lvl: '3-3', name: 'web writes straight to shard map (no queue)', expect: 'either', nodes: `lb:lb ${W('w', 5)} shd:shardrouter a:db b:db c:cache`, edges: 'fans>lb lb>w1..5 w1..5>c,shd c>shd shd>a,b' },
  { lvl: '3-3', name: 'three databases behind the shard map', expect: 'either', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 3, 'worker')} shd:shardrouter a:db b:db c3:db c:cache`, edges: 'fans>lb lb>w1..4 w1..4>mq,c mq>k1..3 k1..3>shd c>shd shd>a,b,c3' },
  { lvl: '3-3', name: 'one db behind a shard map', expect: 'fail', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 3, 'worker')} shd:shardrouter a:db c:cache`, edges: 'fans>lb lb>w1..4 w1..4>mq,c mq>k1..3 k1..3>shd c>shd shd>a' },
  { lvl: '3-3', name: 'single db, queue + workers (naive)', expect: 'fail', from: (d) => d, note: 'uses naive below' },
  { lvl: '3-3', name: 'two dbs wired directly, no shard map', expect: 'fail', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 3, 'worker')} a:db b:db c:cache`, edges: 'fans>lb lb>w1..4 w1..4>mq,c mq>k1..3 k1..3>a,b c>a,b' },
  { lvl: '3-3', name: 'cache wired straight to one shard (bypasses the shard map)', expect: 'fail', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 3, 'worker')} shd:shardrouter a:db b:db c:cache`, edges: 'fans>lb lb>w1..4 w1..4>mq,c mq>k1..3 k1..3>shd c>a shd>a,b' },

  // ---------------- 3.4 ----------------
  { lvl: '3-4', name: 'reference', expect: 'pass', from: (d) => d },
  { lvl: '3-4', name: 'sync writes, every web publishes, reads from read model', expect: 'pass', nodes: `lb:lb ${W('w', 5)} d:db t:pubsub v:readmodel`, edges: 'fans>lb lb>w1..5 w1..5>d,v,t t>v' },
  { lvl: '3-4', name: 'only one web publishes', expect: 'fail', nodes: `lb:lb ${W('w', 5)} d:db t:pubsub v:readmodel`, edges: 'fans>lb lb>w1..5 w1..5>d,v w1>t t>v' },
  { lvl: '3-4', name: 'reading through the topic', expect: 'fail', nodes: `lb:lb ${W('w', 5)} d:db t:pubsub v:readmodel`, edges: 'fans>lb lb>w1..5 w1..5>d,t t>v' },
  { lvl: '3-4', name: 'read model not subscribed', expect: 'fail', nodes: `lb:lb ${W('w', 5)} d:db v:readmodel`, edges: 'fans>lb lb>w1..5 w1..5>d,v' },
  { lvl: '3-4', name: 'cache + replica (naive)', expect: 'fail', nodes: `lb:lb ${W('w', 5)} c:cache d:db r:replica`, edges: 'fans>lb lb>w1..5 w1..5>c c>d,r' },
  { lvl: '3-4', name: 'replicas only, no cache', expect: 'either', nodes: `lb:lb ${W('w', 5)} d:db r1:replica r2:replica`, edges: 'fans>lb lb>w1..5 w1..5>d,r1,r2' },
  { lvl: '3-4', name: 'workers publish, web writes via queue, reads from model', expect: 'pass', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 2, 'worker')} d:db t:pubsub v:readmodel`, edges: 'fans>lb lb>w1..4 w1..4>mq,v mq>k1..2 k1..2>d,t t>v' },
  { lvl: '3-4', name: 'workers write but only one publishes', expect: 'fail', nodes: `lb:lb ${W('w', 4)} mq:queue ${W('k', 2, 'worker')} d:db t:pubsub v:readmodel`, edges: 'fans>lb lb>w1..4 w1..4>mq,v mq>k1..2 k1..2>d k1>t t>v' },

  // ---------------- 3.5 ----------------
  { lvl: '3-5', name: 'reference (two full stacks + dns)', expect: 'pass', from: (d) => d },
  { lvl: '3-5', name: 'everything in the south', expect: 'fail', nodes: `lb:lb@s ${W('w', 4, 'web', '@s')} c:cache@s d:db@s`, edges: 'fans>lb lb>w1..4 w1..4>c c>d' },
  { lvl: '3-5', name: 'everything in the north', expect: 'fail', nodes: `lb:lb@n ${W('w', 4, 'web', '@n')} c:cache@n d:db@n`, edges: 'fans>lb lb>w1..4 w1..4>c c>d' },
  { lvl: '3-5', name: 'two stacks, fans wired to one lb (no dns)', expect: 'fail', nodes: `lbn:lb@n wn1..3:web@n cn:cache@n dn:db@n lbs:lb@s ws1..3:web@s cs:cache@s ds:db@s`, edges: 'fans>lbn lbn>wn1..3 wn1..3>cn cn>dn lbs>ws1..3 ws1..3>cs cs>ds' },
  { lvl: '3-5', name: 'dns, but only north has parts', expect: 'fail', nodes: `dns:dns@g lbn:lb@n wn1..4:web@n cn:cache@n dn:db@n`, edges: 'fans>dns dns>lbn lbn>wn1..4 wn1..4>cn cn>dn' },
  { lvl: '3-5', name: 'dns, two stacks, webs only 2 each', expect: 'either', nodes: `dns:dns@g lbn:lb@n wn1..2:web@n cn:cache@n dn:db@n lbs:lb@s ws1..2:web@s cs:cache@s ds:db@s`, edges: 'fans>dns dns>lbn,lbs lbn>wn1..2 wn1..2>cn cn>dn lbs>ws1..2 ws1..2>cs cs>ds' },
  { lvl: '3-5', name: 'dns, two stacks, one shared db in the north', expect: 'fail', nodes: `dns:dns@g lbn:lb@n wn1..3:web@n cn:cache@n lbs:lb@s ws1..3:web@s cs:cache@s d:db@n`, edges: 'fans>dns dns>lbn,lbs lbn>wn1..3 wn1..3>cn cn>d lbs>ws1..3 ws1..3>cs cs>d' },
  { lvl: '3-5', name: 'dns, two stacks, cdn in the global strip', expect: 'pass', nodes: `dns:dns@g cdn:cdn@g lbn:lb@n wn1..3:web@n cn:cache@n dn:db@n lbs:lb@s ws1..3:web@s cs:cache@s ds:db@s`, edges: 'fans>dns dns>lbn,lbs cdn>lbn lbn>wn1..3 wn1..3>cn cn>dn lbs>ws1..3 ws1..3>cs cs>ds' },

  // ---------------- 3.6 ----------------
  { lvl: '3-6', name: 'reference (saga on webs)', expect: 'pass', from: (d) => d },
  { lvl: '3-6', name: 'no saga', expect: 'fail', from: setOpts('web', { retry: true }) },
  { lvl: '3-6', name: 'saga but no retry', expect: 'either', from: setOpts('web', { saga: true }) },
  { lvl: '3-6', name: 'no rate limiter (bots hit servers)', expect: 'fail', from: chain(without('waf'), addEdges('fans>cdn')) },
  { lvl: '3-6', name: 'no cache', expect: 'fail', nodes: `waf:waf cdn:cdn lb:lb ${W('w', 4, 'web', '[saga,retry]')} d:db`, edges: 'fans>waf waf>cdn cdn>lb lb>w1..4 w1..4>pay,d' },
  { lvl: '3-6', name: 'shard map + 2 dbs, queue + 2 workers (saga, retry both)', expect: 'pass', nodes: `waf:waf cdn:cdn lb:lb ${W('w', 3)} mq:queue ${W('k', 2, 'worker', '[saga,retry]')} shd:shardrouter a:db b:db`, edges: 'fans>waf waf>lb cdn>lb lb>w1..3 w1..3>shd,mq mq>k1..2 k1..2>pay,shd shd>a,b' },
  { lvl: '3-6', name: 'single db + cache + queue + 2 workers (saga, retry)', expect: 'pass', nodes: `waf:waf cdn:cdn lb:lb ${W('w', 3)} mq:queue ${W('k', 2, 'worker', '[saga,retry]')} c:cache d:db`, edges: 'fans>waf waf>lb cdn>lb lb>w1..3 w1..3>c,mq mq>k1..2 k1..2>pay,c c>d' },
  { lvl: '3-6', name: 'single db, no cache, queue + workers', expect: 'fail', nodes: `waf:waf cdn:cdn lb:lb ${W('w', 3)} mq:queue ${W('k', 2, 'worker', '[saga,retry]')} d:db`, edges: 'fans>waf waf>lb cdn>lb lb>w1..3 w1..3>d,mq mq>k1..2 k1..2>pay,d' },
  { lvl: '3-6', name: 'saga only on one of two workers', expect: 'either', nodes: `waf:waf cdn:cdn lb:lb ${W('w', 3)} mq:queue k1:worker[saga,retry] k2:worker c:cache d:db`, edges: 'fans>waf waf>lb cdn>lb lb>w1..3 w1..3>c,mq mq>k1,k2 k1,k2>pay,c c>d' },
];

// Levels whose "naive" design is also worth listing as a scenario.
for (const l of LEVELS) if (l.naive && ['3-3'].includes(l.id)) S.push({ lvl: l.id, name: 'level naive design', expect: 'fail', from: () => structuredClone(l.naive!) });

export function main() {
const only = process.argv[2];
let mismatches = 0, total = 0, illegal = 0;
const lines: string[] = [];
let curLvl = '';
for (const sc of S) {
  if (only && sc.lvl !== only) continue;
  const l = levelById(sc.lvl)!;
  if (sc.name === 'single db, queue + workers (naive)' && l.naive) { sc.from = () => structuredClone(l.naive!); }
  const d = build(sc, l);
  if (curLvl !== sc.lvl) { curLvl = sc.lvl; lines.push(`\n== ${l.id} ${l.title}  (par $${l.parCost}${l.maxCost ? `, cap $${l.maxCost}` : ''}, SLO ${l.slo.success * 100}% p99<${l.slo.p99})`); }
  // legality: kit, cap, catalog, options
  const probs: string[] = [];
  for (const [k, lim] of Object.entries(l.kit ?? {})) if (d.nodes.filter((n) => n.kind === k && !n.fixed).length > lim!) probs.push(`kit ${k}>${lim}`);
  for (const n of d.nodes) if (!n.fixed && !['users', 'payment'].includes(n.kind) && !l.catalog.includes(n.kind)) probs.push(`${n.kind} not in catalog`);
  for (const n of d.nodes) for (const o of Object.keys(n.opts ?? {})) if (!l.options?.includes(o as keyof NodeOpts) && (n.opts as any)[o]) probs.push(`${o} not unlocked`);
  const cost = designCost(d);
  if (l.maxCost && cost > l.maxCost) probs.push(`cost $${cost}>${l.maxCost}`);
  const sim = new Sim(l, d);
  sim.runToEnd();
  const r = score(sim, d);
  const passed = r.stars[0];
  const ok = sc.expect === 'either' || (sc.expect === 'pass') === passed;
  total++;
  if (!ok) mismatches++;
  if (probs.length) illegal++;
  const why = Object.entries(sim.stats.why).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(' ');
  const chk = checkDesign(l, d);
  const flag = ok ? '  ' : '!!';
  lines.push(
    `${flag} ${passed ? 'PASS' : 'FAIL'} ${r.stars.map((x) => (x ? '*' : '-')).join('')} exp=${sc.expect.padEnd(6)} ${sc.name}` +
    ` | ${(r.success * 100).toFixed(1)}% fail=${sim.stats.failed} p99=${r.p99} $${cost}${probs.length ? ` ILLEGAL(${probs.join('; ')})` : ''}${why ? ` | ${why}` : ''}` +
    `${chk.problems.length && passed ? ` | CHECK: ${chk.problems[0].slice(0, 90)}` : ''}${!passed && !ok ? ` | DX: ${(diagnose(sim, l, d).headline ?? '').slice(0, 110)}` : ''}`,
  );
}
console.log(lines.join('\n'));
console.log(`\n${total} scenarios, ${mismatches} where the game disagrees with the author, ${illegal} not legal under the level's kit/cap/options`);
  if (mismatches || illegal) process.exitCode = 1;

}
if (/playtest\.ts$/.test(process.argv[1] ?? '')) main();
