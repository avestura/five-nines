import './style.css';
import { h, clear } from './dom';
import { LEVELS, ACTS, levelById } from './levels';
import { load, save, type Naming } from './store';
import { decodeDesign, readHash } from './share';
import { Game } from './game/game';
import type { Design, Level } from './sim/types';
import { SANDBOX } from './levels/sandbox';

const app = document.getElementById('app')!;
let game: Game | null = null;

function unlocked(i: number) {
  if (i === 0) return true;
  const s = load().stars;
  return (s[LEVELS[i - 1].id] ?? 0) > 0 || (s[LEVELS[i].id] ?? 0) > 0;
}

function freshDesign(level: Level): Design {
  return { nodes: level.fixed.map((n) => ({ ...n })), edges: [...(level.fixedEdges ?? [])] };
}

function openLevel(level: Level, design?: Design) {
  game?.destroy();
  const saved = load().designs[level.id];
  const d = design ?? (saved ? decodeDesign(saved, level) : null) ?? freshDesign(level);
  history.replaceState(null, '', location.pathname + location.search);
  game = new Game(app, level, d, {
    onExit: () => showMap(),
    onNext: (l) => openLevel(l),
  });
  game.showIntro();
}

function showMap() {
  game?.destroy();
  game = null;
  clear(app);
  const s = load();
  const naming = (n: Naming, label: string) =>
    h('button', { class: `btn small ${s.naming === n ? 'on' : ''}`, onclick: () => { save((x) => (x.naming = n)); showMap(); } }, label);

  const total = LEVELS.length * 3;
  const sandboxOpen = LEVELS.filter((l) => l.act === 1).every((l) => (s.stars[l.id] ?? 0) > 0);
  const got = LEVELS.reduce((a, l) => a + (s.stars[l.id] ?? 0), 0);

  app.append(
    h('div', { class: 'title-screen paper' },
      h('div', { class: 'title-sheet' },
        h('div', { class: 'title-top' },
          h('h1', { class: 'logo' }, 'FIVE NINES', h('small', {}, '99.999%  ·  about 5 minutes of downtime a year')),
          h('div', { class: 'title-note' },
            'You are the first infrastructure hire at Queuetix, a concert ticket startup. ',
            'Every big on-sale starts at 10:00:00 sharp, and every fan clicks at once. Keep it up.'),
          h('div', { class: 'title-settings' },
            h('span', {}, 'names:'), naming('generic', 'Generic'), naming('azure', 'Azure'), naming('aws', 'AWS'),
            h('button', { class: 'btn small', onclick: () => { save((x) => (x.muted = !x.muted)); showMap(); } }, s.muted ? 'Sound off' : 'Sound on'),
          ),
        ),
        h('div', { class: 'title-row' },
          h('div', { class: 'tape' }, `${got} / ${total} stars`),
          h('button', {
            class: 'btn small', disabled: !sandboxOpen,
            title: sandboxOpen ? 'Free build with every part' : 'Finish Act 1 to open the sandbox',
            onclick: () => openLevel(structuredClone(SANDBOX)),
          }, sandboxOpen ? 'Sandbox' : 'Sandbox (finish Act 1)'),
        ),
        h('div', { class: 'phone-note tape' }, 'This plays best on a desktop with a mouse.'),
        ...ACTS.map((a) =>
          h('section', { class: 'act' },
            h('h2', {}, `ACT ${a.n}: ${a.name.toUpperCase()}`, h('span', {}, a.blurb)),
            h('div', { class: 'sheets' },
              ...LEVELS.map((l, i) => ({ l, i })).filter(({ l }) => l.act === a.n).map(({ l, i }) => {
                const st = s.stars[l.id] ?? 0;
                const open = unlocked(i);
                return h('button', { class: 'sheet', disabled: !open, onclick: () => openLevel(l) },
                  h('span', { class: 'num' }, `SHEET ${l.id.replace('-', '.')}  ·  ${l.clock[0]}`),
                  h('span', { class: 'name' }, open ? l.title : 'Locked'),
                  st ? h('span', { class: 'stars' }, '★'.repeat(st) + '☆'.repeat(3 - st)) : null,
                  st ? h('span', { class: 'stamp' }, 'Approved') : null,
                );
              }),
            ),
          ),
        ),
      ),
    ),
  );
}

// Shared links open straight into the level with the sender's design.
const hash = readHash();
const shared = hash.level ? levelById(hash.level) : undefined;
if (shared) {
  const d = hash.design ? decodeDesign(hash.design, shared) : null;
  openLevel(shared, d ?? undefined);
} else {
  showMap();
}
