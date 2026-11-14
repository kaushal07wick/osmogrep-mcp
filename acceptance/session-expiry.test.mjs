import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExpired } from './session-expiry.mjs';

test('a session remains valid before its deadline', () => {
  assert.equal(isExpired(1000, 999), false);
});
test('a session is expired exactly at its deadline', () => {
  assert.equal(isExpired(1000, 1000), true);
});
test('a session is expired after its deadline', () => {
  assert.equal(isExpired(1000, 1001), true);
});
