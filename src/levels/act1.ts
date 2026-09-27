import type { Design, EdgeSpec, Level, NodeSpec, PartKind } from '../sim/types';

// Small helpers so reference designs stay readable.
export const FANS: NodeSpec = { id: 'fans', kind: 'users', x: 96, y: 336, fixed: true, label: 'Fans' };
let auto = 0;
export function n(kind: PartKind, x: number, y: number, id?: string, opts?: NodeSpec['opts']): NodeSpec {
  return { id: id ?? `${kind}-${++auto}`, kind, x, y, opts };
}
export function wire(...ids: string[]): EdgeSpec[] {
  const out: EdgeSpec[] = [];
  for (let i = 0; i < ids.length - 1; i++) out.push({ from: ids[i], to: ids[i + 1] });
  return out;
}
export function fan(from: string, tos: string[]): EdgeSpec[] {
  return tos.map((to) => ({ from, to }));
}
export function funnel(froms: string[], to: string): EdgeSpec[] {
  return froms.map((from) => ({ from, to }));
}
export function design(nodes: NodeSpec[], edges: EdgeSpec[]): Design {
  return { nodes: [FANS, ...nodes], edges };
}

const webs = (count: number, x = 480) =>
  Array.from({ length: count }, (_, i) => n('web', x, 336 + (i - (count - 1) / 2) * 96, `web-${i + 1}`));

export const ACT1: Level[] = [
  {
    id: '1-1',
    act: 1,
    title: 'Hello, World Tour',
    clock: ['09:00', '09:05'],
    intro: [
      'Queuetix is three people, a laptop, and one band that said yes.',
      'Fans want to see tour dates. Put a web server in front of them and a database behind it.',
      'Drag parts from the tray. Drag from one part to another to wire them. Then press Run.',
    ],
    goal: 'Serve the tour page. Keep the error budget above zero.',
    duration: 40,
    seed: 11,
    traffic: [
      { at: 0, rps: 10, mix: { read: 0.9, write: 0.1 } },
      { at: 20, rps: 25 },
      { at: 40, rps: 20 },
    ],
    chaos: [],
    fixed: [FANS],
    kit: { web: 1, db: 1 },
    catalog: ['web', 'db'],
    parCost: 180,
    slo: { p99: 400, success: 0.99 },
    errorBudget: 20,
    unlocks: ['web', 'db'],
    reference: design([webs(1)[0], n('db', 800, 336, 'db')], wire('fans', 'web-1', 'db')),
    naive: design([webs(1)[0]], wire('fans', 'web-1')),
    postmortem: {
      win: [
        'Summary: the tour page stayed up. Nobody noticed, which is the goal.',
        'Contributing factors: none. Enjoy it. It does not last.',
      ],
      lose: [
        'Summary: fans asked for tour dates and got nothing.',
        'Root cause: requests need a path from Fans to something that has the data.',
      ],
      hint: 'Every request needs a route to the data. Fans, then web, then database.',
    },
  },
  {
    id: '1-2',
    act: 1,
    title: 'Opening Act',
    clock: ['11:40', '12:00'],
    intro: [
      'A mid-size band tweeted the link. Traffic is doubling every few minutes.',
      'One web server can hold about 50 requests a second. The forecast says more than that is coming.',
    ],
    goal: 'Survive the tweet. Two web servers will not be enough at the peak.',
    duration: 50,
    seed: 12,
    traffic: [
      { at: 0, rps: 30, mix: { read: 0.85, write: 0.15 } },
      { at: 15, rps: 60 },
      { at: 35, rps: 115 },
      { at: 50, rps: 90 },
    ],
    chaos: [],
    fixed: [FANS],
    kit: { web: 4, db: 1, lb: 1 },
    catalog: ['web', 'db', 'lb'],
    parCost: 325,
    slo: { p99: 400, success: 0.98 },
    errorBudget: 60,
    unlocks: ['lb'],
    reference: design(
      [n('lb', 288, 336, 'lb'), ...webs(3), n('db', 800, 336, 'db')],
      [...wire('fans', 'lb'), ...fan('lb', ['web-1', 'web-2', 'web-3']), ...funnel(['web-1', 'web-2', 'web-3'], 'db')],
    ),
    naive: design([webs(1)[0], n('db', 800, 336, 'db')], wire('fans', 'web-1', 'db')),
    postmortem: {
      win: [
        'Summary: the load balancer spread the tweet across three servers. None of them broke a sweat. Well, one did a little.',
        'What went well: horizontal scaling. More small boxes instead of one big one.',
      ],
      lose: [
        'Summary: one web server tried to serve the entire internet.',
        'Root cause: every slot on the server was busy, the queue filled up, and new fans got turned away.',
      ],
      hint: 'Put a load balancer in front and add more web servers behind it.',
    },
  },
  {
    id: '1-3',
    act: 1,
    title: 'The Setlist Page',
    clock: ['19:55', '20:15'],
    intro: [
      'Tonight is the first show. Everyone in the venue is refreshing the same setlist page.',
      'It is the same answer, asked ten thousand times. The database does not know that. It looks it up every time.',
    ],
    goal: 'Keep the database breathing while everyone reads the same thing.',
    duration: 50,
    seed: 13,
    traffic: [
      { at: 0, rps: 70, mix: { read: 0.92, write: 0.08 } },
      { at: 15, rps: 145 },
      { at: 30, rps: 260 },
      { at: 50, rps: 205 },
    ],
    chaos: [],
    fixed: [FANS],
    kit: { web: 4, db: 1, lb: 1, cache: 1 },
    catalog: ['web', 'db', 'lb', 'cache'],
    parCost: 425,
    slo: { p99: 350, success: 0.98 },
    errorBudget: 80,
    unlocks: ['cache'],
    reference: design(
      [n('lb', 288, 336, 'lb'), ...webs(4), n('cache', 672, 336, 'cache'), n('db', 864, 336, 'db')],
      [
        ...wire('fans', 'lb'),
        ...fan('lb', ['web-1', 'web-2', 'web-3', 'web-4']),
        ...funnel(['web-1', 'web-2', 'web-3', 'web-4'], 'cache'),
        ...wire('cache', 'db'),
      ],
    ),
    naive: design(
      [n('lb', 288, 336, 'lb'), ...webs(4), n('db', 864, 336, 'db')],
      [...wire('fans', 'lb'), ...fan('lb', ['web-1', 'web-2', 'web-3', 'web-4']), ...funnel(['web-1', 'web-2', 'web-3', 'web-4'], 'db')],
    ),
    postmortem: {
      win: [
        'Summary: the cache answered most setlist reads. The database got to sit down.',
        'What went well: cache-aside. Hot data lives close, the source of truth stays calm.',
        'Known risk: if the setlist changes, some fans will see the old one for a bit. That is the trade.',
      ],
      lose: [
        'Summary: the database looked up the same setlist thousands of times until it fell behind.',
        'Root cause: adding web servers moved the bottleneck, it did not remove it.',
      ],
      hint: 'A cache between the web servers and the database answers repeated reads.',
    },
  },
  {
    id: '1-4',
    act: 1,
    title: 'Poster Drop',
    clock: ['12:00', '12:20'],
    intro: [
      'The band posted the tour poster. It is 4 MB. Every fan wants it, right now.',
      'Your web servers are great at running the app and bad at shipping big files.',
    ],
    goal: 'Get the poster to everyone without tying up every web server.',
    duration: 50,
    seed: 14,
    traffic: [
      { at: 0, rps: 85, mix: { read: 0.55, write: 0.05, static: 0.4 } },
      { at: 12, rps: 140 },
      { at: 25, rps: 350, mix: { read: 0.3, write: 0.05, static: 0.65 } },
      { at: 50, rps: 280 },
    ],
    chaos: [],
    fixed: [FANS],
    kit: { web: 3, db: 1, lb: 1, cache: 1, cdn: 1 },
    catalog: ['web', 'db', 'lb', 'cache', 'cdn'],
    parCost: 395,
    slo: { p99: 350, success: 0.98 },
    errorBudget: 80,
    unlocks: ['cdn'],
    reference: design(
      [n('cdn', 240, 336, 'cdn'), n('lb', 336, 336, 'lb'), ...webs(3), n('cache', 672, 336, 'cache'), n('db', 864, 336, 'db')],
      [...wire('fans', 'cdn', 'lb'), ...fan('lb', ['web-1', 'web-2', 'web-3']), ...funnel(['web-1', 'web-2', 'web-3'], 'cache'), ...wire('cache', 'db')],
    ),
    naive: design(
      [n('lb', 288, 336, 'lb'), ...webs(3), n('cache', 672, 336, 'cache'), n('db', 864, 336, 'db')],
      [...wire('fans', 'lb'), ...fan('lb', ['web-1', 'web-2', 'web-3']), ...funnel(['web-1', 'web-2', 'web-3'], 'cache'), ...wire('cache', 'db')],
    ),
    postmortem: {
      win: [
        'Summary: the CDN handed out the poster from the edge. Your servers barely saw it.',
        'What went well: static content hosting. Files that never change do not need an app server.',
      ],
      lose: [
        'Summary: every web server spent the afternoon mailing out a JPEG.',
        'Root cause: static files held web slots for a long time, so real page loads queued behind them.',
      ],
      hint: 'Put a CDN in front of everything. It answers static files and passes the rest through.',
    },
  },
  {
    id: '1-5',
    act: 1,
    title: 'Server Down',
    clock: ['10:00', '10:20'],
    intro: [
      'Presale day. Everything is fine. Everything is always fine, until it is not.',
      'Somewhere in the forecast, a web server is going to die. The load balancer does not know that yet.',
    ],
    goal: 'Lose a server and keep serving. Turn on health checks in the load balancer inspector.',
    duration: 55,
    seed: 15,
    traffic: [
      { at: 0, rps: 60, mix: { read: 0.8, write: 0.1, static: 0.1 } },
      { at: 20, rps: 125 },
      { at: 55, rps: 125 },
    ],
    chaos: [{ at: 22, kind: 'down', target: { kind: 'web', pick: 'busiest' }, note: 'A web server stops answering' }],
    fixed: [FANS],
    kit: { web: 4, db: 1, lb: 1, cache: 1, cdn: 1 },
    catalog: ['web', 'db', 'lb', 'cache', 'cdn'],
    options: ['healthCheck'],
    parCost: 455,
    slo: { p99: 400, success: 0.97 },
    errorBudget: 90,
    unlocks: ['healthCheck'],
    reference: design(
      [n('cdn', 240, 336, 'cdn'), n('lb', 336, 336, 'lb', { healthCheck: true }), ...webs(4), n('cache', 672, 336, 'cache'), n('db', 864, 336, 'db')],
      [...wire('fans', 'cdn', 'lb'), ...fan('lb', ['web-1', 'web-2', 'web-3', 'web-4']), ...funnel(['web-1', 'web-2', 'web-3', 'web-4'], 'cache'), ...wire('cache', 'db')],
    ),
    naive: design(
      [n('cdn', 240, 336, 'cdn'), n('lb', 336, 336, 'lb'), ...webs(3), n('cache', 672, 336, 'cache'), n('db', 864, 336, 'db')],
      [...wire('fans', 'cdn', 'lb'), ...fan('lb', ['web-1', 'web-2', 'web-3']), ...funnel(['web-1', 'web-2', 'web-3'], 'cache'), ...wire('cache', 'db')],
    ),
    postmortem: {
      win: [
        'Summary: a web server died at the worst time. The load balancer noticed within seconds and stopped sending it fans.',
        'What went well: health endpoint monitoring, plus one server more than you strictly needed.',
      ],
      lose: [
        'Summary: the load balancer kept sending a third of all fans to a server that was no longer there.',
        'Root cause: nothing was checking whether the servers were alive.',
      ],
      hint: 'Open the load balancer inspector and turn on health checks. Keep a spare server for when one dies.',
    },
  },
];
