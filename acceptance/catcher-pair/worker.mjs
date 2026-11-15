import { acquireBatch } from './pool.mjs';
export const concurrency = 2;
export function runBatch() { return acquireBatch(concurrency); }
