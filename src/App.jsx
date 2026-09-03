import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import './App.css';
import {
  captureMobileStopLocation,
  formatMobileStopEventTime,
  getMobileStopEventState,
} from './mobile-stop-events';
import {
  createMobilePaperworkObjectUrl,
  getMobileLoadPaperwork,
  getMobilePaperworkPdf,
  printMobilePaperworkFrame,
} from './mobile-paperwork';

const configuredApiBase = String(import.meta.env.VITE_KOLE_API_BASE || '').trim();
const API_BASE_URL = (
  configuredApiBase ||
  (import.meta.env.DEV
    ? 'http://localhost:5000'
    : 'https://kole-lookup-console.onrender.com')
).replace(/\/+$/, '');
const MOBILE_TOKEN_KEY = 'kole-connect-mobile-token';
const MOBILE_THEME_KEY = 'kole-connect-mobile-theme';
const MOBILE_THEME_COLORS = {
  dark: '#0f172a',
  light: '#f5efe3',
};
const MOBILE_UPLOAD_MAX_FILES = 10;
const MOBILE_UPLOAD_MAX_FILE_SIZE = 20 * 1024 * 1024;
const MOBILE_UPLOAD_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.pdf'];
const MOBILE_UPLOAD_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/pdf',
];
const isTauriRuntime = Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);

function getSavedMobileTheme() {
  try {
    return localStorage.getItem(MOBILE_THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

const HOME_STATE_LABELS = {
  pickup_upload_needed: 'ACTION NEEDED',
  delivery_upload_needed: 'ACTION NEEDED',
  delivering_today: 'DELIVERING TODAY',
  in_transit: 'IN TRANSIT',
  pickup_today: 'PICKUP TODAY',
  upcoming_load: 'NEXT LOAD',
};

const MOBILE_PUSH_STATUS_COPY = {
  checking: {
    label: 'Checking this device',
    detail: 'Confirming whether notifications are enabled.',
  },
  enabled: {
    label: 'Notifications enabled',
    detail: 'This device can receive load assignments and important load updates.',
  },
  default: {
    label: 'Notifications are off',
    detail: 'Enable notifications to receive load assignments and important load updates.',
  },
  denied: {
    label: 'Notifications are blocked',
    detail: 'Allow notifications for Kole Connect in your browser settings, then return here.',
  },
  unsupported: {
    label: 'Not available on this device',
    detail: 'Use an installed, supported browser version to receive notifications.',
  },
  error: {
    label: 'Notifications need attention',
    detail: 'Kole Connect could not update notification settings on this device.',
  },
};

async function readJson(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || fallbackMessage);
    error.status = response.status;
    throw error;
  }

  return data;
}

async function getDriver(token) {
  const response = await fetch(`${API_BASE_URL}/mobile/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await readJson(response, 'Unable to load your driver profile.');

  if (!data.driver) {
    throw new Error('The server did not return a driver profile.');
  }

  return data.driver;
}

async function getMobileHome(token) {
  const response = await fetch(`${API_BASE_URL}/mobile/home`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await readJson(response, 'Unable to load your Mobile home.');

  if (!data.driver || !data.homeState) {
    throw new Error('The server did not return a complete Mobile home.');
  }

  return data;
}

async function getMyLoad(token, loadId = '') {
  const loadQuery = loadId ? `?loadId=${encodeURIComponent(loadId)}` : '';
  const response = await fetch(`${API_BASE_URL}/mobile/my-load${loadQuery}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await readJson(response, 'Unable to load your current load.');

  if (!data.driver || typeof data.hasLoad !== 'boolean') {
    throw new Error('The server did not return a complete current-load response.');
  }

  return data;
}

async function recordMobileStopEvent(token, input) {
  const response = await fetch(`${API_BASE_URL}/mobile/stop-event`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return readJson(response, 'Unable to record this stop event right now.');
}

function supportsMobilePush() {
  return Boolean(
    !isTauriRuntime &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window,
  );
}

function decodeVapidPublicKey(publicKey) {
  const padding = '='.repeat((4 - (publicKey.length % 4)) % 4);
  const base64 = `${publicKey}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);

  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function pushSubscriptionUsesKey(subscription, publicKey) {
  const currentKey = subscription?.options?.applicationServerKey;
  if (!currentKey) return true;

  const expectedKey = decodeVapidPublicKey(publicKey);
  const currentBytes = new Uint8Array(currentKey);

  return (
    currentBytes.length === expectedKey.length &&
    currentBytes.every((value, index) => value === expectedKey[index])
  );
}

async function getMobilePushRegistration() {
  const current = await navigator.serviceWorker.getRegistration();
  return current || navigator.serviceWorker.register('/sw.js');
}

async function getMobilePushPublicKey(token) {
  const response = await fetch(`${API_BASE_URL}/mobile/push/public-key`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await readJson(response, 'Unable to load notification settings.');

  if (!data.configured || !data.publicKey) {
    throw new Error('Notifications are not configured right now.');
  }

  return data.publicKey;
}

async function registerMobilePushSubscription(token, subscription) {
  const response = await fetch(`${API_BASE_URL}/mobile/push/subscribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

  return readJson(response, 'Unable to enable notifications on this device.');
}

async function deactivateMobilePushSubscription(token, endpoint) {
  const response = await fetch(`${API_BASE_URL}/mobile/push/unsubscribe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ endpoint }),
  });

  return readJson(response, 'Unable to disable notifications on this device.');
}

async function disconnectMobilePushSubscription(token) {
  if (!supportsMobilePush()) return false;

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;

  try {
    await deactivateMobilePushSubscription(token, subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }

  return true;
}

async function uploadMobileFile(token, loadId, uploadType, file) {
  const formData = new FormData();
  formData.append('loadId', String(loadId));
  formData.append('uploadType', uploadType);
  formData.append('files', file);

  const response = await fetch(`${API_BASE_URL}/mobile/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  return readJson(response, 'Unable to upload these files right now.');
}

async function uploadMobileFiles(token, loadId, uploadType, files) {
  const uploaded = [];
  let latestResult = null;

  for (let index = 0; index < files.length; index += 1) {
    try {
      latestResult = await uploadMobileFile(token, loadId, uploadType, files[index]);
      uploaded.push(...(latestResult.uploaded || []));
    } catch (error) {
      error.uploaded = uploaded;
      error.remainingFiles = files.slice(index);
      throw error;
    }
  }

  return {
    ...latestResult,
    success: true,
    uploadType: latestResult?.uploadType || uploadType,
    uploaded,
  };
}

async function openExternalLink(url) {
  if (!url) return;

  if (isTauriRuntime) {
    try {
      await openUrl(url);
      return;
    } catch {
      // Fall through to the normal browser behavior.
    }
  }

  const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');

  if (!openedWindow) {
    window.location.href = url;
  }
}

function getDriverFirstName(driver) {
  const fullName = String(driver?.tmsName || driver?.name || '').trim();

  if (!fullName) {
    return 'Driver';
  }

  if (fullName.includes(',')) {
    return fullName.split(',')[1]?.trim().split(/\s+/)[0] || fullName;
  }

  return fullName.split(/\s+/)[0];
}

function getTimeGreeting() {
  const hour = new Date().getHours();

  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatMobileDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) return 'Date pending';

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  );

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatFileSize(size) {
  const bytes = Number(size || 0);

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getUploadFileValidationError(files) {
  if (files.length > MOBILE_UPLOAD_MAX_FILES) {
    return `Select no more than ${MOBILE_UPLOAD_MAX_FILES} files at once.`;
  }

  const oversizedFile = files.find((file) => file.size > MOBILE_UPLOAD_MAX_FILE_SIZE);

  if (oversizedFile) {
    return `${oversizedFile.name} is larger than 20 MB.`;
  }

  const unsupportedFile = files.find((file) => {
    const extension = String(file.name || '').toLowerCase().match(/\.[a-z0-9]{1,10}$/)?.[0] || '';
    return !MOBILE_UPLOAD_ALLOWED_TYPES.includes(file.type) &&
      !MOBILE_UPLOAD_ALLOWED_EXTENSIONS.includes(extension);
  });

  if (unsupportedFile) {
    return `${unsupportedFile.name} is not a supported photo or PDF.`;
  }

  return '';
}

function formatLoadTime(time, ampm) {
  const timeText = String(time || '').trim();
  const ampmText = String(ampm || '').trim();

  if (!timeText) return 'Time pending';
  if (!ampmText || /\b(?:am|pm)\b/i.test(timeText)) return timeText;

  return `${timeText} ${ampmText}`;
}

function formatStopLocation(name, city, state, fallback) {
  const cityState = [city, state].filter(Boolean).join(', ');
  return [name, cityState].filter(Boolean).join(' · ') || fallback || 'Location pending';
}

function HomeFact({ label, value, secondary }) {
  return (
    <div className="home-fact">
      <span>{label}</span>
      <strong>{value}</strong>
      {secondary ? <small>{secondary}</small> : null}
    </div>
  );
}

function LoadRoute({ load }) {
  if (!load?.Origin && !load?.Destination) return null;

  return (
    <div className="home-route" aria-label="Load route">
      <div>
        <span>From</span>
        <strong>{load.Origin || 'Origin pending'}</strong>
      </div>
      <span className="home-route-arrow" aria-hidden="true">
        →
      </span>
      <div>
        <span>To</span>
        <strong>{load.Destination || 'Destination pending'}</strong>
      </div>
    </div>
  );
}

function HomeLoadDetails({ homeState, load }) {
  const pickupLocation = formatStopLocation(
    load.Pickup1Name,
    load.Pickup1City,
    load.Pickup1State,
    load.Origin,
  );
  const deliveryLocation = formatStopLocation(
    load.Delivery1Name,
    load.Delivery1City,
    load.Delivery1State,
    load.Destination,
  );

  if (homeState === 'pickup_upload_needed') {
    return (
      <>
        <p className="home-task-copy">
          Pickup photos are still needed before this load can advance to delivery.
        </p>
        <HomeFact
          label="Pickup"
          value={formatMobileDate(load.PickupDate)}
          secondary={pickupLocation}
        />
        <LoadRoute load={load} />
      </>
    );
  }

  if (homeState === 'delivery_upload_needed') {
    return (
      <>
        <p className="home-task-copy">
          Delivery photos are still needed before this load can be closed.
        </p>
        <HomeFact
          label="Delivered"
          value={formatMobileDate(load.DeliveryDate)}
          secondary={deliveryLocation}
        />
        <LoadRoute load={load} />
      </>
    );
  }

  if (homeState === 'pickup_today') {
    return (
      <>
        <HomeFact
          label="Pickup"
          value={pickupLocation}
          secondary={formatLoadTime(load.PickupTime, load.PickupAMPM)}
        />
        <LoadRoute load={load} />
      </>
    );
  }

  if (homeState === 'delivering_today') {
    return (
      <>
        <HomeFact
          label="Delivery"
          value={deliveryLocation}
          secondary={formatLoadTime(load.DeliveryTime, load.DeliveryAMPM)}
        />
        <LoadRoute load={load} />
      </>
    );
  }

  if (homeState === 'in_transit') {
    return (
      <>
        <LoadRoute load={load} />
        <HomeFact
          label="Delivery"
          value={formatMobileDate(load.DeliveryDate)}
          secondary={formatLoadTime(load.DeliveryTime, load.DeliveryAMPM)}
        />
      </>
    );
  }

  return (
    <>
      <HomeFact
        label="Pickup"
        value={formatMobileDate(load.PickupDate)}
        secondary={`${pickupLocation} · ${formatLoadTime(load.PickupTime, load.PickupAMPM)}`}
      />
      <LoadRoute load={load} />
    </>
  );
}

function hasLoadValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function getLoadReference(load, fallback = 'Assigned load') {
  if (load?.BOL) return `BOL ${load.BOL}`;
  if (load?.BidID) return `Bid ${load.BidID}`;
  return fallback;
}

function getStopAddress(address1, city, state, zip) {
  const locality = [city, state].filter(Boolean).join(', ');
  const localityWithZip = [locality, zip].filter(Boolean).join(' ');

  return {
    line1: String(address1 || '').trim(),
    line2: localityWithZip,
    full: [address1, localityWithZip].filter(Boolean).join(', '),
  };
}

function getPhoneUrl(phone) {
  const normalized = String(phone || '').replace(/[^\d+]/g, '');
  return /\d/.test(normalized) ? `tel:${normalized}` : '';
}

function getDirectionsUrl(address) {
  const normalized = String(address || '').trim();

  return normalized
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(normalized)}`
    : '';
}

function LoadActionLink({ href, className = '', children }) {
  const linkClassName = `load-action-link${className ? ` ${className}` : ''}`;

  if (!href) {
    return (
      <span className={`${linkClassName} is-disabled`} aria-disabled="true">
        {children}
      </span>
    );
  }

  return (
    <a
      className={linkClassName}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        void openExternalLink(href);
      }}
    >
      {children}
    </a>
  );
}

function MobileStopEventControl({ type, load, isEnabled, operation, onRecord }) {
  if (!isEnabled) return null;

  const isPickup = type === 'pickup';
  const stopLabel = isPickup ? 'PICKUP' : 'DELIVERY';
  const stopState = getMobileStopEventState(load.stopEvents, type, 1);
  const stopEventsAvailable = load.stopEventsAvailable === true;
  const phase = operation?.phase || '';
  const action = operation?.action || stopState.nextAction;
  const isBusy = Boolean(phase);
  const isRefreshRequired = operation?.refreshRequired === true;
  const progressMessage = phase === 'getting-location'
    ? 'Getting current location…'
    : phase === 'recording'
      ? `Recording check-${action === 'out' ? 'out' : 'in'}…`
      : phase === 'refreshing'
        ? 'Refreshing stop status…'
        : '';

  if (!stopEventsAvailable) {
    return (
      <div className="load-stop-event load-stop-event--unavailable" role="status">
        <p>{load.stopEventsError || 'Check-in is temporarily unavailable.'}</p>
      </div>
    );
  }

  if (stopState.complete) {
    return (
      <div className="load-stop-event load-stop-event--complete" aria-live="polite">
        <strong>{stopLabel} COMPLETE</strong>
        <dl>
          <div>
            <dt>Arrived</dt>
            <dd>{formatMobileStopEventTime(stopState.arrivedEvent.time)}</dd>
          </div>
          <div>
            <dt>Departed</dt>
            <dd>{formatMobileStopEventTime(stopState.departedEvent.time)}</dd>
          </div>
        </dl>
      </div>
    );
  }

  if (!stopState.nextAction) {
    return (
      <div className="load-stop-event load-stop-event--unavailable" role="status">
        <p>Check-in status needs to be refreshed before another action.</p>
      </div>
    );
  }

  return (
    <div className="load-stop-event">
      {stopState.arrivedEvent ? (
        <div className="load-stop-event-arrival" aria-live="polite">
          <span>ARRIVED</span>
          <strong>{formatMobileStopEventTime(stopState.arrivedEvent.time)}</strong>
        </div>
      ) : null}

      <button
        className="load-stop-event-action"
        type="button"
        disabled={isBusy || isRefreshRequired}
        onClick={() => onRecord(type, stopState.nextAction)}
      >
        {`${stopState.nextAction === 'out' ? 'CHECK OUT OF' : 'CHECK IN AT'} ${stopLabel}`}
      </button>

      {progressMessage ? (
        <p className="load-stop-event-progress" aria-live="polite">
          {progressMessage}
        </p>
      ) : null}
      {operation?.error ? (
        <p className="load-stop-event-error" role="alert">
          {operation.error}
        </p>
      ) : null}
    </div>
  );
}

function LoadStopCard({
  type,
  load,
  sectionRef,
  onUpload,
  stopEventsEnabled,
  stopEventOperation,
  onStopEvent,
}) {
  const isPickup = type === 'pickup';
  const title = isPickup ? 'PICKUP' : 'DELIVERY';
  const facility = isPickup ? load.Pickup1Name : load.Delivery1Name;
  const address = isPickup
    ? getStopAddress(
        load.Pickup1Address1,
        load.Pickup1City,
        load.Pickup1State,
        load.Pickup1Zip,
      )
    : getStopAddress(
        load.Delivery1Address1,
        load.Delivery1City,
        load.Delivery1State,
        load.Delivery1Zip,
      );
  const date = isPickup ? load.PickupDate : load.DeliveryDate;
  const time = isPickup
    ? formatLoadTime(load.PickupTime, load.PickupAMPM)
    : formatLoadTime(load.DeliveryTime, load.DeliveryAMPM);
  const contactName = isPickup
    ? load.Pickup1ContactName
    : load.Delivery1ContactName;
  const contactPhone = isPickup
    ? load.Pickup1ContactNumber
    : load.Delivery1ContactNumber;
  const serviceLocation = isPickup
    ? load.pickupServiceLocation
    : load.deliveryServiceLocation;
  const facilityNotes = String(serviceLocation?.facilityNotes || '').trim();

  return (
    <section
      className="load-section load-stop-card"
      ref={sectionRef}
      tabIndex="-1"
      aria-labelledby={`${type}-section-title`}
    >
      <span className="load-section-kicker" id={`${type}-section-title`}>
        {title}
      </span>
      <h2>{facility || `${isPickup ? 'Pickup' : 'Delivery'} location`}</h2>

      {address.line1 || address.line2 ? (
        <address className="load-address">
          {address.line1 ? <span>{address.line1}</span> : null}
          {address.line2 ? <span>{address.line2}</span> : null}
        </address>
      ) : (
        <p className="load-muted">Address pending</p>
      )}

      <div className="load-schedule">
        <HomeFact label="Date" value={formatMobileDate(date)} />
        <HomeFact label="Time" value={time} />
      </div>

      {contactName || contactPhone ? (
        <div className="load-contact">
          <span>CONTACT</span>
          {contactName ? <strong>{contactName}</strong> : null}
          {contactPhone ? <small>{contactPhone}</small> : null}
        </div>
      ) : null}

      {facilityNotes ? (
        <div className="load-location-notes">
          <span>LOCATION NOTES</span>
          <p>{facilityNotes}</p>
          {serviceLocation?.mapLink ? (
            <LoadActionLink
              className="load-facility-map-action"
              href={serviceLocation.mapLink}
            >
              View Facility Map
            </LoadActionLink>
          ) : null}
        </div>
      ) : null}

      <div className="load-stop-actions">
        <LoadActionLink href={getPhoneUrl(contactPhone)}>Call Contact</LoadActionLink>
        <LoadActionLink href={getDirectionsUrl(address.full)}>Directions</LoadActionLink>
      </div>

      <MobileStopEventControl
        type={type}
        load={load}
        isEnabled={stopEventsEnabled}
        operation={stopEventOperation}
        onRecord={onStopEvent}
      />

      <button
        className="load-upload-action"
        type="button"
        onClick={() => onUpload(type)}
      >
        Upload {isPickup ? 'Pickup' : 'Delivery'} Photos
      </button>
    </section>
  );
}

function MobileOrderNotes({ notes }) {
  const text = String(notes || '').trim();
  if (!text) return null;

  return (
    <section className="load-section load-order-notes-card">
      <span className="load-section-kicker">ORDER NOTES</span>
      <p>{text}</p>
    </section>
  );
}

function LoadDetailSection({ title, rows }) {
  const visibleRows = rows.filter((row) => hasLoadValue(row.value));

  if (!visibleRows.length) return null;

  return (
    <section className="load-section load-detail-card">
      <span className="load-section-kicker">{title}</span>
      <dl>
        {visibleRows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function MobilePermitCard({ load }) {
  if (!load?.IsOversized) return null;

  return (
    <section className="load-section load-permit-card">
      <span className="load-section-kicker">OVERSIZED SHIPMENT</span>
      <h2>Permit Documents</h2>
      <p>Review the permits for this load before travel.</p>

      {load.PermitFolderWebUrl ? (
        <button
          className="load-permit-action"
          type="button"
          onClick={() => void openExternalLink(load.PermitFolderWebUrl)}
        >
          Open Permit Folder
        </button>
      ) : (
        <p className="load-permit-unavailable">
          The permit folder is not available yet.
        </p>
      )}
    </section>
  );
}

function MobilePaperworkCard({
  documents,
  error,
  isLoading,
  onOpen,
  onRetry,
}) {
  return (
    <section className="load-section load-paperwork-card" aria-labelledby="paperwork-title">
      <span className="load-section-kicker" id="paperwork-title">PAPERWORK</span>

      {isLoading ? (
        <p className="load-paperwork-status" aria-live="polite">
          Loading paperwork…
        </p>
      ) : error ? (
        <div className="load-paperwork-error" role="alert">
          <p>Paperwork could not be loaded.</p>
          <button type="button" onClick={onRetry}>Try Again</button>
        </div>
      ) : documents.length ? (
        <div className="load-paperwork-list">
          {documents.map((document) => (
            <button
              className="load-paperwork-row"
              type="button"
              key={document.id}
              onClick={() => onOpen(document)}
            >
              <span>{document.name}</span>
              <strong>VIEW</strong>
            </button>
          ))}
        </div>
      ) : (
        <p className="load-paperwork-status">
          No paperwork has been added for this load.
        </p>
      )}
    </section>
  );
}

function MobilePaperworkViewer({
  document: paperworkDocument,
  loadId,
  onClose,
  onLoadUnavailable,
  onSessionExpired,
  token,
}) {
  const [viewerUrl, setViewerUrl] = useState('');
  const [viewerError, setViewerError] = useState('');
  const [printError, setPrintError] = useState('');
  const [isFrameReady, setIsFrameReady] = useState(false);
  const closeButtonRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrlLease = null;
    let cancelled = false;

    async function loadPdf() {
      try {
        const blob = await getMobilePaperworkPdf({
          apiBaseUrl: API_BASE_URL,
          token,
          loadId,
          documentId: paperworkDocument.id,
          signal: controller.signal,
        });

        if (cancelled) return;
        objectUrlLease = createMobilePaperworkObjectUrl(blob);
        setViewerUrl(objectUrlLease.viewerUrl);
      } catch (error) {
        if (cancelled || error.name === 'AbortError') return;

        if (error.status === 401) {
          onSessionExpired(error.message);
          return;
        }
        if (error.code === 'MOBILE_PAPERWORK_LOAD_NOT_AVAILABLE') {
          onLoadUnavailable(error.message);
          return;
        }

        setViewerError(
          error.status === 404
            ? 'This paperwork is no longer available.'
            : 'This paperwork could not be opened.',
        );
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      controller.abort();
      objectUrlLease?.revoke();
    };
  }, [loadId, onLoadUnavailable, onSessionExpired, paperworkDocument.id, token]);

  function handlePrint() {
    const frameWindow = frameRef.current?.contentWindow;

    if (!isFrameReady) {
      setPrintError('Printing is not available on this device right now.');
      return;
    }

    try {
      setPrintError('');
      if (!printMobilePaperworkFrame(frameWindow)) {
        setPrintError('Printing is not available on this device right now.');
      }
    } catch {
      setPrintError('Printing is not available on this device right now.');
    }
  }

  return (
    <section
      className="paperwork-viewer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paperwork-viewer-title"
    >
      <header className="paperwork-viewer-header">
        <div>
          <span>PAPERWORK</span>
          <h1 id="paperwork-viewer-title">{paperworkDocument.name}</h1>
        </div>
        <button ref={closeButtonRef} type="button" onClick={onClose}>Close</button>
      </header>

      <div className="paperwork-viewer-body">
        {viewerError ? (
          <div className="paperwork-viewer-message" role="alert">
            <p>{viewerError}</p>
          </div>
        ) : viewerUrl ? (
          <iframe
            ref={frameRef}
            src={viewerUrl}
            title={paperworkDocument.name}
            onLoad={() => setIsFrameReady(true)}
          />
        ) : (
          <div className="paperwork-viewer-message" aria-live="polite">
            <p>Loading paperwork…</p>
          </div>
        )}
      </div>

      <footer className="paperwork-viewer-footer">
        {printError ? <p role="alert">{printError}</p> : null}
        <button
          type="button"
          disabled={!viewerUrl || Boolean(viewerError)}
          onClick={handlePrint}
        >
          Print
        </button>
      </footer>
    </section>
  );
}

function MobileLoadScreen({
  driver,
  loadResponse,
  error,
  isLoading,
  onRetry,
  topRef,
  pickupRef,
  deliveryRef,
  onUpload,
  paperworkDocuments = [],
  paperworkError,
  isPaperworkLoading,
  onOpenPaperwork,
  onRetryPaperwork,
  stopEventOperations = {},
  onStopEvent,
}) {
  if (isLoading) {
    return (
      <section className="home-message-card" aria-live="polite">
        <span className="auth-label">CURRENT LOAD</span>
        <h2>Loading...</h2>
        <p>Checking the latest operational details for Truck {driver.truck}.</p>
      </section>
    );
  }

  if (!loadResponse) {
    return (
      <section className="home-message-card home-message-card--error" role="alert">
        <span className="auth-label">LOAD UNAVAILABLE</span>
        <h2>We couldn’t load your current assignment.</h2>
        <p>{error || 'Please try again.'}</p>
        <button className="home-retry" type="button" onClick={onRetry}>
          Try Again
        </button>
      </section>
    );
  }

  if (!loadResponse.hasLoad || !loadResponse.load) {
    return (
      <section className="home-message-card home-message-card--empty">
        <span className="auth-label">CURRENT LOAD</span>
        <h2>No working load right now.</h2>
        <p>No current load is assigned to Truck {driver.truck}.</p>
      </section>
    );
  }

  const load = loadResponse.load;
  const loadRoleLabel = loadResponse.loadRole === 'next'
    ? 'NEXT LOAD'
    : loadResponse.loadRole === 'upcoming'
      ? 'UPCOMING LOAD'
      : 'CURRENT LOAD';
  const stopEventsEnabled = loadResponse.loadRole === 'current';
  const freightRows = [
    { label: 'Freight', value: load.Item1Description || load.Freight },
    { label: 'Quantity', value: load.Item1QTY },
    { label: 'Total pieces', value: load.TotalPieces },
    { label: 'Serial number', value: load.Item1Serial },
    { label: 'Dimensions', value: load.Item1Dimensions },
    { label: 'Estimated weight', value: load.EstimatedWeight },
    { label: 'Shipper / reference', value: load.ShipperNumber },
    { label: 'Tarps needed', value: load.NoOfTarpsNeeded },
  ];
  const informationRows = [
    { label: 'Route', value: load.Route },
    {
      label: 'Aircraft related',
      value: load.AircraftRelated === null ? '' : load.AircraftRelated ? 'Yes' : 'No',
    },
    {
      label: 'Team required',
      value: load.TeamRequired === null ? '' : load.TeamRequired ? 'Yes' : 'No',
    },
  ];

  return (
    <div className="load-screen">
      <section className="load-heading" ref={topRef} tabIndex="-1">
        <p className="eyebrow">{loadRoleLabel}</p>
        <h1>{getLoadReference(load)}</h1>
        <div className="load-heading-route">
          <strong>{load.Origin || 'Origin pending'}</strong>
          <span aria-hidden="true">→</span>
          <strong>{load.Destination || 'Destination pending'}</strong>
        </div>
        <button
          className="load-heading-upload"
          type="button"
          onClick={() => onUpload('')}
        >
          Upload Photos / Documents
        </button>
      </section>

      <LoadStopCard
        type="pickup"
        load={load}
        sectionRef={pickupRef}
        onUpload={onUpload}
        stopEventsEnabled={stopEventsEnabled}
        stopEventOperation={stopEventOperations.pickup}
        onStopEvent={onStopEvent}
      />
      <LoadStopCard
        type="delivery"
        load={load}
        sectionRef={deliveryRef}
        onUpload={onUpload}
        stopEventsEnabled={stopEventsEnabled}
        stopEventOperation={stopEventOperations.delivery}
        onStopEvent={onStopEvent}
      />
      <MobilePaperworkCard
        documents={paperworkDocuments}
        error={paperworkError}
        isLoading={isPaperworkLoading}
        onOpen={onOpenPaperwork}
        onRetry={onRetryPaperwork}
      />
      <MobileOrderNotes notes={load.OrderNotes} />
      <MobilePermitCard load={load} />
      <LoadDetailSection title="FREIGHT" rows={freightRows} />
      <LoadDetailSection title="LOAD INFORMATION" rows={informationRows} />
    </div>
  );
}

function MobileHome({
  driver,
  home,
  error,
  isLoading,
  onRetry,
  onPrimaryAction,
  onUpcomingLoad,
}) {
  const identity = home?.driver || driver;
  const upcomingLoads = Array.isArray(home?.upcomingLoads)
    ? home.upcomingLoads
    : home?.nextLoad
      ? [home.nextLoad]
      : [];

  return (
    <div className="home-dashboard">
      <section className="home-identity">
        <p className="eyebrow">Driver Portal</p>
        <h1>
          {getTimeGreeting()}, {getDriverFirstName(identity)}
        </h1>
        <p>
          Truck <strong>{identity.truck}</strong>
        </p>
      </section>

      {isLoading ? (
        <section className="home-message-card" aria-live="polite">
          <span className="auth-label">LOADING HOME</span>
          <h2>Checking today’s work</h2>
          <p>Connecting to the current Bid Listing.</p>
        </section>
      ) : !home ? (
        <section className="home-message-card home-message-card--error" role="alert">
          <span className="auth-label">HOME UNAVAILABLE</span>
          <h2>We couldn’t load today’s work.</h2>
          <p>{error || 'Please try again.'}</p>
          <button className="home-retry" type="button" onClick={onRetry}>
            Try Again
          </button>
        </section>
      ) : home.homeState === 'no_load' ? (
        <section className="home-message-card home-message-card--empty">
          <span className="auth-label">ALL CAUGHT UP</span>
          <h2>You’re all caught up.</h2>
          <p>No current load is assigned to Truck {identity.truck}.</p>
        </section>
      ) : (
        <>
          <section className="home-hero" data-home-state={home.homeState}>
            <span className="home-status-kicker">
              {HOME_STATE_LABELS[home.homeState] || 'CURRENT LOAD'}
            </span>
            <h2>{getLoadReference(home.currentLoad)}</h2>

            <div className="home-load-details">
              <HomeLoadDetails
                homeState={home.homeState}
                load={home.currentLoad}
              />
            </div>

            {home.primaryAction ? (
              <button
                className="home-primary-action"
                type="button"
                onClick={() => onPrimaryAction(home.primaryAction.type)}
              >
                {home.primaryAction.label}
              </button>
            ) : null}
          </section>

          {upcomingLoads.length ? (
            <section className="home-upcoming-section">
              <div className="home-upcoming-heading">
                <span className="auth-label">UPCOMING LOADS</span>
                <span>{upcomingLoads.length}</span>
              </div>

              <div className="home-upcoming-list">
                {upcomingLoads.map((load, index) => (
                  <article className="home-next-card" key={load.id || getLoadReference(load)}>
                    <span className="auth-label">
                      {index === 0 ? 'NEXT LOAD' : 'UPCOMING LOAD'}
                    </span>
                    <h2>{getLoadReference(load, 'Scheduled load')}</h2>
                    <HomeFact
                      label="Pickup"
                      value={formatMobileDate(load.PickupDate)}
                      secondary={formatStopLocation(
                        load.Pickup1Name,
                        load.Pickup1City,
                        load.Pickup1State,
                        load.Origin,
                      )}
                    />
                    <LoadRoute load={load} />
                    <button
                      className="home-next-action"
                      type="button"
                      onClick={() => onUpcomingLoad(load.id)}
                    >
                      View Load
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function MobileUploadScreen({
  load,
  error,
  isLoading,
  uploadType,
  files,
  isUploading,
  success,
  onRetry,
  onSelectType,
  onAddFiles,
  onRemoveFile,
  onUpload,
  onDone,
  onUploadMore,
}) {
  const fileInputRef = useRef(null);

  function handleFileSelection(event) {
    onAddFiles(Array.from(event.target.files || []));
    event.target.value = '';
  }

  if (isLoading) {
    return (
      <section className="home-message-card" aria-live="polite">
        <span className="auth-label">UPLOAD</span>
        <h2>Finding your load</h2>
        <p>Checking the current assignment and its upload folders.</p>
      </section>
    );
  }

  if (!load) {
    return (
      <section
        className={`home-message-card ${error ? 'home-message-card--error' : 'home-message-card--empty'}`}
        role={error ? 'alert' : undefined}
      >
        <span className="auth-label">UPLOAD</span>
        <h2>{error ? 'Upload is unavailable.' : 'No working load right now.'}</h2>
        <p>
          {error || 'There is no current load available for photos or documents.'}
        </p>
        {error ? (
          <button className="home-retry" type="button" onClick={onRetry}>
            Try Again
          </button>
        ) : null}
      </section>
    );
  }

  if (success) {
    const uploadedCount = success.uploaded?.length || 0;
    const destination = success.uploadType === 'pickup' ? 'Pickup Photos' : 'Delivery Photos';

    return (
      <div className="upload-screen">
        <section className="upload-heading">
          <p className="eyebrow">Upload Complete</p>
          <h1>{uploadedCount} {uploadedCount === 1 ? 'file' : 'files'} uploaded</h1>
          <p>
            {uploadedCount === 1 ? 'Your file was' : 'Your files were'} uploaded to {destination} for{' '}
            {getLoadReference(load)}.
          </p>
        </section>

        <section className="upload-success-card" aria-live="polite">
          <span className="upload-success-icon" aria-hidden="true">✓</span>
          <h2>Upload complete</h2>
          <p>Kole Connect may take a moment to update the load status.</p>
          <div className="upload-success-actions">
            <button type="button" className="upload-primary-button" onClick={onDone}>
              Done
            </button>
            <button type="button" className="upload-secondary-button" onClick={onUploadMore}>
              Upload More
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="upload-screen">
      <section className="upload-heading">
        <p className="eyebrow">Upload</p>
        <h1>{getLoadReference(load)}</h1>
        <div className="load-heading-route">
          <strong>{load.Origin || 'Origin pending'}</strong>
          <span aria-hidden="true">→</span>
          <strong>{load.Destination || 'Destination pending'}</strong>
        </div>
      </section>

      <section className="upload-card">
        <span className="load-section-kicker">DESTINATION</span>
        <h2>What are you uploading?</h2>
        <div className="upload-type-options" role="group" aria-label="Upload destination">
          <button
            type="button"
            className={`upload-type-option${uploadType === 'pickup' ? ' is-selected' : ''}`}
            aria-pressed={uploadType === 'pickup'}
            disabled={isUploading}
            onClick={() => onSelectType('pickup')}
          >
            <span aria-hidden="true">↑</span>
            Pickup Photos
          </button>
          <button
            type="button"
            className={`upload-type-option${uploadType === 'delivery' ? ' is-selected' : ''}`}
            aria-pressed={uploadType === 'delivery'}
            disabled={isUploading}
            onClick={() => onSelectType('delivery')}
          >
            <span aria-hidden="true">↓</span>
            Delivery Photos
          </button>
        </div>
      </section>

      <section className="upload-card">
        <span className="load-section-kicker">FILES</span>
        <h2>Photos or documents</h2>
        <input
          ref={fileInputRef}
          className="upload-file-input"
          type="file"
          multiple
          accept="image/*,application/pdf"
          disabled={isUploading}
          onChange={handleFileSelection}
        />
        <button
          type="button"
          className="upload-picker-button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          Take / Select Photos
        </button>
        <p className="upload-help">JPEG, PNG, HEIC/HEIF, or PDF · up to 20 MB each</p>

        {files.length ? (
          <ul className="upload-file-list">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                <div>
                  <strong>{file.name}</strong>
                  <small>{formatFileSize(file.size)}</small>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  disabled={isUploading}
                  onClick={() => onRemoveFile(index)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {error ? <p className="auth-error" role="alert">{error}</p> : null}

        <button
          type="button"
          className="upload-submit-button"
          disabled={!uploadType || !files.length || isUploading}
          onClick={onUpload}
        >
          {isUploading
            ? 'Uploading…'
            : `Upload ${files.length || ''} ${files.length === 1 ? 'File' : 'Files'}`.trim()}
        </button>
      </section>
    </div>
  );
}

function MobileMe({
  driver,
  error,
  isLoading,
  colorTheme,
  pushStatus,
  pushMessage,
  isPushSaving,
  onEnablePush,
  onDisablePush,
  onThemeChange,
  onSignOut,
}) {
  const displayName = String(driver?.name || driver?.tmsName || '').trim() || `Truck ${driver.truck}`;
  const typeDetails = [driver?.driverType, driver?.soloOrTeam].filter(Boolean).join(' · ');
  const pushCopy = MOBILE_PUSH_STATUS_COPY[pushStatus] || MOBILE_PUSH_STATUS_COPY.default;

  return (
    <div className="me-screen">
      <section className="me-heading">
        <p className="eyebrow">Me</p>
        <h1>{displayName}</h1>
        <p>Truck <strong>{driver.truck}</strong></p>
      </section>

      <section className="me-card">
        <span className="load-section-kicker">DRIVER INFORMATION</span>
        <dl>
          {driver.cellPhone1 ? (
            <div>
              <dt>Phone</dt>
              <dd>
                <a
                  href={getPhoneUrl(driver.cellPhone1)}
                  onClick={(event) => {
                    event.preventDefault();
                    void openExternalLink(getPhoneUrl(driver.cellPhone1));
                  }}
                >
                  {driver.cellPhone1}
                </a>
              </dd>
            </div>
          ) : null}
          {driver.emailAddress1 ? (
            <div>
              <dt>Email</dt>
              <dd>
                <a
                  href={`mailto:${driver.emailAddress1}`}
                  onClick={(event) => {
                    event.preventDefault();
                    void openExternalLink(`mailto:${driver.emailAddress1}`);
                  }}
                >
                  {driver.emailAddress1}
                </a>
              </dd>
            </div>
          ) : null}
          {typeDetails ? (
            <div>
              <dt>Type</dt>
              <dd>{typeDetails}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="me-card me-notification-card">
        <span className="load-section-kicker">NOTIFICATIONS</span>
        <div className="me-notification-status" data-status={pushStatus}>
          <span className="me-notification-dot" aria-hidden="true" />
          <strong>{pushCopy.label}</strong>
        </div>
        <p>{pushMessage || pushCopy.detail}</p>
        <div aria-live="polite">
          {pushStatus === 'enabled' ? (
            <button
              type="button"
              className="me-notification-button me-notification-button--secondary"
              disabled={isPushSaving}
              onClick={onDisablePush}
            >
              {isPushSaving ? 'Updating…' : 'Disable Notifications'}
            </button>
          ) : pushStatus !== 'unsupported' && pushStatus !== 'denied' ? (
            <button
              type="button"
              className="me-notification-button"
              disabled={isPushSaving || pushStatus === 'checking'}
              onClick={onEnablePush}
            >
              {isPushSaving ? 'Enabling…' : pushStatus === 'error' ? 'Try Again' : 'Enable Notifications'}
            </button>
          ) : null}
        </div>
      </section>

      <section className="me-card me-preferences-card">
        <span className="load-section-kicker">PREFERENCES</span>
        <div className="me-preference-option">
          <div className="me-preference-copy">
            <strong>Appearance</strong>
            <span>Choose the classic dark view or a warm cream light mode.</span>
          </div>
          <div className="me-theme-options" role="group" aria-label="Appearance theme">
            <button
              type="button"
              className={colorTheme === 'dark' ? 'is-selected' : ''}
              aria-pressed={colorTheme === 'dark'}
              onClick={() => onThemeChange('dark')}
            >
              <span aria-hidden="true">☾</span>
              Dark
            </button>
            <button
              type="button"
              className={colorTheme === 'light' ? 'is-selected' : ''}
              aria-pressed={colorTheme === 'light'}
              onClick={() => onThemeChange('light')}
            >
              <span aria-hidden="true">☀</span>
              Light
            </button>
          </div>
        </div>
      </section>

      <section className="me-card me-session-card">
        <span className="load-section-kicker">DEVICE / SESSION</span>
        <p>This device is signed in as Truck <strong>{driver.truck}</strong>.</p>
        {isLoading ? (
          <p className="me-session-status" aria-live="polite">Refreshing your profile…</p>
        ) : null}
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        <button type="button" className="me-sign-out" onClick={onSignOut}>
          Sign Out
        </button>
      </section>
    </div>
  );
}

function App() {
  const [truck, setTruck] = useState('');
  const [pin, setPin] = useState('');
  const [driver, setDriver] = useState(null);
  const [home, setHome] = useState(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [loadResponse, setLoadResponse] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [isLoadLoading, setIsLoadLoading] = useState(false);
  const [pendingLoadFocus, setPendingLoadFocus] = useState(null);
  const [activeLoadId, setActiveLoadId] = useState('');
  const [stopEventOperations, setStopEventOperations] = useState({});
  const [paperworkDocuments, setPaperworkDocuments] = useState([]);
  const [paperworkError, setPaperworkError] = useState('');
  const [isPaperworkLoading, setIsPaperworkLoading] = useState(false);
  const [activePaperworkDocument, setActivePaperworkDocument] = useState(null);
  const [uploadLoad, setUploadLoad] = useState(null);
  const [uploadType, setUploadType] = useState('');
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [isUploadLoading, setIsUploadLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [meError, setMeError] = useState('');
  const [isMeLoading, setIsMeLoading] = useState(false);
  const [pushStatus, setPushStatus] = useState('default');
  const [pushMessage, setPushMessage] = useState('');
  const [isPushSaving, setIsPushSaving] = useState(false);
  const [colorTheme, setColorTheme] = useState(getSavedMobileTheme);
  const loadTopRef = useRef(null);
  const pickupRef = useRef(null);
  const deliveryRef = useRef(null);
  const stopEventRequestsRef = useRef(new Set());
  const paperworkRequestRef = useRef(null);
  const pendingNotificationLoadIdRef = useRef(
    new URL(window.location.href).searchParams.get('loadId')?.trim() || '',
  );
  const [isLoading, setIsLoading] = useState(() =>
    Boolean(localStorage.getItem(MOBILE_TOKEN_KEY)),
  );

  useEffect(() => {
    const normalizedTheme = colorTheme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = normalizedTheme;
    document.body.dataset.theme = normalizedTheme;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute('content', MOBILE_THEME_COLORS[normalizedTheme]);
    const statusBarStyle = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    statusBarStyle?.setAttribute('content', normalizedTheme === 'light' ? 'default' : 'black-translucent');

    try {
      localStorage.setItem(MOBILE_THEME_KEY, normalizedTheme);
    } catch {
      // The current selection still applies when device storage is unavailable.
    }
  }, [colorTheme]);

  useEffect(() => () => {
    paperworkRequestRef.current?.abort();
  }, []);

  function clearMobileSession(message = '') {
    localStorage.removeItem(MOBILE_TOKEN_KEY);
    setDriver(null);
    setHome(null);
    setLoadResponse(null);
    setLoadError('');
    setActiveLoadId('');
    setPendingLoadFocus(null);
    setStopEventOperations({});
    stopEventRequestsRef.current.clear();
    paperworkRequestRef.current?.abort();
    paperworkRequestRef.current = null;
    setPaperworkDocuments([]);
    setPaperworkError('');
    setIsPaperworkLoading(false);
    setActivePaperworkDocument(null);
    setUploadLoad(null);
    setUploadType('');
    setUploadFiles([]);
    setUploadError('');
    setUploadSuccess(null);
    setIsUploadLoading(false);
    setIsUploading(false);
    setMeError('');
    setIsMeLoading(false);
    setPushStatus('default');
    setPushMessage('');
    setIsPushSaving(false);
    setIsLoading(false);
    setActiveTab('home');
    setError(message);
  }

  useEffect(() => {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    if (!token) {
      return undefined;
    }

    let cancelled = false;

    async function restoreSession() {
      try {
        const hydratedDriver = await getDriver(token);

        if (!cancelled) {
          setDriver(hydratedDriver);
        }

        const hydratedHome = await getMobileHome(token);

        if (!cancelled) {
          setHome(hydratedHome);
        }
      } catch (sessionError) {
        if (sessionError.status === 401) {
          localStorage.removeItem(MOBILE_TOKEN_KEY);

          if (!cancelled) {
            setDriver(null);
            setHome(null);
            setActiveTab('home');
          }
        }

        if (!cancelled) {
          setError(sessionError.message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!driver || !('serviceWorker' in navigator)) return undefined;

    let cancelled = false;
    let refreshInFlight = false;
    let refreshQueued = false;

    async function refreshHomeAfterPush() {
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }

      refreshInFlight = true;

      do {
        refreshQueued = false;
        const token = localStorage.getItem(MOBILE_TOKEN_KEY);
        if (!token) break;

        try {
          const refreshedHome = await getMobileHome(token);

          if (!cancelled && localStorage.getItem(MOBILE_TOKEN_KEY) === token) {
            setHome(refreshedHome);
            setError('');
          }
        } catch (refreshError) {
          if (cancelled) break;

          if (refreshError.status === 401) {
            clearMobileSession(refreshError.message);
          } else {
            setError('A new load update arrived, but Home could not refresh. Please try again.');
          }
        }
      } while (refreshQueued && !cancelled);

      refreshInFlight = false;
    }

    function handleServiceWorkerMessage(event) {
      if (event.data?.type !== 'KOLE_MOBILE_PUSH_RECEIVED') return;
      void refreshHomeAfterPush();
    }

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [driver]);

  useEffect(() => {
    if (!driver || !pendingNotificationLoadIdRef.current) return;

    const loadId = pendingNotificationLoadIdRef.current;
    pendingNotificationLoadIdRef.current = '';

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('loadId');
    window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    void openLoadTab('top', loadId);
  }, [driver]);

  useEffect(() => {
    if (!driver) return undefined;

    if (!supportsMobilePush()) {
      setPushStatus('unsupported');
      setPushMessage('');
      return undefined;
    }

    if (Notification.permission === 'denied') {
      setPushStatus('denied');
      setPushMessage('');
      return undefined;
    }

    if (Notification.permission !== 'granted') {
      setPushStatus('default');
      setPushMessage('');
      return undefined;
    }

    let cancelled = false;
    setPushStatus('checking');
    setPushMessage('');

    async function refreshPushRegistration() {
      const token = localStorage.getItem(MOBILE_TOKEN_KEY);
      if (!token) return;

      try {
        const registration = await getMobilePushRegistration();
        const subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          if (!cancelled) setPushStatus('default');
          return;
        }

        const publicKey = await getMobilePushPublicKey(token);
        if (!pushSubscriptionUsesKey(subscription, publicKey)) {
          if (!cancelled) {
            setPushStatus('default');
            setPushMessage('Tap Enable Notifications to refresh this device.');
          }
          return;
        }

        await registerMobilePushSubscription(token, subscription);
        if (!cancelled) setPushStatus('enabled');
      } catch (pushError) {
        if (pushError.status === 401) {
          if (!cancelled) clearMobileSession(pushError.message);
        } else if (!cancelled) {
          setPushStatus('error');
          setPushMessage(pushError.message);
        }
      }
    }

    void refreshPushRegistration();

    return () => {
      cancelled = true;
    };
  }, [driver]);

  useEffect(() => {
    if (
      activeTab !== 'load' ||
      isLoadLoading ||
      !pendingLoadFocus ||
      !loadResponse?.hasLoad ||
      !loadResponse.load
    ) {
      return undefined;
    }

    const targetRef =
      pendingLoadFocus === 'pickup'
        ? pickupRef
        : pendingLoadFocus === 'delivery'
          ? deliveryRef
          : loadTopRef;
    const timer = window.setTimeout(() => {
      targetRef.current?.focus({ preventScroll: true });
      targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingLoadFocus(null);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeTab, isLoadLoading, loadResponse, pendingLoadFocus]);

  async function handleLogin(event) {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/mobile/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ truck, pin }),
      });
      const data = await readJson(
        response,
        'Unable to sign in to Kole Connect Mobile.',
      );

      if (!data.token) {
        throw new Error('The server did not return a Mobile session token.');
      }

      localStorage.setItem(MOBILE_TOKEN_KEY, data.token);

      const hydratedDriver = await getDriver(data.token);
      setDriver(hydratedDriver);

      const hydratedHome = await getMobileHome(data.token);
      setHome(hydratedHome);
      setActiveTab('home');
      setPin('');
    } catch (loginError) {
      if (loginError.status === 401) {
        clearMobileSession(loginError.message);
      }

      if (loginError.status !== 401) {
        setError(loginError.message);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleHomeRetry() {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const hydratedHome = await getMobileHome(token);
      setHome(hydratedHome);
    } catch (homeError) {
      if (homeError.status === 401) {
        clearMobileSession(homeError.message);
      } else {
        setError(homeError.message);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function loadPaperworkForLoad(token, loadId) {
    paperworkRequestRef.current?.abort();
    const controller = new AbortController();
    paperworkRequestRef.current = controller;
    setPaperworkDocuments([]);
    setPaperworkError('');
    setIsPaperworkLoading(true);

    try {
      const documents = await getMobileLoadPaperwork({
        apiBaseUrl: API_BASE_URL,
        token,
        loadId,
        signal: controller.signal,
      });

      if (paperworkRequestRef.current !== controller) return;
      setPaperworkDocuments(documents);
    } catch (paperworkFailure) {
      if (
        paperworkFailure.name === 'AbortError' ||
        paperworkRequestRef.current !== controller
      ) {
        return;
      }

      if (paperworkFailure.status === 401) {
        clearMobileSession(paperworkFailure.message);
      } else if (paperworkFailure.code === 'MOBILE_PAPERWORK_LOAD_NOT_AVAILABLE') {
        setLoadError(paperworkFailure.message);
        setLoadResponse(null);
      } else {
        setPaperworkError('Paperwork could not be loaded.');
      }
    } finally {
      if (paperworkRequestRef.current === controller) {
        paperworkRequestRef.current = null;
        setIsPaperworkLoading(false);
      }
    }
  }

  async function openLoadTab(focusSection = 'top', loadId = '') {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    setActiveTab('load');
    setPendingLoadFocus(focusSection);
    setActiveLoadId(loadId);
    setLoadError('');
    setLoadResponse(null);
    setStopEventOperations({});
    paperworkRequestRef.current?.abort();
    paperworkRequestRef.current = null;
    setPaperworkDocuments([]);
    setPaperworkError('');
    setIsPaperworkLoading(false);
    setActivePaperworkDocument(null);
    setIsLoadLoading(true);

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      setIsLoadLoading(false);
      return;
    }

    try {
      const currentLoad = await getMyLoad(token, loadId);
      setLoadResponse(currentLoad);
      if (currentLoad.hasLoad && currentLoad.load?.id) {
        void loadPaperworkForLoad(token, String(currentLoad.load.id));
      }
    } catch (currentLoadError) {
      if (currentLoadError.status === 401) {
        clearMobileSession(currentLoadError.message);
      } else {
        setLoadError(currentLoadError.message);
      }
    } finally {
      setIsLoadLoading(false);
    }
  }

  async function handleStopEvent(stop, action) {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);
    const load = loadResponse?.load;
    const stopKey = String(stop || '').toLowerCase();
    const actionKey = String(action || '').toLowerCase();

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      return;
    }

    if (
      loadResponse?.loadRole !== 'current' ||
      load?.stopEventsAvailable !== true ||
      !load?.id ||
      !['pickup', 'delivery'].includes(stopKey) ||
      !['in', 'out'].includes(actionKey)
    ) {
      return;
    }

    const requestKey = `${load.id}|${stopKey}`;
    if (stopEventRequestsRef.current.has(requestKey)) return;

    stopEventRequestsRef.current.add(requestKey);
    setStopEventOperations((current) => ({
      ...current,
      [stopKey]: {
        action: actionKey,
        phase: 'getting-location',
        error: '',
        refreshRequired: false,
      },
    }));

    let eventRecorded = false;

    try {
      const location = await captureMobileStopLocation();

      setStopEventOperations((current) => ({
        ...current,
        [stopKey]: {
          action: actionKey,
          phase: 'recording',
          error: '',
          refreshRequired: false,
        },
      }));

      await recordMobileStopEvent(token, {
        loadId: String(load.id),
        stop: stopKey,
        stopSequence: 1,
        action: actionKey,
        location,
      });
      eventRecorded = true;

      setStopEventOperations((current) => ({
        ...current,
        [stopKey]: {
          action: actionKey,
          phase: 'refreshing',
          error: '',
          refreshRequired: false,
        },
      }));

      const refreshedLoad = await getMyLoad(token, String(load.id));
      if (localStorage.getItem(MOBILE_TOKEN_KEY) !== token) return;

      setLoadResponse((current) => (
        String(current?.load?.id || '') === String(load.id)
          ? refreshedLoad
          : current
      ));
      setStopEventOperations((current) => {
        const next = { ...current };
        delete next[stopKey];
        return next;
      });
    } catch (stopEventError) {
      if (stopEventError.status === 401) {
        clearMobileSession(stopEventError.message);
      } else {
        setStopEventOperations((current) => ({
          ...current,
          [stopKey]: {
            action: actionKey,
            phase: '',
            error: eventRecorded
              ? 'The stop event was recorded, but its latest status could not be refreshed. Reopen this load before recording another event.'
              : stopEventError.message,
            refreshRequired: eventRecorded,
          },
        }));
      }
    } finally {
      stopEventRequestsRef.current.delete(requestKey);
    }
  }

  async function openUploadTab({ load = null, loadId = '', type = '' } = {}) {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    paperworkRequestRef.current?.abort();
    paperworkRequestRef.current = null;
    setIsPaperworkLoading(false);
    setActivePaperworkDocument(null);
    setActiveTab('upload');
    setPendingLoadFocus(null);
    setUploadType(type);
    setUploadFiles([]);
    setUploadError('');
    setUploadSuccess(null);
    setIsUploading(false);

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      return;
    }

    if (load) {
      setUploadLoad(load);
      setIsUploadLoading(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setUploadLoad(null);
    setIsUploadLoading(true);

    try {
      const targetResponse = await getMyLoad(token, loadId);
      setUploadLoad(targetResponse.hasLoad ? targetResponse.load : null);
    } catch (targetError) {
      if (targetError.status === 401) {
        clearMobileSession(targetError.message);
      } else {
        setUploadError(targetError.message);
      }
    } finally {
      setIsUploadLoading(false);
    }
  }

  function handleAddUploadFiles(newFiles) {
    const combinedFiles = [...uploadFiles, ...newFiles];
    const validationError = getUploadFileValidationError(combinedFiles);

    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadFiles(combinedFiles);
    setUploadError('');
  }

  function handleRemoveUploadFile(index) {
    setUploadFiles((currentFiles) =>
      currentFiles.filter((file, fileIndex) => fileIndex !== index),
    );
    setUploadError('');
  }

  async function handleUpload() {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);
    const validationError = getUploadFileValidationError(uploadFiles);

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      return;
    }

    if (!uploadLoad?.id || !uploadType || !uploadFiles.length) {
      setUploadError('Choose Pickup or Delivery and select at least one file.');
      return;
    }

    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadError('');
    setIsUploading(true);

    try {
      const result = await uploadMobileFiles(
        token,
        uploadLoad.id,
        uploadType,
        uploadFiles,
      );
      setUploadFiles([]);
      setUploadSuccess(result);

      try {
        const refreshedHome = await getMobileHome(token);
        setHome(refreshedHome);
      } catch (refreshError) {
        if (refreshError.status === 401) {
          clearMobileSession(refreshError.message);
        }
      }
    } catch (uploadFailure) {
      if (uploadFailure.status === 401) {
        clearMobileSession(uploadFailure.message);
      } else {
        const uploadedCount = uploadFailure.uploaded?.length || 0;
        const remainingFiles = uploadFailure.remainingFiles || uploadFiles;

        if (uploadedCount > 0) {
          const uploadedLabel = uploadedCount === 1 ? 'file was' : 'files were';
          const remainingCount = remainingFiles.length;
          const remainingLabel = remainingCount === 1 ? 'file still needs' : 'files still need';

          setUploadFiles(remainingFiles);
          setUploadError(
            `${uploadedCount} ${uploadedLabel} uploaded. ` +
            `${remainingCount} ${remainingLabel} to be uploaded. ` +
            `${uploadFailure.message} Tap Upload again to retry only the remaining ${remainingCount === 1 ? 'file' : 'files'}.`,
          );
        } else {
          setUploadError(uploadFailure.message);
        }
      }
    } finally {
      setIsUploading(false);
    }
  }

  async function openMeTab() {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    paperworkRequestRef.current?.abort();
    paperworkRequestRef.current = null;
    setIsPaperworkLoading(false);
    setActivePaperworkDocument(null);
    setActiveTab('me');
    setPendingLoadFocus(null);
    setMeError('');

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      return;
    }

    setIsMeLoading(true);

    try {
      const refreshedDriver = await getDriver(token);

      if (localStorage.getItem(MOBILE_TOKEN_KEY) === token) {
        setDriver(refreshedDriver);
      }
    } catch (profileError) {
      if (profileError.status === 401) {
        clearMobileSession(profileError.message);
      } else {
        setMeError(profileError.message);
      }
    } finally {
      setIsMeLoading(false);
    }
  }

  async function handleEnableNotifications() {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      return;
    }

    if (!supportsMobilePush()) {
      setPushStatus('unsupported');
      setPushMessage('');
      return;
    }

    setIsPushSaving(true);
    setPushMessage('');

    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'default');
        return;
      }

      const publicKey = await getMobilePushPublicKey(token);
      const registration = await getMobilePushRegistration();
      let subscription = await registration.pushManager.getSubscription();

      if (subscription && !pushSubscriptionUsesKey(subscription, publicKey)) {
        try {
          await deactivateMobilePushSubscription(token, subscription.endpoint);
        } catch (deactivationError) {
          if (deactivationError.status === 401) throw deactivationError;
        }

        await subscription.unsubscribe();
        subscription = null;
      }

      if (subscription) {
        try {
          await registerMobilePushSubscription(token, subscription);
        } catch (registrationError) {
          if (registrationError.status !== 403) throw registrationError;
          await subscription.unsubscribe();
          subscription = null;
        }
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(publicKey),
        });
        await registerMobilePushSubscription(token, subscription);
      }

      setPushStatus('enabled');
      setPushMessage('This device is ready for Kole Connect notifications.');
    } catch (pushError) {
      if (pushError.status === 401) {
        clearMobileSession(pushError.message);
      } else {
        setPushStatus(Notification.permission === 'denied' ? 'denied' : 'error');
        setPushMessage(pushError.message || 'Unable to enable notifications on this device.');
      }
    } finally {
      setIsPushSaving(false);
    }
  }

  async function handleDisableNotifications() {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      return;
    }

    setIsPushSaving(true);
    setPushMessage('');

    try {
      await disconnectMobilePushSubscription(token);
      setPushStatus('default');
      setPushMessage('Notifications are off on this device.');
    } catch (pushError) {
      if (pushError.status === 401) {
        clearMobileSession(pushError.message);
      } else {
        setPushStatus('default');
        setPushMessage('Notifications are off in this browser. Server cleanup will finish automatically.');
      }
    } finally {
      setIsPushSaving(false);
    }
  }

  async function handleSignOut() {
    if (!window.confirm(`Sign out of Truck ${driver.truck}?`)) return;

    const token = localStorage.getItem(MOBILE_TOKEN_KEY);
    clearMobileSession('');
    setTruck('');
    setPin('');

    if (token) {
      try {
        await disconnectMobilePushSubscription(token);
      } catch {
        // The local subscription is still removed by the cleanup helper.
      }
    }
  }

  function handleHomePrimaryAction(actionType) {
    if (actionType === 'view_pickup') {
      void openLoadTab('pickup');
    } else if (actionType === 'view_delivery') {
      void openLoadTab('delivery');
    } else if (actionType === 'view_load') {
      void openLoadTab();
    } else if (actionType === 'upload_pickup' && home?.currentLoad) {
      void openUploadTab({ load: home.currentLoad, type: 'pickup' });
    } else if (actionType === 'upload_delivery' && home?.currentLoad) {
      void openUploadTab({ load: home.currentLoad, type: 'delivery' });
    }
  }

  function handlePaperworkLoadUnavailable(message) {
    setActivePaperworkDocument(null);
    setPaperworkDocuments([]);
    setPaperworkError('');
    setIsPaperworkLoading(false);
    setLoadError(message || 'That load is not available for this Mobile session.');
    setLoadResponse(null);
  }

  function handlePaperworkSessionExpired(message) {
    setActivePaperworkDocument(null);
    clearMobileSession(message || 'Your Mobile session has ended. Please sign in again.');
  }

  function openHomeTab() {
    paperworkRequestRef.current?.abort();
    paperworkRequestRef.current = null;
    setIsPaperworkLoading(false);
    setActivePaperworkDocument(null);
    setActiveTab('home');
    setPendingLoadFocus(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <div className="brand">
          <span className="brand-kole">KOLE</span>
          <span className="brand-connect">CONNECT</span>
        </div>

        <span className="mobile-label">MOBILE</span>
      </header>

      <main className="mobile-content">
        {driver ? (
          activeTab === 'load' ? (
            <MobileLoadScreen
              driver={driver}
              loadResponse={loadResponse}
              error={loadError}
              isLoading={isLoadLoading}
              onRetry={() => void openLoadTab(pendingLoadFocus || 'top', activeLoadId)}
              topRef={loadTopRef}
              pickupRef={pickupRef}
              deliveryRef={deliveryRef}
              onUpload={(type) =>
                void openUploadTab({ load: loadResponse?.load, type })
              }
              paperworkDocuments={paperworkDocuments}
              paperworkError={paperworkError}
              isPaperworkLoading={isPaperworkLoading}
              onOpenPaperwork={setActivePaperworkDocument}
              onRetryPaperwork={() => {
                const token = localStorage.getItem(MOBILE_TOKEN_KEY);
                const loadId = String(loadResponse?.load?.id || '');

                if (!token) {
                  clearMobileSession('Your Mobile session has ended. Please sign in again.');
                } else if (loadId) {
                  void loadPaperworkForLoad(token, loadId);
                }
              }}
              stopEventOperations={stopEventOperations}
              onStopEvent={(stop, action) => void handleStopEvent(stop, action)}
            />
          ) : activeTab === 'upload' ? (
            <MobileUploadScreen
              load={uploadLoad}
              error={uploadError}
              isLoading={isUploadLoading}
              uploadType={uploadType}
              files={uploadFiles}
              isUploading={isUploading}
              success={uploadSuccess}
              onRetry={() => void openUploadTab()}
              onSelectType={(type) => {
                setUploadType(type);
                setUploadError('');
              }}
              onAddFiles={handleAddUploadFiles}
              onRemoveFile={handleRemoveUploadFile}
              onUpload={() => void handleUpload()}
              onDone={openHomeTab}
              onUploadMore={() => {
                setUploadSuccess(null);
                setUploadError('');
              }}
            />
          ) : activeTab === 'me' ? (
            <MobileMe
              driver={driver}
              error={meError}
              isLoading={isMeLoading}
              colorTheme={colorTheme}
              pushStatus={pushStatus}
              pushMessage={pushMessage}
              isPushSaving={isPushSaving}
              onEnablePush={() => void handleEnableNotifications()}
              onDisablePush={() => void handleDisableNotifications()}
              onThemeChange={setColorTheme}
              onSignOut={() => void handleSignOut()}
            />
          ) : (
            <MobileHome
              driver={driver}
              home={home}
              error={error}
              isLoading={isLoading}
              onRetry={handleHomeRetry}
              onPrimaryAction={handleHomePrimaryAction}
              onUpcomingLoad={(loadId) => void openLoadTab('top', loadId)}
            />
          )
        ) : (
          <>
            <section className="welcome">
              <p className="eyebrow">Driver Portal</p>
              <h1>Kole Connect Mobile</h1>
              <p>
                Loads, documents and trip information — built for the road.
              </p>
            </section>

            {isLoading ? (
              <section className="auth-card" aria-live="polite">
                <span className="auth-label">DRIVER SIGN IN</span>
                <h2>Checking your session</h2>
                <p className="auth-copy">
                  Connecting this device to Kole Connect.
                </p>
              </section>
            ) : (
              <section className="auth-card">
                <span className="auth-label">DRIVER SIGN IN</span>
                <h2>Connect this device</h2>
                <p className="auth-copy">
                  Enter your truck number and Mobile PIN to continue.
                </p>

                <form className="auth-form" onSubmit={handleLogin}>
                  <label className="auth-field">
                    <span>Truck Number</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={truck}
                      onChange={(event) => setTruck(event.target.value)}
                      required
                    />
                  </label>

                  <label className="auth-field">
                    <span>PIN</span>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="current-password"
                      value={pin}
                      onChange={(event) => setPin(event.target.value)}
                      required
                    />
                  </label>

                  {error ? (
                    <p className="auth-error" role="alert">
                      {error}
                    </p>
                  ) : null}

                  <button className="auth-submit" type="submit">
                    Sign In
                  </button>
                </form>
              </section>
            )}
          </>
        )}
      </main>

      {driver ? (
        <nav className="bottom-nav" aria-label="Main navigation">
          <button
            type="button"
            className={`nav-item${activeTab === 'home' ? ' active' : ''}`}
            aria-current={activeTab === 'home' ? 'page' : undefined}
            onClick={openHomeTab}
          >
            <span className="nav-icon">⌂</span>
            <span>Home</span>
          </button>

          <button
            type="button"
            className={`nav-item${activeTab === 'load' ? ' active' : ''}`}
            aria-current={activeTab === 'load' ? 'page' : undefined}
            onClick={() => void openLoadTab()}
          >
            <span className="nav-icon">▣</span>
            <span>Load</span>
          </button>

          <button
            type="button"
            className={`nav-item${activeTab === 'upload' ? ' active' : ''}`}
            aria-current={activeTab === 'upload' ? 'page' : undefined}
            onClick={() => void openUploadTab()}
          >
            <span className="nav-icon">↑</span>
            <span>Upload</span>
          </button>

          <button
            type="button"
            className={`nav-item${activeTab === 'me' ? ' active' : ''}`}
            aria-current={activeTab === 'me' ? 'page' : undefined}
            onClick={() => void openMeTab()}
          >
            <span className="nav-icon">●</span>
            <span>Me</span>
          </button>
        </nav>
      ) : null}

      {driver && activePaperworkDocument && loadResponse?.load?.id ? (
        <MobilePaperworkViewer
          document={activePaperworkDocument}
          loadId={String(loadResponse.load.id)}
          token={localStorage.getItem(MOBILE_TOKEN_KEY) || ''}
          onClose={() => setActivePaperworkDocument(null)}
          onLoadUnavailable={handlePaperworkLoadUnavailable}
          onSessionExpired={handlePaperworkSessionExpired}
        />
      ) : null}
    </div>
  );
}

export default App;
