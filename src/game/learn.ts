import { h, fitCanvas } from '../dom';
import { C, FONT_HAND, FONT_MONO } from '../theme';
import { PARTS } from '../sim/parts';
import { Sim } from '../sim/engine';
import { levelById } from '../levels';
import { save } from '../store';
import type { Design, EdgeSpec, NodeSpec, PartKind } from '../sim/types';
import { NODE_H, NODE_W, drawEdge, drawGrid, drawNode, drawRequests } from './render';
import { wireProblem } from '../sim/parts';

// A short animated walkthrough: a pretend mouse drags parts onto the paper,
// wires them, presses Run and breaks something. The run is the real
// simulation, so the dots, pips and failures are what the game really does.

const W = 880;
const H = 400;
const TRAY: { kind: PartKind; label: string; y: number }[] = [
  { kind: 'lb', label: 'Load balancer', y: 36 },
  { kind: 'web', label: 'Web server', y: 100 },
  { kind: 'db', label: 'Database', y: 164 },
];
const TRAY_X = 16;
const TRAY_W = 150;
const TRAY_H = 46;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Scene {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  cursor: { x: number; y: number; down: boolean; ripple: number };
  move: { fx: number; fy: number; tx: number; ty: number; t0: number; ms: number } | null;
  drag: PartKind | null;
  hoverTray: number;
  wireFrom: string | null;
  flash: { text: string; x: number; y: number; until: number } | null;
  popup: { x: number; y: number; checked: boolean } | null;
  runBtn: { shown: boolean; pressed: boolean };
  sim: Sim | null;
}

export function showLearn(onDone?: () => void) {
  save((s) => (s.seenLearn = true));
  let dead = false;
  let raf = 0;
  let runId = 0;

  const canvas = h('canvas', { style: `width:100%;aspect-ratio:${W}/${H};display:block;background:${C.paper};border:1.5px solid ${C.ink}` });
  const caption = h('p', { class: 'learn-cap' });
  const dots = h('div', { class: 'learn-dots' });
  const steps = 7;
  const dotEls = Array.from({ length: steps }, () => h('span', {}));
  dots.append(...dotEls);

  const close = () => {
    dead = true;
    cancelAnimationFrame(raf);
    back.remove();
    onDone?.();
  };
  const replay = h('button', { class: 'btn', onclick: () => start() }, 'Replay');
  const done = h('button', { class: 'btn primary', onclick: close }, 'Got it');
  const back: HTMLElement = h('div', { class: 'modal-back', onclick: (e: Event) => e.target === back && close() },
    h('div', { class: 'modal wide' },
      h('div', { class: 'kicker' }, 'How it works'),
      h('h2', {}, 'Draw it, wire it, break it'),
      canvas,
      h('div', { class: 'learn-row' }, caption, dots),
      h('div', { class: 'actions' }, h('span', { class: 'learn-hint' }, 'Watch the little cursor. This is the real simulation.'), replay, done),
    ),
  );
  document.body.append(back);

  let sc: Scene;
  const fresh = (): Scene => ({
    nodes: [{ id: 'fans', kind: 'users', x: 262, y: 200, fixed: true, label: 'Fans' }],
    edges: [],
    cursor: { x: 760, y: 360, down: false, ripple: 0 },
    move: null, drag: null, hoverTray: -1, wireFrom: null, flash: null, popup: null,
    runBtn: { shown: false, pressed: false }, sim: null,
  });

  // ---------- script helpers ----------
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const check = (id: number) => { if (dead || id !== runId) throw new Error('cancelled'); };
  const go = async (id: number, x: number, y: number, ms = 700) => {
    sc.move = { fx: sc.cursor.x, fy: sc.cursor.y, tx: x, ty: y, t0: performance.now(), ms };
    await wait(ms + 40);
    check(id);
  };
  const click = async (id: number) => {
    sc.cursor.down = true; sc.cursor.ripple = 1;
    await wait(130); check(id);
    sc.cursor.down = false;
    await wait(120); check(id);
  };
  const node = (nid: string) => sc.nodes.find((n) => n.id === nid)!;
  const port = (nid: string) => ({ x: node(nid).x + NODE_W / 2, y: node(nid).y });
  const say = (i: number, text: string) => {
    caption.textContent = text;
    dotEls.forEach((d, k) => (d.className = k === i ? 'on' : k < i ? 'past' : ''));
  };

  const place = async (id: number, kind: PartKind, nid: string, x: number, y: number) => {
    const ti = TRAY.findIndex((t) => t.kind === kind);
    await go(id, TRAY_X + TRAY_W / 2, TRAY[ti].y + TRAY_H / 2, 650);
    sc.hoverTray = ti;
    sc.cursor.down = true; sc.cursor.ripple = 1;
    await wait(160); check(id);
    sc.drag = kind;
    await go(id, x, y, 800);
    sc.drag = null; sc.cursor.down = false; sc.hoverTray = -1;
    sc.nodes.push({ id: nid, kind, x, y });
    await wait(260); check(id);
  };
  const wire = async (id: number, from: string, to: string) => {
    const p = port(from);
    await go(id, p.x, p.y, 520);
    sc.cursor.down = true; sc.cursor.ripple = 1;
    sc.wireFrom = from;
    await wait(130); check(id);
    await go(id, node(to).x, node(to).y, 620);
    sc.cursor.down = false;
    const a = node(from), b = node(to);
    const problem = wireProblem(a.kind, b.kind);
    sc.wireFrom = null;
    if (problem) {
      sc.flash = { text: 'Fans cannot reach the database directly. They only know the public front door.', x: Math.min(b.x - 120, W - 430), y: b.y + 56, until: performance.now() + 3600 };
    } else {
      sc.edges.push({ from, to });
    }
    await wait(problem ? 3300 : 230); check(id);
  };

  async function script(id: number) {
    sc = fresh();
    say(0, 'Drag parts from the tray onto the paper.');
    await wait(500); check(id);
    await place(id, 'lb', 'lb', 410, 200);
    await place(id, 'web', 'web1', 580, 110);
    await place(id, 'web', 'web2', 580, 290);
    await place(id, 'db', 'db', 770, 200);

    say(1, 'Drag from the blue dot on a part to another part to wire them. Requests follow the wires.');
    await wait(500); check(id);
    await wire(id, 'fans', 'lb');
    await wire(id, 'lb', 'web1');
    await wire(id, 'lb', 'web2');
    await wire(id, 'web1', 'db');
    await wire(id, 'web2', 'db');

    say(2, 'Some wires are refused, and the game says why. Your data sits behind your own code.');
    await wait(400); check(id);
    await wire(id, 'fans', 'db');
    await wait(500); check(id);

    say(3, 'Press Run. Dots are requests. Black pips are busy slots; blue pips are slots waiting on something downstream.');
    sc.runBtn.shown = true;
    await go(id, W - 70, 26, 800);
    sc.runBtn.pressed = true;
    await click(id);
    const lvl = structuredClone(levelById('1-5')!);
    lvl.id = 'demo'; lvl.chaos = []; lvl.duration = 3600; lvl.errorBudget = 99999;
    lvl.traffic = [{ at: 0, rps: 30, mix: { read: 0.9, write: 0.1 } }, { at: 5, rps: 70 }];
    const design: Design = { nodes: structuredClone(sc.nodes), edges: structuredClone(sc.edges) };
    sc.sim = new Sim(lvl, design);
    await go(id, 640, 372, 900);
    await wait(6500); check(id);

    say(4, 'Parts react to each other. A web server dies, and a plain load balancer keeps sending it traffic. Every red cross is a fan who got nothing.');
    sc.sim.inject('down', 'web1');
    await wait(6500); check(id);

    say(5, 'Select the load balancer and turn on health checks. Now it skips parts that are down, and the failures stop.');
    const lb = node('lb');
    await go(id, lb.x, lb.y, 800);
    await click(id);
    sc.popup = { x: lb.x - 214, y: lb.y + 62, checked: false };
    await wait(500); check(id);
    await go(id, lb.x - 214 + 20, lb.y + 62 + 28, 600);
    await click(id);
    sc.popup.checked = true;
    sc.nodes.find((n) => n.id === 'lb')!.opts = { healthCheck: true };
    const live = sc.sim.nodes.get('lb');
    if (live) live.spec.opts = { healthCheck: true };
    await wait(600); check(id);
    await go(id, 640, 372, 700);
    sc.popup = null;
    await wait(5500); check(id);

    say(6, 'That is the game. Every level breaks something new, and you draw the fix. Patterns unlock as you win.');
    sc.sim = null;
    await wait(400);
  }

  function start() {
    runId++;
    const id = runId;
    script(id).catch((e) => { if (e?.message !== 'cancelled') throw e; });
  }

  // ---------- drawing ----------
  let last = 0;
  let acc = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now;
    if (!sc) return;
    const m = sc.move;
    if (m) {
      const f = Math.min(1, (now - m.t0) / m.ms);
      const e = ease(f);
      sc.cursor.x = m.fx + (m.tx - m.fx) * e;
      sc.cursor.y = m.fy + (m.ty - m.fy) * e;
      if (f >= 1) sc.move = null;
    }
    if (sc.sim && sc.sim.state !== 'paged' && sc.sim.state !== 'done') {
      acc += dt * 2 * 20; // x2 speed
      let n = 0;
      while (acc >= 1 && n++ < 30) { sc.sim.step(); acc -= 1; }
    }
    sc.cursor.ripple = Math.max(0, sc.cursor.ripple - dt * 3);
    draw(now);
  };

  function draw(now: number) {
    const { w, h: hh, dpr } = fitCanvas(canvas);
    const ctx = canvas.getContext('2d')!;
    const s = Math.min(w / W, hh / H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, w, hh);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (w - W * s) / 2, dpr * (hh - H * s) / 2);
    drawGrid(ctx, W, H);

    // tray
    ctx.fillStyle = 'rgba(34,37,43,0.05)';
    ctx.fillRect(0, 0, TRAY_X + TRAY_W + 16, H);
    ctx.font = `11px ${FONT_MONO}`;
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('PARTS', TRAY_X, 20);
    TRAY.forEach((t, i) => {
      ctx.fillStyle = sc.hoverTray === i ? '#fffaf0' : C.paper;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.fillRect(TRAY_X, t.y, TRAY_W, TRAY_H);
      ctx.strokeRect(TRAY_X, t.y, TRAY_W, TRAY_H);
      ctx.fillStyle = C.blue;
      ctx.font = `15px ${FONT_MONO}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(PARTS[t.kind].short, TRAY_X + 26, t.y + TRAY_H / 2);
      ctx.fillStyle = C.ink;
      ctx.font = `12px ${FONT_HAND}`;
      ctx.textAlign = 'left';
      ctx.fillText(t.label, TRAY_X + 52, t.y + TRAY_H / 2);
    });

    const byId = new Map(sc.nodes.map((n) => [n.id, n]));
    for (const e of sc.edges) {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (a && b) drawEdge(ctx, a, b, false);
    }
    if (sc.wireFrom) {
      const a = byId.get(sc.wireFrom)!;
      ctx.strokeStyle = C.blue;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(a.x + NODE_W / 2, a.y);
      ctx.lineTo(sc.cursor.x, sc.cursor.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const spec of sc.nodes) {
      drawNode(ctx, { spec, state: sc.sim?.nodes.get(spec.id), naming: 'generic', showPort: !sc.sim && spec.kind !== 'db', wiring: sc.wireFrom === spec.id });
    }
    if (sc.sim) drawRequests(ctx, sc.sim, acc);
    if (sc.drag) {
      ctx.globalAlpha = 0.5;
      drawNode(ctx, { spec: { id: 'ghost', kind: sc.drag, x: sc.cursor.x, y: sc.cursor.y }, naming: 'generic' });
      ctx.globalAlpha = 1;
    }

    // run button and the failure counter
    if (sc.runBtn.shown) {
      ctx.fillStyle = sc.runBtn.pressed ? C.paper : '#2e7d4f';
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.fillRect(W - 110, 8, 100, 36);
      ctx.strokeRect(W - 110, 8, 100, 36);
      ctx.fillStyle = sc.runBtn.pressed ? C.ink : C.paper;
      ctx.font = `15px ${FONT_HAND}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sc.sim ? 'Running' : 'Run', W - 60, 27);
    }
    if (sc.sim) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `13px ${FONT_MONO}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(`served ${sc.sim.stats.ok}`, TRAY_X, H - 34);
      ctx.fillStyle = sc.sim.stats.failed ? C.red : C.inkSoft;
      ctx.fillText(`failed ${sc.sim.stats.failed}`, TRAY_X, H - 16);
    }
    // popup: the inspector switch
    if (sc.popup) {
      const p = sc.popup;
      ctx.fillStyle = '#fbf8f0';
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.fillRect(p.x, p.y, 250, 56);
      ctx.strokeRect(p.x, p.y, 250, 56);
      ctx.strokeRect(p.x + 12, p.y + 20, 16, 16);
      if (p.checked) {
        ctx.strokeStyle = C.blue;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x + 15, p.y + 28);
        ctx.lineTo(p.x + 20, p.y + 33);
        ctx.lineTo(p.x + 27, p.y + 22);
        ctx.stroke();
      }
      ctx.fillStyle = C.ink;
      ctx.font = `12px ${FONT_HAND}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('Health checks: skip servers', p.x + 38, p.y + 22);
      ctx.fillText('that are down', p.x + 38, p.y + 38);
    }
    // refused wire
    if (sc.flash && now < sc.flash.until) {
      const f = sc.flash;
      ctx.font = `13px ${FONT_HAND}`;
      const tw = ctx.measureText(f.text).width + 20;
      ctx.fillStyle = '#fbe9e6';
      ctx.strokeStyle = C.red;
      ctx.lineWidth = 1.5;
      ctx.fillRect(f.x, f.y, tw, 28);
      ctx.strokeRect(f.x, f.y, tw, 28);
      ctx.fillStyle = C.red;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(f.text, f.x + 10, f.y + 15);
    }

    // the pretend mouse
    const c = sc.cursor;
    if (c.ripple > 0) {
      ctx.strokeStyle = `rgba(31,58,147,${c.ripple})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 8 + (1 - c.ripple) * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    const k = c.down ? 0.9 : 1;
    ctx.scale(k, k);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.5, 13);
    ctx.lineTo(8, 20);
    ctx.lineTo(11, 18.5);
    ctx.lineTo(7.5, 12);
    ctx.lineTo(13, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  sc = fresh();
  raf = requestAnimationFrame(frame);
  start();
  void NODE_H;
}
