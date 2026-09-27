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
    blurb: 'Serves images and scripts from the edge. Passes everything else through.',
  },
  queue: {
    kind: 'queue', name: 'Message queue', short: 'MQ', azure: 'Service Bus', aws: 'Amazon SQS',
    cost: 20, capacity: 9999, queueLimit: 2000, service: { default: 0 }, holds: false,
    provides: none, blurb: 'Says "got it" right away, then feeds work to workers at their pace.',
  },
  worker: {
    kind: 'worker', name: 'Worker', short: 'WRK', azure: 'Azure Functions', aws: 'Lambda',
    cost: 35, capacity: 8, queueLimit: 8, service: { default: 3 }, holds: true,
    provides: none, blurb: 'Pulls jobs off a queue and does the slow part.',
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
    provides: none, blurb: 'One front door that sends each kind of call to the right service.',
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
    blurb: 'A copy shaped for reading, kept fresh by events. Only works if it is subscribed to a topic.',
  },
};

// A part the player can place (not users/payment, which levels place).
export function isPlaceable(k: PartKind) {
  return k !== 'users' && k !== 'payment';
}
