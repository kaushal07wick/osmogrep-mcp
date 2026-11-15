import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestCache } from './catcher-request-cache.mjs';

test('successful results remain cached', async () => {
  const cache = createRequestCache();
  let calls = 0;
  assert.equal(await cache.get('profile', () => { calls++; return 42; }), 42);
  assert.equal(await cache.get('profile', () => { calls++; return 99; }), 42);
  assert.equal(calls, 1);
});

test('concurrent same-key callers share one request', async () => {
  const cache = createRequestCache();
  let calls = 0;
  const first = cache.get('profile', async () => { calls++; return 'ok'; });
  const second = cache.get('profile', async () => { calls++; return 'wrong'; });
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), ['ok', 'ok']);
  assert.equal(calls, 1);
});

test('different keys keep independent successful values', async () => {
  const cache = createRequestCache();
  assert.equal(await cache.get('left', () => 'A'), 'A');
  assert.equal(await cache.get('right', () => 'B'), 'B');
  assert.equal(await cache.get('left', () => 'C'), 'A');
});
