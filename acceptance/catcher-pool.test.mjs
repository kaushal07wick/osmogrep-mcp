import assert from 'node:assert/strict';
import test from 'node:test';
import { startWorkers } from './catcher-pool.mjs';

test('one worker acquires a pool lease', () => {
  const [worker] = startWorkers(1);
  assert.equal(worker.ready, true);
  assert.notEqual(worker.lease, null);
});

test('the default configuration starts four workers', () => {
  assert.equal(startWorkers().length, 4);
});

test('worker identities are unique', () => {
  const workers = startWorkers();
  assert.equal(new Set(workers.map(worker => worker.id)).size, 4);
});
