// One tick is 10 ms of simulated time. The renderer plays 20 ticks per real
// second at x1, so the sim runs in slow motion and you can watch dots move.
export const TICK_MS = 10;
export const TICKS_PER_SECOND_REAL = 20;
export const HOP_TICKS = 4;

export type ReqType = 'read' | 'write' | 'static' | 'bot';
export const REQ_TYPES: ReqType[] = ['read', 'write', 'static', 'bot'];

// What a request must collect before it is answered.
export type Need = 'data' | 'write' | 'static' | 'pay';

export type PartKind =
  | 'users'
  | 'web'
  | 'db'
  | 'lb'
  | 'cache'
  | 'cdn'
  | 'queue'
  | 'worker'
  | 'replica'
  | 'waf'
  | 'gateway'
  | 'payment'
  | 'shardrouter'
  | 'dns'
  | 'pubsub'
  | 'readmodel';

export type Health = 'up' | 'down' | 'slow';

// Per-node switches the player can flip once unlocked.
export interface NodeOpts {
  healthCheck?: boolean; // lb: skip nodes that are down
  retry?: boolean; // holder: retry failed downstream calls with backoff
  breaker?: boolean; // holder: stop calling a failing downstream for a while
  bulkhead?: boolean; // holder: writes may use at most half the slots
  saga?: boolean; // holder: undo finished steps when a later step fails
}

export interface NodeSpec {
  id: string;
  kind: PartKind;
  x: number;
  y: number;
  fixed?: boolean; // placed by the level, cannot move or delete
  label?: string;
  opts?: NodeOpts;
}

export interface EdgeSpec {
  from: string;
  to: string;
}

export interface Design {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
}

export interface TrafficPoint {
  at: number; // seconds of real play time at x1
  rps: number; // requests per simulated second
  mix?: Partial<Record<ReqType, number>>;
}

export type Region = 'north' | 'south';
// Width of the global strip on the left of a two-region board: fans and the global router live here.
export const GLOBAL_STRIP = 288;

export type ChaosKind = 'down' | 'slow' | 'hang' | 'recover' | 'flaky';

export interface ChaosEvent {
  at: number; // seconds
  kind: ChaosKind;
  // Either a fixed node id, or a selector over the player's parts.
  target: string | { kind: PartKind; pick: 'first' | 'busiest' } | { region: Region | 'busiest' }; // 'busiest': the region holding most of the player's traffic
  note?: string; // shown on the forecast strip
}

export interface Level {
  id: string;
  act: number;
  title: string;
  clock: [string, string]; // flavor clock shown at start and end of run
  intro: string[];
  goal: string;
  duration: number; // seconds at x1
  seed: number;
  traffic: TrafficPoint[];
  chaos: ChaosEvent[];
  fixed: NodeSpec[];
  fixedEdges?: EdgeSpec[];
  kit?: Partial<Record<PartKind, number>>; // max count of each part, if limited
  catalog: PartKind[]; // parts shown in the tray
  options?: (keyof NodeOpts)[]; // switches unlocked in this level
  maxCost?: number; // $/month cap, if limited
  parCost: number; // 3rd star
  slo: { p99: number; success: number }; // ms, fraction
  errorBudget: number; // failed user requests allowed before you get paged out
  needs?: Partial<Record<ReqType, Need[]>>; // override default needs per type
  cacheHit?: number; // share of reads the cache can answer, default 0.85
  regions?: boolean; // board is split into two regions (north above, south below)
  sagaRule?: boolean; // a request that fails halfway costs 3x unless a saga undoes it
  unlocks?: string[]; // pattern card ids shown after first win
  reference: Design; // a design the harness proves can win
  naive?: Design; // a design the harness proves should lose
  postmortem: {
    win: string[];
    lose: string[];
    hint: string; // the pattern that would have helped
  };
}

export interface Hop {
  from: string;
  to: string;
  start: number;
  end: number;
}

export interface Req {
  id: number;
  type: ReqType;
  born: number;
  deadline: number;
  needs: Need[];
  stack: string[]; // nodes holding a slot for this request, innermost last
  at: string | null; // node it is at (queued or in service)
  hop: Hop | null; // in flight
  serviceEnd: number; // tick service finishes, -1 if queued
  async: boolean; // background job, latency not counted against the user
  attempts: number;
  retryAt: number; // -1, or tick when holder retries
  lastTried: string | null;
  origNeeds: number;
}

export type Outcome = 'ok' | 'dropped' | 'timeout' | 'blocked' | 'botok';

// Why a request failed. Recorded with the node where it happened.
export type FailReason =
  | 'no-route' // reached a part with nothing downstream that can do the next step
  | 'overflow' // slots and queue were both full
  | 'node-down' // sent to a part that was down
  | 'flaky' // the call failed at random (a flaky dependency)
  | 'breaker' // a circuit breaker was open and there was nowhere else to go
  | 'timeout' // the fan gave up waiting
  | 'async-expired' // a queued order was never processed in time
  | 'lost-in-crash' // was inside a part when it went down
  | 'hotfix'; // was on a part removed by a mid-run hotfix

export interface NodeState {
  spec: NodeSpec;
  health: Health;
  slowFactor: number;
  flaky: number; // chance a call to this node fails outright
  queue: Req[];
  inService: number;
  held: number; // slots held while waiting on downstream calls
  svcWrites: number; // writes in service (for the bulkhead)
  writesHeld: number; // slots held by writes waiting downstream
  incoming: number; // jobs a queue has sent that have not arrived yet
  rr: number;
  // breaker per downstream id
  brk: Record<string, { fails: number; calls: number; openUntil: number }>;
  served: number;
  failed: number;
}

export interface Snapshot {
  t: number;
  util: Record<string, number>; // 0..1+
  queue: Record<string, number>;
  health: Record<string, Health>;
  budget: number;
  rps: number;
}

export interface RunStats {
  ok: number;
  failed: number;
  dropped: number;
  timeout: number;
  blocked: number;
  botok: number;
  asyncLost: number;
  latencies: number[]; // ms, successful user requests
  strikes: number;
  halfDone: number; // failed after some steps succeeded, with nothing to undo them
  botLost: number; // bots that failed somewhere other than the rate limiter (not blocked, not served)
  why: Record<string, number>; // "reason@node" or "no-route(need)@node" -> count, user requests only
  byType: Record<ReqType, { ok: number; failed: number }>;
}
