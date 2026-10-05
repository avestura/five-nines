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

## When adding a part or a level

- New part: add it to `PARTS`, `ALLOWED`, the sandbox catalog, a card in
  `src/cards.ts`, and at least one real-world case per sensible placement in
  `tools/audit.ts`.
- New level: it needs a `reference` (3 stars) and a `naive` design that fails.
  Each level introduces one idea.
- Keep Debug-only UI behind `load().debug`.
