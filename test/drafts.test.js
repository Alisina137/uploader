import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { mediaStorage } from '../src/media.js';
import { openStore } from '../src/store.js';

const origin = 'http://localhost:3000';
const password = 'draft workflow test owner password';

function fixture(dir, name, dimensions, seconds) {
  const path = join(dir, name);
  execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i',
    `color=c=blue:s=${dimensions}:r=1:d=${seconds}`, '-c:v', 'mpeg4', '-threads', '1', path]);
  return readFileSync(path);
}

test('a signed-in owner prepares resumable drafts and manages their folders', async (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'upload-hub-drafts-'));
  const shortFile = fixture(directory, 'portrait.mp4', '90x160', 60);
  const longFile = fixture(directory, 'landscape.mov', '160x90', 600);
  const mediaDir = join(directory, 'media');
  const file = join(directory, 'store.sqlite');
  const store = openStore(file);
  const media = mediaStorage(mediaDir, store);
  media.clean();
  const server = createApp({ store, origin, media });
  context.after(async () => {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const passwordHash = await hashPassword(password);
  store.createOwner({ name: 'Creator', email: 'owner@example.com', passwordHash });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const originLocal = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const fetchPage = (path, options = {}) => fetch(originLocal + path, {
    ...options, redirect: 'manual', headers: { Origin: origin, Cookie: cookie, ...options.headers }
  });
  const post = (path, data) => fetchPage(path, { method: 'POST', body: new URLSearchParams(data) });
  const api = async (path, options = {}, status = 200) => {
    const response = await fetchPage(path, { ...options, headers: { Accept: 'application/json', ...options.headers } });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  const login = await post('/login', { email: 'owner@example.com', password });
  assert.equal(login.headers.get('location'), '/onboarding');
  cookie = login.headers.get('set-cookie').split(';')[0];

  const created = await post('/onboarding', { name: 'Studio folder' });
  assert.equal(created.status, 303);
  const list = created.headers.get('location');
  const folder = list.replace(/\/videos$/, '');
  const uploads = list + '/uploads';
  assert.match(await (await fetchPage(list)).text(), /This folder has no videos/);
  assert.match(await (await fetchPage('/channels?q=missing')).text(), /No folders match your search/);
  assert.equal((await post('/channels', { name: 'studio folder' })).status, 409);
  const other = (await post('/channels', { name: 'Second channel' })).headers.get('location').replace(/\/videos$/, '');
  const defaults = { description: 'Original footer', hashtags: 'studio, #video', tags: 'studio videos',
    visibility: 'Unlisted', Instagram: 'Instagram footer', preferredTime: '09:30' };
  assert.equal((await post(folder + '/defaults', defaults)).status, 200);

  async function start(name, size) {
    const transfer = await api(uploads, { method: 'POST', body: new URLSearchParams({ name, size }) }, 201);
    return uploads + '/' + transfer.id;
  }
  const append = (url, body, offset, status) => api(url, {
    method: 'PATCH', body, headers: { 'Upload-Offset': offset }
  }, status);
  const finish = (url, duplicate, status) => api(url + '/finish', {
    method: 'POST', body: new URLSearchParams({ duplicate })
  }, status);

  const shortUpload = await start('portrait.mp4', shortFile.length);
  const half = Math.floor(shortFile.length / 2);
  assert.equal((await append(shortUpload, shortFile.subarray(0, half), 0)).offset, half);

  await new Promise((resolve, reject) => {
    const request = httpRequest(originLocal + shortUpload, {
      method: 'PATCH', headers: { Cookie: cookie, Origin: origin, Accept: 'application/json',
        'Content-Length': shortFile.length - half, 'Upload-Offset': half }
    });
    request.on('error', (error) => error.code === 'ECONNRESET' ? resolve() : reject(error));
    request.write(shortFile.subarray(half, half + 5));
    setTimeout(() => request.destroy(), 30);
  });
  assert.equal((await api(shortUpload)).offset, half);
  await append(shortUpload, shortFile.subarray(half), 0, 409);
  assert.equal((await append(shortUpload, shortFile.subarray(half), half)).offset, shortFile.length);

  const short = (await finish(shortUpload)).location.replace(/\/details$/, '');
  assert.equal((await api(shortUpload)).location, short + '/details');
  const shortPage = await (await fetchPage(short + '/details')).text();
  assert.match(shortPage, /60 s · 90 × 160/);
  assert.match(shortPage, /value="Short" checked/);
  assert.match(shortPage, /Original footer/);
  assert.equal((await post(folder + '/defaults', { ...defaults, description: 'New footer' })).status, 200);
  assert.match(await (await fetchPage(short + '/details')).text(), /Original footer/);
  assert.match(await (await fetchPage(short + '/review')).text(), /Instagram footer/);
  assert.equal((await post(short + '/details', { title: 'a'.repeat(101), format: 'Short', visibility: 'Private' })).status, 422);
  assert.equal((await post(short + '/details', { title: 'My Short draft', format: 'Short', ...defaults })).status, 303);
  assert.match(await (await fetchPage(short + '/platforms')).text(), /TikTok[\s\S]*Eligible/);

  await api(short + '/thumbnail', { method: 'POST', body: new URLSearchParams({ seconds: 0 }) });
  const thumbnail = await fetchPage(short + '/thumbnail');
  assert.equal(thumbnail.headers.get('content-type'), 'image/jpeg');
  const thumbnailBytes = Buffer.from(await thumbnail.arrayBuffer());
  assert.ok(thumbnailBytes.length > 100);
  await api(short + '/thumbnail', { method: 'POST', body: thumbnailBytes, headers: { 'Content-Type': 'image/jpeg' } });
  const source = await fetchPage(short + '/source', { headers: { Range: 'bytes=0-15' } });
  assert.equal(source.status, 206);
  assert.deepEqual(Buffer.from(await source.arrayBuffer()), shortFile.subarray(0, 16));
  assert.equal((await post(short + '/review', {})).headers.get('location'), list);
  assert.match(await (await fetchPage(list)).text(), /My Short draft/);
  assert.match(await (await fetchPage(list + '?format=Long')).text(), /No videos match your filters/);

  const duplicate = await start('portrait-copy.mp4', shortFile.length);
  await append(duplicate, shortFile, 0);
  assert.equal((await finish(duplicate, '0', 409)).duplicate, short + '/details');
  const copied = (await finish(duplicate, '1')).location;
  assert.notEqual(copied, short + '/details');
  const cancelled = await start('cancel.mp4', shortFile.length);
  await append(cancelled, shortFile.subarray(0, 10), 0);
  await api(cancelled, { method: 'DELETE' });
  await api(cancelled, {}, 404);
  assert.ok(!existsSync(join(mediaDir, cancelled.split('/').at(-1))));

  const longUpload = await start('landscape.mov', longFile.length);
  await append(longUpload, longFile, 0);
  const long = (await finish(longUpload)).location.replace(/\/details$/, '');
  const longPage = await (await fetchPage(long + '/details')).text();
  assert.match(longPage, /600 s · 160 × 90/);
  assert.match(longPage, /value="Long" checked/);
  assert.match(longPage, /New footer/);
  await api(long + '/thumbnail', { method: 'POST', body: thumbnailBytes, headers: { 'Content-Type': 'image/jpeg' } }, 422);
  const eligibility = await (await fetchPage(long + '/platforms')).text();
  assert.match(eligibility, /Instagram[\s\S]*Short videos only/);
  assert.match(eligibility, /TikTok[\s\S]*Short videos only/);

  assert.equal((await post(folder + '/settings', { intent: 'rename', name: 'Renamed studio' })).status, 303);
  assert.equal((await post(folder + '/settings', { intent: 'archive' })).status, 303);
  assert.match(await (await fetchPage('/channels?archived=1')).text(), /Renamed studio/);
  assert.equal((await fetchPage(list + '/new')).status, 409);
  assert.equal((await post(short + '/review', {})).status, 409);
  assert.equal((await post(folder + '/settings', { intent: 'restore' })).status, 303);
  const localCopy = (await post(short + '/actions', { intent: 'duplicate' })).headers.get('location').replace(/\/details$/, '');
  assert.equal((await post(localCopy + '/actions', { intent: 'move', destination: other.split('/').at(-1) })).status, 303);
  assert.equal((await post(folder + '/settings', { intent: 'delete', confirmation: 'Studio folder' })).status, 422);
  assert.equal((await post(folder + '/settings', { intent: 'delete', confirmation: 'Renamed studio' })).status, 303);
  assert.equal((await fetchPage(list)).status, 404);
  assert.ok(existsSync(join(mediaDir, shortUpload.split('/').at(-1))), 'shared source stays available after folder deletion');
  assert.ok(!existsSync(join(mediaDir, longUpload.split('/').at(-1))), 'unreferenced source is removed');
  const moved = other + '/videos/' + localCopy.split('/').at(-1);
  assert.equal((await fetchPage(moved + '/thumbnail')).status, 200);
  assert.equal((await post(moved + '/actions', { intent: 'delete' })).status, 303);
  assert.ok(!existsSync(join(mediaDir, shortUpload.split('/').at(-1))), 'last reference releases the source');
});
