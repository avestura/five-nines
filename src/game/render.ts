import { C, FONT_HAND, FONT_MONO, FONT_STAMP, GRID } from '../theme';
import { PARTS, ALLOWED } from '../sim/parts';
import type { Sim } from '../sim/engine';
import { GLOBAL_STRIP, type Design, type EdgeSpec, type NodeSpec, type NodeState, type PartKind, type ReqType, type Snapshot } from '../sim/types';
import type { Naming } from '../store';

export const WORLD_W = 1152;
export const WORLD_H = 672;
export const NODE_W = 84;
export const NODE_H = 54;

export function partName(kind: PartKind, naming: Naming) {
  const p = PARTS[kind];
  if (naming === 'azure') return p.azure;
  if (naming === 'aws') return p.aws;
  return p.name;
}

export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += GRID) {
    ctx.strokeStyle = x % (GRID * 5) === 0 ? C.gridMajor : C.gridMinor;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += GRID) {
    ctx.strokeStyle = y % (GRID * 5) === 0 ? C.gridMajor : C.gridMinor;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
  }
}

// Where the line between two node centers leaves the box around `a`.
function clip(ax: number, ay: number, bx: number, by: number, pad = 4) {
  const dx = bx - ax, dy = by - ay;
  const hw = NODE_W / 2 + pad, hh = NODE_H / 2 + pad;
  const s = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return { x: ax + dx * Math.min(1, s), y: ay + dy * Math.min(1, s) };
}

export function edgePoints(a: NodeSpec, b: NodeSpec) {
  const p = clip(a.x, a.y, b.x, b.y);
  const q = clip(b.x, b.y, a.x, a.y, 8);
  return { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
}

export function drawEdge(ctx: CanvasRenderingContext2D, a: NodeSpec, b: NodeSpec, selected: boolean, open = false) {
  const { x1, y1, x2, y2 } = edgePoints(a, b);
  ctx.strokeStyle = open ? C.red : selected ? C.blue : C.ink;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.setLineDash(open ? [6, 5] : []);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  // pencil ghost line, slightly offset, for a hand-drafted feel
  ctx.strokeStyle = 'rgba(34,37,43,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1 + 1, y1 + 1.5);
  ctx.lineTo(x2 + 1, y2 + 1.5);
  ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.fillStyle = open ? C.red : selected ? C.blue : C.ink;
  ctx.beginPath();
  ctx.moveTo(x2 + 2 * Math.cos(ang), y2 + 2 * Math.sin(ang));
  ctx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function heatColor(u: number) {
  // paper -> amber -> red
  const t = Math.max(0, Math.min(1.2, u));
  if (t < 0.6) return `rgba(201,138,18,${(t / 0.6) * 0.25})`;
  if (t < 0.9) return `rgba(201,138,18,${0.25 + ((t - 0.6) / 0.3) * 0.3})`;
  return `rgba(192,57,43,${0.35 + Math.min(0.4, (t - 0.9) * 1.2)})`;
}

export interface NodeView {
  spec: NodeSpec;
  state?: NodeState;
  util?: number; // for replays
  selected?: boolean;
  hover?: boolean;
  wiring?: boolean;
  naming: Naming;
  showPort?: boolean;
}

export function drawNode(ctx: CanvasRenderingContext2D, v: NodeView) {
  const { spec, state } = v;
  const def = PARTS[spec.kind];
  const x = spec.x - NODE_W / 2;
  const y = spec.y - NODE_H / 2;
  const cap = def.capacity;
  const busy = state ? state.inService + state.held : 0;
  const util = v.util ?? (state && cap < 9999 ? busy / cap : 0);

  // shadow
  ctx.fillStyle = 'rgba(34,37,43,0.12)';
  roundRect(ctx, x + 3, y + 3, NODE_W, NODE_H, 4);
  ctx.fill();
  ctx.fillStyle = spec.kind === 'users' ? '#fff7df' : spec.kind === 'payment' ? '#f1eadf' : '#fbf8f0';
  roundRect(ctx, x, y, NODE_W, NODE_H, 4);
  ctx.fill();
  if (util > 0) {
    ctx.fillStyle = heatColor(util);
    roundRect(ctx, x, y, NODE_W, NODE_H, 4);
    ctx.fill();
  }
  ctx.strokeStyle = v.selected ? C.blue : C.ink;
  ctx.lineWidth = v.selected ? 2.5 : 1.5;
  if (spec.fixed) ctx.setLineDash([5, 3]);
  roundRect(ctx, x, y, NODE_W, NODE_H, 4);
  ctx.stroke();
  ctx.setLineDash([]);

  // stamp
  ctx.fillStyle = spec.kind === 'users' ? C.amber : C.blue;
  ctx.font = `20px ${FONT_STAMP}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.short, spec.x, spec.y - 6);
  ctx.fillStyle = C.inkSoft;
  ctx.font = `12px ${FONT_HAND}`;
  const name = spec.label ?? partName(spec.kind, v.naming);
  ctx.fillText(name.length > 16 ? name.slice(0, 15) + '.' : name, spec.x, spec.y + 14);

  // option badges
  const o = spec.opts ?? {};
  const badges = [o.healthCheck && 'HC', o.retry && 'RT', o.breaker && 'CB', o.bulkhead && 'BH', o.saga && 'SG'].filter(Boolean) as string[];
  badges.forEach((b, i) => {
    const bx = x + NODE_W - 4 - (badges.length - i) * 20;
    ctx.fillStyle = C.ink;
    ctx.fillRect(bx, y - 8, 18, 12);
    ctx.fillStyle = C.paper;
    ctx.font = `9px ${FONT_MONO}`;
    ctx.fillText(b, bx + 9, y - 2);
  });

  // slot pips: filled = working, hollow = waiting on a call downstream
  if (cap < 9999 && spec.kind !== 'users') {
    const n = Math.min(cap, 20);
    const pw = Math.min(8, (NODE_W - 8) / n - 2);
    const px0 = spec.x - (n * (pw + 2)) / 2;
    const working = state ? Math.min(n, state.inService) : 0;
    const held = state ? Math.min(n - working, state.held) : 0;
    for (let i = 0; i < n; i++) {
      const px = px0 + i * (pw + 2);
      const py = y + NODE_H + 5;
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.ink;
      if (i < working) {
        ctx.fillStyle = C.ink;
        ctx.fillRect(px, py, pw, 5);
      } else if (i < working + held) {
        ctx.fillStyle = C.blue;
        ctx.fillRect(px, py, pw, 5);
      } else {
        ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, 4);
      }
    }
    // queue bar
    if (state && state.queue.length > 0) {
      const f = Math.min(1, state.queue.length / Math.max(1, def.queueLimit));
      ctx.fillStyle = f > 0.8 ? C.red : C.amber;
      ctx.fillRect(x, y - 7, NODE_W * f, 4);
      ctx.font = `10px ${FONT_MONO}`;
      ctx.fillStyle = f > 0.8 ? C.red : C.inkSoft;
      ctx.textAlign = 'left';
      ctx.fillText(`q ${state.queue.length}`, x, y - 14);
      ctx.textAlign = 'center';
    }
  }
  if (spec.kind === 'queue' && state && state.queue.length) {
    ctx.font = `11px ${FONT_MONO}`;
    ctx.fillStyle = C.ink;
    ctx.fillText(`${state.queue.length} jobs`, spec.x, y + NODE_H + 10);
  }

  // health
  const h = state?.health;
  if (h === 'down') {
    ctx.strokeStyle = C.red;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 6);
    ctx.lineTo(x + NODE_W - 6, y + NODE_H - 6);
    ctx.moveTo(x + NODE_W - 6, y + 6);
    ctx.lineTo(x + 6, y + NODE_H - 6);
    ctx.stroke();
    stampText(ctx, 'DOWN', spec.x, y - 16, C.red);
  } else if (h === 'slow') {
    stampText(ctx, 'SLOW', spec.x, y - 16, C.amber);
  } else if (state && state.flaky > 0) {
    stampText(ctx, 'FLAKY', spec.x, y - 16, C.amber);
  }

  // wiring port
  if (v.showPort && ALLOWED[spec.kind].length) {
    ctx.fillStyle = v.wiring ? C.blue : C.paper;
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(spec.x + NODE_W / 2, spec.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function stampText(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.08);
  ctx.font = `13px ${FONT_STAMP}`;
  const w = ctx.measureText(t).width + 10;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2, -9, w, 18);
  ctx.fillStyle = color;
  ctx.fillText(t, 0, 1);
  ctx.restore();
}

export const TYPE_COLOR: Record<ReqType, string> = {
  read: C.read, write: C.write, static: C.static, bot: C.bot,
};

// Shape as well as color, so the types read without color vision.
export function drawDot(ctx: CanvasRenderingContext2D, type: ReqType, x: number, y: number, async = false) {
  ctx.fillStyle = TYPE_COLOR[type];
  ctx.strokeStyle = TYPE_COLOR[type];
  const r = 4;
  if (async) {
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  if (type === 'read') ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (type === 'write') ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (type === 'static') {
    ctx.moveTo(x, y - r - 1);
    ctx.lineTo(x + r + 1, y + r);
    ctx.lineTo(x - r - 1, y + r);
    ctx.closePath();
  } else {
    ctx.lineWidth = 1.8;
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
    return;
  }
  ctx.fill();
}

export function drawRequests(ctx: CanvasRenderingContext2D, sim: Sim, frac: number) {
  const t = sim.t - 1 + frac;
  for (const r of sim.live.values()) {
    if (!r.hop) continue;
    const a = sim.nodes.get(r.hop.from)?.spec;
    const b = sim.nodes.get(r.hop.to)?.spec;
    if (!a || !b) continue;
    const { x1, y1, x2, y2 } = edgePoints(a, b);
    const f = Math.max(0, Math.min(1, (t - r.hop.start) / (r.hop.end - r.hop.start)));
    // Small sideways jitter per request so a busy wire looks like traffic.
    const j = ((r.id * 7919) % 7) - 3;
    const nx = -(y2 - y1), ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1;
    const px = x1 + (x2 - x1) * f + (nx / len) * j, py = y1 + (y2 - y1) * f + (ny / len) * j;
    // short trail so direction reads at a glance
    const tf = Math.max(0, f - 0.18);
    ctx.strokeStyle = TYPE_COLOR[r.type] + '55';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x1 + (x2 - x1) * tf + (nx / len) * j, y1 + (y2 - y1) * tf + (ny / len) * j);
    ctx.lineTo(px, py);
    ctx.stroke();
    drawDot(ctx, r.type, px, py, r.async);
  }
  for (const p of sim.pops) {
    const n = sim.nodes.get(p.node)?.spec;
    if (!n) continue;
    const age = sim.t - p.t + frac;
    if (p.outcome === 'dropped' || p.outcome === 'timeout') {
      ctx.strokeStyle = `rgba(192,57,43,${1 - age / 8})`;
      ctx.lineWidth = 2;
      const r = 8 + age * 3;
      ctx.beginPath();
      ctx.moveTo(n.x - r, n.y - NODE_H / 2 - r / 2);
      ctx.lineTo(n.x - r + 6, n.y - NODE_H / 2 - r / 2 + 6);
      ctx.stroke();
    } else if (p.outcome === 'blocked') {
      ctx.fillStyle = `rgba(34,37,43,${1 - age / 8})`;
      ctx.font = `10px ${FONT_MONO}`;
      ctx.fillText('429', n.x + NODE_W / 2 + 8, n.y - 10 - age * 2);
    }
  }
}

// Replay frame for the debrief heatmap.
export function drawReplay(ctx: CanvasRenderingContext2D, design: Design, snap: Snapshot | undefined, naming: Naming) {
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  for (const e of design.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (a && b) drawEdge(ctx, a, b, false);
  }
  for (const spec of design.nodes) {
    drawNode(ctx, { spec, naming, util: snap?.util[spec.id] ?? 0 });
    if (snap?.health[spec.id] === 'down') {
      stampText(ctx, 'DOWN', spec.x, spec.y - NODE_H / 2 - 16, C.red);
    }
    const q = snap?.queue[spec.id] ?? 0;
    if (q > 0 && spec.kind !== 'queue') {
      ctx.fillStyle = C.red;
      ctx.font = `11px ${FONT_MONO}`;
      ctx.fillText(`q ${q}`, spec.x, spec.y + NODE_H / 2 + 20);
    }
  }
}

// Two regions for the multi-region levels. The strip on the left is global.
export function drawRegions(ctx: CanvasRenderingContext2D, sim: Sim | null) {
  const dark = (r: 'north' | 'south') =>
    !!sim && [...sim.nodes.values()].some((n) => !n.spec.fixed && n.health === 'down' && (r === 'north' ? n.spec.y < 336 : n.spec.y >= 336) && n.spec.x >= GLOBAL_STRIP);
  ctx.save();
  ctx.setLineDash([10, 6]);
  ctx.strokeStyle = C.blue;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(GLOBAL_STRIP, 12, WORLD_W - GLOBAL_STRIP - 12, 312);
  ctx.strokeRect(GLOBAL_STRIP, 348, WORLD_W - GLOBAL_STRIP - 12, 312);
  ctx.setLineDash([]);
  for (const [r, y] of [['north', 12], ['south', 348]] as const) {
    if (dark(r)) {
      ctx.fillStyle = 'rgba(34,37,43,0.12)';
      ctx.fillRect(GLOBAL_STRIP, y, WORLD_W - GLOBAL_STRIP - 12, 312);
    }
    ctx.fillStyle = C.blue;
    ctx.font = `14px ${FONT_STAMP}`;
    ctx.textAlign = 'left';
    ctx.fillText(r === 'north' ? 'REGION NORTH  (us-east-1, obviously)' : 'REGION SOUTH', GLOBAL_STRIP + 12, y + 18);
  }
  ctx.fillStyle = C.inkSoft;
  ctx.font = `12px ${FONT_HAND}`;
  ctx.fillText('global', 16, 24);
  ctx.restore();
}

export function hitNode(design: Design, x: number, y: number): NodeSpec | undefined {
  for (let i = design.nodes.length - 1; i >= 0; i--) {
    const n = design.nodes[i];
    if (Math.abs(x - n.x) <= NODE_W / 2 && Math.abs(y - n.y) <= NODE_H / 2) return n;
  }
  return undefined;
}

export function hitPort(design: Design, x: number, y: number): NodeSpec | undefined {
  return design.nodes.find((n) => Math.hypot(x - (n.x + NODE_W / 2), y - n.y) <= 10);
}

export function hitEdge(design: Design, x: number, y: number): EdgeSpec | undefined {
  const byId = new Map(design.nodes.map((n) => [n.id, n]));
  for (const e of design.edges) {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) continue;
    const { x1, y1, x2, y2 } = edgePoints(a, b);
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
    if (Math.hypot(x - (x1 + dx * f), y - (y1 + dy * f)) < 7) return e;
  }
  return undefined;
}
