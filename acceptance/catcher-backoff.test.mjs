import assert from 'node:assert/strict';
import test from 'node:test';
import { retryDelay } from './catcher-backoff.mjs';

test('first retry doubles the default base delay', () => {
  assert.equal(retryDelay(1), 200);
});

test('second retry has four times the base delay', () => {
  assert.equal(retryDelay(2), 400);
});

test('custom base delay is supported', () => {
  assert.equal(retryDelay(1, 250), 500);
});
