export async function runWithLease(pool, task) {
  const release = pool.acquire();
  try {
    return await task();
  } finally {
    release();
  }
}
