import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naturalVoices, voiceChoice } from './voices.js';

test('natural voices: deck region first, nothing for languages without one', () => {
  assert.equal(naturalVoices('pt-PT')[0].name, 'Tugão');
  assert.equal(naturalVoices('pt-BR')[0].name, 'Faber');
  assert.equal(naturalVoices('nl-NL')[0].name, 'Nathalie');
  assert.equal(naturalVoices('en-GB')[0].region, 'UK');
  assert.deepEqual(naturalVoices('ja-JP'), []);
  assert.deepEqual(naturalVoices('tr-TR'), []); // the only Turkish voice is non-commercial
});

test('voice choice: the phone voice unless this device chose a natural one', () => {
  assert.equal(voiceChoice('nl-NL'), 'phone'); // no localStorage in node: falls back quietly
});
