const MOBILE_STOP_EVENT_LOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
});

function normalizeStopEventValue(value) {
  return String(value || '').trim().toLowerCase();
}

export function getMobileCheckInGate(nextAction, availableAt, now = Date.now()) {
  const openingTime = Date.parse(availableAt || '');
  const canOverride = nextAction === 'in' && Number.isFinite(openingTime) && now < openingTime;
  return {
    unavailable: nextAction === 'in' && (!Number.isFinite(openingTime) || now < openingTime),
    canOverride,
  };
}

function getFirstStopEvent(events, action) {
  const normalizedAction = normalizeStopEventValue(action);

  return events
    .filter((event) => normalizeStopEventValue(event?.action) === normalizedAction)
    .sort((left, right) => {
      const leftTime = Date.parse(left?.time || '') || Number.MAX_SAFE_INTEGER;
      const rightTime = Date.parse(right?.time || '') || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    })[0] || null;
}

export function getMobileStopEventState(events = [], stop, stopSequence = 1) {
  const normalizedStop = normalizeStopEventValue(stop);
  const matchingEvents = (Array.isArray(events) ? events : []).filter((event) => (
    normalizeStopEventValue(event?.stop) === normalizedStop &&
    Number(event?.stopSequence) === Number(stopSequence)
  ));
  const arrivedEvent = getFirstStopEvent(matchingEvents, 'in');
  const departedEvent = getFirstStopEvent(matchingEvents, 'out');

  return {
    arrivedEvent,
    departedEvent,
    nextAction: departedEvent ? null : arrivedEvent ? 'out' : 'in',
    complete: Boolean(arrivedEvent && departedEvent),
  };
}

export function formatMobileStopEventTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Time unavailable';

  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function getMobileLocationFailureStatus(error) {
  if (Number(error?.code) === 1) return 'Denied';
  if (Number(error?.code) === 3) return 'Timeout';
  return 'Unavailable';
}

export function captureMobileStopLocation(geolocation = globalThis.navigator?.geolocation) {
  return new Promise((resolve) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      resolve({ status: 'Unavailable' });
      return;
    }

    try {
      geolocation.getCurrentPosition(
        (position) => {
          const latitude = position?.coords?.latitude;
          const longitude = position?.coords?.longitude;
          const accuracy = position?.coords?.accuracy;

          if (
            !Number.isFinite(latitude) ||
            latitude < -90 ||
            latitude > 90 ||
            !Number.isFinite(longitude) ||
            longitude < -180 ||
            longitude > 180 ||
            !Number.isFinite(accuracy) ||
            accuracy < 0
          ) {
            resolve({ status: 'Unavailable' });
            return;
          }

          resolve({
            status: 'Captured',
            latitude,
            longitude,
            accuracy,
          });
        },
        (error) => resolve({ status: getMobileLocationFailureStatus(error) }),
        MOBILE_STOP_EVENT_LOCATION_OPTIONS,
      );
    } catch {
      resolve({ status: 'Unavailable' });
    }
  });
}

export { MOBILE_STOP_EVENT_LOCATION_OPTIONS };
