# Design notes

Every rule here exists because a lens from Jesse Schell's *The Art of Game
Design* (1st edition, 100 lenses) asked a question and the answer changed
the game. Lens numbers match the book's table of lenses.

## #1 Essential Experience

**The experience:** "It held." A telegraphed spike arrives, the pips under
every part go black, the queue bars creep up, and then the curve passes and
nothing broke.

| Essential | How the game delivers it |
|---|---|
| You can see the storm coming | The forecast strip shows the whole level's traffic and every chaos event before you press Run. |
| You feel the strain | Slot pips fill, nodes tint amber then red, queue bars grow, the hum rises in pitch. |
| Relief is earned | The error budget bar only drains. Keeping it green through the peak is the win. |
| It was your design | Stars and the stamp go to the drawing you made, and the share link lets you show it off. |

## #7 Elemental Tetrad

- **Mechanics:** a graph of parts with slots, queues, service times and costs. Requests carry needs (data, static, pay, write) and route toward whatever can satisfy them.
- **Story:** Queuetix, a concert ticket startup, from three people and a laptop to a global farewell tour. It's told through level intros and self-writing postmortems.
- **Aesthetics:** a drafting table. Graph paper, ink wires, stamped parts, masking-tape labels, an APPROVED stamp. It's warm and hand-made, the opposite of the dark ops dashboard people are tired of.
- **Technology:** one canvas and a thin DOM layer, TypeScript + Vite, no runtime dependencies, and synthesized audio. It hosts statically on GitHub Pages.

**The shared theme:** you are drawing the plan on paper. Every mechanic is something an architect would sketch, and every piece of flavor is something an on-call engineer would recognize.

## #15 Toy

Wiring Fans to a web server and watching colored dots flow is pleasant before
any goal exists. That's why the sandbox exists, and why dots have shapes,
trails and a little jitter.

## #23 Emergence and #32 Meaningful Choices

A handful of parts and five switches produce a large design space. There's
more than one valid answer: in 3.1 both a breaker and (later) a bulkhead help.
The harness still guards against dominant strategies: every level ships with
a **naive** design that must fail, and it's the obvious thing a player would
try first, like adding more web servers.

## #33 Triangularity

There are always two paths:

- **Safe and expensive:** over-provision. You still get the first two stars, but you lose the par star.
- **Lean and risky:** build right at par, and the peak might tip you over.

## #31 Challenge, #18 Flow, and #42 Simplicity/Complexity

The simulation deepens by act (layered depth, per the brief):

1. **Release 1:** capacity, queues and service time. A fixed kit, a forgiving budget.
2. **Release 2:** async work, replicas, bots, retries and routing. A monthly $ cap replaces the kit.
3. **Release 3:** hangs, cascades, sharding, CQRS, regions and sagas. Both the kit and the cap apply.

Each level introduces exactly one new idea.

## #6 Problem Solving and #52 Puzzle: pain first, pattern second

Every level is built so that the previous toolbox *almost* works. The naive
design fails in a way you can see (the replay shows where), and the postmortem
names the pattern. The pattern card arrives only after the win, so the player
already feels why it matters.

## #56 Transparency, #57 Feedback, #58 Juiciness

- Slot pips: black means working, blue means held while waiting on a downstream call. That one visual teaches why slow dependencies are dangerous.
- A queue bar and count above every part.
- DOWN, SLOW and FLAKY stamps on parts, red dashes on a wire when its breaker is open, "429" floating off the rate limiter.
- After each run: a latency histogram (square-root scale so the tail stays visible), a replay you can scrub that opens at the worst moment, and a postmortem that states facts measured from your run.

## #41 Punishment and #30 Fairness

- Failing never loses progress. "Back to drafting" keeps your design.
- Deploying a hotfix mid-run costs a pager strike and 5% of the error budget: a mild, legible cost that makes the build-first hybrid mode meaningful.
- Runs are deterministic (seeded RNG, fixed tick), so the same design gets the same result every time. No bad luck.

## #61 Interest Curve

Every level follows the same shape: a calm opener, rising load, a telegraphed
peak, then release. The releases do too. Release 3 ends on the farewell tour, where
everything happens at once.

## #10 Resonance and #72 Indirect Control

The jokes are aimed at people who have been on call: "us-east-1, obviously",
a status page that stays green, "the load balancer knows what it did". Level
goals hint without instructing ("Nobody said you had to finish them all
instantly").

## #91 Playtesting: what has and has not been tested

- `npm run harness` plays every level headless with its reference and naive design. All 16 levels pass: every reference gets 3 stars, every naive design fails.
- `tools/smoke*.ts` drives the real UI in headless Chrome: mouse placement, wiring, runs, debrief and sandbox.
- **Not done:** real people. The harness can prove a level is solvable and that the obvious wrong answer fails. It cannot tell whether a level feels good, or whether the pattern cards land. That needs human playtests.

## Wiring rules, failure reasons and the Debug button

- **Who may call whom** lives in one table, `ALLOWED` in `src/sim/parts.ts`. The editor, share links and the engine all read it. Fans reach only front-door parts (rate limiter, CDN, load balancer, gateway, global router, web server). Queues feed workers, data stores and payments sit behind web servers and workers. Loops are refused.
- **Every failure has a reason and a place** (`stats.why`, e.g. `no-route(write)@web-1`, `overflow@db`). The debrief reads from it, so it says "nothing after web-1 provides write" instead of blaming whatever node a request happened to be sitting at.
- **Design check** (`src/sim/check.ts`) walks the graph the engine will use before a run: which kinds of request have a route to everything they need, which parts are cut off, which are dead ends. It shows in the banner while drafting and in the debrief when you lose.
- **Debug** button (top bar and debrief) copies a compact dump: nodes, edges, check, run stats, failure reasons, and a `CODE` line. `npm run replay -- "2-3 <code>"` re-runs it headless. `npm run check` runs the design check over every reference.
