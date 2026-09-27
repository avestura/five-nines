import { C, FONT_HAND, FONT_MONO } from '../theme';
import { TYPE_COLOR } from './render';
import type { Level, ReqType } from '../sim/types';
import { REQ_TYPES } from '../sim/types';

function rpsAt(level: Level, sec: number) {
  const pts = level.traffic;
  if (sec <= pts[0].at) return pts[0].rps;
  for (let i = 1; i < pts.length; i++) {
    if (sec <= pts[i].at) {
      const a = pts[i - 1], b = pts[i];
      return a.rps + ((b.rps - a.rps) * (sec - a.at)) / Math.max(1e-6, b.at - a.at);
    }
  }
  return pts[pts.length - 1].rps;
}

function mixAt(level: Level, sec: number): Record<ReqType, number> {
  let mix = level.traffic[0].mix ?? { read: 1 };
  for (const p of level.traffic) if (p.at <= sec && p.mix) mix = p.mix;
  const m = { read: 0, write: 0, static: 0, bot: 0, ...mix };
  const s = REQ_TYPES.reduce((a, k) => a + m[k], 0) || 1;
  for (const k of REQ_TYPES) m[k] /= s;
  return m;
}

// The forecast strip: stacked traffic by type, chaos markers, playhead.
// Everything the level will throw at you is visible before you press Run.
export function drawForecast(ctx: CanvasRenderingContext2D, w: number, h: number, level: Level, playSec: number | null) {
  ctx.fillStyle = '#ece6d6';
  ctx.fillRect(0, 0, w, h);
  const padL = 56, padR = 16, padT = 20, padB = 18;
  const pw = w - padL - padR, ph = h - padT - padB;
  const dur = level.duration;
  const peak = Math.max(...level.traffic.map((p) => p.rps)) * 1.15;
  const X = (s: number) => padL + (s / dur) * pw;
  const Y = (r: number) => padT + ph - (r / peak) * ph;

  ctx.strokeStyle = C.gridMinor;
  ctx.lineWidth = 1;
  for (let s = 0; s <= dur; s += 5) {
    ctx.beginPath();
    ctx.moveTo(X(s) + 0.5, padT);
    ctx.lineTo(X(s) + 0.5, padT + ph);
    ctx.stroke();
  }

  // stacked areas, sampled
  const steps = Math.max(40, Math.floor(pw / 4));
  const order: ReqType[] = ['bot', 'static', 'write', 'read'];
  let base = new Array(steps + 1).fill(0);
  for (const type of order) {
    const top = base.map((b, i) => {
      const s = (i / steps) * dur;
      return b + rpsAt(level, s) * mixAt(level, s)[type];
    });
    if (top.some((v, i) => v > base[i] + 0.01)) {
      ctx.fillStyle = TYPE_COLOR[type] + '55';
      ctx.beginPath();
      top.forEach((v, i) => (i ? ctx.lineTo(X((i / steps) * dur), Y(v)) : ctx.moveTo(X(0), Y(v))));
      for (let i = steps; i >= 0; i--) ctx.lineTo(X((i / steps) * dur), Y(base[i]));
      ctx.closePath();
      ctx.fill();
    }
    base = top;
  }
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  base.forEach((v, i) => (i ? ctx.lineTo(X((i / steps) * dur), Y(v)) : ctx.moveTo(X(0), Y(v))));
  ctx.stroke();

  // axis
  ctx.fillStyle = C.inkSoft;
  ctx.font = `11px ${FONT_MONO}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const peakRps = Math.max(...level.traffic.map((p) => p.rps));
  ctx.fillText(`${Math.round(peakRps)}`, padL - 6, Y(peakRps));
  ctx.fillText('0', padL - 6, Y(0));
  ctx.save();
  ctx.translate(12, padT + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('req/s', 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.font = `13px ${FONT_HAND}`;
  ctx.fillStyle = C.ink;
  ctx.fillText('Forecast', padL, 10);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.inkSoft;
  ctx.font = `11px ${FONT_MONO}`;
  ctx.fillText(`${level.clock[0]}  to  ${level.clock[1]}`, w - padR, 10);

  // chaos markers
  ctx.textAlign = 'left';
  level.chaos.forEach((ev, i) => {
    const x = X(ev.at);
    ctx.strokeStyle = C.red;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.red;
    ctx.beginPath();
    ctx.moveTo(x, padT + ph);
    ctx.lineTo(x - 5, padT + ph + 8);
    ctx.lineTo(x + 5, padT + ph + 8);
    ctx.fill();
    ctx.font = `12px ${FONT_HAND}`;
    // Stagger labels so neighbouring events do not print over each other,
    // and give each a paper backing so the traffic fill does not eat it.
    const label = ev.note ?? ev.kind;
    const ly = padT + 8 + (i % 3) * 14;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(236,230,214,0.85)';
    ctx.fillRect(x + 3, ly - 8, tw + 4, 14);
    ctx.fillStyle = C.red;
    ctx.fillText(label, x + 5, ly);
  });

  if (playSec !== null) {
    const x = X(Math.min(dur, playSec));
    ctx.fillStyle = 'rgba(31,58,147,0.08)';
    ctx.fillRect(padL, padT, x - padL, ph);
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, padT - 4);
    ctx.lineTo(x, padT + ph + 4);
    ctx.stroke();
  }

  // legend
  ctx.font = `11px ${FONT_MONO}`;
  let lx = padL + 80;
  for (const t of REQ_TYPES) {
    const used = level.traffic.some((p) => (p.mix?.[t] ?? 0) > 0);
    if (!used) continue;
    ctx.fillStyle = TYPE_COLOR[t];
    ctx.fillRect(lx, 6, 8, 8);
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = 'left';
    ctx.fillText(t, lx + 11, 10);
    lx += 62;
  }
}
