// Regression tests for server-side input checks (api/generate-deck.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpec, cleanCards } from '../../api/generate-deck.js';

test('AI builder: extra fields like role:"admin" are dropped', () => {
  const s = cleanSpec({ topic: 'Dutch', role: 'admin', isAdmin: true, model: 'expensive-model', count: 20 });
  assert.equal('role' in s, false);
  assert.equal('isAdmin' in s, false);
  assert.equal('model' in s, false);
  assert.deepEqual(Object.keys(s).sort(), ['alternatives', 'back', 'backHint', 'count', 'focus', 'front', 'frontHint', 'known', 'learning', 'level', 'subject', 'topic']);
});

test('AI builder: wrong types become safe defaults', () => {
  for (const bad of [null, 'text', 42, ['a'], undefined]) {
    const s = cleanSpec(bad);
    assert.equal(s.count, 20);
    assert.equal(s.level, 'Beginner');
    assert.equal(s.front, 'Front');
  }
  const s = cleanSpec({ count: '9999', level: { a: 1 }, topic: { evil: true }, alternatives: 'yes' });
  assert.equal(s.count, 20);              // only the sizes the app offers
  assert.equal(s.level, 'Beginner');      // only the levels the app offers
  assert.equal(typeof s.topic, 'string');
  assert.equal(s.alternatives, true);
});

test('AI builder: text over the limit is cut', () => {
  const s = cleanSpec({ topic: 'x'.repeat(100000), subject: 'y'.repeat(5000), front: 'z'.repeat(5000) });
  assert.equal(s.topic.length, 200);
  assert.equal(s.subject.length, 20);
  assert.equal(s.front.length, 40);
});

test('AI cards: empty, repeated and oversized cards are cleaned; never more than asked', () => {
  const cards = cleanCards([
    { front: 'a', back: '1' }, { front: 'A', back: 'dup' }, { front: '', back: 'x' },
    { front: 'b' }, { front: 'c'.repeat(1000), back: 'd' }, 'junk', null,
    ...Array.from({ length: 50 }, (_, i) => ({ front: `w${i}`, back: `v${i}` })),
  ], 10);
  assert.equal(cards.length, 10);
  assert.equal(cards[0].front, 'a');
  assert.ok(cards.every((c) => c.front && c.back && c.front.length <= 200));
  assert.equal(cleanCards('not a list', 10).length, 0);
});
