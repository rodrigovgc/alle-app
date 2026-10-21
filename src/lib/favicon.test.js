import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faviconSvg, tabColor } from './favicon.js';

test('lime or unknown colours keep the normal icon', () => {
  assert.equal(tabColor('lime'), null);
  assert.equal(tabColor(undefined), null);
});

test('the tab background takes the deck colour', () => {
  assert.equal(tabColor('blue'), '#92C6FB');
  assert.ok(faviconSvg('#92C6FB').includes('fill="#92C6FB"'));
});
