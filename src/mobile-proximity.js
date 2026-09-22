const seenNotices = new Set();
const STORAGE_KEY = 'kole-mobile-seen-proximity';

export function getMobileProximityPrompt(driver, home) {
  const load = home?.currentLoad;
  if (!driver?.id || String(home?.driver?.id) !== String(driver.id) ||
      String(home?.driver?.truck) !== String(driver.truck) || !load?.id ||
      String(load.Status).toLowerCase() !== 'won') return null;
  // A retained field on a future/older load is not evidence of arrival today.
  if (!home.targetDate || ![load.PickupDate, load.DeliveryDate].includes(home.targetDate)) return null;
  const key = typeof load.ProximityNoticeKey === 'string' ? load.ProximityNoticeKey.trim() : '';
  const parts = key.split('|');
  if (parts.length !== 2 || key.length > 512 || (/[<>]/.test(key) || [...key].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) return null;
  const [bol, stopName] = parts.map((part) => part.trim());
  if (!bol || !stopName || bol !== String(load.BOL || '').trim()) return null;
  // Only existing primary-stop controls can be focused; never guess a secondary stop.
  const pickup = stopName === String(load.Pickup1Name || '').trim();
  const delivery = stopName === String(load.Delivery1Name || '').trim();
  return {
    id: JSON.stringify([String(driver.id), String(driver.truck), String(load.id), bol, stopName]),
    loadId: String(load.id),
    stopName,
    focus: pickup !== delivery ? (pickup ? 'pickup' : 'delivery') : 'top',
  };
}

export function hasSeenProximityPrompt(id) {
  if (seenNotices.has(id)) return true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(saved) && saved.includes(id);
  } catch {
    return false;
  }
}

export function rememberProximityPrompt(id) {
  seenNotices.add(id);
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    const entries = new Set(Array.isArray(saved) ? saved : []);
    entries.add(id);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...entries].slice(-100)));
  } catch {
    // The in-memory guard still prevents repeats when session storage is unavailable.
  }
}
