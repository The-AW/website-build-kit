import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOrigin } from '../src/lib/origin.ts';

test('allows an absent Origin and an exact same origin', () => {
  assert.equal(isSameOrigin('https://www.example.com/api/contact/', null), true);
  assert.equal(isSameOrigin('https://www.example.com/api/contact/', 'https://www.example.com'), true);
});

test('rejects a different host, scheme, port and malformed Origin', () => {
  const requestUrl = 'https://www.example.com/api/contact/';
  for (const origin of [
    'https://attacker.example',
    'http://www.example.com',
    'https://www.example.com:8443',
    'null',
    'not-an-origin',
  ]) {
    assert.equal(isSameOrigin(requestUrl, origin), false, `accepted ${origin}`);
  }
});
