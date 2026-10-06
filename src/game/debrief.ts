import { h, fitCanvas } from '../dom';
import { C, FONT_MONO } from '../theme';
import type { Sim } from '../sim/engine';
import { score, starCount } from '../sim/score';
import { PARTS } from '../sim/parts';
import { checkDesign, NEED_WHO } from '../sim/check';
import { diagnose } from '../sim/diagnose';
import { idleGateways, IDLE_GATEWAY_EXTRA } from '../sim/engine';
import type { Need } from '../sim/types';
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
  debug?: () => void; // only with debug enabled in settings
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
  const peakUtil: Record<string, number> = {};
  for (const s of sim.snapshots) for (const [id, u] of Object.entries(s.util)) peakUtil[id] = Math.max(peakUtil[id] ?? 0, u);
  const hottest = Object.entries(peakUtil).sort((a, b) => b[1] - a[1])[0];
  const name = (id: string) => {
    const n = sim.nodes.get(id)?.spec;
    return n ? `${n.label ?? PARTS[n.kind].name} (${n.id})` : id;
  };
  const facts: string[] = [];
  if (hottest && hottest[1] > 0.95) facts.push(`${name(hottest[0])} hit ${Math.round(hottest[1] * 100)}% of its slots.`);
  // Exactly what failed and where, biggest first.
  const sorry: Record<string, (n: number, at: string, need: string) => string> = {
    'no-route': (n, at, need) => `${n} requests reached ${at} and found nothing after it that could provide "${need}". That is a wiring problem, not a capacity one.`,
    overflow: (n, at) => `${n} requests were turned away because ${at} had no free slots and a full queue.`,
    'node-down': (n, at) => `${n} requests were sent to ${at} while it was down.`,
    flaky: (n, at) => `${n} calls to ${at} failed at random.`,
    breaker: (n, at) => `${n} requests failed fast at ${at} because its circuit breaker was open and it had nowhere else to go.`,
    timeout: (n, at) => `${n} fans gave up after 3 seconds while their request was at ${at}. Look at ${at} and what it waits on.`,
    'async-expired': (n, at) => `${n} queued orders were still waiting at ${at} when their time ran out. Not enough workers, or the database behind them is too slow.`,
    'lost-in-crash': (n, at) => `${n} requests were inside ${at} when it went down.`,
    hotfix: (n, at) => `${n} requests were on parts removed by a mid-run hotfix (${at}).`,
  };
  const whyAll = Object.entries(sim.stats.why).sort((a, b) => b[1] - a[1]);
  const why = whyAll.slice(0, 4);
  const parse = (key: string) => /^([a-z-]+)(?:\(([a-z]+)\))?@(.*)$/.exec(key);
  // Dead ends, grouped by what the request still needed, with every part where it got stuck.
  const stuck = new Map<string, { n: number; at: Set<string> }>();
  let noRoute = 0;
  for (const [key, n] of whyAll) {
    const m = parse(key);
    if (!m || m[1] !== 'no-route') continue;
    noRoute += n;
    const g = stuck.get(m[2]) ?? { n: 0, at: new Set<string>() };
    g.n += n;
    g.at.add(m[3]);
    stuck.set(m[2], g);
  }
  // Mostly dead ends means the drawing is wrong, whatever the level's pattern is.
  const wiring = !passed && sim.stats.failed > 0 && noRoute >= sim.stats.failed * 0.5;
  const where = (ids: Set<string>) => {
    const parts = [...ids].map((id) => sim.nodes.get(id)?.spec).filter(Boolean) as NonNullable<ReturnType<typeof sim.nodes.get>>['spec'][];
    if (parts.length && parts.every((p) => p.kind === 'users')) return 'the fans';
    const kinds = [...new Set(parts.map((p) => PARTS[p.kind].name.toLowerCase()))];
    return `${kinds.join(' or ')} (${[...ids].join(', ')})`;
  };
  const wiringLines: string[] = [];
  const wiringFix: string[] = [];
  for (const [need, g] of [...stuck].sort((a, b) => b[1].n - a[1].n)) {
    const who = NEED_WHO[need as Need] ?? need;
    wiringLines.push(`${g.n} requests that needed "${need}" got as far as ${where(g.at)} and had nowhere to go.`);
    wiringFix.push(`Wire ${g.at.size > 1 ? 'each of those parts' : 'that part'} to something that leads to ${who}.`);
  }
  if (wiring && stuck.has('data') && design.nodes.some((x) => x.kind === 'queue')) {
    wiringFix.push('Reads cannot go through a queue: the fan needs the answer in the same request. Give them their own wire from the web servers to a cache, replica, read model or database.');
  }
  if (wiring && stuck.has('data') && design.nodes.some((x) => x.kind === 'pubsub')) {
    wiringFix.push('A topic carries events, not requests: nothing can be read through it. Wire the web servers straight to the read model. The topic only keeps the read model fresh.');
  }
  for (const [key, n] of why) {
    const m = parse(key);
    if (!m || !sorry[m[1]] || m[1] === 'no-route') continue;
    facts.push(sorry[m[1]](n, name(m[3]), m[2] ?? ''));
  }
  if (wiringLines.length) facts.push(...wiringLines, 'That is a wiring problem, not a capacity one: more or bigger parts would not have helped.');
  const bt = sim.stats.byType;
  const dead = wiring ? [] : (['read', 'write', 'static'] as const).filter((t) => bt[t].failed > 10 && bt[t].ok === 0);
  for (const t of dead) facts.push(`Every ${t} request failed (${bt[t].failed}). None got through, so check the route they take.`);
  if (sim.stats.asyncLost > 0 && !why.some(([k]) => k.startsWith('async-expired'))) facts.push(`${sim.stats.asyncLost} queued orders were never processed.`);
  if (sim.stats.blocked > 0) facts.push(`The rate limiter turned away ${sim.stats.blocked} bot requests.`);
  if (sim.stats.botLost > 0) facts.push(`${sim.stats.botLost} more bot requests died inside your system without being blocked. They still used up your servers on the way.`);
  if (sim.stats.strikes > 0) facts.push(`${sim.stats.strikes} hotfix${sim.stats.strikes > 1 ? 'es were' : ' was'} deployed mid-incident.`);
  if (!facts.length) facts.push('Nothing notable. A boring incident report is the best kind.');
  const dx = diagnose(sim, L, design);
  const problems = passed || !load().debug ? [] : checkDesign(L, design).problems;

  const pm = h('div', { class: 'pm' },
    h('h5', {}, 'Summary'),
    ...(passed
      ? L.postmortem.win
      : wiring
        ? [`Summary: ${noRoute} of ${sim.stats.failed} failed requests hit a dead end: the drawing gave them no route to what they needed. Nothing ran out of capacity.`]
        : dx.headline
          ? [`Summary: ${dx.headline}`]
          : L.postmortem.lose).map((l) => h('div', {}, l)),
    problems.length ? h('h5', {}, 'Problems with the drawing') : null,
    problems.length ? h('ul', {}, ...problems.map((f) => h('li', {}, f))) : null,
    h('h5', {}, 'What the graphs say'),
    h('ul', {}, ...facts.map((f) => h('li', {}, f))),
    sim.events.length ? h('h5', {}, 'Timeline') : null,
    sim.events.length
      ? h('ul', {}, ...sim.events.slice(0, 8).map((e) => h('li', {}, h('span', { class: 'tl' }, clock(e.t) + '  '), e.text)))
      : null,
    !passed || stars < 3 || idleGateways(design).length ? h('h5', {}, 'Action items') : null,
    ...(!passed && wiring ? wiringFix.map((l) => h('div', {}, l)) : []),
    !passed && wiring ? h('div', {}, `Once every request has a route, this level is about: ${L.postmortem.hint}`) : null,
    ...(!passed && !wiring ? dx.fixes.map((f) => h('div', {}, f)) : []),
    ...(!passed || stars < 3 ? dx.notes.map((f) => h('div', {}, f)) : []),
    !passed && !wiring ? h('div', {}, dx.headline ? `The pattern this level teaches: ${L.postmortem.hint}` : L.postmortem.hint) : null,
    passed && !r.stars[1] ? h('div', {}, `p99 was ${r.p99} ms against a ${L.slo.p99} ms target. Find the queue that is backing up.`) : null,
    passed && !r.stars[2] ? h('div', {}, `You spent $${r.cost}/mo. Par is $${L.parCost}. Something is doing less than it costs.`) : null,
    idleGateways(design).length ? h('div', {}, `The API gateway (${idleGateways(design).join(', ')}) had only one kind of service behind it, so it had nothing to route. It was billed an extra $${idleGateways(design).length * IDLE_GATEWAY_EXTRA}/mo. A load balancer would have done the job for $25.`) : null,
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
        act.debug ? h('button', { class: 'btn', onclick: () => act.debug!(), title: 'Compact text dump for bug reports' }, 'Debug') : null,
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
