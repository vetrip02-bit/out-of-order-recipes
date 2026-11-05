/* ------------------------------------------------------------------ *
 * api.js - every request the page makes goes through get().
 *
 * On localhost the page calls /api/mealdb on its own origin and the local
 * server proxies it to the assignment API. Add ?direct=1 to the page URL
 * to call the assignment API host directly instead (it sends CORS headers).
 * Anywhere else (a public static host has no proxy) it always calls directly.
 *
 * get() logs START / DONE / FAIL / ABORT and turns every non-2xx answer
 * and every network failure into a thrown ApiError, so callers only need
 * one try/catch.
 * ------------------------------------------------------------------ */

import { log } from './log.js';

export const HUB = 'https://api-hub-50046202742.development.catalystappsail.in';
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const DIRECT = !LOCAL || new URLSearchParams(location.search).has('direct');
export const ORIGIN = DIRECT ? HUB : '';
export const BASE = `${ORIGIN}/api/mealdb`;

/* image paths in responses are hub-relative ("/api/mealdb/meal-thumb/…") */
export const asset = (path) => (path && path.startsWith('/') ? ORIGIN + path : path || '');

export class ApiError extends Error {
  constructor(message, { status = 0, path = '', aborted = false } = {}) {
    super(message);
    this.name = aborted ? 'AbortError' : 'ApiError';
    this.status = status;
    this.path = path;
    this.aborted = aborted;
  }
}

/* race demo only: wait before sending, so one request can answer later than another */
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  });
}

/**
 * req = { tag, signal?, delayMs? } - tag labels the log rows with the selection number;
 * delayMs (race demo cards only) is a simulated wait before the request is sent
 */
async function get(path, req) {
  const url = BASE + path;
  if (req.delayMs) {
    log.wait(req.tag, url, req.delayMs);
    const waited = performance.now();
    try {
      await pause(req.delayMs, req.signal);
    } catch {
      log.abort(req.tag, url, Math.round(performance.now() - waited));
      throw new ApiError('request aborted', { path, aborted: true });
    }
  }
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  log.start(req.tag, url);

  let res;
  let body = null;
  try {
    res = await fetch(url, { signal: req.signal, headers: { accept: 'application/json' } });
    body = await res.json().catch(() => null);
  } catch (err) {
    if (err.name === 'AbortError') {
      log.abort(req.tag, url, ms());
      throw new ApiError('request aborted', { path, aborted: true });
    }
    log.fail(req.tag, url, `network error · ${err.message} · ${ms()} ms`);
    throw new ApiError(`Network error - ${err.message}`, { path });
  }

  if (!res.ok) {
    const message = body?.error?.message || res.statusText || 'request failed';
    log.fail(req.tag, url, `HTTP ${res.status} · ${message} · ${ms()} ms`);
    throw new ApiError(`HTTP ${res.status} - ${message}`, { status: res.status, path });
  }
  if (!body) {
    log.fail(req.tag, url, `HTTP ${res.status} · response was not JSON · ${ms()} ms`);
    throw new ApiError('The response was not valid JSON', { status: res.status, path });
  }

  const delay = res.headers.get('x-delay-ms');
  log.done(req.tag, url, `HTTP ${res.status} · ${ms()} ms${delay ? ` (server delay ${delay} ms)` : ''}`);
  return body;
}

/* every path value goes through encodeURIComponent */
const enc = encodeURIComponent;

export const api = {
  categories:   (req)       => get('/categories', req),                      // L1  2000 ms
  category:     (name, req) => get(`/category/${enc(name)}`, req),           // L2  1000 ms
  meal:         (id, req)   => get(`/meal/${enc(id)}`, req),                 // L3   500 ms
  area:         (name, req) => get(`/area/${enc(name)}`, req),               // L4   300 ms
  ingredient:   (name, req) => get(`/ingredient/${enc(name)}`, req),         // L4   300 ms
  byIngredient: (name, req) => get(`/by-ingredient/${enc(name)}`, req),      // L5   200 ms
};
