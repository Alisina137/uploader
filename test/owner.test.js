import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { openStore } from '../src/store.js';
import { normalizeTimeZone } from '../src/validation.js';

const origin = 'http://localhost:3000';
const password = 'local test owner password';

async function start(store, context) {
  const server = createApp({ store, origin });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    redirect: 'manual',
    ...options
  });
}

const post = (values, headers = {}) => ({
  method: 'POST', body: new URLSearchParams(values), headers: { Origin: origin, ...headers }
});

test('owner can sign in, save settings to disk, and sign out', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'upload-hub-'));
  const file = join(directory, 'owner.sqlite');
  const store = openStore(file);
  context.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const passwordHash = await hashPassword(password);
  assert.equal(store.createOwner({ name: 'Test owner', email: 'owner@example.com', passwordHash }), true);
  assert.equal(store.createOwner({ name: 'Other owner', email: 'other@example.com', passwordHash }), false);
  const request = await start(store, context);
  const loginPage = await request('/login');
  // Chromium needs a same-origin referrer policy to include Origin on form submissions.
  assert.equal(loginPage.headers.get('referrer-policy'), 'same-origin');
  await loginPage.text();

  for (const path of ['/channels', '/settings']) {
    const response = await request(path);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/login');
  }
  const wrong = await request('/login', post({ email: 'owner@example.com', password: 'wrong' }));
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.match(await wrong.text(), /email or password is incorrect/);

  const login = await request('/login', post({ email: 'OWNER@example.com', password, timeZone: 'Asia/Kabul' }));
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/channels');
  const session = login.headers.get('set-cookie');
  assert.match(session, /HttpOnly; SameSite=Lax/);
  const headers = { Cookie: session.split(';')[0] };
  assert.match(await (await request('/channels', { headers })).text(), /No channel folders yet/);
  assert.match(await (await request('/settings', { headers })).text(), /value="Asia\/Kabul" selected/);
  assert.equal((await request('/calendar', { headers })).status, 404);

  const changes = { name: 'Updated <owner>', email: 'new@example.com', timeZone: 'Europe/London' };
  const crossOrigin = await request('/settings', post(changes, { ...headers, Origin: 'http://elsewhere.example' }));
  assert.equal(crossOrigin.status, 403);
  const invalid = await request('/settings', post({ ...changes, timeZone: 'Mars/Olympus' }, headers));
  assert.equal(invalid.status, 422);
  assert.equal(store.getOwner().time_zone, 'Asia/Kabul');

  const saved = await request('/settings', post(changes, headers));
  assert.equal(saved.status, 200);
  assert.match(await saved.text(), /Updated &lt;owner&gt;[\s\S]*Settings saved/);
  const reopened = openStore(file);
  try {
    assert.equal(reopened.getOwner().time_zone, 'Europe/London');
    assert.equal(reopened.getOwner().email, 'new@example.com');
  } finally {
    reopened.close();
  }

  const logout = await request('/logout', post({}, headers));
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/settings', { headers })).headers.get('location'), '/login');
  const relogin = await request('/login', post({ email: 'new@example.com', password, timeZone: 'UTC' }));
  const newHeaders = { Cookie: relogin.headers.get('set-cookie').split(';')[0] };
  assert.match(await (await request('/settings', { headers: newHeaders })).text(), /value="Europe\/London" selected/);
});

test('login attempts are limited and time zone aliases are supported', () => {
  const store = openStore(':memory:');
  try {
    for (let index = 0; index < 10; index++) assert.equal(store.reserveLogin('local'), 0);
    assert.ok(store.reserveLogin('local') > 0);
    assert.equal(store.reserveLogin('another address'), 0);
    store.clearAttempts('local');
    assert.equal(store.reserveLogin('local'), 0);
    assert.equal(normalizeTimeZone('Etc/UTC'), 'UTC');
    assert.ok(normalizeTimeZone('US/Eastern'));
    assert.equal(normalizeTimeZone('+01:00'), null);
  } finally {
    store.close();
  }
});
