# Agent notes for Five Nines

A browser game about cloud design patterns. TypeScript + Vite, no runtime deps.
Sim in `src/sim`, UI in `src/game`, levels in `src/levels`.

## Checks to run after any sim, wiring, part or level change

```
npx tsc --noEmit
npm run harness   # every reference wins, every naive design loses, no shortcuts pass
npm run check     # static design check passes on every reference
npm run audit     # real-world arrangements are accepted AND do something
npm run diagnose  # debrief causes/fixes for every naive design; teaching switches must be named
npm run playtest  # ~130 hand-written solutions per level; '!!' lines are where the game disagrees with the author
```

`npm run replay -- "<level> <code>"` re-runs a design from the in-game Debug
dump (enable Debug in the title-screen settings). Ask users for that dump
before guessing at a "the game rejected my good design" report.

## Lessons learned (read before touching parts, wiring or levels)

These all came from player reports where a design that is correct in real life
was refused or silently did nothing.

1. **Model what a part is for, not where the reference solution put it.** The
   1.4 CDN only worked as `fans > cdn > lb`. In reality a web server hands the
   browser the CDN's address, and the CDN pulls from an origin. A CDN wired
   beside the app did nothing and the player had no way to know. Before adding
   or changing a part, list every way an engineer would draw it (in front,
   beside, behind, attached, origin-pull) and make each one work or refuse it
   with a message that says what to do instead.
2. **A part the player can place must never be silently inert.** Either the
   wire is refused with a reason (`wireProblem`), or it works. The design check
   (`src/sim/check.ts`) reports cut-off and dead-end parts. If you add a way to
   be inert, add a message for it.
3. **One table for who may call whom**: `ALLOWED` in `src/sim/parts.ts`. The
   editor, share links, engine and check all read it. Do not add rules
   elsewhere. Loops are refused (`wouldCycle`).
4. **Never let the reference solution define the rules.** The harness only
   proves that the reference wins and the naive design loses. It cannot prove
   other correct designs win. When you add a rule, ask "what else would a
   reasonable player build?" and add a case to `tools/audit.ts`.
5. **Errors must name the cause and the place.** Every failure goes through
   `finish(r, outcome, noRetry, reason)` and is counted in `stats.why` as
   `reason@node`. Do not add a failure path without a reason. Do not count
   something as a success ("blocked, good") unless the player did it on purpose.
6. **Canned level text must not contradict measured failures.** The debrief's
   per-level `postmortem.lose` and `hint` describe the level's pattern, not what
   went wrong. When most failures are dead ends (`no-route`), the debrief
   replaces the summary with the measured cause and puts the level hint after
   it. Keep that rule when adding failure kinds: measured facts first, canned
   pattern second, and the debrief must read correctly with Debug off.
7. **Every inspector switch needs a symptom detector.** `src/sim/diagnose.ts`
   maps measured failures to the switch or part that would have helped, and
   says when the switch is available but off (health check, retry, breaker,
   bulkhead, saga). When you add a switch or a failure reason, add its detector
   and list the level in `MUST_MENTION` in `tools/diagnose.ts`. A debrief that
   only repeats the level's canned pattern text is a bug.
8. **Text must match behavior.** Level intros, goals, hints, blurbs and card
   text make claims (capacity numbers, "two servers will not be enough").
   When you change the sim or a level, re-read the text. The harness will not
   catch a wrong sentence.
9. **Shortcuts are bugs.** Fans wired straight to a store, queue or worker must
   fail; the harness checks every non-front-door kind. If you add a part,
   decide whether fans may reach it and keep the harness in step.
10. **Requests that need more than one step** (charge, then save) are held by a
   web server or worker that calls its downstream parts in turn. Any static
   analysis of routes has to model that, or it will flag valid designs
   (`walk` in `check.ts`).

11. **Say where the game simplifies reality.** If a rule is stricter or
    narrower than the real thing (queues here take writes only), put it in the
    part's card under `inGame`, in the blurb, and in the debrief when it is the
    cause of a failure. Players with real experience will otherwise think the
    game is wrong.

12. **Only balancers may balance.** A part that is not a load balancer, global
    router or gateway must not be able to spread traffic over several targets,
    or the load balancer becomes optional. `ONE_NEXT_HOP` (fans, rate limiter,
    CDN) enforces it in the editor, the engine and share links, and the harness
    has a `wafLB` cheat check. When adding a part, decide if it may fan out and
    extend that check. (The gateway may balance; it also routes by request type.)

13. **A part must cost something when it is not needed.** The gateway is billed
    an extra `IDLE_GATEWAY_EXTRA` when only one kind of service sits behind it
    (`idleGateways` in `engine.ts`; part of `designCost`, so the cap, stars,
    top bar, inspector, debrief and dump all agree). If you add a part that has a
    cheaper stand-in (a gateway vs a load balancer), decide how "not needed" is
    detected and make that visible everywhere cost is shown.

14. **The UI must not offer what the rules refuse.** The wiring grip on a part
    shows only if `ALLOWED[kind]` is non-empty. Do not hard-code lists of kinds
    in the UI; derive from the table.

15. **A part that carries events must not be a stop on a request's route.** A
    player routed reads web > topic > read model and passed 3.4 with topics
    "serving" requests. A topic only feeds subscribers (its reach is empty in
    `computeReach`). When adding a part, say whether requests pass through it,
    and add a negative case to `tools/audit.ts` (things that must not work).
16. **Eventual consistency has to be paid for.** A read model only answers if
    every web server or worker that writes to the data also publishes to its
    topic (`stale` in the engine). One publisher out of five is not CQRS, it is
    a read model that misses 80% of writes. If you add a derived copy of data,
    decide what makes it trustworthy and enforce that.
17. **Follow the real read path.** With a read model wired, queries go to it and
    not to the database (CQRS); with a cache wired, the cache is asked first.

18. **Chaos must not be predictable from the board.** If a level says "this
    fails" and the player can see where, they will simply avoid it (3.5: put
    everything in the south). Target the part or region the player leans on
    (`pick: 'busiest'`, `region: 'busiest'`), never a fixed spot, and add a
    harness cheat that dodges it.

19. **Board geometry lives in constants.** The global strip of a two-region board
    is `GLOBAL_STRIP` in `src/sim/types.ts`; the engine, renderer, diagnosis and
    harness all read it. Do not hard-code pixel positions for it, and give the
    player room for every part the level asks them to place (3.5 moves Fans left
    so the global router fits beside them).

20. **A level's premise must be enforced, not just described.** In 2.5 the Tickets
    app could answer browsing because any web server wired to a database could.
    `NodeSpec.handles` limits an app to the request kinds it owns. If a level says
    "team A owns X", make the engine refuse X from team B.
21. **Queued work is late, not lost.** A queued order past its deadline is counted
    once as failed (`async-late`, attributed to its queue) but is still worked. The
    debrief names what behind the queue was full. Do not delete work from a
    queue to punish a slow consumer.
22. **Sharded data is reached through the shard map.** `ownedByShardMap`: a database
    wired from a shard map accepts no wires from anything else, so reads cannot
    skip it.
23. **Praise only what the player did.** `postmortem.pattern` lists the parts or
    switches a level's win text praises. If the design lacks them, the debrief says
    it held another way. Add `pattern` when you add a level.
24. **Play the game, do not just run the reference.** `npm run playtest` runs ~125
    hand-written solutions, good and bad, on every level. It exits non-zero when the
    game disagrees with the author's expectation. Add scenarios for every new rule.

## When adding a part or a level

- New part: add it to `PARTS`, `ALLOWED`, the sandbox catalog, a card in
  `src/cards.ts`, and at least one real-world case per sensible placement in
  `tools/audit.ts`.
- New level: it needs a `reference` (3 stars) and a `naive` design that fails.
  Each level introduces one idea.
- Keep Debug-only UI behind `load().debug`.
