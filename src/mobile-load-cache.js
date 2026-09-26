// Only the current assignment is retained, for at most one minute.
export function createCurrentLoadCache(fetchLoad, now = Date.now) {
  let entry = null;
  let pending = null;
  let generation = 0;
  let expectedToken = null;
  let expectedId = '';
  const matches = (token, id) => entry?.token === token &&
    (!id || String(entry.data.load?.id || '') === String(id));
  const cache = {
    clear(token = null, id = '') {
      expectedToken = token;
      expectedId = String(id || '');
      generation += 1;
      entry = null;
      pending = null;
    },
    store(token, data) {
      if (data.loadRole === 'current' || !data.hasLoad) {
        entry = { token, data, expiresAt: now() + 60_000 };
      }
    },
    peek(token, id = '') {
      return matches(token, id) && now() < entry.expiresAt ? entry.data : null;
    },
    async get(token, id = '') {
      const cached = cache.peek(token, id);
      if (cached) return cached;
      // Explicit future-load selections always go to the API.
      if (id && !matches(token, id) &&
          !(expectedToken === token && expectedId === String(id))) return fetchLoad(token, id);
      if (pending?.token === token) return pending.promise;
      const version = generation;
      const request = { token };
      request.promise = Promise.resolve().then(() => fetchLoad(token, id)).then((data) => {
        if (generation === version) cache.store(token, data);
        return data;
      }).finally(() => {
        if (pending === request) pending = null;
      });
      pending = request;
      return request.promise;
    },
  };
  return cache;
}
