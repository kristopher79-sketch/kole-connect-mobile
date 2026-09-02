import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOBILE_STOP_EVENT_LOCATION_OPTIONS,
  captureMobileStopLocation,
  getMobileLocationFailureStatus,
  getMobileStopEventState,
} from '../src/mobile-stop-events.js';

test('stop state advances from In to Out to complete', () => {
  const noEvents = getMobileStopEventState([], 'pickup', 1);
  const arrived = getMobileStopEventState([
    { stop: 'Pickup', stopSequence: 1, action: 'In', time: '2026-09-02T13:47:18Z' },
  ], 'pickup', 1);
  const complete = getMobileStopEventState([
    { stop: 'Pickup', stopSequence: 1, action: 'In', time: '2026-09-02T13:47:18Z' },
    { stop: 'Pickup', stopSequence: 1, action: 'Out', time: '2026-09-02T15:12:00Z' },
  ], 'pickup', 1);

  assert.equal(noEvents.nextAction, 'in');
  assert.equal(arrived.nextAction, 'out');
  assert.equal(complete.nextAction, null);
  assert.equal(complete.complete, true);
});

test('Pickup, Delivery, and Stop Sequence remain independent', () => {
  const events = [
    { stop: 'Pickup', stopSequence: 1, action: 'In', time: '2026-09-02T13:47:18Z' },
    { stop: 'Delivery', stopSequence: 1, action: 'In', time: '2026-09-02T17:04:00Z' },
    { stop: 'Pickup', stopSequence: 2, action: 'Out', time: '2026-09-02T18:00:00Z' },
  ];

  assert.equal(getMobileStopEventState(events, 'pickup', 1).nextAction, 'out');
  assert.equal(getMobileStopEventState(events, 'delivery', 1).nextAction, 'out');
  assert.equal(getMobileStopEventState(events, 'pickup', 2).arrivedEvent, null);
});

test('successful geolocation maps coordinates and uses deliberate one-shot options', async () => {
  let receivedOptions = null;
  const geolocation = {
    getCurrentPosition(success, _failure, options) {
      receivedOptions = options;
      success({
        coords: {
          latitude: 35.123456,
          longitude: -80.123456,
          accuracy: 12,
        },
      });
    },
  };

  const location = await captureMobileStopLocation(geolocation);

  assert.deepEqual(location, {
    status: 'Captured',
    latitude: 35.123456,
    longitude: -80.123456,
    accuracy: 12,
  });
  assert.deepEqual(receivedOptions, MOBILE_STOP_EVENT_LOCATION_OPTIONS);
});

test('geolocation failures map to nonblocking event statuses', async () => {
  const statuses = await Promise.all([1, 2, 3].map((code) => (
    captureMobileStopLocation({
      getCurrentPosition(_success, failure) {
        failure({ code });
      },
    })
  )));

  assert.deepEqual(statuses, [
    { status: 'Denied' },
    { status: 'Unavailable' },
    { status: 'Timeout' },
  ]);
  assert.equal(getMobileLocationFailureStatus({ code: 99 }), 'Unavailable');
});

test('missing, throwing, or invalid geolocation still allows an Unavailable event', async () => {
  const missing = await captureMobileStopLocation(null);
  const throwing = await captureMobileStopLocation({
    getCurrentPosition() {
      throw new Error('Device bridge failed');
    },
  });
  const invalid = await captureMobileStopLocation({
    getCurrentPosition(success) {
      success({ coords: { latitude: 999, longitude: 0, accuracy: 1 } });
    },
  });

  assert.deepEqual(missing, { status: 'Unavailable' });
  assert.deepEqual(throwing, { status: 'Unavailable' });
  assert.deepEqual(invalid, { status: 'Unavailable' });
});
