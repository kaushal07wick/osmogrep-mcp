import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeliveryQueue } from './delivery-retry.mjs';

test('a successful send returns its result', async () => {
  const deliver = createDeliveryQueue(async event => 'sent:' + event.id);
  assert.deepEqual(await deliver({ id: 'order-1' }), { duplicate: false, result: 'sent:order-1' });
});

test('an acknowledged delivery is not sent twice', async () => {
  let calls = 0;
  const deliver = createDeliveryQueue(async () => ++calls);
  await deliver({ id: 'order-1' });
  assert.deepEqual(await deliver({ id: 'order-1' }), { duplicate: true });
  assert.equal(calls, 1);
});

test('a transient send failure can be retried with the same event ID', async () => {
  let calls = 0;
  const deliver = createDeliveryQueue(async () => {
    if (++calls === 1) throw new Error('temporary upstream failure');
    return 'acknowledged';
  });
  await assert.rejects(deliver({ id: 'order-1' }), /temporary upstream failure/);
  assert.deepEqual(await deliver({ id: 'order-1' }), { duplicate: false, result: 'acknowledged' });
  assert.equal(calls, 2);
});

test('repeated failures are not mistaken for confirmed deliveries', async () => {
  let calls = 0;
  const deliver = createDeliveryQueue(async () => { calls++; throw new Error('upstream unavailable'); });
  await assert.rejects(deliver({ id: 'order-1' }), /upstream unavailable/);
  await assert.rejects(deliver({ id: 'order-1' }), /upstream unavailable/);
  assert.equal(calls, 2);
});

test('separate event IDs remain independent', async () => {
  const delivered = [];
  const deliver = createDeliveryQueue(async event => { delivered.push(event.id); return 'ack'; });
  await deliver({ id: 'order-1' });
  await deliver({ id: 'order-2' });
  assert.deepEqual(delivered, ['order-1', 'order-2']);
});
