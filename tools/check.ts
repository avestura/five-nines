// Runs the static design check over every level's reference design. A good
// reference must have no problems.
import { LEVELS } from '../src/levels';
import { checkDesign } from '../src/sim/check';
import { idleGateways } from '../src/sim/engine';

let bad = 0;
for (const l of LEVELS) {
  const c = checkDesign(l, l.reference);
  if (idleGateways(l.reference).length) c.problems.push('reference has an idle gateway');
  if (c.problems.length) { bad++; console.log(l.id, c.problems); }
}
console.log(bad ? `${bad} references have problems` : 'all references pass the design check');
process.exit(bad ? 1 : 0);
