import type { EdgeSpec, Level, NodeSpec, NodeOpts } from '../sim/types';
import { FANS, design, fan, funnel, n, wire } from './act1';

const ALL = ['web', 'db', 'lb', 'cache', 'cdn', 'queue', 'worker', 'replica', 'waf', 'gateway'] as const;

const col = (kind: NodeSpec['kind'], prefix: string, count: number, x: number, cy = 336, gap = 96, opts?: NodeOpts) =>
  Array.from({ length: count }, (_, i) => n(kind, x, cy + (i - (count - 1) / 2) * gap, `${prefix}-${i + 1}`, opts));
const ids = (nodes: NodeSpec[]) => nodes.map((x) => x.id);
const PAY: NodeSpec = { id: 'pay', kind: 'payment', x: 864, y: 96, fixed: true, label: 'Payments API' };

// web -> pay, web -> cache -> db
function payStack(webs: NodeSpec[]) {
  return {
    nodes: [PAY, n('lb', 288, 336, 'lb'), ...webs, n('cache', 720, 456, 'cache'), n('db', 912, 456, 'db')],
    edges: [
      ...wire('fans', 'lb'), ...fan('lb', ids(webs)),
      ...ids(webs).flatMap((w) => [{ from: w, to: 'pay' }, { from: w, to: 'cache' }]),
      ...wire('cache', 'db'),
    ] as EdgeSpec[],
  };
}

// 3.1 / 3.2
const s31ref = payStack(col('web', 'web', 4, 504, 336, 96, { breaker: true }));
const s31naive = payStack(col('web', 'web', 4, 504, 336, 96, { retry: true }));
const s32ref = payStack(col('web', 'web', 4, 504, 336, 96, { bulkhead: true }));
const s32naive = payStack(col('web', 'web', 4, 504, 336, 96));

// 3.3
const w33 = col('web', 'web', 4, 384);
const k33 = col('worker', 'wrk', 3, 672, 192, 84);
const ref33 = design(
  [n('lb', 240, 336, 'lb'), ...w33, n('queue', 528, 168, 'mq'), ...k33, n('cache', 528, 504, 'cache'), n('shardrouter', 816, 336, 'shd'), n('db', 984, 240, 'db-a'), n('db', 984, 432, 'db-b')],
  [
    ...wire('fans', 'lb'), ...fan('lb', ids(w33)),
    ...ids(w33).flatMap((w) => [{ from: w, to: 'mq' }, { from: w, to: 'cache' }]),
    ...fan('mq', ids(k33)), ...funnel(ids(k33), 'shd'), ...wire('cache', 'shd'), ...fan('shd', ['db-a', 'db-b']),
  ],
);
const naive33 = design(
  [n('lb', 240, 336, 'lb'), ...w33, n('queue', 528, 168, 'mq'), ...k33, n('cache', 528, 504, 'cache'), n('db', 984, 336, 'db')],
  [
    ...wire('fans', 'lb'), ...fan('lb', ids(w33)),
    ...ids(w33).flatMap((w) => [{ from: w, to: 'mq' }, { from: w, to: 'cache' }]),
    ...fan('mq', ids(k33)), ...funnel(ids(k33), 'db'), ...wire('cache', 'db'),
  ],
);

// 3.4
const w34 = col('web', 'web', 5, 384);
const k34 = col('worker', 'wrk', 2, 672, 144, 96);
const ref34 = design(
  [n('lb', 240, 336, 'lb'), ...w34, n('queue', 528, 144, 'mq'), ...k34, n('db', 912, 144, 'db'), n('pubsub', 816, 336, 'topic'), n('readmodel', 672, 504, 'view')],
  [
    ...wire('fans', 'lb'), ...fan('lb', ids(w34)),
    ...ids(w34).flatMap((w) => [{ from: w, to: 'mq' }, { from: w, to: 'view' }]),
    ...fan('mq', ids(k34)), ...funnel(ids(k34), 'db'), ...funnel(ids(k34), 'topic'), ...wire('topic', 'view'),
  ],
);
const naive34 = design(
  [n('lb', 240, 336, 'lb'), ...w34, n('queue', 528, 144, 'mq'), ...k34, n('cache', 672, 456, 'cache'), n('db', 912, 144, 'db'), n('replica', 912, 504, 'rr')],
  [
    ...wire('fans', 'lb'), ...fan('lb', ids(w34)),
    ...ids(w34).flatMap((w) => [{ from: w, to: 'mq' }, { from: w, to: 'cache' }]),
    ...fan('mq', ids(k34)), ...funnel(ids(k34), 'db'), ...fan('cache', ['db', 'rr']),
  ],
);

// 3.5: one full stamp per region
function stamp(tag: 'n' | 's', cy: number, webs = 3) {
  const w = Array.from({ length: webs }, (_, i) => n('web', 624, cy + (i - (webs - 1) / 2) * 84, `web-${tag}${i + 1}`));
  const nodes = [n('lb', 432, cy, `lb-${tag}`), ...w, n('cache', 816, cy, `cache-${tag}`), n('db', 1032, cy, `db-${tag}`)];
  const edges = [...fan(`lb-${tag}`, ids(w)), ...funnel(ids(w), `cache-${tag}`), ...wire(`cache-${tag}`, `db-${tag}`)];
  return { nodes, edges };
}
const north = stamp('n', 168);
const south = stamp('s', 504);
const north4 = stamp('n', 168, 4);
// Fans sit at the left of the global strip, with the global router beside them.
const FANS35: NodeSpec = { ...FANS, x: 72 };
const ref35 = {
  nodes: [FANS35, n('dns', 204, 336, 'dns'), ...north.nodes, ...south.nodes],
  edges: [...wire('fans', 'dns'), ...fan('dns', ['lb-n', 'lb-s']), ...north.edges, ...south.edges],
};
const naive35 = {
  nodes: [FANS35, n('dns', 204, 336, 'dns'), ...north4.nodes],
  edges: [...wire('fans', 'dns'), ...fan('dns', ['lb-n']), ...north4.edges],
};

// 3.6
const w36 = (opts: NodeOpts) => col('web', 'web', 4, 576, 336, 96, opts);
function finale(opts: NodeOpts) {
  const w = w36(opts);
  return design(
    [PAY, n('waf', 216, 336, 'waf'), n('cdn', 312, 336, 'cdn'), n('lb', 408, 336, 'lb'), ...w, n('cache', 792, 456, 'cache'), n('db', 984, 456, 'db')],
    [
      ...wire('fans', 'waf', 'cdn', 'lb'), ...fan('lb', ids(w)),
      ...ids(w).flatMap((x) => [{ from: x, to: 'pay' }, { from: x, to: 'cache' }]),
      ...wire('cache', 'db'),
    ],
  );
}

export const ACT3: Level[] = [
  {
    id: '3-1',
    act: 3,
    title: 'Payment Provider Is Having A Day',
    clock: ['19:00', '19:30'],
    intro: [
      'The payments provider posted "we are investigating elevated latency". That means it is on fire.',
      'Every checkout now waits on them, and while a web server waits it holds a slot. Browsing needs those slots too.',
      'You turned on retries last time. Think about what retries do to something that is already drowning.',
    ],
    goal: 'Keep browsing alive while checkout is broken. Some orders will fail. Fail them fast.',
    duration: 50,
    seed: 31,
    needs: { write: ['pay', 'write'] },
    traffic: [
      { at: 0, rps: 130, mix: { read: 0.88, write: 0.12 } },
      { at: 15, rps: 185 },
      { at: 50, rps: 185 },
    ],
    chaos: [
      { at: 14, kind: 'hang', target: 'pay', note: 'Payments stops answering' },
      { at: 34, kind: 'recover', target: 'pay', note: 'Payments recovers' },
    ],
    fixed: [FANS, PAY],
    catalog: [...ALL],
    options: ['healthCheck', 'retry', 'breaker'],
    kit: { web: 5 },
    maxCost: 560,
    parCost: 445,
    slo: { p99: 1200, success: 0.92 },
    errorBudget: 200,
    unlocks: ['breaker'],
    reference: design(s31ref.nodes, s31ref.edges),
    naive: design(s31naive.nodes, s31naive.edges),
    postmortem: {
      win: [
        'Summary: Payments went slow. The breakers noticed within seconds, stopped calling it, and failed checkouts immediately. Browsing never noticed.',
        'What went well: circuit breaker. A fast "no" is kinder than a slow timeout, to fans and to your own servers.',
        'Also: nobody retried into a burning building. Growth.',
      ],
      lose: [
        'Summary: every web server spent the incident waiting on Payments. Fans who only wanted to browse got timeouts too.',
        'Root cause: a slow dependency held every slot. If retries were on, each failed call came back for more.',
      ],
      hint: 'Turn on circuit breakers on the web servers, and turn off retries against a dependency that is down.',
    },
  },
  {
    id: '3-2',
    act: 3,
    title: 'Noisy Neighbors',
    clock: ['12:00', '12:30'],
    intro: [
      'Payments is not failing today. It is just slow, all day, and very sorry about it.',
      'Checkouts will succeed, eventually. The problem is everything else waiting behind them on the same servers.',
      'A breaker only trips on failures. Nothing is failing.',
    ],
    goal: 'Slow checkouts are allowed. Slow browsing is not.',
    duration: 50,
    seed: 32,
    needs: { write: ['pay', 'write'] },
    traffic: [
      { at: 0, rps: 130, mix: { read: 0.86, write: 0.14 } },
      { at: 20, rps: 230 },
      { at: 50, rps: 230 },
    ],
    chaos: [{ at: 8, kind: 'slow', target: 'pay', note: 'Payments gets slow and stays slow' }],
    fixed: [FANS, PAY],
    catalog: [...ALL],
    options: ['healthCheck', 'retry', 'breaker', 'bulkhead'],
    kit: { web: 5 },
    maxCost: 560,
    parCost: 445,
    slo: { p99: 2000, success: 0.97 },
    errorBudget: 80,
    unlocks: ['bulkhead'],
    reference: design(s32ref.nodes, s32ref.edges),
    naive: design(s32naive.nodes, s32naive.edges),
    postmortem: {
      win: [
        'Summary: checkout was slow, and it stayed in its own compartment. Browsing had its half of every server to itself.',
        'What went well: bulkheads. One leak does not sink the ship.',
      ],
      lose: [
        'Summary: slow checkouts slowly filled every slot on every server. Browsing waited in line behind people paying.',
        'Root cause: one shared pool for fast work and slow work.',
      ],
      hint: 'Turn on the bulkhead on your web servers so writes can only take half the slots.',
    },
  },
  {
    id: '3-3',
    act: 3,
    title: 'Too Big To Index',
    clock: ['09:55', '10:30'],
    intro: [
      'The world tour. Forty stadiums on sale at once. It is not a spike this time. It is a plateau.',
      'The queue buys you time, but time runs out when writes never slow down. One primary can only commit so fast.',
    ],
    goal: 'Keep up with sustained writes. The database is the limit, so have more than one.',
    duration: 65,
    seed: 33,
    traffic: [
      { at: 0, rps: 90, mix: { read: 0.6, write: 0.4 } },
      { at: 8, rps: 250, mix: { read: 0.4, write: 0.6 } },
      { at: 65, rps: 250 },
    ],
    chaos: [{ at: 8, kind: 'recover', target: 'fans', note: 'Forty on-sales open' }],
    fixed: [FANS],
    catalog: [...ALL, 'shardrouter'],
    options: ['healthCheck', 'retry', 'breaker', 'bulkhead'],
    maxCost: 900,
    parCost: 790,
    slo: { p99: 400, success: 0.98 },
    errorBudget: 80,
    unlocks: ['shardrouter'],
    reference: ref33,
    naive: naive33,
    postmortem: {
      win: [
        'Summary: orders were split across two primaries by a shard map. Each database did half the work and neither of them complained.',
        'What went well: sharding. When one machine cannot do it, stop asking one machine.',
        'Known risk: "show me every order for this fan" now has to ask two databases. Someone will file that ticket next quarter.',
      ],
      lose: [
        'Summary: the queue filled faster than one database could empty it. Orders waited past their deadline and were lost.',
        'Root cause: a queue smooths a spike. It cannot fix a flat line that is higher than your capacity.',
      ],
      hint: 'Put a shard map between your workers and two databases. Wire the cache through it too.',
    },
  },
  {
    id: '3-4',
    act: 3,
    title: 'Everyone Wants The Seat Map',
    clock: ['09:50', '10:10'],
    intro: [
      'The new seat map shows every seat, live, with prices. Fans reload it constantly. It is the most-read page on the site by a factor of forty.',
      'Every fan sees a different map, so caching barely helps. Replicas help, but they cost like databases, because they are databases.',
      'What if the read side had its own store, shaped exactly like the seat map, updated whenever a seat sells?',
    ],
    goal: 'Serve a flood of seat map reads within budget. Writes must still land in the real database.',
    duration: 50,
    seed: 34,
    cacheHit: 0.2,
    traffic: [
      { at: 0, rps: 210, mix: { read: 0.92, write: 0.08 } },
      { at: 15, rps: 365 },
      { at: 50, rps: 390 },
    ],
    chaos: [],
    fixed: [FANS],
    catalog: [...ALL, 'shardrouter', 'pubsub', 'readmodel'],
    options: ['healthCheck', 'retry', 'breaker', 'bulkhead'],
    maxCost: 700,
    parCost: 640,
    slo: { p99: 400, success: 0.98 },
    errorBudget: 80,
    unlocks: ['readmodel'],
    reference: ref34,
    naive: naive34,
    postmortem: {
      win: [
        'Summary: seat map reads came from a read model built for exactly that page. Workers published every sale, and the view kept up.',
        'What went well: CQRS with pub/sub. Writes stayed boring. Reads got their own fast lane.',
        'Known risk: the view is always a moment behind. A fan may click a seat that sold 200 ms ago. The checkout will tell them, politely.',
      ],
      lose: [
        'Summary: the seat map buried the database, or the budget, or both.',
        'Root cause: asking the transactional database to also be a very fast read-only map.',
      ],
      hint: 'Workers write to the database and publish to an event topic. A read model subscribes to the topic. Web servers read from the read model.',
    },
  },
  {
    id: '3-5',
    act: 3,
    title: 'us-east-1',
    clock: ['10:00', '10:30'],
    intro: [
      'You know how this one goes. At some point today a whole region will go dark. Every part in it. The status page will say green for the first forty minutes.',
      'The board is split into two regions, north and south. Anything placed in a region goes down with it.',
      'Nobody knows which region it will be. If you lean on one, that is the one that fails.',
      'A global router lives in the strip on the left, outside both regions.',
    ],
    goal: 'Lose an entire region, whichever you leaned on most, and keep selling tickets.',
    duration: 55,
    seed: 35,
    regions: true,
    traffic: [
      { at: 0, rps: 90, mix: { read: 0.85, write: 0.1, static: 0.05 } },
      { at: 15, rps: 150 },
      { at: 55, rps: 150 },
    ],
    chaos: [{ at: 22, kind: 'down', target: { region: 'busiest' }, note: 'Your busiest region goes dark' }],
    fixed: [FANS35],
    catalog: [...ALL, 'shardrouter', 'pubsub', 'readmodel', 'dns'],
    options: ['healthCheck', 'retry', 'breaker', 'bulkhead'],
    maxCost: 1000,
    parCost: 830,
    slo: { p99: 400, success: 0.97 },
    errorBudget: 90,
    unlocks: ['dns'],
    reference: ref35,
    naive: naive35,
    postmortem: {
      win: [
        'Summary: a whole region vanished. The global router noticed, and every fan went to the other one. Some of them noticed a slightly slower page.',
        'What went well: deployment stamps across regions, with a global router that checks health.',
        'Known risk: the two regions each have their own database. Reconciling orders from the outage window is now somebody\'s whole week. Not yours. Probably.',
      ],
      lose: [
        'Summary: you leaned on one region, and that region went away.',
        'Root cause: redundancy inside a region does not help when the region is the thing that fails.',
      ],
      hint: 'Build a complete copy of the stack in each region. Put a global router in the left strip in front of both load balancers.',
    },
  },
  {
    id: '3-6',
    act: 3,
    title: 'Refund Friday',
    clock: ['09:59', '10:30'],
    intro: [
      'The farewell tour. Everything at once: the spike, the scalpers, and the orders database having one of its moods.',
      'An order is two steps: charge the card, then save the ticket. If the charge works and the save fails, a fan has paid for nothing. That costs three times as much as a normal failure. Refunds, support tickets, a thread on social media.',
      'Everything you have learned is in the tray.',
    ],
    goal: 'Survive the finale. When an order fails halfway, undo the half that worked.',
    duration: 60,
    seed: 36,
    sagaRule: true,
    needs: { write: ['pay', 'write'] },
    traffic: [
      { at: 0, rps: 70, mix: { read: 0.6, write: 0.15, static: 0.15, bot: 0.1 } },
      { at: 10, rps: 95 },
      { at: 14, rps: 240, mix: { read: 0.3, write: 0.2, static: 0.2, bot: 0.3 } },
      { at: 45, rps: 210 },
      { at: 60, rps: 160 },
    ],
    chaos: [
      { at: 14, kind: 'recover', target: 'fans', note: 'The farewell tour goes on sale' },
      { at: 24, kind: 'down', target: { kind: 'db', pick: 'first' }, note: 'Orders DB fails over' },
      { at: 32, kind: 'recover', target: { kind: 'db', pick: 'first' }, note: 'Failover done' },
    ],
    fixed: [FANS, PAY],
    catalog: [...ALL, 'shardrouter', 'pubsub', 'readmodel', 'dns'],
    options: ['healthCheck', 'retry', 'breaker', 'bulkhead', 'saga'],
    maxCost: 700,
    parCost: 625,
    slo: { p99: 1000, success: 0.95 },
    errorBudget: 150,
    unlocks: ['saga'],
    reference: finale({ retry: true, saga: true }),
    naive: finale({ retry: true }),
    postmortem: {
      win: [
        'Summary: the farewell tour sold out. When the orders database dropped a save, the saga refunded the charge before the fan finished refreshing.',
        'What went well: all of it. Rate limiting, the CDN, retries, and a saga with compensating steps.',
        'Five nines is about five minutes of downtime a year. You had about zero today. Go home.',
      ],
      lose: [
        'Summary: some fans were charged for tickets that were never saved. Support is not having a good afternoon.',
        'Root cause: a two-step order with no plan for when step two fails.',
      ],
      hint: 'Turn on the saga switch on your web servers, so a failed save undoes the charge. Retry still helps with the flaky database.',
    },
  },
];
