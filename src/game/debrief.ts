import { h, fitCanvas } from '../dom';
import { C, FONT_MONO } from '../theme';
import type { Sim } from '../sim/engine';
import { score, starCount } from '../sim/score';
import { PARTS } from '../sim/parts';
import type { Design, Level } from '../sim/types';
import { LEVELS } from '../levels';
import { CARDS } from '../cards';
import { load, save } from '../store';
import { shareUrl } from '../share';
import { WORLD_H, WORLD_W, drawGrid, drawReplay } from './render';
import { cardEl } from './cardview';
import { audio } from '../audio';

interface Actions {
  retry: () => void;
  next: (l: Level) => void;
  map: () => void;
}

export function showDebrief(sim: Sim, design: Design, act: Actions) {
  const L = sim.level;
  const r = score(sim, design);
  const stars = starCount(r);
  const prevBest = load().stars[L.id] ?? 0;
  const firstWin = r.stars[0] && prevBest === 0;
  if (stars > prevBest && L.act > 0) save((s) => (s.stars[L.id] = stars));
  const passed = r.stars[0];
  setTimeout(() => (passed ? audio.stamp() : audio.fail()), 250);

  const clock = (t: number) => {
    const [a, b] = L.clock.map((c) => { const [hh, mm] = c.split(':').map(Number); return hh * 60 + mm; });
    const m = Math.round(a + ((b - a) * t) / sim.endTick);
    return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  // --- postmortem text, written from what actually happened ---
  const worst = [...sim.nodes.values()].filter((n) => !n.spec.fixed || n.spec.kind === 'payment').sort((a, b) => b.failed - a.failed)[0];
  const peakUtil: Record<string, number> = {};
  for (const s of sim.snapshots) for (const [id, u] of Object.entries(s.util)) peakUtil[id] = Math.max(peakUtil[id] ?? 0, u);
  const hottest = Object.entries(peakUtil).sort((a, b) => b[1] - a[1])[0];
  const name = (id: string) => {
    const n = sim.nodes.get(id)?.spec;
    return n ? `${n.label ?? PARTS[n.kind].name} (${n.id})` : id;
  };
  const facts: string[] = [];
  if (hottest && hottest[1] > 0.95) facts.push(`${name(hottest[0])} hit ${Math.round(hottest[1] * 100)}% of its slots.`);
  if (worst && worst.failed > 0) facts.push(`Most failures surfaced at ${name(worst.spec.id)}: ${worst.failed}.`);
  if (sim.stats.timeout > sim.stats.dropped && sim.stats.timeout > 0) facts.push(`${sim.stats.timeout} fans waited more than 3 seconds and gave up.`);
  if (sim.stats.dropped > 0) facts.push(`${sim.stats.dropped} requests were turned away at a full queue or a dead end.`);
  if (sim.stats.asyncLost > 0) facts.push(`${sim.stats.asyncLost} queued orders were never processed.`);
  if (sim.stats.blocked > 0) facts.push(`${sim.stats.blocked} bot requests were turned away. Good.`);
  if (sim.stats.strikes > 0) facts.push(`${sim.stats.strikes} hotfix${sim.stats.strikes > 1 ? 'es were' : ' was'} deployed mid-incident.`);
  if (!facts.length) facts.push('Nothing notable. A boring incident report is the best kind.');

  const pm = h('div', { class: 'pm' },
    h('h5', {}, 'Summary'),
    ...(passed ? L.postmortem.win : L.postmortem.lose).map((l) => h('div', {}, l)),
    h('h5', {}, 'What the graphs say'),
    h('ul', {}, ...facts.map((f) => h('li', {}, f))),
    sim.events.length ? h('h5', {}, 'Timeline') : null,
    sim.events.length
      ? h('ul', {}, ...sim.events.slice(0, 8).map((e) => h('li', {}, h('span', { class: 'tl' }, clock(e.t) + '  '), e.text)))
      : null,
    !passed || stars < 3 ? h('h5', {}, 'Action items') : null,
    !passed ? h('div', {}, L.postmortem.hint) : null,
    passed && !r.stars[1] ? h('div', {}, `p99 was ${r.p99} ms against a ${L.slo.p99} ms target. Find the queue that is backing up.`) : null,
    passed && !r.stars[2] ? h('div', {}, `You spent $${r.cost}/mo. Par is $${L.parCost}. Something is doing less than it costs.`) : null,
    h('h5', {}, 'Blame'),
    h('div', {}, 'None. This is a blameless postmortem. (The load balancer knows what it did.)'),
  );

  // --- histogram ---
  const hist = h('canvas', {});
  // --- replay ---
  const replay = h('canvas', {});
  const snaps = sim.snapshots;
  let worstIdx = 0, worstVal = -1;
  snaps.forEach((s, i) => {
    const v = Math.max(0, ...Object.values(s.util)) + Object.values(s.queue).reduce((a, b) => a + b, 0) / 200;
    if (v > worstVal) { worstVal = v; worstIdx = i; }
  });
  const scrub = h('input', { type: 'range', class: 'scrub', min: 0, max: Math.max(0, snaps.length - 1), value: worstIdx }) as HTMLInputElement;
  const scrubLab = h('div', { class: 'caption' });

  const starLabels = [
    `Stayed up, ${(L.slo.success * 100).toFixed(1)}%+ success`,
    `p99 under ${L.slo.p99} ms`,
    `At or under par ($${L.parCost}/mo)`,
  ];

  const idx = LEVELS.findIndex((l) => l.id === L.id);
  const next = idx >= 0 ? LEVELS[idx + 1] : undefined;
  const shareBtn = h('button', { class: 'btn' }, 'Copy share link');
  shareBtn.addEventListener('click', async () => {
    const url = shareUrl(L.id, design);
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = 'Copied';
    } catch {
      prompt('Copy this link', url);
    }
  });

  const close = () => back.remove();
  const unlockCards = firstWin ? (L.unlocks ?? []).map((id) => CARDS[id]).filter(Boolean) : [];

  const back: HTMLElement = h('div', { class: 'modal-back' },
    h('div', { class: 'modal wide' },
      h('div', { class: `stamp bigstamp ${passed ? 'ok' : 'bad'}` }, passed ? 'Approved' : sim.state === 'paged' ? 'Paged out' : 'SLO missed'),
      h('div', { class: 'kicker' }, `Incident report  ·  ${L.id.replace('-', '.')}  ·  ${L.clock[0]} to ${clock(sim.t)}`),
      h('h2', {}, `Postmortem: ${L.title}`),
      h('div', { class: 'starrow' }, ...r.stars.map((got, i) => h('div', {}, h('span', { class: `s ${got ? 'got' : ''}` }, '★'), starLabels[i]))),
      h('div', { class: 'numbers' },
        h('span', {}, 'success ', h('b', {}, `${(r.success * 100).toFixed(2)}%`)),
        h('span', {}, 'p50 ', h('b', {}, `${r.p50} ms`)),
        h('span', {}, 'p95 ', h('b', {}, `${r.p95} ms`)),
        h('span', {}, 'p99 ', h('b', {}, `${r.p99} ms`)),
        h('span', {}, 'served ', h('b', {}, `${sim.stats.ok}`)),
        h('span', {}, 'failed ', h('b', {}, `${sim.stats.failed}`)),
        h('span', {}, 'cost ', h('b', {}, `$${r.cost}/mo`)),
      ),
      h('div', { class: 'debrief-grid' },
        h('div', {}, hist, h('div', { class: 'caption' }, 'How long fans waited. The red line is your SLO. The tail is what fans remember.')),
        h('div', {}, replay, scrub, scrubLab),
      ),
      h('div', { style: 'margin-top:14px' }, pm),
      unlockCards.length ? h('h3', { style: 'margin:18px 0 0;font-weight:normal' }, 'Added to your toolbox') : null,
      ...unlockCards.map((c) => cardEl(c)),
      h('div', { class: 'actions sticky' },
        shareBtn,
        h('button', { class: 'btn', onclick: () => { close(); act.map(); } }, 'Level map'),
        h('button', { class: 'btn', onclick: () => { close(); act.retry(); } }, 'Back to drafting'),
        next && passed ? h('button', { class: 'btn primary', onclick: () => { close(); act.next(next); } }, `Next: ${next.title}`) : null,
      ),
    ),
  );
  document.body.append(back);

  requestAnimationFrame(() => {
    drawHistogram(hist, sim.stats.latencies, L.slo.p99, r);
    const paint = () => {
      const i = +scrub.value;
      const s = snaps[i];
      const { w, h: hh, dpr } = fitCanvas(replay);
      const ctx = replay.getContext('2d')!;
      const k = Math.min(w / WORLD_W, hh / WORLD_H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, w, hh);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (w - WORLD_W * k) / 2, dpr * (hh - WORLD_H * k) / 2);
      drawGrid(ctx, WORLD_W, WORLD_H);
      drawReplay(ctx, design, s, load().naming);
      scrubLab.textContent = s
        ? `Replay at ${clock(s.t)}  ·  ${Math.round(s.rps)} req/s  ·  budget ${s.budget}. Drag to scrub. It starts at the worst moment.`
        : 'No replay data.';
    };
    scrub.addEventListener('input', paint);
    paint();
  });
}

function drawHistogram(c: HTMLCanvasElement, lat: number[], slo: number, r: { p50: number; p95: number; p99: number }) {
  const { w, h: hh, dpr } = fitCanvas(c);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, w, hh);
  const pad = { l: 30, r: 10, t: 12, b: 22 };
  const pw = w - pad.l - pad.r, ph = hh - pad.t - pad.b;
  const maxMs = Math.max(slo * 1.6, Math.min(3000, r.p99 * 1.2));
  const bins = 40;
  const counts = new Array(bins).fill(0);
  for (const v of lat) counts[Math.min(bins - 1, Math.floor((v / maxMs) * bins))]++;
  const top = Math.max(1, ...counts);
  const X = (ms: number) => pad.l + (ms / maxMs) * pw;
  for (let i = 0; i < bins; i++) {
    const v = counts[i];
    if (!v) continue;
    const bh = Math.max(1, Math.sqrt(v / top) * ph); // sqrt so the tail is visible
    const x0 = pad.l + (i / bins) * pw;
    ctx.fillStyle = (i / bins) * maxMs > slo ? C.red : C.blue;
    ctx.fillRect(x0 + 1, pad.t + ph - bh, pw / bins - 2, bh);
  }
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t + ph + 0.5);
  ctx.lineTo(pad.l + pw, pad.t + ph + 0.5);
  ctx.stroke();
  ctx.strokeStyle = C.red;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(slo), pad.t);
  ctx.lineTo(X(slo), pad.t + ph);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `10px ${FONT_MONO}`;
  ctx.fillStyle = C.inkSoft;
  ctx.textAlign = 'center';
  for (let ms = 0; ms <= maxMs; ms += maxMs > 1500 ? 500 : 100) ctx.fillText(`${ms}`, X(ms), hh - 8);
  const marks: [string, number][] = [['p50', r.p50], ['p95', r.p95], ['p99', r.p99]];
  marks.forEach(([l, v], i) => {
    if (!v || v > maxMs) return;
    ctx.fillStyle = C.ink;
    ctx.fillRect(X(v) - 0.5, pad.t, 1, ph);
    ctx.fillText(l, X(v), pad.t + 8 + i * 11);
  });
  ctx.fillStyle = C.red;
  ctx.textAlign = 'left';
  ctx.fillText('SLO', X(slo) + 4, pad.t + ph - 4);
}
