import { h } from '../dom';
import type { Card } from '../cards';

export function cardEl(c: Card, compact = false) {
  return h('div', { class: 'card' },
    h('div', { class: 'pat' }, `PATTERN: ${c.pattern}`),
    compact ? null : h('h3', {}, c.title),
    h('dl', {},
      h('dt', {}, 'What'), h('dd', {}, c.what),
      h('dt', {}, 'When'), h('dd', {}, c.when),
      h('dt', {}, 'Trade-off'), h('dd', {}, c.cost),
    ),
    h('div', { class: 'links' }, ...c.links.map((l) => h('a', { href: l.href, target: '_blank', rel: 'noopener' }, l.label))),
  );
}
