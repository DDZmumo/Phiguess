import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { createRequestId } from '../apps/web/src/request-id';

test('request IDs work on HTTP origins without randomUUID', () => {
  const id = createRequestId({getRandomValues: bytes => {bytes.fill(255);return bytes;}});
  assert.equal(id, 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('HTTP request IDs are distinct UUID v4 values', () => {
  const random = {getRandomValues: (bytes: Uint8Array) => webcrypto.getRandomValues(bytes)};
  const ids = Array.from({length: 200}, () => createRequestId(random));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('secure origins can use native randomUUID', () => {
  const expected = '12345678-1234-4321-8123-123456789abc';
  assert.equal(createRequestId({randomUUID: () => expected,getRandomValues: () => {throw new Error('Unexpected fallback');}}), expected);
});
