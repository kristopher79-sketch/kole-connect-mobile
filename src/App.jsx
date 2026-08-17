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

function LoadStopCard({ type, load, sectionRef }) {
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
      </section>

      <LoadStopCard type="pickup" load={load} sectionRef={pickupRef} />
      <LoadStopCard type="delivery" load={load} sectionRef={deliveryRef} />
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
                disabled={home.primaryAction.type === 'upload_delivery'}
                title={
                  home.primaryAction.type === 'upload_delivery'
                    ? 'Delivery photo upload is coming in a future Mobile pass.'
                    : undefined
                }
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
  const loadTopRef = useRef(null);
  const pickupRef = useRef(null);
  const deliveryRef = useRef(null);
  const [isLoading, setIsLoading] = useState(() =>
    Boolean(localStorage.getItem(MOBILE_TOKEN_KEY)),
  );

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
          setDriver(hydratedHome.driver);
          setHome(hydratedHome);
        }
      } catch (sessionError) {
        if (sessionError.status === 401) {
          localStorage.removeItem(MOBILE_TOKEN_KEY);

          if (!cancelled) {
            setDriver(null);
            setHome(null);
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
      setDriver(hydratedHome.driver);
      setHome(hydratedHome);
      setPin('');
    } catch (loginError) {
      if (loginError.status === 401) {
        localStorage.removeItem(MOBILE_TOKEN_KEY);
        setDriver(null);
        setHome(null);
      }

      setError(loginError.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleHomeRetry() {
    const token = localStorage.getItem(MOBILE_TOKEN_KEY);

    if (!token) {
      setDriver(null);
      setHome(null);
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      const hydratedHome = await getMobileHome(token);
      setDriver(hydratedHome.driver);
      setHome(hydratedHome);
    } catch (homeError) {
      if (homeError.status === 401) {
        localStorage.removeItem(MOBILE_TOKEN_KEY);
        setDriver(null);
        setHome(null);
      }

      setError(homeError.message);
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
    setIsLoadLoading(true);

    if (!token) {
      setDriver(null);
      setHome(null);
      setActiveTab('home');
      setIsLoadLoading(false);
      return;
    }

    try {
      const currentLoad = await getMyLoad(token, loadId);
      setDriver(currentLoad.driver);
      setLoadResponse(currentLoad);
    } catch (currentLoadError) {
      if (currentLoadError.status === 401) {
        localStorage.removeItem(MOBILE_TOKEN_KEY);
        setDriver(null);
        setHome(null);
        setLoadResponse(null);
        setActiveTab('home');
      }

      setLoadError(currentLoadError.message);
    } finally {
      setIsLoadLoading(false);
    }
  }

  function handleHomePrimaryAction(actionType) {
    if (actionType === 'view_pickup') {
      void openLoadTab('pickup');
    } else if (actionType === 'view_delivery') {
      void openLoadTab('delivery');
    } else if (actionType === 'view_load') {
      void openLoadTab();
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
            className="nav-item"
            disabled
            title="Upload is coming in a future Mobile pass."
          >
            <span className="nav-icon">↑</span>
            <span>Upload</span>
          </button>

          <button
            type="button"
            className="nav-item"
            disabled
            title="Profile is coming in a future Mobile pass."
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
