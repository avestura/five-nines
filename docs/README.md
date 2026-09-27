# Five Nines: docs

Work is split into phases. Each phase is a separate file with a checklist.
Build one phase, check it off, then move on to the next.

| Phase | File | Goal |
|---|---|---|
| 0 | [00-decisions.md](00-decisions.md) | Everything the owner already decided. Read first. |
| 1 | [01-scaffold.md](01-scaffold.md) | Vite + TS project, GitHub Pages deploy, blank blueprint canvas |
| 2 | [02-engine.md](02-engine.md) | Deterministic simulation: nodes, queues, routing, error budget |
| 3 | [03-editor.md](03-editor.md) | Place parts, draw wires, inspect, pause and patch |
| 4 | [04-act1.md](04-act1.md) | Act 1 "Garage": 5 levels, first parts, pattern cards |
| 5 | [05-debrief.md](05-debrief.md) | Histogram, heatmap replay, postmortem, stars, share link |
| 6 | [06-act2.md](06-act2.md) | Act 2 "Growth": queues, replicas, rate limits, retries |
| 7 | [07-act3.md](07-act3.md) | Act 3 "Scale": breakers, bulkheads, shards, regions, saga |
| 8 | [08-polish.md](08-polish.md) | Sandbox, audio, settings, vendor naming, balance harness |
| - | [design.md](design.md) | Lens-by-lens design notes (Schell) |

Rule for every phase: when it ends, the game builds, runs, and is playable up to
that point.
