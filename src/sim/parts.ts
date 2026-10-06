import type { Need, PartKind, ReqType } from './types';

export interface PartDef {
  kind: PartKind;
  name: string;
  short: string; // 2 to 4 letters, stamped on the node
  azure: string;
  aws: string;
  cost: number; // $/month
  capacity: number; // concurrent slots
  queueLimit: number;
  service: Partial<Record<ReqType, number>> & { default: number }; // ticks
  holds: boolean; // keeps a slot while waiting on a downstream call
  // Which needs this node can satisfy for a request of this type.
  provides: (t: ReqType, roll: number) => Need[];
  blurb: string; // one line for the tray tooltip
}

const none = () => [] as Need[];

export const PARTS: Record<PartKind, PartDef> = {
  users: {
    kind: 'users', name: 'Fans', short: 'FANS', azure: 'Internet', aws: 'Internet',
    cost: 0, capacity: 9999, queueLimit: 0, service: { default: 0 }, holds: false,
    provides: none, blurb: 'Where requests come from. They are impatient.',
  },
  web: {
    kind: 'web', name: 'Web server', short: 'WEB', azure: 'App Service', aws: 'EC2 / ECS task',
    cost: 60, capacity: 10, queueLimit: 40,
    service: { default: 3, static: 12 }, holds: true,
    provides: (t) => (t === 'static' ? ['static'] : []),
    blurb: 'Runs the app. Serves pages itself (slowly), calls a database for data.',
  },
  db: {
    kind: 'db', name: 'Database', short: 'DB', azure: 'Azure SQL Database', aws: 'Amazon RDS',
    cost: 120, capacity: 8, queueLimit: 40,
    service: { default: 5, write: 8 }, holds: false,
    provides: (t) => (t === 'write' ? ['write', 'data'] : ['data']),
    blurb: 'The source of truth. Reads and writes. There is only one primary.',
  },
  lb: {
    kind: 'lb', name: 'Load balancer', short: 'LB', azure: 'Application Gateway', aws: 'Application Load Balancer',
    cost: 25, capacity: 9999, queueLimit: 0, service: { default: 0 }, holds: false,
    provides: none, blurb: 'Spreads requests across everything wired after it.',
  },
  cache: {
    kind: 'cache', name: 'Cache', short: '$', azure: 'Azure Cache for Redis', aws: 'ElastiCache',
    cost: 40, capacity: 20, queueLimit: 60, service: { default: 1 }, holds: false,
    // 85% of reads are for the same hot few pages.
    provides: (t, roll) => (t !== 'write' && t !== 'static' && roll < 0.85 ? ['data'] : []),
    blurb: 'Remembers answers to popular reads. Misses go to the database.',
  },
  cdn: {
    kind: 'cdn', name: 'CDN', short: 'CDN', azure: 'Azure Front Door', aws: 'CloudFront',
    cost: 30, capacity: 9999, queueLimit: 0, service: { default: 1 }, holds: false,
    provides: (t) => (t === 'static' ? ['static'] : []),
    blurb: 'Serves images and scripts from the edge. Wire it into your app (in front, or off a web server) and files stop touching your servers.',
  },
  queue: {
    kind: 'queue', name: 'Message queue', short: 'MQ', azure: 'Service Bus', aws: 'Amazon SQS',
    cost: 20, capacity: 9999, queueLimit: 2000, service: { default: 0 }, holds: false,
    provides: none, blurb: 'Says "got it" right away, then feeds work to workers at their pace. Writes only: a read needs its answer now.',
  },
  worker: {
    kind: 'worker', name: 'Worker', short: 'WRK', azure: 'Azure Functions', aws: 'Lambda',
    cost: 35, capacity: 8, queueLimit: 8, service: { default: 3 }, holds: true,
    provides: none, blurb: 'Pulls jobs off a queue and does the slow part. Here that means writes, never page reads.',
  },
  replica: {
    kind: 'replica', name: 'Read replica', short: 'RR', azure: 'SQL read replica', aws: 'RDS read replica',
    cost: 90, capacity: 8, queueLimit: 40, service: { default: 5 }, holds: false,
    provides: (t) => (t === 'write' || t === 'static' ? [] : ['data']),
    blurb: 'A read-only copy of the database. Takes reads off the primary.',
  },
  waf: {
    kind: 'waf', name: 'Rate limiter', short: 'WAF', azure: 'Azure WAF', aws: 'AWS WAF',
    cost: 45, capacity: 9999, queueLimit: 0, service: { default: 0 }, holds: false,
    provides: none, blurb: 'Turns away clients that ask too often. Bots, mostly.',
  },
  gateway: {
    kind: 'gateway', name: 'API gateway', short: 'API', azure: 'API Management', aws: 'API Gateway',
    cost: 50, capacity: 9999, queueLimit: 0, service: { default: 1 }, holds: false,
    provides: none, blurb: 'One front door that sends each kind of call to the right service. Only worth it with two or more different services behind it, otherwise it is billed as idle.',
  },
  payment: {
    kind: 'payment', name: 'Payments API', short: 'PAY', azure: 'Third party', aws: 'Third party',
    cost: 0, capacity: 12, queueLimit: 20, service: { default: 6 }, holds: false,
    provides: (t) => (t === 'write' ? ['pay'] : []),
    blurb: 'Someone else\'s service. You cannot scale it, only survive it.',
  },
  shardrouter: {
    kind: 'shardrouter', name: 'Shard map', short: 'SHD', azure: 'Elastic Database tools', aws: 'Aurora Limitless',
    cost: 30, capacity: 9999, queueLimit: 0, service: { default: 0 }, holds: false,
    provides: none, blurb: 'Knows which database owns which rows. Lets you have many primaries.',
  },
  dns: {
    kind: 'dns', name: 'Global router', short: 'DNS', azure: 'Azure Front Door', aws: 'Route 53',
    cost: 30, capacity: 9999, queueLimit: 0, service: { default: 0 }, holds: false,
    provides: none, blurb: 'Sends fans to a healthy region. Notices when a whole region goes dark.',
  },
  pubsub: {
    kind: 'pubsub', name: 'Event topic', short: 'PUB', azure: 'Event Grid', aws: 'Amazon SNS',
    cost: 25, capacity: 9999, queueLimit: 0, service: { default: 0 }, holds: false,
    provides: none, blurb: 'Whoever writes announces it here. Whoever cares subscribes.',
  },
  readmodel: {
    kind: 'readmodel', name: 'Read model', short: 'VIEW', azure: 'Cosmos DB', aws: 'DynamoDB',
    cost: 70, capacity: 16, queueLimit: 60, service: { default: 2 }, holds: false,
    provides: (t) => (t === 'read' || t === 'bot' ? ['data'] : []),
    blurb: 'A copy shaped for reading, kept fresh by events. Only works if it is subscribed to a topic, and every part that writes to the data publishes to it.',
  },
};

// Who may call whom. A wire not listed here cannot be drawn, and the engine
// ignores it. Fans only reach front-door parts; data stores, queues and
// workers sit behind your own code. Nothing here is a shortcut: every edge
// is one a real architecture diagram would have.
const FRONT: PartKind[] = ['waf', 'cdn', 'lb', 'gateway', 'dns', 'web'];
export const ALLOWED: Record<PartKind, PartKind[]> = {
  users: FRONT,
  dns: ['waf', 'cdn', 'lb', 'gateway', 'web'],
  waf: ['cdn', 'lb', 'gateway', 'web'],
  cdn: ['waf', 'lb', 'gateway', 'web'],
  lb: ['web', 'gateway'],
  gateway: ['lb', 'web', 'queue'],
  web: ['db', 'replica', 'cache', 'shardrouter', 'readmodel', 'queue', 'payment', 'pubsub', 'cdn'],
  queue: ['worker'],
  worker: ['db', 'replica', 'cache', 'shardrouter', 'readmodel', 'payment', 'pubsub'],
  cache: ['db', 'replica', 'shardrouter'],
  shardrouter: ['db'],
  pubsub: ['readmodel', 'queue'],
  db: [],
  replica: [],
  readmodel: [],
  payment: [],
};

// Fans know one address, queuetix.com. Whatever answers it has to do the spreading.
export const FANS_ONE_ADDRESS =
  'Fans only know one address. Wire them to a single front door, and put a load balancer, gateway or global router there to spread the traffic.';

// Parts that hand everything to one next part. Only a load balancer, a global
// router or a gateway may spread traffic, or the load balancer would be optional.
export const ONE_NEXT_HOP: PartKind[] = ['users', 'waf', 'cdn'];
export function oneHopMessage(kind: PartKind): string {
  return kind === 'users'
    ? FANS_ONE_ADDRESS
    : `A ${PARTS[kind].name.toLowerCase()} passes everything to one next part. To spread traffic over several servers, put a load balancer after it.`;
}

const list = (kinds: PartKind[]) => {
  const names = kinds.map((k) => PARTS[k].name.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
};

// Why a wire is not allowed, or null if it is fine.
export function wireProblem(from: PartKind, to: PartKind): string | null {
  if (to === 'users') return 'Nothing sends requests to the fans.';
  if (ALLOWED[from].includes(to)) return null;
  const f = PARTS[from].name, t = PARTS[to].name.toLowerCase();
  if (to === 'waf') return `A rate limiter filters traffic before it is spread, so it goes in front of the ${PARTS[from].name.toLowerCase()}, not behind it. (In the cloud you attach a WAF to a load balancer; here that means putting it in front.)`;
  if (from === 'db' && to === 'replica') return 'Replication is automatic, so there is no wire for it. Wire the replica from whatever does the reading: a web server, worker or cache.';
  if (!ALLOWED[from].length) return `${f} does not call anything. It only answers.`;
  if (from === 'users') return `Fans cannot reach the ${t} directly. They only know the public front door: ${list(FRONT)}.`;
  const callers = (Object.keys(ALLOWED) as PartKind[]).filter((k) => ALLOWED[k].includes(to));
  return `${f} cannot wire to the ${t}. ${callers.length ? `Only a ${list(callers)} can call it.` : 'Nothing calls it.'} ${f} can call: ${list(ALLOWED[from])}.`;
}

// A part the player can place (not users/payment, which levels place).
export function isPlaceable(k: PartKind) {
  return k !== 'users' && k !== 'payment';
}

// Databases owned by a shard map. Rows live where the shard map says, so only
// the shard map may call them: a cache or app wired straight to one would
// read rows that may live on another shard.
export function ownedByShardMap(nodes: { id: string; kind: PartKind }[], edges: { from: string; to: string }[]): Set<string> {
  const kind = new Map(nodes.map((n) => [n.id, n.kind]));
  return new Set(edges.filter((e) => kind.get(e.from) === 'shardrouter' && kind.get(e.to) === 'db').map((e) => e.to));
}
export const SHARD_OWNED = 'That database belongs to the shard map. Wire to the shard map instead, so each row is looked up on the shard that holds it.';

// Would adding from -> to close a loop? Requests would circle forever.
export function wouldCycle(edges: { from: string; to: string }[], from: string, to: string): boolean {
  const seen = new Set<string>([to]);
  const stack = [to];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === from) return true;
    for (const e of edges) if (e.from === id && !seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
  }
  return false;
}

export const NO_LOOPS = 'That wire would make a loop. Requests would go round in circles.';
