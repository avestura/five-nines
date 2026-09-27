import { PARTS, wireProblem } from './parts';
import { makeRng, poisson, type Rng } from './rng';
import {
  HOP_TICKS, TICKS_PER_SECOND_REAL, TICK_MS, REQ_TYPES,
  type Design, type Level, type Need, type NodeState, type Outcome, type Req,
  type ReqType, type RunStats, type Snapshot, type NodeSpec, type ChaosEvent,
} from './types';

const DEFAULT_NEEDS: Record<ReqType, Need[]> = {
  read: ['data'],
  write: ['write'],
  static: ['static'],
  bot: ['data'],
};

const USER_DEADLINE = 300; // 3 s
const ASYNC_DEADLINE = 400; // 4 s of sim time: an order should be processed within about 20 real seconds
const SLOW_FACTOR = 8;
const HANG_FACTOR = 60;
const CALL_TIMEOUT = 100; // 1 s: a breaker gives up on a call this slow
const STRIKE_COST = 0.05; // share of the starting error budget per mid-run patch

export type SimState = 'ready' | 'running' | 'paged' | 'done';

export interface SimEvent {
  t: number;
  kind: 'chaos' | 'paged' | 'breaker' | 'strike';
  text: string;
  node?: string;
}

interface LiveReq extends Req {
  returning: boolean;
  dispatchedTo: string | null; // worker a queue already promised this job to
  dead: boolean;
  calls: [string, string, number][]; // holder, downstream, tick the call started
  writeSlot: boolean;
}

export class Sim {
  readonly level: Level;
  readonly rng: Rng;
  t = 0;
  endTick: number;
  state: SimState = 'ready';
  budget: number;
  readonly budgetStart: number;
  nodes = new Map<string, NodeState>();
  out = new Map<string, string[]>();
  reach = new Map<string, Set<Need>>();
  subscribed = new Set<string>(); // read models fed by an event topic
  live = new Map<number, LiveReq>();
  stats: RunStats = {
    ok: 0, failed: 0, dropped: 0, timeout: 0, blocked: 0, botok: 0, asyncLost: 0,
    latencies: [], strikes: 0, halfDone: 0,
  };
  snapshots: Snapshot[] = [];
  events: SimEvent[] = [];
  // Recent completions, for the renderer's little pops.
  pops: { t: number; node: string; outcome: Outcome }[] = [];
  private nextId = 1;
  private chaosDone = new Set<ChaosEvent>();
  private arrivalsThisSecond = 0;
  private lastRps = 0;

  constructor(level: Level, design: Design) {
    this.level = level;
    this.rng = makeRng(level.seed);
    this.endTick = level.duration * TICKS_PER_SECOND_REAL;
    this.budget = this.budgetStart = level.errorBudget;
    this.load(design);
  }

  // ---------- graph ----------

  private load(design: Design) {
    const keep = new Map(this.nodes);
    this.nodes.clear();
    for (const spec of design.nodes) {
      const prev = keep.get(spec.id);
      if (prev) {
        prev.spec = spec;
        this.nodes.set(spec.id, prev);
      } else {
        this.nodes.set(spec.id, {
          spec, health: 'up', slowFactor: SLOW_FACTOR, flaky: 0, queue: [], inService: 0, held: 0, svcWrites: 0, writesHeld: 0, incoming: 0,
          rr: 0, brk: {}, served: 0, failed: 0,
        });
      }
    }
    this.out.clear();
    for (const id of this.nodes.keys()) this.out.set(id, []);
    for (const e of design.edges) {
      const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
      // Wires the editor would refuse (old saves, hand-made links) do nothing.
      if (a && b && e.from !== e.to && !wireProblem(a.spec.kind, b.spec.kind)) {
        const list = this.out.get(e.from)!;
        if (!list.includes(e.to)) list.push(e.to);
      }
    }
    this.computeReach();
  }

  private canProvide(n: NodeSpec): Set<Need> {
    const s = new Set<Need>();
    if (n.kind === 'readmodel' && !this.subscribed.has(n.id)) return s;
    for (const t of REQ_TYPES) for (const need of PARTS[n.kind].provides(t, 0)) s.add(need);
    return s;
  }

  // reach[n] = every need that n or something downstream of n can satisfy.
  private computeReach() {
    this.reach.clear();
    // A read model is only useful if a topic feeds it, and something
    // publishes to that topic.
    this.subscribed.clear();
    const into = (id: string) => [...this.out.entries()].filter(([, outs]) => outs.includes(id)).map(([from]) => from);
    for (const [id, n] of this.nodes) {
      if (n.spec.kind !== 'readmodel') continue;
      const fed = into(id).some((t) => this.nodes.get(t)?.spec.kind === 'pubsub' && into(t).some((p) => this.nodes.get(p)?.spec.kind !== 'users'));
      if (fed) this.subscribed.add(id);
    }
    const visit = (id: string, stack: Set<string>): Set<Need> => {
      const cached = this.reach.get(id);
      if (cached) return cached;
      const node = this.nodes.get(id)!;
      const s = this.canProvide(node.spec);
      if (stack.has(id)) return s;
      stack.add(id);
      for (const to of this.out.get(id) ?? []) for (const need of visit(to, stack)) s.add(need);
      stack.delete(id);
      // A queue only takes work that can be done later.
      if (node.spec.kind === 'queue') for (const n of [...s]) if (n !== 'write' && n !== 'pay') s.delete(n);
      this.reach.set(id, s);
      return s;
    };
    for (const id of this.nodes.keys()) visit(id, new Set());
  }

  // Swap in an edited design mid-run. Costs a pager strike.
  patch(design: Design) {
    const removed = [...this.nodes.keys()].filter((id) => !design.nodes.some((n) => n.id === id));
    this.load(design);
    for (const r of [...this.live.values()]) {
      const touches =
        (r.at && removed.includes(r.at)) ||
        (r.hop && (removed.includes(r.hop.to) || removed.includes(r.hop.from))) ||
        r.stack.some((s) => removed.includes(s));
      if (touches) {
        r.stack = r.stack.filter((s) => !removed.includes(s));
        if (r.at && removed.includes(r.at)) r.serviceEnd = -1;
        this.finish(r, 'dropped');
      }
    }
    if (this.state === 'running' || this.t > 0) {
      this.stats.strikes++;
      this.budget -= Math.ceil(this.budgetStart * STRIKE_COST);
      this.events.push({ t: this.t, kind: 'strike', text: `Hotfix deployed during the incident (pager strike ${this.stats.strikes})` });
      this.checkPaged();
    }
  }

  // ---------- traffic ----------

  rpsAt(sec: number): number {
    const pts = this.level.traffic;
    if (sec <= pts[0].at) return pts[0].rps;
    for (let i = 1; i < pts.length; i++) {
      if (sec <= pts[i].at) {
        const a = pts[i - 1], b = pts[i];
        const f = (sec - a.at) / Math.max(1e-6, b.at - a.at);
        return a.rps + (b.rps - a.rps) * f;
      }
    }
    return pts[pts.length - 1].rps;
  }

  mixAt(sec: number): Record<ReqType, number> {
    let mix = this.level.traffic[0].mix ?? { read: 1 };
    for (const p of this.level.traffic) if (p.at <= sec && p.mix) mix = p.mix;
    const m = { read: 0, write: 0, static: 0, bot: 0, ...mix };
    const sum = REQ_TYPES.reduce((s, k) => s + m[k], 0) || 1;
    for (const k of REQ_TYPES) m[k] /= sum;
    return m;
  }

  // ---------- main loop ----------

  step() {
    if (this.state === 'paged' || this.state === 'done') return;
    this.state = 'running';
    const t = this.t;
    const sec = t / TICKS_PER_SECOND_REAL;

    this.runChaos(sec);
    this.spawn(sec);

    for (const r of [...this.live.values()]) {
      if (r.dead) continue;
      if (r.hop && r.hop.end <= t) {
        const to = r.hop.to;
        r.hop = null;
        this.arrive(r, to);
      }
    }
    for (const r of [...this.live.values()]) {
      if (r.dead || !r.at || r.serviceEnd < 0 || r.serviceEnd > t) continue;
      const node = this.nodes.get(r.at);
      r.serviceEnd = -1;
      if (!node) continue;
      node.inService--;
      if (r.writeSlot) { node.svcWrites--; r.writeSlot = false; }
      this.afterService(r, node);
    }
    for (const node of this.nodes.values()) this.startService(node);
    for (const node of this.nodes.values()) if (node.spec.kind === 'queue') this.dispatchQueue(node);
    for (const r of [...this.live.values()]) {
      if (!r.dead && r.retryAt >= 0 && r.retryAt <= t) {
        r.retryAt = -1;
        const holder = this.nodes.get(r.stack[r.stack.length - 1]);
        if (holder) this.route(r, holder);
        else this.finish(r, 'dropped');
      }
    }
    for (const r of [...this.live.values()]) {
      if (r.dead) continue;
      if (t > r.deadline) { this.timeout(r); continue; }
      // With a breaker, the caller also stops waiting on any single call
      // after CALL_TIMEOUT. That is what lets the breaker see a hang.
      const last = r.calls[r.calls.length - 1];
      if (last && r.retryAt < 0 && t - last[2] > CALL_TIMEOUT && r.stack[r.stack.length - 1] === last[0] && r.at !== last[0]) {
        if (this.nodes.get(last[0])?.spec.opts?.breaker) this.timeout(r);
      }
    }
    this.decayBreakers();

    if (t % 10 === 0) this.snapshot(sec);
    this.pops = this.pops.filter((p) => t - p.t < 8);
    this.t++;
    if (this.t >= this.endTick && this.state === 'running') this.state = 'done';
  }

  private runChaos(sec: number) {
    for (const ev of this.level.chaos) {
      if (this.chaosDone.has(ev) || ev.at > sec) continue;
      this.chaosDone.add(ev);
      const targets = this.resolveTarget(ev);
      for (const node of targets) this.applyChaos(ev, node);
      if (targets.length) this.events.push({ t: this.t, kind: 'chaos', text: ev.note ?? `${PARTS[targets[0].spec.kind].name} ${ev.kind}`, node: targets[0].spec.id });
    }
  }

  // Sandbox: break something on purpose.
  inject(kind: ChaosEvent['kind'], id: string) {
    const node = this.nodes.get(id);
    if (!node) return;
    const ev: ChaosEvent = { at: 0, kind, target: id };
    this.applyChaos(ev, node);
    this.events.push({ t: this.t, kind: 'chaos', text: `You made ${node.spec.label ?? node.spec.id} ${kind === 'recover' ? 'recover' : kind}`, node: id });
  }

  private applyChaos(ev: ChaosEvent, node: NodeState) {
    {
      if (ev.kind === 'down') {
        node.health = 'down';
        // Everything inside it is lost.
        for (const r of [...this.live.values()]) if (r.at === node.spec.id && !r.hop) this.finish(r, 'dropped');
        node.queue = [];
        node.inService = 0;
      } else if (ev.kind === 'slow' || ev.kind === 'hang') {
        node.health = 'slow';
        node.slowFactor = ev.kind === 'hang' ? HANG_FACTOR : SLOW_FACTOR;
      }
      else if (ev.kind === 'flaky') node.flaky = 0.35;
      else { node.health = 'up'; node.flaky = 0; }
    }
  }

  private resolveTarget(ev: ChaosEvent): NodeState[] {
    const tg = ev.target;
    if (typeof tg === 'string') {
      const n = this.nodes.get(tg);
      return n ? [n] : [];
    }
    if ('region' in tg) return [...this.nodes.values()].filter((n) => regionOf(n.spec) === tg.region);
    const list = [...this.nodes.values()].filter((n) => n.spec.kind === tg.kind && !n.spec.fixed);
    if (!list.length) return [];
    if (tg.pick === 'first') return [list[0]];
    return [list.reduce((a, b) => (b.served > a.served ? b : a))];
  }

  private spawn(sec: number) {
    const rps = this.rpsAt(sec);
    this.lastRps = rps;
    const n = poisson(this.rng, (rps * TICK_MS) / 1000);
    if (!n) return;
    const mix = this.mixAt(sec);
    const sources = [...this.nodes.values()].filter((x) => x.spec.kind === 'users');
    if (!sources.length) return;
    for (let i = 0; i < n; i++) {
      let roll = this.rng();
      let type: ReqType = 'read';
      for (const k of REQ_TYPES) {
        if (roll < mix[k]) { type = k; break; }
        roll -= mix[k];
      }
      const src = sources[i % sources.length];
      const r: LiveReq = {
        id: this.nextId++, type, born: this.t, deadline: this.t + USER_DEADLINE,
        needs: [...(this.level.needs?.[type] ?? DEFAULT_NEEDS[type])],
        stack: [], at: src.spec.id, hop: null, serviceEnd: -1, async: false,
        attempts: 0, retryAt: -1, lastTried: null, origNeeds: 0,
        returning: false, dead: false, calls: [], writeSlot: false, dispatchedTo: null,
      };
      r.origNeeds = r.needs.length;
      this.live.set(r.id, r);
      this.arrivalsThisSecond++;
      this.route(r, src);
    }
  }

  private arrive(r: LiveReq, id: string) {
    const node = this.nodes.get(id);
    if (r.dispatchedTo === id) {
      if (node) node.incoming--;
      r.dispatchedTo = null;
    }
    if (!node) return this.finish(r, 'dropped');
    r.at = id;
    if (r.returning) {
      r.returning = false;
      return this.route(r, node);
    }
    if (node.health === 'down') return this.finish(r, 'dropped');
    if (node.flaky > 0 && this.rng() < node.flaky) return this.finish(r, 'dropped');
    const def = PARTS[node.spec.kind];
    if (def.service.default === 0 && def.capacity >= 9999) {
      node.served++;
      return this.afterService(r, node);
    }
    if (node.queue.length >= def.queueLimit && this.busy(node) >= def.capacity) {
      return this.finish(r, 'dropped');
    }
    node.queue.push(r);
  }

  private busy(n: NodeState) {
    return n.inService + n.held;
  }

  private startService(node: NodeState) {
    const def = PARTS[node.spec.kind];
    // A queue's backlog is handed out by dispatchQueue, never serviced here.
    if (node.health === 'down' || !node.queue.length || node.spec.kind === 'queue') return;
    const bulk = !!node.spec.opts?.bulkhead;
    const writeCap = Math.floor(def.capacity / 2);
    for (let i = 0; i < node.queue.length && this.busy(node) < def.capacity; ) {
      const r = node.queue[i] as LiveReq;
      if (r.dead) { node.queue.splice(i, 1); continue; }
      const isWrite = r.type === 'write';
      if (bulk && isWrite && node.svcWrites + node.writesHeld >= writeCap) { i++; continue; }
      node.queue.splice(i, 1);
      const base = def.service[r.type] ?? def.service.default;
      const mult = node.health === 'slow' ? node.slowFactor : 1;
      r.serviceEnd = this.t + Math.max(1, Math.round(base * mult));
      node.inService++;
      if (bulk && isWrite) { node.svcWrites++; r.writeSlot = true; }
      node.served++;
    }
  }

  private afterService(r: LiveReq, node: NodeState) {
    const def = PARTS[node.spec.kind];
    if (node.spec.kind === 'waf' && r.type === 'bot' && this.rng() < 0.95) {
      return this.finish(r, 'blocked');
    }
    const roll = this.rng();
    const got = node.spec.kind === 'cache'
      ? (r.type === 'read' || r.type === 'bot') && roll < (this.level.cacheHit ?? 0.85) ? ['data' as Need] : []
      : node.spec.kind === 'readmodel' && !this.subscribed.has(node.spec.id)
        ? []
        : def.provides(r.type, roll);
    if (got.length) r.needs = r.needs.filter((n) => !got.includes(n));
    if (!r.needs.length) return this.finish(r, r.type === 'bot' ? 'botok' : 'ok');
    this.route(r, node);
  }

  private candidates(r: LiveReq, node: NodeState): string[] {
    const outs = this.out.get(node.spec.id) ?? [];
    const hc = node.spec.kind === 'dns' || ((node.spec.kind === 'lb' || node.spec.kind === 'gateway') && !!node.spec.opts?.healthCheck);
    const brk = !!node.spec.opts?.breaker;
    // A load balancer is dumb on purpose: it spreads everything across
    // everything behind it. Sending each call to the right place is the
    // gateway's job.
    const dumb = node.spec.kind === 'lb' || node.spec.kind === 'users' || node.spec.kind === 'dns';
    let c = outs.filter((id) => {
      const reach = this.reach.get(id);
      if (!reach || !reach.size) return false;
      if (!dumb && !r.needs.some((n) => reach.has(n))) return false;
      const target = this.nodes.get(id)!;
      if (hc && target.health === 'down') return false;
      if (brk && (node.brk[id]?.openUntil ?? -1) > this.t) return false;
      if (r.stack.includes(id)) return false;
      return true;
    });
    // Steps happen in order: charge the card, then save the ticket.
    const next = r.needs[0];
    const direct = c.filter((id) => this.reach.get(id)!.has(next));
    if (!dumb && direct.length) c = direct;
    // The app sends writes to a queue when it has one.
    if (!r.async && r.needs.includes('write')) {
      const qs = c.filter((id) => this.nodes.get(id)!.spec.kind === 'queue');
      if (qs.length) c = qs;
    }
    // Only a shard map knows how to split writes across several primaries.
    if (r.needs.includes('write') && node.spec.kind !== 'shardrouter') {
      const dbs = c.filter((id) => this.nodes.get(id)!.spec.kind === 'db');
      if (dbs.length > 1) c = c.filter((id) => !dbs.includes(id) || id === dbs[0]);
    }
    return c;
  }

  private route(r: LiveReq, node: NodeState) {
    if (node.spec.kind === 'queue' && !r.async) return this.enqueueJob(r, node);
    const c = this.candidates(r, node);
    const id = node.spec.id;
    if (!c.length) {
      const top = r.stack[r.stack.length - 1];
      if (top && top !== id) return this.sendBack(r, id, top);
      // Breaker open and nowhere else to go: fail fast.
      return this.finish(r, 'dropped');
    }
    const pick = c[node.rr++ % c.length];
    if (PARTS[node.spec.kind].holds && r.stack[r.stack.length - 1] !== id) {
      r.stack.push(id);
      node.held++;
      if (r.type === 'write') node.writesHeld++;
    }
    if (PARTS[node.spec.kind].holds) r.calls.push([id, pick, this.t]);
    r.lastTried = pick;
    this.hop(r, id, pick);
  }

  private sendBack(r: LiveReq, from: string, to: string) {
    r.returning = true;
    this.hop(r, from, to);
  }

  private hop(r: LiveReq, from: string, to: string) {
    r.at = null;
    r.hop = { from, to, start: this.t, end: this.t + HOP_TICKS };
  }

  // Queue-based load leveling: answer the fan now, do the work later.
  private enqueueJob(r: LiveReq, q: NodeState) {
    const limit = PARTS.queue.queueLimit;
    if (q.queue.length >= limit) return this.finish(r, 'dropped');
    const job: LiveReq = {
      ...r, id: this.nextId++, async: true, stack: [], calls: [], deadline: this.t + ASYNC_DEADLINE,
      at: q.spec.id, hop: null, serviceEnd: -1, returning: false, dead: false, writeSlot: false, dispatchedTo: null,
    };
    this.live.set(job.id, job);
    q.queue.push(job);
    q.served++;
    this.finish(r, 'ok');
  }

  private dispatchQueue(q: NodeState) {
    // Workers pull only as much as they have free slots for, counting jobs
    // already on the way. That is the whole point of a queue.
    const free = (n: NodeState) => PARTS[n.spec.kind].capacity - this.busy(n) - n.queue.length - n.incoming;
    const outs = (this.out.get(q.spec.id) ?? []).filter((id) => {
      const n = this.nodes.get(id)!;
      return n.health !== 'down' && free(n) > 0;
    });
    while (q.queue.length && outs.length) {
      const r = q.queue.shift() as LiveReq;
      if (r.dead) continue;
      const to = outs[q.rr++ % outs.length];
      const n = this.nodes.get(to)!;
      r.dispatchedTo = to;
      n.incoming++;
      this.hop(r, q.spec.id, to);
      if (free(n) <= 0) outs.splice(outs.indexOf(to), 1);
    }
  }

  private timeout(r: LiveReq) {
    if (r.at && r.serviceEnd >= 0) {
      const n = this.nodes.get(r.at);
      if (n) {
        n.inService--;
        if (r.writeSlot) { n.svcWrites--; r.writeSlot = false; }
      }
    }
    r.serviceEnd = -1;
    this.finish(r, 'timeout', true);
  }

  private finish(r: LiveReq, outcome: Outcome, noRetry = false) {
    if (r.dead) return;
    const failed = outcome === 'dropped' || outcome === 'timeout';

    if (failed) {
      const last = r.calls[r.calls.length - 1];
      if (last) this.breakerRecord(last[0], last[1], true);
      const holderId = r.stack[r.stack.length - 1];
      const holder = holderId ? this.nodes.get(holderId) : undefined;
      if (!noRetry && holder?.spec.opts?.retry && r.attempts < 2 && holder.health !== 'down') {
        r.attempts++;
        r.retryAt = this.t + 4 * 2 ** r.attempts; // exponential backoff
        r.at = holderId;
        r.hop = null;
        return;
      }
    } else {
      for (const [h, d] of r.calls) this.breakerRecord(h, d, false);
    }

    // Half an order: charged but no ticket, or the other way round. Unless
    // a saga undoes the finished steps, that is a support ticket and a refund.
    let penalty = 0;
    if (failed && this.level.sagaRule && !r.async && r.type !== 'bot' && r.needs.length < r.origNeeds) {
      const saga = r.calls.some(([h]) => this.nodes.get(h)?.spec.opts?.saga);
      if (!saga) {
        this.stats.halfDone++;
        penalty = 2;
      }
    }

    r.dead = true;
    this.live.delete(r.id);
    if (r.at && r.serviceEnd >= 0) {
      const n = this.nodes.get(r.at);
      if (n) n.inService--;
    }
    for (const id of r.stack) {
      const n = this.nodes.get(id);
      if (!n) continue;
      n.held = Math.max(0, n.held - 1);
      if (r.type === 'write') n.writesHeld = Math.max(0, n.writesHeld - 1);
    }
    r.stack = [];
    const where = r.at ?? r.hop?.to ?? '';
    this.pops.push({ t: this.t, node: where, outcome });

    const s = this.stats;
    if (outcome === 'ok') {
      if (!r.async) {
        s.ok++;
        s.latencies.push((this.t - r.born) * TICK_MS);
      }
    } else if (outcome === 'blocked') s.blocked++;
    else if (outcome === 'botok') s.botok++;
    else if (r.type === 'bot') {
      s.blocked++; // a bot that fell over is a bot that went away
    } else {
      s.failed++;
      if (outcome === 'dropped') s.dropped++;
      else s.timeout++;
      if (r.async) s.asyncLost++;
      const n = this.nodes.get(where);
      if (n) n.failed++;
      this.budget -= 1 + penalty;
      this.checkPaged();
    }
  }

  private checkPaged() {
    if (this.budget <= 0 && this.state !== 'paged') {
      this.budget = 0;
      this.state = 'paged';
      this.events.push({ t: this.t, kind: 'paged', text: 'Error budget exhausted. You have been paged.' });
    }
  }

  private breakerRecord(holder: string, down: string, fail: boolean) {
    const h = this.nodes.get(holder);
    if (!h?.spec.opts?.breaker) return;
    const b = (h.brk[down] ??= { fails: 0, calls: 0, openUntil: -1 });
    b.calls++;
    if (fail) b.fails++;
    if (b.openUntil < this.t && b.calls >= 8 && b.fails / b.calls > 0.5) {
      b.openUntil = this.t + 200;
      b.fails = 0;
      b.calls = 0;
      this.events.push({ t: this.t, kind: 'breaker', text: `Breaker opened: ${h.spec.label ?? h.spec.id} stopped calling ${down}`, node: holder });
    }
  }

  private decayBreakers() {
    if (this.t % 40 !== 0) return;
    for (const n of this.nodes.values()) for (const b of Object.values(n.brk)) {
      b.fails *= 0.5;
      b.calls *= 0.5;
    }
  }

  private snapshot(_sec: number) {
    const util: Record<string, number> = {};
    const queue: Record<string, number> = {};
    const health: Record<string, NodeState['health']> = {};
    for (const [id, n] of this.nodes) {
      const cap = PARTS[n.spec.kind].capacity;
      util[id] = cap >= 9999 ? 0 : this.busy(n) / cap;
      queue[id] = n.queue.length;
      health[id] = n.health;
    }
    this.snapshots.push({ t: this.t, util, queue, health, budget: this.budget, rps: this.lastRps });
  }

  // Convenience for the headless harness.
  runToEnd() {
    while (this.state === 'ready' || this.state === 'running') this.step();
  }
}

export function designCost(d: Design) {
  return d.nodes.reduce((s, n) => s + (n.fixed ? 0 : PARTS[n.kind].cost), 0);
}

export function regionOf(n: NodeSpec): 'north' | 'south' | null {
  if (n.fixed && n.kind === 'users') return null;
  if (n.x < 192) return null; // the global strip on the left
  return n.y < 336 ? 'north' : 'south';
}
