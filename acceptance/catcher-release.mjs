export async function runWithLease(pool, task) {
  const release = pool.acquire();
  const result = await task();
  release();
  return result;
}
