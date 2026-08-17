import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import './App.css';

const configuredApiBase = String(import.meta.env.VITE_KOLE_API_BASE || '').trim();
const API_BASE_URL = (
  configuredApiBase ||
  (import.meta.env.DEV
    ? 'http://localhost:5000'
    : 'https://kole-lookup-console.onrender.com')
).replace(/\/+$/, '');
const MOBILE_TOKEN_KEY = 'kole-connect-mobile-token';
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

const HOME_STATE_LABELS = {
  delivery_upload_needed: 'ACTION NEEDED',
  delivering_today: 'DELIVERING TODAY',
  in_transit: 'IN TRANSIT',
  pickup_today: 'PICKUP TODAY',
  upcoming_load: 'NEXT LOAD',
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

async function uploadMobileFiles(token, loadId, uploadType, files) {
  const formData = new FormData();
  formData.append('loadId', String(loadId));
  formData.append('uploadType', uploadType);
  files.forEach((file) => formData.append('files', file));

  const response = await fetch(`${API_BASE_URL}/mobile/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  return readJson(response, 'Unable to upload these files right now.');
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

function LoadActionLink({ href, children }) {
  if (!href) {
    return (
      <span className="load-action-link is-disabled" aria-disabled="true">
        {children}
      </span>
    );
  }

  return (
    <a
      className="load-action-link"
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

function LoadStopCard({ type, load, sectionRef, onUpload }) {
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

      <div className="load-stop-actions">
        <LoadActionLink href={getPhoneUrl(contactPhone)}>Call Contact</LoadActionLink>
        <LoadActionLink href={getDirectionsUrl(address.full)}>Directions</LoadActionLink>
      </div>

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
}) {
  if (isLoading) {
    return (
      <section className="home-message-card" aria-live="polite">
        <span className="auth-label">CURRENT LOAD</span>
        <h2>Loading your load</h2>
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
  const loadRoleLabel = loadResponse.loadRole === 'next' ? 'NEXT LOAD' : 'CURRENT LOAD';
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
      />
      <LoadStopCard
        type="delivery"
        load={load}
        sectionRef={deliveryRef}
        onUpload={onUpload}
      />
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
  onNextLoad,
}) {
  const identity = home?.driver || driver;

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

          {home.nextLoad ? (
            <section className="home-next-card">
              <span className="auth-label">NEXT LOAD</span>
              <h2>{getLoadReference(home.nextLoad, 'Scheduled load')}</h2>
              <HomeFact
                label="Pickup"
                value={formatMobileDate(home.nextLoad.PickupDate)}
                secondary={formatStopLocation(
                  home.nextLoad.Pickup1Name,
                  home.nextLoad.Pickup1City,
                  home.nextLoad.Pickup1State,
                  home.nextLoad.Origin,
                )}
              />
              <button
                className="home-next-action"
                type="button"
                onClick={() => onNextLoad(home.nextLoad.id)}
              >
                View Next Load
              </button>
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

function MobileMe({ driver, error, isLoading, onSignOut }) {
  const displayName = String(driver?.name || driver?.tmsName || '').trim() || `Truck ${driver.truck}`;
  const typeDetails = [driver?.driverType, driver?.soloOrTeam].filter(Boolean).join(' · ');

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
  const [uploadLoad, setUploadLoad] = useState(null);
  const [uploadType, setUploadType] = useState('');
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [isUploadLoading, setIsUploadLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [meError, setMeError] = useState('');
  const [isMeLoading, setIsMeLoading] = useState(false);
  const loadTopRef = useRef(null);
  const pickupRef = useRef(null);
  const deliveryRef = useRef(null);
  const [isLoading, setIsLoading] = useState(() =>
    Boolean(localStorage.getItem(MOBILE_TOKEN_KEY)),
  );

  function clearMobileSession(message = '') {
    localStorage.removeItem(MOBILE_TOKEN_KEY);
    setDriver(null);
    setHome(null);
    setLoadResponse(null);
    setLoadError('');
    setActiveLoadId('');
    setPendingLoadFocus(null);
    setUploadLoad(null);
    setUploadType('');
    setUploadFiles([]);
    setUploadError('');
    setUploadSuccess(null);
    setIsUploadLoading(false);
    setIsUploading(false);
    setMeError('');
    setIsMeLoading(false);
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

  async function openLoadTab(focusSection = 'top', loadId = '') {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    setActiveTab('load');
    setPendingLoadFocus(focusSection);
    setActiveLoadId(loadId);
    setLoadError('');
    setLoadResponse(null);
    setIsLoadLoading(true);

    if (!token) {
      clearMobileSession('Your Mobile session has ended. Please sign in again.');
      setIsLoadLoading(false);
      return;
    }

    try {
      const currentLoad = await getMyLoad(token, loadId);
      setLoadResponse(currentLoad);
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

  async function openUploadTab({ load = null, loadId = '', type = '' } = {}) {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

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
        setUploadError(uploadFailure.message);
      }
    } finally {
      setIsUploading(false);
    }
  }

  async function openMeTab() {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

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

  function handleSignOut() {
    if (!window.confirm(`Sign out of Truck ${driver.truck}?`)) return;

    clearMobileSession('');
    setTruck('');
    setPin('');
  }

  function handleHomePrimaryAction(actionType) {
    if (actionType === 'view_pickup') {
      void openLoadTab('pickup');
    } else if (actionType === 'view_delivery') {
      void openLoadTab('delivery');
    } else if (actionType === 'view_load') {
      void openLoadTab();
    } else if (actionType === 'upload_delivery' && home?.currentLoad) {
      void openUploadTab({ load: home.currentLoad, type: 'delivery' });
    }
  }

  function openHomeTab() {
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
              onSignOut={handleSignOut}
            />
          ) : (
            <MobileHome
              driver={driver}
              home={home}
              error={error}
              isLoading={isLoading}
              onRetry={handleHomeRetry}
              onPrimaryAction={handleHomePrimaryAction}
              onNextLoad={(loadId) => void openLoadTab('pickup', loadId)}
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
    </div>
  );
}

export default App;
