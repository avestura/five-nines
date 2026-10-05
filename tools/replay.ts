// Replays a design pasted from the in-game Debug button.
//   npx tsx tools/replay.ts "<CODE line>"      e.g. "2-3 eyJu..."
import { levelById } from '../src/levels';
import { decodeDesign } from '../src/share';
import { Sim } from '../src/sim/engine';
import { dumpState } from '../src/sim/dump';

const [id, code] = process.argv.slice(2).join(' ').replace(/^CODE\s+/, '').split(/\s+/);
const level = levelById(id);
if (!level) { console.error('unknown level', id); process.exit(1); }
const d = decodeDesign(code, level);
if (!d) { console.error('bad code'); process.exit(1); }
const sim = new Sim(level, d);
sim.runToEnd();
console.log(dumpState(level, d, sim));
