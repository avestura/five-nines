# Five Nines

A browser game about keeping a concert ticket startup online. Drag parts onto
a sheet of graph paper, wire them up, press Run, and watch the traffic arrive.
Each level is built to hurt without a particular cloud design pattern, and
unlocks that pattern when you beat it.

Sixteen levels across three releases, plus a sandbox:

| Release | Levels | Patterns |
|---|---|---|
| 1 Garage | 1.1 to 1.5 | horizontal scaling, cache-aside, static content hosting, health endpoint monitoring |
| 2 Growth | 2.1 to 2.5 | queue-based load leveling, competing consumers, read replicas, rate limiting, retry, gateway routing |
| 3 Scale | 3.1 to 3.6 | circuit breaker, bulkhead, sharding, CQRS + pub/sub, geodes / deployment stamps, saga |

Part names can be switched between generic, Azure and AWS on the title screen.
Every pattern card links to the Azure Architecture Center and AWS Prescriptive
Guidance.

## Run it

```sh
npm install
npm run dev        # play locally
npm run harness    # prove every level is winnable and the naive design fails
npm run build      # static site in dist/
```

## Deploy to GitHub Pages

Push to `main` on GitHub. In the repo settings, set **Pages > Source** to
**GitHub Actions**. `.github/workflows/deploy.yml` runs the balance harness,
builds, and publishes `dist/`. The build uses relative paths, so any repo
name works.

## Layout

```
src/sim/       deterministic simulation (no DOM): engine, parts, scoring
src/levels/    act1.ts, act2.ts, act3.ts, sandbox.ts
src/game/      canvas renderer, editor/controller, forecast strip, debrief
src/cards.ts   pattern cards and doc links
tools/         harness.ts (balance), scan.ts (tuning), smoke*.ts (headless Chrome)
docs/          phase plans and design.md (lens-by-lens design notes)
```

## Adding a level

Write the `Level` in `src/levels/actN.ts` with a `reference` design that should
win and a `naive` design that should lose. Then run
`npx tsx tools/scan.ts <id>` to see both at several traffic scales, and
`python tools/scale.py <file> <id> <factor>` to apply one. `npm run harness`
has to pass before CI will deploy.
