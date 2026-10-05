// Prints the debrief's measured cause and fixes for every naive design, so a
// human can check they read right and name the switch or part that is missing.
import { LEVELS } from '../src/levels';
import { Sim } from '../src/sim/engine';
import { diagnose } from '../src/sim/diagnose';

// Levels that teach a switch: the naive design's diagnosis must name it.
const MUST_MENTION: Record<string, RegExp> = {
  '1-5': /health check/i, '2-4': /retry/i, '3-1': /circuit breaker/i, '3-2': /bulkhead/i, '3-5': /region/i, '3-6': /saga/i,
};
let bad = 0;
for (const l of LEVELS) {
  if (!l.naive) continue;
  const s = new Sim(l, l.naive);
  s.runToEnd();
  const d = diagnose(s, l, l.naive);
  console.log(`${l.id} ${l.title}\n  ${d.headline ?? '(no measured cause)'}`);
  for (const f of d.fixes) console.log(`   - ${f}`);
  const need = MUST_MENTION[l.id];
  if (need && !need.test([d.headline, ...d.fixes].join(' '))) { console.log(`  !! diagnosis does not mention ${need}`); bad++; }
}
process.exit(bad ? 1 : 0);
