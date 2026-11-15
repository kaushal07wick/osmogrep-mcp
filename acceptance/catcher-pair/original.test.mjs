import test from 'node:test';
import assert from 'node:assert/strict';
import { concurrency } from './worker.mjs';
test('configured worker count is positive', () => assert.ok(concurrency > 0));
