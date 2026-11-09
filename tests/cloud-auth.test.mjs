import test from 'node:test';
import assert from 'node:assert/strict';
import { signSession, readSession, tenantId, storageToken, storageKey } from '../cloud/auth.mjs';
test('sessions reject forgery and expiry and separate instructor codes', async () => {
  const secret = 'test-secret';
  const a = await tenantId('MDX-A', secret), b = await tenantId('MDX-B', secret);
  assert.notEqual(a, b);
  const cookie = await signSession(a, secret, 1000);
  assert.equal(await readSession(cookie, secret, 999), a);
  assert.equal(await readSession(cookie, secret, 1001), null);
  assert.equal(await readSession(cookie + 'x', secret, 999), null);
  assert.equal(await readSession(cookie, 'wrong', 999), null);
  assert.notEqual(await storageToken(a, secret), await storageToken(b, secret));
});
test('storage paths stay inside one tenant and allow only persistent app directories', () => {
  const id = 'a'.repeat(64);
  assert.equal(storageKey(id, 'jobs/학교/clip.mp4'), `${id}/jobs/학교/clip.mp4`);
  for (const p of ['../x', 'data/../x', '/data/x', 'data/a\\b', 'app/server.mjs', 'data//a']) assert.throws(() => storageKey(id, p));
  assert.throws(() => storageKey('../b', 'data/settings.json'));
});
