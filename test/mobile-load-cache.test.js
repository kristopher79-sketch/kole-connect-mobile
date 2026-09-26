import test from 'node:test';
import assert from 'node:assert/strict';
import { createCurrentLoadCache } from '../src/mobile-load-cache.js';
const current = { hasLoad: true, loadRole: 'current', load: { id: '1' } };

test('startup preload is reused for current-load navigation', async () => {
  let calls = 0;
  const cache = createCurrentLoadCache(async () => { calls++; return current; });
  await cache.get('session');
  assert.equal(cache.peek('session'), current);
  assert.equal(await cache.get('session', '1'), current);
  assert.equal(calls, 1);
});

test('opening current load during preload shares its request', async () => {
  let calls = 0;
  let finish;
  const cache = createCurrentLoadCache(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  cache.clear('session', '1');
  const first = cache.get('session');
  const second = cache.get('session', '1');
  await Promise.resolve();
  finish(current);
  assert.deepEqual(await Promise.all([first, second]), [current, current]);
  assert.equal(calls, 1);
});

test('future loads always fetch and preserve the current preload', async () => {
  const ids = [];
  const cache = createCurrentLoadCache(async (token, id) => {
    ids.push(id);
    return id === '2' ? { hasLoad: true, loadRole: 'next', load: { id } } : current;
  });
  await cache.get('session');
  await cache.get('session', '2');
  await cache.get('session', '2');
  assert.equal(cache.peek('session'), current);
  assert.equal(ids.length, 3);
});

test('expired data and failed preloads retry', async () => {
  let time = 0;
  let calls = 0;
  const cache = createCurrentLoadCache(async () => {
    if (++calls === 1) throw new Error('offline');
    return current;
  }, () => time);
  await assert.rejects(cache.get('session'), /offline/);
  await cache.get('session');
  time = 60_000;
  assert.equal(cache.peek('session'), null);
  await cache.get('session');
  assert.equal(calls, 3);
});

test('invalidation prevents an old request from repopulating the cache', async () => {
  let finish;
  const cache = createCurrentLoadCache(() => new Promise(resolve => { finish = resolve; }));
  const request = cache.get('old-session');
  await Promise.resolve();
  cache.clear();
  finish(current);
  await request;
  assert.equal(cache.peek('old-session'), null);
  assert.equal(cache.peek('new-session'), null);
});

test('empty current assignment is reused and session data stays separate', async () => {
  const empty = { hasLoad: false, loadRole: 'current', load: null };
  const cache = createCurrentLoadCache(async () => empty);
  await cache.get('session');
  assert.equal(cache.peek('session'), empty);
  assert.equal(cache.peek('another-session'), null);
  cache.clear();
  assert.equal(cache.peek('session'), null);
});
