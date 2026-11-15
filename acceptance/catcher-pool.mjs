export const poolCapacity = 8;

export function startWorkers(count = 4) {
  const free = Array.from({ length: poolCapacity }, (_, id) => ({ id }));
  return Array.from({ length: count }, (_, id) => ({
    id,
    ready: true,
    lease: free.shift() ?? null,
  }));
}
