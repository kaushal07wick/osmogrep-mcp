/** Deduplicate confirmed deliveries. Failed sends must remain retryable. */
export function createDeliveryQueue(send) {
  const delivered = new Set();
  return async function deliver(event) {
    if (delivered.has(event.id)) return { duplicate: true };
    const result = await send(event);
    delivered.add(event.id);
    return { duplicate: false, result };
  };
}
