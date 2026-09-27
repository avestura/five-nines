// Pattern cards. Shown when a part or switch unlocks, and in the inspector.
const AZ = 'https://learn.microsoft.com/en-us/azure/architecture/patterns/';
const AWS = 'https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/';

export interface Card {
  id: string;
  title: string;
  pattern: string;
  what: string;
  when: string;
  cost: string; // the trade-off, always honest
  links: { label: string; href: string }[];
}

export const CARDS: Record<string, Card> = {
  web: {
    id: 'web', title: 'Web server', pattern: 'Stateless compute',
    what: 'Runs your app code. While it waits on a database, it keeps a slot busy for that request.',
    when: 'Always. Keep it stateless so you can run many copies.',
    cost: 'Each copy costs money even at 3am when nobody is buying tickets.',
    links: [{ label: 'Azure: web app baseline', href: 'https://learn.microsoft.com/en-us/azure/architecture/web-apps/app-service/architectures/baseline-zone-redundant' }],
  },
  db: {
    id: 'db', title: 'Database', pattern: 'System of record',
    what: 'Holds the truth: seats, orders, fans. Every write lands here.',
    when: 'Whenever the answer has to be right and has to survive a restart.',
    cost: 'Hard to scale out. There is one primary, and it is usually your bottleneck.',
    links: [{ label: 'Azure: data store models', href: 'https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/data-store-overview' }],
  },
  lb: {
    id: 'lb', title: 'Load balancer', pattern: 'Horizontal scaling',
    what: 'One address in front, many servers behind. It takes turns sending each request to the next server.',
    when: 'The moment one server is not enough, or you want to survive one dying.',
    cost: 'Only helps if the servers behind it are stateless. And the database is still just one.',
    links: [
      { label: 'Azure: load balancing options', href: 'https://learn.microsoft.com/en-us/azure/architecture/guide/technology-choices/load-balancing-overview' },
      { label: 'AWS: Elastic Load Balancing', href: 'https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html' },
    ],
  },
  cache: {
    id: 'cache', title: 'Cache', pattern: 'Cache-Aside',
    what: 'Keeps copies of popular answers in memory. Hits come back fast, misses fall through to the database.',
    when: 'Many people read the same thing, and it is fine if it is a few seconds old.',
    cost: 'Stale data. When the setlist changes, someone will see the old one for a moment.',
    links: [{ label: 'Azure: Cache-Aside', href: AZ + 'cache-aside' }],
  },
  cdn: {
    id: 'cdn', title: 'CDN', pattern: 'Static Content Hosting',
    what: 'Serves images, scripts and posters from servers close to the fan. Everything else passes through.',
    when: 'Big files that are the same for everybody.',
    cost: 'Changing a file means waiting for, or forcing, the edge to forget the old one.',
    links: [{ label: 'Azure: Static Content Hosting', href: AZ + 'static-content-hosting' }],
  },
  healthCheck: {
    id: 'healthCheck', title: 'Health checks', pattern: 'Health Endpoint Monitoring',
    what: 'The load balancer pings each server. Dead ones stop getting traffic until they come back.',
    when: 'Always. Servers die. Plan to lose one and still have enough.',
    cost: 'A spare server you pay for and hope not to need.',
    links: [{ label: 'Azure: Health Endpoint Monitoring', href: AZ + 'health-endpoint-monitoring' }],
  },
  queue: {
    id: 'queue', title: 'Message queue + workers', pattern: 'Queue-Based Load Leveling',
    what: 'The queue says "order received" right away. Workers take jobs off it at the speed the database can handle.',
    when: 'Bursts of work that do not need to finish before the fan sees a reply.',
    cost: 'The fan gets "we are processing your order", not "done". And now you have to think about jobs that fail later.',
    links: [
      { label: 'Azure: Queue-Based Load Leveling', href: AZ + 'queue-based-load-leveling' },
      { label: 'Azure: Competing Consumers', href: AZ + 'competing-consumers' },
    ],
  },
  replica: {
    id: 'replica', title: 'Read replica', pattern: 'Read scale-out',
    what: 'A read-only copy of the database. Reads go there, writes still go to the primary.',
    when: 'Reads vastly outnumber writes and the cache cannot catch them all.',
    cost: 'Replication lag. A fan might buy a seat and not see it for a second.',
    links: [{ label: 'Azure: CQRS (the read side)', href: AZ + 'cqrs' }],
  },
  waf: {
    id: 'waf', title: 'Rate limiter', pattern: 'Rate Limiting + Gatekeeper',
    what: 'Sits at the front and turns away clients asking far too often. Most of those are scalper bots.',
    when: 'Someone has written a script against you. For tickets, always.',
    cost: 'Tune it too tight and real fans get a "slow down" page.',
    links: [
      { label: 'Azure: Rate Limiting', href: AZ + 'rate-limiting-pattern' },
      { label: 'Azure: Gatekeeper', href: AZ + 'gatekeeper' },
    ],
  },
  retry: {
    id: 'retry', title: 'Retry with backoff', pattern: 'Retry',
    what: 'When a call fails, wait a little and try again. Wait longer each time.',
    when: 'Failures that are brief and random: a flaky network, a busy dependency.',
    cost: 'Retries add load. Against something that is truly down, they make it worse.',
    links: [
      { label: 'Azure: Retry', href: AZ + 'retry' },
      { label: 'AWS: Retry with backoff', href: AWS + 'retry-backoff.html' },
    ],
  },
  gateway: {
    id: 'gateway', title: 'API gateway', pattern: 'Gateway Routing',
    what: 'One front door. It looks at each call and sends it to the service that owns it.',
    when: 'You have more than one backend and do not want fans to know that.',
    cost: 'One more hop, and one more thing that has to stay up.',
    links: [
      { label: 'Azure: Gateway Routing', href: AZ + 'gateway-routing' },
      { label: 'AWS: API routing', href: AWS + 'api-routing.html' },
    ],
  },
  breaker: {
    id: 'breaker', title: 'Circuit breaker', pattern: 'Circuit Breaker',
    what: 'If most calls to a dependency are failing, stop calling it for a while and fail fast instead.',
    when: 'A dependency is slow or down, and waiting on it is using up your own capacity.',
    cost: 'Some requests fail on purpose. You trade a few errors for staying alive.',
    links: [
      { label: 'Azure: Circuit Breaker', href: AZ + 'circuit-breaker' },
      { label: 'AWS: Circuit breaker', href: AWS + 'circuit-breaker.html' },
    ],
  },
  bulkhead: {
    id: 'bulkhead', title: 'Bulkhead', pattern: 'Bulkhead',
    what: 'Split a server\'s slots into compartments. Checkout can only use half, so browsing always has room.',
    when: 'One kind of work can get slow and you cannot let it starve the rest.',
    cost: 'Capacity sits idle in one compartment while the other is full.',
    links: [{ label: 'Azure: Bulkhead', href: AZ + 'bulkhead' }],
  },
  shardrouter: {
    id: 'shardrouter', title: 'Sharding', pattern: 'Sharding',
    what: 'Split the data by key across several databases. A shard map knows where each row lives.',
    when: 'Writes are too much for one primary, and they will keep growing.',
    cost: 'Queries that cross shards get hard. Picking the shard key is a decision you live with.',
    links: [{ label: 'Azure: Sharding', href: AZ + 'sharding' }],
  },
  dns: {
    id: 'dns', title: 'Global router', pattern: 'Geode / Deployment Stamps',
    what: 'Run a full copy of the stack in two regions. A global router sends fans to whichever region is healthy.',
    when: 'Losing one region would lose the business. For a ticket seller on a big on-sale day, that is today.',
    cost: 'You pay for two of everything, and keeping two databases in agreement is its own career.',
    links: [
      { label: 'Azure: Geode', href: AZ + 'geodes' },
      { label: 'Azure: Deployment Stamps', href: AZ + 'deployment-stamp' },
    ],
  },
  readmodel: {
    id: 'readmodel', title: 'Read model + event topic', pattern: 'CQRS + Publisher-Subscriber',
    what: 'Writes go to the database and announce themselves on a topic. A read model subscribes and keeps a copy shaped exactly for the seat map.',
    when: 'Reads and writes want very different shapes, and reads outnumber writes a hundred to one.',
    cost: 'Two models to keep in sync, and the read side is always slightly behind.',
    links: [
      { label: 'Azure: CQRS', href: AZ + 'cqrs' },
      { label: 'Azure: Publisher-Subscriber', href: AZ + 'publisher-subscriber' },
      { label: 'AWS: Publish-subscribe', href: AWS + 'publish-subscribe.html' },
    ],
  },
  saga: {
    id: 'saga', title: 'Saga', pattern: 'Saga + Compensating Transaction',
    what: 'An order is several steps across services. If a later step fails, run the undo for every step that already worked.',
    when: 'A business action spans services that cannot share one database transaction.',
    cost: 'Every step needs an undo, and someone has to write it. Refunds are not free either.',
    links: [
      { label: 'Azure: Saga', href: AZ + 'saga' },
      { label: 'Azure: Compensating Transaction', href: AZ + 'compensating-transaction' },
      { label: 'AWS: Saga patterns', href: AWS + 'saga-patterns.html' },
    ],
  },
};
