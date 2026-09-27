import { designCost, type Sim } from './engine';
import type { Design } from './types';

export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

export interface Result {
  survived: boolean;
  success: number;
  p50: number;
  p95: number;
  p99: number;
  cost: number;
  stars: [boolean, boolean, boolean]; // survived + success, p99, cost
  total: number;
}

export function score(sim: Sim, design: Design): Result {
  const s = sim.stats;
  const lat = [...s.latencies].sort((a, b) => a - b);
  const total = s.ok + s.failed;
  const success = total ? s.ok / total : 1;
  const survived = sim.state !== 'paged';
  const cost = designCost(design);
  const slo = sim.level.slo;
  const p99 = percentile(lat, 0.99);
  const first = survived && success >= slo.success;
  return {
    survived,
    success,
    p50: percentile(lat, 0.5),
    p95: percentile(lat, 0.95),
    p99,
    cost,
    stars: [first, first && p99 <= slo.p99, first && cost <= sim.level.parCost],
    total,
  };
}

export function starCount(r: Result) {
  return r.stars.filter(Boolean).length;
}
