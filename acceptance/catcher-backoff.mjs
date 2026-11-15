export function retryDelay(attempt, baseMs = 100, maxMs = 5000) {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}
