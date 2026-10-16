import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, normalise } from './evaluate.js';
import { nextBox, buildSession, schedule } from './srs.js';
import { parseCSV, rowsToDeck, toCsvUrl, displayLines } from './csv.js';

test('normalise', () => {
  assert.equal(normalise('  Hoe kom  jij, naar het werk?! '), 'hoe kom jij naar het werk');
});

test('evaluate verdicts', () => {
  assert.equal(evaluate('Hoe kom jij naar het werk', 'Hoe kom jij naar het werk?').verdict, 'correct');
  assert.equal(evaluate('Hoe kom jij naat het werk?', 'Hoe kom jij naar het werk?').verdict, 'almost');
  assert.equal(evaluate('tres', 'três').verdict, 'almost');
  assert.equal(evaluate('cinco', 'dois').verdict, 'wrong');
  assert.equal(evaluate('', 'um').verdict, 'wrong');
  const alt = evaluate('uma', 'um|uma');
  assert.equal(alt.verdict, 'correct');
  assert.equal(alt.match, 'uma');
});

test('leitner boxes follow the verdict', () => {
  assert.equal(nextBox(0, 'correct'), 2);   // new card answered right
  assert.equal(nextBox(3, 'correct'), 4);
  assert.equal(nextBox(5, 'correct'), 5);   // capped
  assert.equal(nextBox(3, 'almost'), 3);    // stays
  assert.equal(nextBox(0, 'almost'), 1);
  assert.equal(nextBox(4, 'wrong'), 1);
  const s = schedule({ box: 2, reviews: 3, lapses: 0 }, 'correct', new Date('2026-01-01'));
  assert.equal(s.box, 3);
  assert.equal(s.due_at, new Date('2026-01-05').toISOString());
});

test('session: due first oldest-first, then up to 10 new', () => {
  const now = new Date('2026-06-01');
  const due = Array.from({ length: 3 }, (_, i) => ({
    key: `d${i}`, progress: { due_at: new Date(now - (i + 1) * 864e5).toISOString() },
  }));
  const later = [{ key: 'l', progress: { due_at: new Date(+now + 864e5).toISOString() } }];
  const fresh = Array.from({ length: 10 }, (_, i) => ({ key: `n${i}`, progress: null }));
  const s = buildSession([...due, ...later, ...fresh], { now });
  assert.deepEqual(s.slice(0, 3).map((c) => c.key), ['d2', 'd1', 'd0']);
  assert.equal(s.length, 3 + 7); // 3 due + 7 new to fill 10
  assert.ok(!s.some((c) => c.key === 'l'));
  const many = Array.from({ length: 25 }, (_, i) => ({ key: `x${i}`, progress: { due_at: new Date(now - i * 1000).toISOString() } }));
  assert.equal(buildSession([...many, ...fresh], { now }).length, 10);
});

test('csv parsing', () => {
  const rows = parseCSV('English,Dutch\r\n"Hello, you",Hallo|Hoi\n"Say ""hi""","Zeg • hoi"\n,\n');
  const deck = rowsToDeck(rows);
  assert.equal(deck.frontLabel, 'English');
  assert.equal(deck.cards.length, 2);
  assert.equal(deck.cards[0].front, 'Hello, you');
  assert.equal(deck.cards[1].front, 'Say "hi"');
  assert.deepEqual(displayLines(deck.cards[1].back), ['Zeg', 'hoi']);
});

test('sheet url conversion', () => {
  assert.equal(
    toCsvUrl('https://docs.google.com/spreadsheets/d/abc123/edit#gid=42'),
    'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv&gid=42',
  );
  assert.equal(
    toCsvUrl('https://docs.google.com/spreadsheets/d/e/2PACX-x/pubhtml'),
    'https://docs.google.com/spreadsheets/d/e/2PACX-x/pub?output=csv',
  );
});

import { diffAnswer } from './evaluate.js';
test('diff marks only the letters that differ', () => {
  const r = diffAnswer('Hoe kom jij naat het werk', 'Hoe kom jij naar het werk?');
  assert.deepEqual(r.typed.filter((x) => x.mark).map((x) => x.text), ['t']);
  assert.deepEqual(r.answer.filter((x) => x.mark).map((x) => x.text), ['r']);
  const miss = diffAnswer('tres', 'três');
  assert.deepEqual(miss.answer.filter((x) => x.mark).map((x) => x.text), ['ê']);
});

import { parseLooseTable } from './csv.js';
import { buildPrompt } from './prompt.js';
test('pasted AI output: fenced CSV, tabs, markdown', () => {
  const fenced = 'Here you go!\n```csv\nEnglish,Dutch\nto go,gaan|lopen\n"Hi, you",Hoi\n```\nEnjoy';
  const d1 = parseLooseTable(fenced);
  assert.equal(d1.frontLabel, 'English');
  assert.equal(d1.cards.length, 2);
  assert.equal(d1.cards[0].back, 'gaan|lopen');
  const d2 = parseLooseTable('Term\tDefinition\nAtom\tSmallest unit');
  assert.equal(d2.cards[0].front, 'Atom');
  const d3 = parseLooseTable('| Event | Year |\n|---|---|\n| Moon landing | 1969 |');
  assert.deepEqual(d3.cards[0], { front: 'Moon landing', back: '1969' });
});
test('prompt fills the template', () => {
  const p = buildPrompt({ subject: 'language', known: 'English', learning: 'Dutch', front: 'English', back: 'Dutch',
    frontHint: 'a phrase in English', backHint: 'the same in Dutch', count: 20, level: 'Beginner', alternatives: true });
  assert.match(p, /Make 20 flashcards for learning Dutch for someone who speaks English/);
  assert.match(p, /header row is exactly: \| English \| Dutch \|/);
  assert.match(p, /answer one\|answer two/);
});

import { answerMode, makeOptions } from './srs.js';
import { imageSrc } from './media.js';
import { SAMPLE_DECKS } from './sampleDeck.js';
test('answer mode: long answers use multiple choice, short ones typing', () => {
  const signs = { cards: [
    { front: 'Belgian road sign A13.svg', back: 'Uneven road' },
    { front: 'Belgian road sign B5.svg', back: 'Stop' },
    { front: 'Belgian road sign C1.svg', back: 'No entry for all vehicles' },
    { front: 'Belgian road sign D5.svg', back: 'Roundabout' },
    { front: 'Belgian road sign A23.svg', back: 'Children crossing ahead here' },
  ] };
  assert.equal(answerMode(signs), 'choice');
  // Flags deck is explicitly multiple choice.
  assert.equal(answerMode(SAMPLE_DECKS.flagsWorld), 'choice');
  // A deck of short answers with no override stays typed.
  assert.equal(answerMode({ cards: [{ front: 'a', back: 'um' }, { front: 'b', back: 'dois' }, { front: 'c', back: 'tres' }, { front: 'd', back: 'vier' }] }), 'type');
  assert.equal(answerMode({ ...SAMPLE_DECKS.flagsWorld, answer_mode: 'type' }), 'type');
  assert.equal(answerMode({ cards: [{ front: 'a', back: 'a long answer that is long' }], answer_mode: 'choice' }), 'type');
  const opts = makeOptions('Stop', ['Stop', 'Yield', 'No parking', 'Roundabout', 'Dead end']);
  assert.equal(opts.length, 4);
  assert.ok(opts.includes('Stop'));
  assert.equal(new Set(opts).size, 4);
});
test('image cells', () => {
  assert.match(imageSrc('Flag of Belgium.svg'), /thumb\.php\?f=Flag_of_Belgium\.svg/);
  assert.equal(imageSrc('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(imageSrc('How do you get to work?'), null);
  assert.equal(imageSrc('3.5'), null);
});

import { pickDeckLook } from '../styles/tokens.js';
test('new decks follow the rainbow and never get beige', () => {
  let decks = [];
  for (let i = 0; i < 9; i++) decks.push({ id: i, ...pickDeckLook(decks) });
  assert.deepEqual(decks.slice(0, 8).map((d) => d.color), ['yellow', 'green', 'blue', 'red', 'purple', 'lime', 'pink', 'yellow']);
  assert.ok(!decks.some((d) => d.color === 'beige'));
  // continues after whatever the last deck is
  assert.equal(pickDeckLook([{ color: 'blue', shape: 'blue' }]).color, 'red');
  assert.equal(pickDeckLook([{ color: 'beige', shape: 'beige' }]).color, 'yellow');
  // never the same colour + shape pair while one is free
  for (let i = 0; i < 40; i++) decks.push({ id: 100 + i, ...pickDeckLook(decks) });
  const pairs = decks.slice(0, 50).map((d) => `${d.color}/${d.shape}`);
  assert.equal(new Set(pairs).size, pairs.length);
});

import { clockTime } from './media.js';
test('clock cells', () => {
  assert.deepEqual(clockTime('clock 6:30'), { h: 6, m: 30 });
  assert.deepEqual(clockTime('clock 12:00'), { h: 0, m: 0 });
  assert.equal(clockTime('6:30'), null);
  assert.equal(clockTime('clock 6:99'), null);
});

test('pasted cards with commas are never cut: rejoined or flagged for a check', async () => {
  const { parseLooseTable } = await import('./csv.js');
  // The bug: an AI forgets the quotes and "Yes, here it is." used to become Yes → "here it is."
  let d = parseLooseTable('English,Portuguese\nYes, here it is.,Sim, aqui está.\nThank you,Obrigado\nHello, Paul,Olá Paulo');
  assert.deepEqual(d.cards[0], { front: 'Yes, here it is.', back: 'Sim, aqui está.' });
  assert.deepEqual(d.cards[1], { front: 'Thank you', back: 'Obrigado' });
  assert.equal(d.cards[2].front + d.cards[2].back, 'HelloPaul, Olá Paulo'); // no word lost
  assert.deepEqual(d.check.map((c) => c.index), [0, 2]);
  assert.equal(d.check[0].original, 'Yes, here it is.,Sim, aqui está.');
  // Quoted CSV still works and needs no check
  d = parseLooseTable('English,Portuguese\n"Yes, here it is.","Sim, aqui está."\n"Is it ""free""?","É ""grátis""?"');
  assert.deepEqual(d.cards, [{ front: 'Yes, here it is.', back: 'Sim, aqui está.' }, { front: 'Is it "free"?', back: 'É "grátis"?' }]);
  assert.equal(d.check.length, 0);
  // The new table format: commas, question marks and alternatives
  d = parseLooseTable('```\n| English | Portuguese |\n|---|---|\n| Yes, here it is. | Sim, aqui está. |\n| How long, roughly? | Quanto tempo, mais ou menos? |\n| Thanks | Obrigado|Valeu |\n| Hi | Olá | Oi |\n```');
  assert.deepEqual(d.cards.slice(0, 3), [
    { front: 'Yes, here it is.', back: 'Sim, aqui está.' },
    { front: 'How long, roughly?', back: 'Quanto tempo, mais ou menos?' },
    { front: 'Thanks', back: 'Obrigado|Valeu' }]);
  assert.deepEqual(d.cards[3], { front: 'Hi', back: 'Olá|Oi' }); // alternatives written with spaces
  assert.deepEqual(d.check.map((c) => c.index), [3]);
  // A table copied from the chat window arrives as tabs
  d = parseLooseTable('English\tPortuguese\nYes, here it is.\tSim, aqui está.');
  assert.deepEqual(d.cards, [{ front: 'Yes, here it is.', back: 'Sim, aqui está.' }]);
});

test('Google Sheets keep ignoring extra columns (notes), unchanged', async () => {
  const { parseCSV, rowsToDeck } = await import('./csv.js');
  const d = rowsToDeck(parseCSV('English,Dutch,Notes\nHello,Hallo,greeting'));
  assert.deepEqual(d.cards, [{ front: 'Hello', back: 'Hallo' }]);
});

test('audio: the best voice for the language, never a novelty or English one', async () => {
  const { pickVoice, inferLang } = await import('./speech.js');
  const V = (name, lang, localService = true) => ({ name, lang, localService });
  const mac = [V('Albert', 'en-US'), V('Samantha', 'en-US'), V('Eddy (Italian (Italy))', 'it-IT'), V('Grandma (Italian (Italy))', 'it-IT'),
    V('Alice', 'it-IT'), V('Google italiano', 'it-IT', false), V('Rocko (Portuguese (Brazil))', 'pt-BR'), V('Luciana', 'pt-BR')];
  assert.equal(pickVoice(mac, 'it-IT').name, 'Google italiano');
  assert.equal(pickVoice(mac.filter((v) => !/Google/.test(v.name)), 'it-IT').name, 'Alice');
  assert.equal(pickVoice(mac, 'pt-BR').name, 'Luciana');
  assert.equal(pickVoice([V('Alice (Enhanced)', 'it_IT'), V('Eddy', 'it_IT')], 'it-IT').name, 'Alice (Enhanced)'); // Android-style codes
  assert.equal(pickVoice(mac, 'ja-JP'), null);   // no Japanese voice: never fall back to English
  assert.equal(pickVoice([], 'it-IT'), null);    // list not loaded yet
  assert.equal(inferLang('Italian'), 'it-IT');
  assert.equal(inferLang('Japanese'), 'ja-JP');
  assert.equal(inferLang('Swedish'), 'sv-SE');
  assert.equal(inferLang('Nederlands'), 'nl-NL');
});
