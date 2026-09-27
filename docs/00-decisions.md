# Decisions (from the owner)

- **Name:** Five Nines
- **Play mode:** hybrid. Build with the clock stopped, press Run, watch it live.
  You can pause mid-run and patch, but every patch costs a pager strike.
- **Essential experience:** "It held." The spike hits, the graph bends, nothing breaks.
- **Player curve:** starts at junior system designer (few parts, forgiving),
  ends at senior engineer (clever puzzles, inside jokes).
- **Constraint:** fixed kit early, monthly $ budget later, both in Act 3.
- **Win/lose:** error budget bar drains live (lose at zero). The end of the run is
  scored on SLO (p99 latency + success rate), cost, and part count. 1 to 3 stars.
- **Requests:** colored dots by type (read, write, static, auth, bot).
- **Framing:** startup story. You are the first infra hire at **Queuetix**, a
  concert ticket seller. Everyone hits "buy" at 10:00:00.
- **Voice:** no mentor character. After each run a blameless postmortem writes
  itself and delivers the lesson and the jokes. Also "pain first": a level is
  built to hurt without the new part, then the part unlocks with a card.
- **Look:** blueprint / drafting. Off-white graph paper, ink lines, stamped
  icons, an APPROVED stamp on a win. No dark neon dashboard.
- **Naming:** generic names, switchable to Azure or AWS names for the whole game.
  Each card links to Azure Architecture Center and AWS prescriptive guidance.
- **Devices:** desktop first. Phones see a notice but can still load.
- **Chaos:** traffic spikes (telegraphed on a forecast strip), component
  failure, slow dependency, bot floods.
- **Debrief:** latency histogram with SLO line, scrubbable heatmap replay,
  postmortem card, shareable URL-encoded design.
- **Sim depth:** layered. Act 1 is capacity + queue + service time. Act 2 adds
  retries and replication lag. Act 3 adds cold starts, retry storms, cascading.
- **Scope:** 3 acts (~16 levels) plus sandbox.
- **Audio:** subtle procedural WebAudio, mute toggle.
- **Stack:** TypeScript + Vite, a GitHub Action deploys to GitHub Pages.
- **Writing style:** plain and human. No em dashes. No AI-ish phrasing.
