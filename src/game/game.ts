import { h, clear, fitCanvas } from '../dom';
import { GRID } from '../theme';
import { PARTS, ALLOWED, isPlaceable, wireProblem, wouldCycle, ONE_NEXT_HOP, oneHopMessage, NO_LOOPS } from '../sim/parts';
import { Sim, designCost, idleGateways, IDLE_GATEWAY_EXTRA } from '../sim/engine';
import { checkDesign } from '../sim/check';
import { dumpState } from '../sim/dump';
import { TICKS_PER_SECOND_REAL, type Design, type EdgeSpec, type Level, type NodeOpts, type NodeSpec, type PartKind } from '../sim/types';
import { CARDS } from '../cards';
import { load, save } from '../store';
import { encodeDesign } from '../share';
import {
  WORLD_H, WORLD_W, NODE_W, drawEdge, drawRegions, drawGrid, drawNode, drawRequests, hitEdge, hitNode, hitPort, partName,
} from './render';
import { drawForecast } from './forecast';
import { showDebrief } from './debrief';
import { cardEl } from './cardview';
import { audio } from '../audio';

type Mode = 'build' | 'run' | 'paused' | 'over';

const OPT_LABEL: Record<keyof NodeOpts, string> = {
  healthCheck: 'Health checks: skip servers that are down',
  retry: 'Retry failed calls with backoff',
  breaker: 'Circuit breaker on outgoing calls',
  bulkhead: 'Bulkhead: writes use at most half the slots',
  saga: 'Saga: undo finished steps if a later one fails',
};
// Which parts each switch applies to.
const OPT_FOR: Record<keyof NodeOpts, PartKind[]> = {
  healthCheck: ['lb', 'gateway'],
  retry: ['web', 'worker'],
  breaker: ['web', 'worker'],
  bulkhead: ['web'],
  saga: ['web', 'worker'],
};

export interface GameHooks {
  onExit: () => void;
  onNext: (level: Level) => void;
}

export class Game {
  level: Level;
  design: Design;
  sim: Sim | null = null;
  private lastSim: Sim | null = null; // the most recent run, kept for the debug dump after Reset
  mode: Mode = 'build';
  speed = 1;
  selNode: string | null = null;
  selEdge: EdgeSpec | null = null;
  private patched = false;
  private drag: { id: string; dx: number; dy: number } | null = null;
  private wireFrom: string | null = null;
  private placing: PartKind | null = null;
  private pointer = { x: 0, y: 0, inside: false };
  private acc = 0;
  private last = 0;
  private raf = 0;
  private idSeq = 0;
  private view = { s: 1, ox: 0, oy: 0 };
  private hooks: GameHooks;

  private root: HTMLElement;
  private board!: HTMLCanvasElement;
  private fc!: HTMLCanvasElement;
  private top!: HTMLElement;
  private tray!: HTMLElement;
  private insp!: HTMLElement;
  private banner!: HTMLElement;

  constructor(root: HTMLElement, level: Level, design: Design, hooks: GameHooks) {
    this.root = root;
    this.level = level;
    this.design = design;
    this.hooks = hooks;
    for (const n of design.nodes) {
      const m = /-(\d+)$/.exec(n.id);
      if (m) this.idSeq = Math.max(this.idSeq, +m[1]);
    }
    this.mount();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    audio.hum(0);
    clear(this.root);
  }

  // ---------- layout ----------

  private mount() {
    clear(this.root);
    this.top = h('div', { class: 'topbar' });
    this.tray = h('div', { class: 'tray' });
    this.board = h('canvas', {});
    this.insp = h('div', { class: 'inspector', style: 'display:none' });
    this.banner = h('div', { class: 'banner', style: 'display:none' });
    this.fc = h('canvas', {});
    const boardWrap = h('div', { class: 'board' }, this.board, this.banner, this.insp);
    if (this.level.id === 'sandbox') boardWrap.append(this.sandboxPanel());
    this.root.append(h('div', { class: 'game' }, this.top, this.tray, boardWrap, h('div', { class: 'forecast' }, this.fc)));

    this.board.addEventListener('pointerdown', this.onDown);
    this.board.addEventListener('pointermove', this.onMove);
    this.board.addEventListener('pointerup', this.onUp);
    this.board.addEventListener('pointerleave', () => (this.pointer.inside = false));
    this.board.addEventListener('contextmenu', this.onContext);
    window.addEventListener('pointerup', this.onWindowUp);
    this.renderTop();
    this.renderTray();
    this.updateBanner();
  }

  private onResize = () => this.renderTop();

  private editable() {
    return this.mode === 'build' || this.mode === 'paused';
  }

  // ---------- top bar ----------

  private budgetFill!: HTMLElement;
  private budgetLab!: HTMLElement;
  private clockEl!: HTMLElement;
  private moneyEl!: HTMLElement;

  private renderTop() {
    clear(this.top);
    const L = this.level;
    this.clockEl = h('span', { class: 'clock' }, L.clock[0]);
    this.budgetFill = h('div', { class: 'fill', style: 'width:100%' });
    this.budgetLab = h('span', {}, `${L.errorBudget}`);
    this.moneyEl = h('span', { class: 'money' });
    const runLabel = this.mode === 'run' ? 'Pause' : this.mode === 'paused' ? 'Resume' : 'Run';
    const speeds = [1, 2, 4].map((s) =>
      h('button', { class: `btn small ${this.speed === s ? 'on' : ''}`, onclick: () => { this.speed = s; this.renderTop(); } }, `x${s}`),
    );
    this.top.append(
      h('button', { class: 'btn small', onclick: () => this.hooks.onExit(), title: 'Back to the level map' }, 'Map'),
      h('span', { class: 'lvl' }, L.act ? h('b', {}, L.id.replace('-', '.')) : null, L.title),
      this.clockEl,
      h('div', { class: 'spacer' }),
      h('div', { class: 'meter', title: 'Error budget. Every failed request uses some up. At zero you get paged out.' },
        h('div', { class: 'lab' }, h('span', {}, 'error budget'), this.budgetLab),
        h('div', { class: 'bar' }, this.budgetFill)),
      this.moneyEl,
      h('div', { class: 'speed' }, ...speeds),
      h('button', { class: `btn ${this.mode === 'run' ? '' : 'go'}`, onclick: () => this.toggleRun(), disabled: this.mode === 'over' }, runLabel),
      h('button', { class: 'btn', onclick: () => this.reset(), title: 'Stop and go back to drafting (R)' }, 'Reset'),
      h('button', { class: 'btn small', onclick: () => this.showIntro(), title: 'Brief' }, '?'),
      ...(load().debug ? [h('button', { class: 'btn small', onclick: () => this.showDebug(), title: 'Copy a compact text dump of this design and the last run, for bug reports' }, 'Debug')] : []),
    );
    this.updateTop();
  }

  private updateTop() {
    const L = this.level;
    const b = this.sim ? this.sim.budget : L.errorBudget;
    const f = Math.max(0, b / L.errorBudget);
    this.budgetFill.style.width = `${f * 100}%`;
    this.budgetFill.className = `fill ${f < 0.25 ? 'crit' : f < 0.5 ? 'low' : ''}`;
    this.budgetLab.textContent = L.act ? `${Math.max(0, b)} / ${L.errorBudget}` : `${L.errorBudget - b} failed`;
    const cost = designCost(this.design);
    const idle = idleGateways(this.design).length;
    this.moneyEl.textContent = (L.maxCost ? `$${cost} / $${L.maxCost} mo` : `$${cost}/mo`) + (idle ? `  (+$${idle * IDLE_GATEWAY_EXTRA} idle gateway)` : '');
    this.moneyEl.className = `money ${L.maxCost && cost > L.maxCost ? 'over' : ''}`;
    this.clockEl.textContent = this.clockAt(this.sim ? this.sim.t / this.sim.endTick : 0);
  }

  private clockAt(f: number) {
    const [a, b] = this.level.clock.map((c) => {
      const [hh, mm] = c.split(':').map(Number);
      return hh * 60 + mm;
    });
    const m = Math.round(a + (b - a) * Math.min(1, f));
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  // ---------- tray ----------

  private countOf(kind: PartKind) {
    return this.design.nodes.filter((n) => n.kind === kind && !n.fixed).length;
  }

  private canPlace(kind: PartKind) {
    const L = this.level;
    const lim = L.kit?.[kind];
    if (lim !== undefined && this.countOf(kind) >= lim) return false;
    if (L.maxCost && designCost(this.design) + PARTS[kind].cost > L.maxCost) return false;
    return true;
  }

  private renderTray() {
    clear(this.tray);
    const naming = load().naming;
    this.tray.append(h('h3', {}, 'PARTS'));
    this.level.catalog.filter(isPlaceable).forEach((kind, i) => {
      const def = PARTS[kind];
      const lim = this.level.kit?.[kind];
      const left = lim !== undefined ? `${lim - this.countOf(kind)} left` : '';
      const ok = this.canPlace(kind) && this.editable();
      const el = h('button', {
        class: `part ${ok ? '' : 'out'}`,
        title: `${def.blurb}  (${i + 1})`,
        onpointerdown: (e: Event) => {
          e.preventDefault();
          if (ok) { this.placing = kind; this.select(null); }
        },
      },
        h('span', { class: 'ico' }, def.short),
        h('span', {}, h('span', { class: 'nm' }, partName(kind, naming)), h('span', { class: 'meta' }, `$${def.cost}/mo ${left}`)),
      );
      this.tray.append(el);
    });
    this.tray.append(
      h('div', { class: 'tips' },
        h('p', {}, 'Drag a part onto the paper. Drag from the blue dot on a part to another part to wire them.'),
        h('p', {}, h('kbd', {}, 'Space'), ' run/pause ', h('kbd', {}, 'R'), ' reset ', h('kbd', {}, 'Del'), ' remove. Right-click removes too.'),
        h('p', {}, 'Pips under a part are its slots. Black is working, blue is waiting on something downstream.'),
      ),
    );
  }

  // ---------- inspector ----------

  private select(id: string | null, edge: EdgeSpec | null = null) {
    this.selNode = id;
    this.selEdge = edge;
    this.renderInspector();
  }

  private renderInspector() {
    const id = this.selNode;
    const spec = id ? this.design.nodes.find((n) => n.id === id) : undefined;
    if (!spec) {
      this.insp.style.display = 'none';
      return;
    }
    const def = PARTS[spec.kind];
    clear(this.insp);
    this.insp.style.display = 'block';
    const rps = def.capacity >= 9999 ? 'no limit' : `about ${Math.round((def.capacity / (def.service.default + (def.holds ? 9 : 0))) * 100)} req/s`;
    this.insp.append(
      h('button', { class: 'x', onclick: () => this.select(null) }, '×'),
      h('h4', {}, spec.label ?? def.name),
      h('div', { class: 'vendor' }, `Azure: ${def.azure}  ·  AWS: ${def.aws}`),
      h('p', {}, def.blurb),
      h('div', { class: 'stats' },
        h('span', {}, 'slots'), h('span', {}, def.capacity >= 9999 ? 'lots' : def.capacity),
        h('span', {}, 'queue'), h('span', {}, def.queueLimit || 'none'),
        h('span', {}, 'service'), h('span', {}, `${def.service.default * 10} ms${def.service.static ? `, files ${def.service.static * 10} ms` : ''}`),
        h('span', {}, 'handles'), h('span', {}, rps),
        h('span', {}, 'cost'), h('span', {}, `$${def.cost}/mo`),
      ),
    );
    const opts = (this.level.options ?? []).filter((o) => OPT_FOR[o].includes(spec.kind));
    for (const o of opts) {
      const cb = h('input', { type: 'checkbox', checked: !!spec.opts?.[o], disabled: !this.editable() || spec.fixed });
      cb.addEventListener('change', () => {
        spec.opts = { ...spec.opts, [o]: (cb as HTMLInputElement).checked };
        this.changed();
        this.renderInspector();
      });
      this.insp.append(h('label', { class: 'opt' }, cb, OPT_LABEL[o]));
    }
    if (spec.kind === 'gateway' && idleGateways(this.design).includes(spec.id)) {
      this.insp.append(h('p', { class: 'opt' }, `Idle gateway: everything behind it is the same kind of service, so there is nothing to route. A load balancer does this job for less. Costs +$${IDLE_GATEWAY_EXTRA}/mo extra.`));
    }
    const card = CARDS[spec.kind];
    if (card) this.insp.append(cardEl(card, true));
    if (!spec.fixed && this.editable()) {
      this.insp.append(h('div', { class: 'row' }, h('button', { class: 'btn small warn', onclick: () => this.removeNode(spec.id) }, 'Remove')));
    }
  }

  // ---------- editing ----------

  private changed() {
    if (this.mode === 'paused') this.patched = true;
    save((s) => (s.designs[this.level.id] = encodeDesign(this.design)));
    if (this.selNode) this.renderInspector();
    this.renderTray();
    this.updateTop();
    this.updateBanner();
  }

  private addNode(kind: PartKind, x: number, y: number) {
    if (!this.canPlace(kind)) return;
    const id = `${kind}-${++this.idSeq}`;
    const spec: NodeSpec = { id, kind, x: snap(x), y: snap(y) };
    this.design.nodes.push(spec);
    audio.place();
    this.select(id);
    this.changed();
  }

  private removeNode(id: string) {
    const n = this.design.nodes.find((x) => x.id === id);
    if (!n || n.fixed || !this.editable()) return;
    this.design.nodes = this.design.nodes.filter((x) => x.id !== id);
    this.design.edges = this.design.edges.filter((e) => e.from !== id && e.to !== id);
    this.select(null);
    this.changed();
  }

  private removeEdge(e: EdgeSpec) {
    if (!this.editable()) return;
    const fixed = this.level.fixedEdges?.some((f) => f.from === e.from && f.to === e.to);
    if (fixed) return;
    this.design.edges = this.design.edges.filter((x) => !(x.from === e.from && x.to === e.to));
    this.select(null);
    this.changed();
  }

  private addEdge(from: string, to: string) {
    if (from === to) return;
    const a = this.design.nodes.find((n) => n.id === from);
    const b = this.design.nodes.find((n) => n.id === to);
    if (!a || !b) return;
    const problem = wireProblem(a.kind, b.kind);
    if (problem) return this.flash(problem);
    if (ONE_NEXT_HOP.includes(a.kind) && this.design.edges.some((e) => e.from === from)) return this.flash(oneHopMessage(a.kind));
    if (this.design.edges.some((e) => e.from === from && e.to === to)) return;
    if (wouldCycle(this.design.edges, from, to)) return this.flash(NO_LOOPS);
    this.design.edges.push({ from, to });
    audio.wire();
    this.changed();
  }

  // Would a wire from a to b be accepted by addEdge?
  private canWire(a: NodeSpec, b: NodeSpec) {
    if (a.id === b.id) return false;
    if (wireProblem(a.kind, b.kind)) return false;
    if (ONE_NEXT_HOP.includes(a.kind) && this.design.edges.some((e) => e.from === a.id)) return false;
    if (this.design.edges.some((e) => e.from === a.id && e.to === b.id)) return false;
    return !wouldCycle(this.design.edges, a.id, b.id);
  }

  // ---------- pointer ----------

  private toWorld(e: PointerEvent | MouseEvent) {
    const r = this.board.getBoundingClientRect();
    return { x: (e.clientX - r.left - this.view.ox) / this.view.s, y: (e.clientY - r.top - this.view.oy) / this.view.s };
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const p = this.toWorld(e);
    if (this.placing) return;
    if (this.editable()) {
      const port = hitPort(this.design, p.x, p.y);
      if (port && ALLOWED[port.kind].length) {
        this.wireFrom = port.id;
        this.board.setPointerCapture(e.pointerId);
        return;
      }
    }
    const n = hitNode(this.design, p.x, p.y);
    if (n) {
      this.select(n.id);
      if (this.editable() && !n.fixed) {
        this.drag = { id: n.id, dx: p.x - n.x, dy: p.y - n.y };
        this.board.setPointerCapture(e.pointerId);
      }
      return;
    }
    const edge = hitEdge(this.design, p.x, p.y);
    this.select(null, edge ?? null);
  };

  private onMove = (e: PointerEvent) => {
    const p = this.toWorld(e);
    this.pointer = { ...p, inside: true };
    if (this.drag) {
      const n = this.design.nodes.find((x) => x.id === this.drag!.id);
      if (n) {
        n.x = clampX(snap(p.x - this.drag.dx));
        n.y = clampY(snap(p.y - this.drag.dy));
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    const p = this.toWorld(e);
    if (this.wireFrom) {
      const n = hitNode(this.design, p.x, p.y);
      if (n) this.addEdge(this.wireFrom, n.id);
      this.wireFrom = null;
    }
    if (this.drag) {
      this.drag = null;
      this.changed();
    }
  };

  // Placing from the tray ends wherever the pointer is released.
  private onWindowUp = (e: PointerEvent) => {
    if (!this.placing) return;
    const kind = this.placing;
    this.placing = null;
    const r = this.board.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const p = this.toWorld(e);
      this.addNode(kind, clampX(p.x), clampY(p.y));
    }
  };

  private onContext = (e: MouseEvent) => {
    e.preventDefault();
    const p = this.toWorld(e);
    const n = hitNode(this.design, p.x, p.y);
    if (n) return this.removeNode(n.id);
    const edge = hitEdge(this.design, p.x, p.y);
    if (edge) this.removeEdge(edge);
  };

  private onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || document.querySelector('.modal-back')) return;
    if (e.code === 'Space') { e.preventDefault(); this.toggleRun(); }
    else if (e.key === 'r' || e.key === 'R') this.reset();
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selNode) this.removeNode(this.selNode);
      else if (this.selEdge) this.removeEdge(this.selEdge);
    } else if (e.key === 'Escape') { this.select(null); this.placing = null; this.wireFrom = null; }
    else if (/^[1-9]$/.test(e.key) && this.editable()) {
      const kind = this.level.catalog.filter(isPlaceable)[+e.key - 1];
      if (kind && this.canPlace(kind)) {
        const p = this.pointer.inside ? this.pointer : { x: WORLD_W / 2, y: WORLD_H / 2 };
        this.addNode(kind, p.x, p.y);
      }
    }
  };

  // ---------- run control ----------

  toggleRun() {
    if (this.mode === 'over') return;
    if (this.mode === 'build') {
      if (this.level.maxCost && designCost(this.design) > this.level.maxCost) return;
      this.sim = new Sim(this.level, structuredClone(this.design));
      this.mode = 'run';
      audio.start();
    } else if (this.mode === 'run') {
      this.mode = 'paused';
    } else if (this.mode === 'paused') {
      if (this.patched && this.sim) {
        this.sim.patch(structuredClone(this.design));
        audio.strike();
      }
      this.patched = false;
      this.mode = 'run';
    }
    this.last = performance.now();
    this.renderTop();
    this.renderTray();
    this.renderInspector();
    this.updateBanner();
  }

  reset() {
    if (this.sim && this.sim.t > 0) this.lastSim = this.sim;
    this.sim = null;
    this.mode = 'build';
    this.patched = false;
    this.acc = 0;
    audio.hum(0);
    this.renderTop();
    this.renderTray();
    this.renderInspector();
    this.updateBanner();
  }

  private updateBanner() {
    const b = this.banner;
    b.className = 'banner';
    if (this.mode === 'paused') {
      b.style.display = 'block';
      b.textContent = this.patched
        ? 'Hotfix ready. Resuming deploys it mid-incident: one pager strike, and 5% of the error budget.'
        : 'Paused. You can change the design, but deploying mid-run costs a pager strike.';
      if (this.patched) b.className = 'banner red';
    } else if (this.mode === 'build' && !this.design.edges.length) {
      b.style.display = 'block';
      b.textContent = 'Nothing is wired yet. Fans have nowhere to go.';
    } else if (this.mode === 'build' && load().debug && this.checkProblems().length) {
      const ps = this.checkProblems();
      b.style.display = 'block';
      b.textContent = `Design check: ${ps[0]}${ps.length > 1 ? `  (+${ps.length - 1} more, see Debug)` : ''}`;
    } else {
      b.style.display = 'none';
    }
  }

  private checkProblems() {
    return checkDesign(this.level, this.design).problems;
  }

  private finish() {
    if (!this.sim) return;
    this.lastSim = this.sim;
    this.mode = 'over';
    audio.hum(0);
    this.renderTop();
    showDebrief(this.sim, structuredClone(this.design), {
      retry: () => this.reset(),
      debug: load().debug ? () => this.showDebug() : undefined,
      next: (lvl) => this.hooks.onNext(lvl),
      map: () => this.hooks.onExit(),
    });
  }

  // ---------- frame ----------

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    let frac = 1;
    if (this.mode === 'run' && this.sim) {
      this.acc += dt * this.speed * TICKS_PER_SECOND_REAL;
      let steps = 0;
      while (this.acc >= 1 && steps < 40) {
        this.sim.step();
        this.acc -= 1;
        steps++;
        if (this.sim.state === 'paged' || this.sim.state === 'done') break;
      }
      frac = this.acc;
      const load = [...this.sim.nodes.values()].reduce((m, n) => {
        const c = PARTS[n.spec.kind].capacity;
        return c >= 9999 ? m : Math.max(m, (n.inService + n.held) / c);
      }, 0);
      audio.hum(load);
      if (this.sim.state === 'paged' || this.sim.state === 'done') this.finish();
      this.updateTop();
    }
    this.draw(frac);
  }

  private draw(frac: number) {
    const { w, h: hh, dpr } = fitCanvas(this.board);
    const ctx = this.board.getContext('2d')!;
    const s = Math.min(w / WORLD_W, hh / WORLD_H);
    this.view = { s, ox: (w - WORLD_W * s) / 2, oy: (hh - WORLD_H * s) / 2 };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#e8e2d1';
    ctx.fillRect(0, 0, w, hh);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * this.view.ox, dpr * this.view.oy);
    drawGrid(ctx, WORLD_W, WORLD_H);
    if (this.level.regions) drawRegions(ctx, this.sim);

    const naming = load().naming;
    const byId = new Map(this.design.nodes.map((n) => [n.id, n]));
    const sim = this.sim;
    for (const e of this.design.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) continue;
      const sel = !!this.selEdge && this.selEdge.from === e.from && this.selEdge.to === e.to;
      const open = !!sim && (sim.nodes.get(e.from)?.brk[e.to]?.openUntil ?? -1) > sim.t;
      drawEdge(ctx, a, b, sel, open);
    }
    if (this.wireFrom) {
      const a = byId.get(this.wireFrom);
      if (a) {
        ctx.strokeStyle = '#1f3a93';
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(a.x + NODE_W / 2, a.y);
        ctx.lineTo(this.pointer.x, this.pointer.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    const from = this.wireFrom ? byId.get(this.wireFrom) : undefined;
    for (const spec of this.design.nodes) {
      // While drawing a wire, only parts it could legally end on stay bright.
      ctx.globalAlpha = from && !this.canWire(from, spec) ? 0.25 : 1;
      drawNode(ctx, {
        spec,
        state: sim?.nodes.get(spec.id),
        selected: this.selNode === spec.id,
        naming,
        showPort: this.editable(),
        wiring: this.wireFrom === spec.id,
      });
      ctx.globalAlpha = 1;
    }
    if (sim) drawRequests(ctx, sim, frac);
    if (this.placing && this.pointer.inside) {
      ctx.globalAlpha = 0.5;
      drawNode(ctx, { spec: { id: 'ghost', kind: this.placing, x: snap(this.pointer.x), y: snap(this.pointer.y) }, naming });
      ctx.globalAlpha = 1;
    }

    const f = fitCanvas(this.fc);
    const fctx = this.fc.getContext('2d')!;
    fctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
    drawForecast(fctx, f.w, f.h, this.level, sim ? sim.t / TICKS_PER_SECOND_REAL : null);
  }

  // ---------- sandbox ----------

  private sandboxPanel() {
    const L = this.level;
    const t = L.traffic[0];
    const mix = t.mix as Record<string, number>;
    const slider = (label: string, get: () => number, set: (v: number) => void, max: number) => {
      const val = h('span', { class: 'v' }, String(Math.round(get())));
      const inp = h('input', { type: 'range', min: 0, max, value: get() }) as HTMLInputElement;
      inp.addEventListener('input', () => { set(+inp.value); val.textContent = inp.value; });
      return h('label', { class: 'sl' }, h('span', {}, label), inp, val);
    };
    const chaos = (label: string, kind: 'down' | 'slow' | 'hang' | 'flaky' | 'recover') =>
      h('button', { class: 'btn small', onclick: () => {
        if (!this.sim || !this.selNode) { this.flash('Run first, then select a part to break.'); return; }
        this.sim.inject(kind, this.selNode);
      } }, label);
    const pay = h('input', { type: 'checkbox' }) as HTMLInputElement;
    pay.addEventListener('change', () => {
      L.needs = { write: pay.checked ? ['pay', 'write'] : ['write'] };
      if (pay.checked && !this.design.nodes.some((n) => n.kind === 'payment')) {
        this.design.nodes.push({ id: 'pay', kind: 'payment', x: 864, y: 96, fixed: true, label: 'Payments API' });
        this.changed();
      }
    });
    return h('div', { class: 'sandbox' },
      h('h4', {}, 'Traffic'),
      slider('req/s', () => t.rps, (v) => (t.rps = v), 800),
      slider('read %', () => mix.read * 100, (v) => (mix.read = v / 100), 100),
      slider('write %', () => mix.write * 100, (v) => (mix.write = v / 100), 100),
      slider('static %', () => mix.static * 100, (v) => (mix.static = v / 100), 100),
      slider('bot %', () => mix.bot * 100, (v) => (mix.bot = v / 100), 100),
      h('label', { class: 'opt' }, pay, 'Orders go through a Payments API'),
      h('h4', {}, 'Chaos on the selected part'),
      h('div', { class: 'row wrap' }, chaos('Kill', 'down'), chaos('Slow', 'slow'), chaos('Hang', 'hang'), chaos('Flaky', 'flaky'), chaos('Heal', 'recover')),
    );
  }

  private flash(text: string) {
    this.banner.style.display = 'block';
    this.banner.className = 'banner red';
    this.banner.textContent = text;
    setTimeout(() => this.updateBanner(), 4000);
  }

  // ---------- debug ----------

  showDebug() {
    const text = dumpState(this.level, this.design, this.sim ?? this.lastSim);
    const close = () => back.remove();
    const area = h('textarea', { readonly: true, spellcheck: false, style: 'width:100%;height:320px;font:12px ui-monospace,Consolas,monospace;box-sizing:border-box' }) as HTMLTextAreaElement;
    area.value = text;
    const copy = h('button', { class: 'btn primary' }, 'Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; } catch { area.select(); copy.textContent = 'Press Ctrl+C'; }
    });
    const back: HTMLElement = h('div', { class: 'modal-back', onclick: (e: Event) => e.target === back && close() },
      h('div', { class: 'modal wide' },
        h('h2', {}, 'Debug dump'),
        h('p', {}, 'Design, design check and the last run in a compact form. Paste it into a bug report. The CODE line rebuilds the exact design.'),
        area,
        h('div', { class: 'actions' }, copy, h('button', { class: 'btn', onclick: close }, 'Close')),
      ),
    );
    document.body.append(back);
    area.select();
  }

  // ---------- brief ----------

  showIntro() {
    const L = this.level;
    const close = () => back.remove();
    const back: HTMLElement = h('div', { class: 'modal-back', onclick: (e: Event) => e.target === back && close() },
      h('div', { class: 'modal' },
        h('div', { class: 'kicker' }, L.act ? `Release ${L.act}  ·  Ticket ${L.id.replace('-', '.')}  ·  ${L.clock[0]}` : 'Free build'),
        h('h2', {}, L.title),
        ...L.intro.map((p) => h('p', {}, p)),
        h('div', { class: 'goal' }, L.goal),
        h('div', { class: 'slo' },
          `SLO: ${(L.slo.success * 100).toFixed(1)}% success, p99 under ${L.slo.p99} ms. `,
          `Error budget: ${L.errorBudget} failures. `,
          L.maxCost ? `Spend cap: $${L.maxCost}/mo. ` : '',
          `Par: $${L.parCost}/mo.`),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: close }, 'Start drafting')),
      ),
    );
    document.body.append(back);
  }
}

function snap(v: number) {
  return Math.round(v / GRID) * GRID;
}
function clampX(x: number) {
  return Math.max(NODE_W / 2 + GRID, Math.min(WORLD_W - NODE_W / 2 - GRID, x));
}
function clampY(y: number) {
  return Math.max(48, Math.min(WORLD_H - 48, y));
}
