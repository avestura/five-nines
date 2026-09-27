# Phase 2: Simulation engine

Pure TypeScript, no DOM. Fixed tick (50 ms of sim time) and a seeded RNG, so a level
plays the same way every time and a Node harness can run it headless.

## Model
- **Request:** id, type (`read | write | static | auth | bot`), born tick, deadline.
- **Node:** kind, capacity (concurrent), service time per type, queue limit,
  cost per month, health (`up | down | slow`).
- **Edge:** from, to. Travel time proportional to length (short, but visible).
- **Routing:** each node kind has a route rule. The LB round-robins healthy
  targets. Cache answers reads on hit. CDN answers static. DB is a sink.
- **Outcome:** a request ends as `ok` (reached a node that answers it), `dropped`
  (queue full, no route, node down) or `timeout` (past its deadline).
- **Error budget:** each failed request drains it. Zero means you get paged out.
- **Metrics:** per-second snapshots of node utilization + queue length (for the
  heatmap), plus every completed latency (for the histogram).

## Traffic
A level script is a list of phases `{at, rps, mix}` plus chaos events
`{at, kind, target}`. The forecast strip reads from the same script.

## Checklist
- [x] `src/sim/types.ts`, `src/sim/rng.ts`
- [x] `src/sim/parts.ts` part catalog (stats, costs, vendor names, docs links)
- [x] `src/sim/engine.ts` tick loop, routing, outcomes, budget
- [x] `src/sim/score.ts` percentiles, stars
- [x] `tools/harness.ts` runs every level headless against its reference solution
