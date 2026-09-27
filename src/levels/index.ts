import { ACT1 } from './act1';
import { ACT2 } from './act2';
import { ACT3 } from './act3';
import type { Level } from '../sim/types';

export const LEVELS: Level[] = [...ACT1, ...ACT2, ...ACT3];

export const ACTS = [
  { n: 1, name: 'Garage', blurb: 'Three people, one laptop, one band that said yes.' },
  { n: 2, name: 'Growth', blurb: 'Queuetix goes viral. Now you have a budget, and so do the scalpers.' },
  { n: 3, name: 'Scale', blurb: 'Global, famous, and one bad dependency away from the front page.' },
];

export function levelById(id: string) {
  return LEVELS.find((l) => l.id === id);
}
