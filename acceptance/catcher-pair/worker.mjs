import { acquireBatch } from './pool.mjs';
export const concurrency = 6;
export function runBatch() { return acquireBatch(concurrency); }
