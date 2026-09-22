import test from 'node:test';
import assert from 'node:assert/strict';
import { getMobileProximityPrompt, hasSeenProximityPrompt, rememberProximityPrompt } from '../src/mobile-proximity.js';
const driver = { id: 'driver-a', truck: '0042' };
const home = { driver, targetDate: '2026-09-22', currentLoad: {
  id: '42', Status: 'Won', BOL: 'BOL-42', PickupDate: '2026-09-22',
  Pickup1Name: 'AGSE', Delivery1Name: 'EVA Air Cargo', ProximityNoticeKey: 'BOL-42|AGSE',
} };
test('only the authenticated current load yields a prompt and existing stop focus', () => {
  assert.equal(getMobileProximityPrompt(driver, home).focus, 'pickup');
  for (const [key, focus] of [['BOL-42|EVA Air Cargo', 'delivery'], ['BOL-42|Second Stop', 'top']]) {
    assert.equal(getMobileProximityPrompt(driver, { ...home, currentLoad: { ...home.currentLoad, ProximityNoticeKey: key } }).focus, focus);
  }
  assert.equal(getMobileProximityPrompt({ ...driver, id: 'other' }, home), null);
  assert.equal(getMobileProximityPrompt(driver, { ...home, targetDate: '2026-09-23' }), null);
  for (const ProximityNoticeKey of ['', 'OTHER|AGSE', 'BOL-42|', 'BOL-42|<b>', 'BOL-42|A|B']) {
    assert.equal(getMobileProximityPrompt(driver, { ...home, currentLoad: { ...home.currentLoad, ProximityNoticeKey } }), null);
  }
});
test('same notice stays seen across rereads and storage persists while identities remain isolated', () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
  const notice = getMobileProximityPrompt(driver, home);
  assert.equal(hasSeenProximityPrompt(notice.id), false);
  rememberProximityPrompt(notice.id);
  assert.equal(hasSeenProximityPrompt(getMobileProximityPrompt(driver, structuredClone(home)).id), true);
  assert.ok([...store.values()][0].includes('driver-a'));
  assert.equal(hasSeenProximityPrompt('other-driver'), false);
  sessionStorage.setItem('kole-mobile-seen-proximity', JSON.stringify(['previous-mount']));
  assert.equal(hasSeenProximityPrompt('previous-mount'), true);
  globalThis.sessionStorage = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  rememberProximityPrompt('storage-disabled');
  assert.equal(hasSeenProximityPrompt('storage-disabled'), true);
});
