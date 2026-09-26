import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('  async function handleStopEvent('), source.indexOf('  async function openUploadTab('));
function setup(confirmed) {
  const sent = [];
  const prompts = [];
  let locationCalls = 0;
  const load = { id: '12', stopEventsAvailable: true, pickupCheckInAvailableAt: '2099-01-01T12:00:00Z' };
  const context = {
    localStorage: { getItem: () => 'synthetic-session' }, MOBILE_TOKEN_KEY: 'test',
    loadResponse: { loadRole: 'current', load },
    clearMobileSession() {}, setStopEventOperations() {}, setLoadResponse() {},
    stopEventRequestsRef: { current: new Set() },
    window: { confirm: text => { prompts.push(text); return confirmed; } },
    captureMobileStopLocation: async () => { locationCalls++; return { status: 'Unavailable' }; },
    currentLoadCacheRef: { current: { clear() {}, store() {} } },
    recordMobileStopEvent: async (_token, payload) => { sent.push(payload); },
    getMyLoad: async () => ({ load }),
  };
  vm.createContext(context);
  vm.runInContext(handler, context);
  return { context, sent, prompts, locationCalls: () => locationCalls };
}

test('cancelling the detention notice captures no location and sends no check-in', async () => {
  const h = setup(false);
  await h.context.handleStopEvent('pickup', 'in', true);
  assert.match(h.prompts[0], /Check-ins outside of scheduled times do not guarantee detention time\./);
  assert.equal(h.locationCalls(), 0);
  assert.equal(h.sent.length, 0);
});

test('confirming sends the early-arrival flag once and clears the request lock', async () => {
  const h = setup(true);
  await Promise.all([h.context.handleStopEvent('pickup', 'in', true), h.context.handleStopEvent('pickup', 'in', true)]);
  assert.equal(h.prompts.length, 1);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].earlyArrival, true);
  assert.equal(h.context.stopEventRequestsRef.current.size, 0);
});

test('ordinary check-in remains blocked while early, and does not show a notice after opening', async () => {
  const h = setup(true);
  await h.context.handleStopEvent('pickup', 'in');
  assert.equal(h.sent.length, 0);
  h.context.loadResponse.load.pickupCheckInAvailableAt = '2020-01-01T12:00:00Z';
  await h.context.handleStopEvent('pickup', 'in');
  assert.equal(h.prompts.length, 0);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].earlyArrival, false);
});
