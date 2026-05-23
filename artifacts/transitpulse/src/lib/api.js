import axios from "axios";

export const API = "/api";

/* ── TTL cache & in-flight dedup ── */
const CACHE   = new Map(); // cacheKey -> { data, expiry }
const PENDING = new Map(); // cacheKey -> Promise

const CACHE_TTLS = [
  ["/stops",          60_000],
  ["/buses/",         12_000],
  ["/buses",          12_000],
  ["/routes/pending", 20_000],
  ["/users/",         30_000],
];

function ttlFor(path) {
  for (const [prefix, ms] of CACHE_TTLS) {
    if (path.startsWith(prefix)) return ms;
  }
  return 10_000;
}

export function invalidateCache(prefix) {
  for (const key of CACHE.keys()) {
    if (key.startsWith(prefix)) CACHE.delete(key);
  }
}

export function bustAllCache() {
  CACHE.clear();
}

/* ── axios instance ── */
export const api = axios.create({
  baseURL: API,
  timeout: 14_000,
});

/* ── retry interceptor (up to 2 retries, skip 4xx) ── */
api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config;
    if (!cfg) return Promise.reject(err);
    const status = err.response?.status;
    if (status && status >= 400 && status < 500) return Promise.reject(err);
    cfg.__retryCount = (cfg.__retryCount || 0) + 1;
    if (cfg.__retryCount > 2) return Promise.reject(err);
    await new Promise((res) => setTimeout(res, 700 * cfg.__retryCount));
    return api(cfg);
  },
);

/* ── cached GET ── */
export function get(path, config) {
  const cacheKey = path + (config ? JSON.stringify(config) : "");
  const now = Date.now();

  const hit = CACHE.get(cacheKey);
  if (hit && now < hit.expiry) return Promise.resolve(hit.data);

  const inflight = PENDING.get(cacheKey);
  if (inflight) return inflight;

  const req = api
    .get(path, config)
    .then((r) => {
      CACHE.set(cacheKey, { data: r.data, expiry: now + ttlFor(path) });
      PENDING.delete(cacheKey);
      return r.data;
    })
    .catch((err) => {
      PENDING.delete(cacheKey);
      /* serve stale on error rather than crash */
      const stale = CACHE.get(cacheKey);
      if (stale) return stale.data;
      throw err;
    });

  PENDING.set(cacheKey, req);
  return req;
}

/* ── POST always bypasses cache; optionally invalidates related keys ── */
export function post(path, body, config) {
  return api.post(path, body, config).then((r) => r.data);
}
