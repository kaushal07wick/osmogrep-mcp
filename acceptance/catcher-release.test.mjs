import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithLease } from './catcher-release.mjs';

function makePool() {
  let active = 0;
  return {
    acquire() {
      active += 1;
      return () => { active -= 1; };
    },
    get active() { return active; },
  };
}

test('successful task keeps its return value', async () => {
  assert.equal(await runWithLease(makePool(), async () => 42), 42);
});

test('successful task releases its lease', async () => {
  const pool = makePool();
  await runWithLease(pool, async () => 'done');
  assert.equal(pool.active, 0);
});

test('sequential successful tasks can reuse the pool', async () => {
  const pool = makePool();
  await runWithLease(pool, async () => 1);
  await runWithLease(pool, async () => 2);
  assert.equal(pool.active, 0);
});
