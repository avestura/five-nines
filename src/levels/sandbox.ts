import type { Level, PartKind } from '../sim/types';
import { FANS } from './act1';

const EVERYTHING: PartKind[] = [
  'web', 'db', 'lb', 'cache', 'cdn', 'queue', 'worker', 'replica', 'waf', 'gateway',
  'shardrouter', 'pubsub', 'readmodel', 'dns',
];

// Free build. Traffic comes from the sliders, chaos from the buttons.
export const SANDBOX: Level = {
  id: 'sandbox',
  act: 0,
  title: 'Sandbox',
  clock: ['00:00', '23:59'],
  intro: [
    'Everything is unlocked. There is no forecast, no par, and nobody is watching.',
    'Set the traffic with the sliders. Select a part and break it with the chaos buttons.',
    'The error budget is effectively infinite. Build the thing you have been wondering about.',
  ],
  goal: 'Poke it until it falls over. Then work out why.',
  duration: 600,
  seed: 99,
  traffic: [{ at: 0, rps: 100, mix: { read: 0.7, write: 0.15, static: 0.1, bot: 0.05 } }],
  chaos: [],
  fixed: [FANS],
  catalog: EVERYTHING,
  options: ['healthCheck', 'retry', 'breaker', 'bulkhead', 'saga'],
  needs: { write: ['write'] },
  parCost: 0,
  slo: { p99: 400, success: 0.99 },
  errorBudget: 99999,
  reference: { nodes: [FANS], edges: [] },
  postmortem: { win: ['Summary: you built a thing. It did things.'], lose: ['Summary: you broke it on purpose. Well done.'], hint: '' },
};
