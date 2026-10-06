import type { Level, NodeSpec } from '../sim/types';
import { FANS, design, fan, funnel, n, wire } from './act1';

const ACT1_PARTS = ['web', 'db', 'lb', 'cache', 'cdn'] as const;

const col = (kind: NodeSpec['kind'], prefix: string, count: number, x: number, cy = 336, gap = 84) =>
  Array.from({ length: count }, (_, i) => n(kind, x, cy + (i - (count - 1) / 2) * gap, `${prefix}-${i + 1}`));
const ids = (nodes: NodeSpec[]) => nodes.map((x) => x.id);

// 2.1 ----------------------------------------------------------------
const w21 = col('web', 'web', 5, 432, 336, 96);
const k21 = col('worker', 'wrk', 3, 816, 192, 84);

// 2.2 ----------------------------------------------------------------
const w22 = col('web', 'web', 5, 432, 336, 96);

// 2.3 ----------------------------------------------------------------
const w23 = col('web', 'web', 3, 480, 336, 96);

// 2.4 ----------------------------------------------------------------
const PAY: NodeSpec = { id: 'pay', kind: 'payment', x: 816, y: 120, fixed: true, label: 'Payments API' };
const w24 = col('web', 'web', 3, 480, 336, 96);
const w24r = w24.map((w) => ({ ...w, opts: { retry: true } }));

// 2.5 ----------------------------------------------------------------
const TK = (i: number): NodeSpec => ({ id: `tix-${i}`, kind: 'web', x: 576, y: 168 + (i - 1) * 96, fixed: true, label: 'Tickets app', handles: ['write'] });
const BR = (i: number): NodeSpec => ({ id: `browse-${i}`, kind: 'web', x: 576, y: 408 + (i - 1) * 96, fixed: true, label: 'Browse app', handles: ['read', 'static', 'bot'] });
const DB25: NodeSpec = { id: 'db', kind: 'db', x: 912, y: 216, fixed: true, label: 'Orders DB' };
const RR25: NodeSpec = { id: 'rr', kind: 'replica', x: 912, y: 456, fixed: true, label: 'Catalog replica' };
const fixed25 = [FANS, TK(1), TK(2), BR(1), BR(2), BR(3), DB25, RR25];
const edges25 = [
  ...funnel(['tix-1', 'tix-2'], 'db'),
  ...funnel(['browse-1', 'browse-2', 'browse-3'], 'rr'),
];
const backends25 = ['tix-1', 'tix-2', 'browse-1', 'browse-2', 'browse-3'];

export const ACT2: Level[] = [
  {
    id: '2-1',
    act: 2,
    title: '10:00:00',
    clock: ['09:58', '10:06'],
    intro: [
      'The first big on-sale. At 10:00:00 exactly, everyone who has been refreshing clicks Buy.',
      'Each order is a database write, and the database can only do so many at once. It does not care that you are famous now.',
      'From here on you get a monthly budget instead of a parts list.',
      'A queue only takes work the fan does not wait for, like saving an order. A page read needs its answer right now, so it still needs a direct route to the data.',
    ],
    goal: 'Take every order during the rush. Nobody said you had to finish them all instantly.',
    duration: 55,
    seed: 21,
    traffic: [
      { at: 0, rps: 60, mix: { read: 0.8, write: 0.2 } },
      { at: 10, rps: 70 },
      { at: 12, rps: 275, mix: { read: 0.35, write: 0.65 } },
      { at: 30, rps: 240 },
      { at: 40, rps: 110, mix: { read: 0.7, write: 0.3 } },
      { at: 55, rps: 85 },
    ],
    chaos: [{ at: 12, kind: 'recover', target: 'fans', note: '10:00:00, on sale' }],
    fixed: [FANS],
    catalog: [...ACT1_PARTS, 'queue', 'worker'],
    maxCost: 700,
    parCost: 615,
    slo: { p99: 400, success: 0.98 },
    errorBudget: 80,
    unlocks: ['queue'],
    reference: design(
      [n('lb', 240, 336, 'lb'), ...w21, n('cache', 672, 480, 'cache'), n('queue', 672, 192, 'mq'), ...k21, n('db', 960, 336, 'db')],
      [
        ...wire('fans', 'lb'), ...fan('lb', ids(w21)),
        ...ids(w21).flatMap((w) => [{ from: w, to: 'mq' }, { from: w, to: 'cache' }]),
        ...wire('cache', 'db'), ...fan('mq', ids(k21)), ...funnel(ids(k21), 'db'),
      ],
    ),
    naive: design(
      [n('lb', 240, 336, 'lb'), ...w21, n('cache', 672, 480, 'cache'), n('db', 960, 336, 'db')],
      [...wire('fans', 'lb'), ...fan('lb', ids(w21)), ...funnel(ids(w21), 'cache'), ...wire('cache', 'db')],
    ),
    postmortem: {
      win: [
        'Summary: 10:00:00 hit, and the queue took every order and said "got it". Workers fed them to the database at a pace it could live with.',
        'What went well: queue-based load leveling plus competing consumers. The spike became a slope.',
        'Known risk: fans saw "processing" for a few seconds. Some of them tweeted about it. That is fine.',
      ],
      lose: [
        'Summary: every fan tried to write to the database at the same second. The database politely declined most of them.',
        'Root cause: writes arrived faster than one primary can commit. More web servers only means more of them waiting.',
      ],
      hint: 'Send writes to a message queue, and put workers between the queue and the database.',
      pattern: [{ part: 'queue' }, { part: 'worker' }],
    },
  },
  {
    id: '2-2',
    act: 2,
    title: 'Read All About It',
    clock: ['14:00', '14:20'],
    intro: [
      'Queuetix now has seat maps. Every fan sees their own view of the venue with their own prices.',
      'That means the cache mostly misses. Every seat map is a fresh database read.',
    ],
    goal: 'Take the read load off the primary database without losing any writes.',
    duration: 50,
    seed: 22,
    cacheHit: 0.3,
    traffic: [
      { at: 0, rps: 110, mix: { read: 0.9, write: 0.1 } },
      { at: 15, rps: 210 },
      { at: 30, rps: 295 },
      { at: 50, rps: 265 },
    ],
    chaos: [],
    fixed: [FANS],
    catalog: [...ACT1_PARTS, 'queue', 'worker', 'replica'],
    maxCost: 700,
    parCost: 635,
    slo: { p99: 400, success: 0.98 },
    errorBudget: 70,
    unlocks: ['replica'],
    reference: design(
      [n('lb', 240, 336, 'lb'), ...w22, n('cache', 672, 336, 'cache'), n('db', 912, 216, 'db'), n('replica', 912, 456, 'rr')],
      [...wire('fans', 'lb'), ...fan('lb', ids(w22)), ...funnel(ids(w22), 'cache'), ...fan('cache', ['db', 'rr'])],
    ),
    naive: design(
      [n('lb', 240, 336, 'lb'), ...w22, n('cache', 672, 336, 'cache'), n('db', 912, 336, 'db')],
      [...wire('fans', 'lb'), ...fan('lb', ids(w22)), ...funnel(ids(w22), 'cache'), ...wire('cache', 'db')],
    ),
    postmortem: {
      win: [
        'Summary: the replica took half the seat map reads. The primary kept its attention on orders.',
        'What went well: read scale-out. Reads are cheap to copy. Writes are not.',
        'Known risk: replication lag. A fan might grab a seat and see it as free for another second. Product has been told. Product said "hm".',
      ],
      lose: [
        'Summary: the cache could not help, since no two fans asked for the same thing, so every read landed on the primary.',
        'Root cause: one database doing both jobs. Reads crowded out writes.',
      ],
      hint: 'Add a read replica next to the database, and wire the cache to both. Writes will still find the primary.',
      pattern: [{ part: 'replica' }],
    },
  },
  {
    id: '2-3',
    act: 2,
    title: 'The Scalpers',
    clock: ['09:59', '10:04'],
    intro: [
      'A stadium tour. Somebody has written a script that asks for seat availability 400 times a second from a few thousand IPs.',
      'Those requests look like fans, cost like fans, and are not fans. Bots are the black crosses on the forecast.',
    ],
    goal: 'Keep real fans served. You do not have the budget to serve the bots too.',
    duration: 50,
    seed: 23,
    traffic: [
      { at: 0, rps: 110, mix: { read: 0.75, write: 0.1, static: 0.1, bot: 0.05 } },
      { at: 12, rps: 180, mix: { read: 0.4, write: 0.08, static: 0.07, bot: 0.45 } },
      { at: 22, rps: 385, mix: { read: 0.25, write: 0.05, static: 0.05, bot: 0.65 } },
      { at: 50, rps: 360 },
    ],
    chaos: [{ at: 12, kind: 'recover', target: 'fans', note: 'Bot traffic starts' }],
    fixed: [FANS],
    catalog: [...ACT1_PARTS, 'queue', 'worker', 'replica', 'waf'],
    maxCost: 560,
    parCost: 500,
    slo: { p99: 400, success: 0.98 },
    errorBudget: 60,
    unlocks: ['waf'],
    reference: design(
      [n('waf', 216, 336, 'waf'), n('cdn', 336, 336, 'cdn'), n('lb', 432, 336, 'lb'), ...w23.map((w) => ({ ...w, x: 576 })), n('cache', 768, 336, 'cache'), n('db', 960, 336, 'db')],
      [...wire('fans', 'waf', 'cdn', 'lb'), ...fan('lb', ids(w23)), ...funnel(ids(w23), 'cache'), ...wire('cache', 'db')],
    ),
    naive: design(
      [n('cdn', 240, 336, 'cdn'), n('lb', 336, 336, 'lb'), ...w23.map((w) => ({ ...w, x: 576 })), n('cache', 768, 336, 'cache'), n('db', 960, 336, 'db')],
      [...wire('fans', 'cdn', 'lb'), ...fan('lb', ids(w23)), ...funnel(ids(w23), 'cache'), ...wire('cache', 'db')],
    ),
    postmortem: {
      win: [
        'Summary: the rate limiter turned away most of the bots at the door. Fans got through. The scalpers got a lot of HTTP 429.',
        'What went well: rate limiting at the edge, before the expensive parts.',
        'Known risk: a few real fans on shared office Wi-Fi also got "slow down". Their manager was probably grateful.',
      ],
      lose: [
        'Summary: bots used up the web servers and the fans waited behind them.',
        'Root cause: every request was treated as a customer. Some were a Python script in a basement.',
      ],
      hint: 'Put a rate limiter first, in front of everything, so bots are turned away before they cost anything.',
      pattern: [{ part: 'waf' }],
    },
  },
  {
    id: '2-4',
    act: 2,
    title: 'Flaky Payments',
    clock: ['18:30', '18:50'],
    intro: [
      'Orders now go through a payments provider before they are saved. You do not run it. You cannot scale it.',
      'At some point tonight it will start failing about one call in three, for no reason anyone will ever explain.',
    ],
    goal: 'Get orders through a dependency that fails at random. Wire your web servers to Payments and to your data.',
    duration: 50,
    seed: 24,
    needs: { write: ['pay', 'write'] },
    traffic: [
      { at: 0, rps: 70, mix: { read: 0.7, write: 0.3 } },
      { at: 20, rps: 130 },
      { at: 50, rps: 130 },
    ],
    chaos: [{ at: 15, kind: 'flaky', target: 'pay', note: 'Payments starts failing 1 in 3' }],
    fixed: [FANS, PAY],
    catalog: [...ACT1_PARTS, 'queue', 'worker', 'replica', 'waf'],
    options: ['healthCheck', 'retry'],
    maxCost: 560,
    parCost: 405,
    slo: { p99: 800, success: 0.97 },
    errorBudget: 45,
    unlocks: ['retry'],
    reference: design(
      [PAY, n('lb', 288, 336, 'lb'), ...w24r, n('cache', 720, 456, 'cache'), n('db', 912, 456, 'db')],
      [...wire('fans', 'lb'), ...fan('lb', ids(w24r)), ...ids(w24r).flatMap((w) => [{ from: w, to: 'pay' }, { from: w, to: 'cache' }]), ...wire('cache', 'db')],
    ),
    naive: design(
      [PAY, n('lb', 288, 336, 'lb'), ...w24, n('cache', 720, 456, 'cache'), n('db', 912, 456, 'db')],
      [...wire('fans', 'lb'), ...fan('lb', ids(w24)), ...ids(w24).flatMap((w) => [{ from: w, to: 'pay' }, { from: w, to: 'cache' }]), ...wire('cache', 'db')],
    ),
    postmortem: {
      win: [
        'Summary: Payments failed a third of all calls. Your servers waited a moment and tried again, and most orders went through on the second try.',
        'What went well: retry with exponential backoff. Brief, random failures are best answered with patience.',
        'Known risk: retries add load. Against a provider that is truly down, this would make things worse. Remember that. It comes up again.',
      ],
      lose: [
        'Summary: one order in three failed because a third party flipped a coin.',
        'Root cause: a single failed call was treated as final.',
      ],
      hint: 'Open each web server\'s inspector and turn on retry with backoff.',
      pattern: [{ opt: 'retry' }],
    },
  },
  {
    id: '2-5',
    act: 2,
    title: 'Two Teams, One Door',
    clock: ['10:00', '10:20'],
    intro: [
      'Queuetix now has two teams. Tickets owns orders. Browse owns the catalog. They built two different apps and are both very proud.',
      'Fans have one address. Something has to send each request to the app that can actually answer it.',
      'A load balancer spreads traffic evenly. It does not read the request.',
    ],
    goal: 'Route orders to Tickets and browsing to Browse, from one front door.',
    duration: 45,
    seed: 25,
    traffic: [
      { at: 0, rps: 60, mix: { read: 0.75, write: 0.15, static: 0.1 } },
      { at: 15, rps: 140 },
      { at: 45, rps: 150 },
    ],
    chaos: [],
    fixed: fixed25,
    fixedEdges: edges25,
    catalog: [...ACT1_PARTS, 'waf', 'gateway'],
    options: ['healthCheck', 'retry'],
    maxCost: 200,
    parCost: 80,
    slo: { p99: 400, success: 0.98 },
    errorBudget: 50,
    unlocks: ['gateway'],
    reference: {
      nodes: [...fixed25, n('cdn', 240, 336, 'cdn'), n('gateway', 384, 336, 'api')],
      edges: [...edges25, ...wire('fans', 'cdn', 'api'), ...fan('api', backends25)],
    },
    naive: {
      nodes: [...fixed25, n('cdn', 240, 336, 'cdn'), n('lb', 384, 336, 'lb')],
      edges: [...edges25, ...wire('fans', 'cdn', 'lb'), ...fan('lb', backends25)],
    },
    postmortem: {
      win: [
        'Summary: the gateway read every request and sent it to the team that owns it. Neither team knows the other exists, which is how they like it.',
        'What went well: gateway routing. One public address, many private services.',
      ],
      lose: [
        'Summary: the load balancer sent orders to the Browse app, which has no idea what an order is.',
        'Root cause: an L4-minded front door in front of services that are not interchangeable.',
      ],
      hint: 'Use an API gateway as the front door. It routes each call to a service that can handle it.',
      pattern: [{ part: 'gateway' }],
    },
  },
];
