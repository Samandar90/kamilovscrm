let cache: any[] | null = null;
let lastFetch = 0;

const TTL = 1000 * 60 * 5;

export async function getServicesCached(fetcher: () => Promise<any[]>) {
  const now = Date.now();

  if (cache && now - lastFetch < TTL) {
    return cache;
  }

  const data = await fetcher();
  cache = data;
  lastFetch = now;
  return data;
}

export async function refreshServicesCache(fetcher: () => Promise<any[]>) {
  const data = await fetcher();
  cache = data;
  lastFetch = Date.now();
  return data;
}

export function getServicesInstant() {
  return cache;
}

/** Drop cached services after a change elsewhere (e.g. a doctor edits their own services). */
export function invalidateServicesCache() {
  cache = null;
  lastFetch = 0;
}
