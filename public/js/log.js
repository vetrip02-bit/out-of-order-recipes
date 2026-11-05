/* ------------------------------------------------------------------ *
 * log.js - the on-page request / arrival log.
 *
 * Every user selection gets a numbered tag (#1, #2, …) so overlapping
 * chains can be told apart. The log only *records* what happened; it never
 * decides whether a response is painted - that is the chain's job.
 * ------------------------------------------------------------------ */

const T0 = performance.now();
const $ = (sel) => document.querySelector(sel);

const LABEL = {
  select: 'SELECT',
  start: 'START',
  done: 'DONE',
  fail: 'FAIL',
  abort: 'ABORTED',
  wait: 'DELAY',
  ignored: 'IGNORED',
  stale: 'STALE PAINTED',
};

let counter = 0;
let latest = null;

function add(tag, kind, text) {
  const list = $('#log');
  const stick = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;

  const row = document.createElement('li');
  row.className = `log__row log__row--${kind}`;
  row.dataset.kind = kind;
  if (tag) row.dataset.sel = tag.id;

  const at = document.createElement('span');
  at.className = 'log__at';
  at.textContent = `+${((performance.now() - T0) / 1000).toFixed(3)}s`;

  const gen = document.createElement('span');
  gen.className = 'log__gen';
  gen.textContent = tag ? `#${tag.id}` : '';

  const badge = document.createElement('span');
  badge.innerHTML = `<span class="k k--${kind}">${LABEL[kind]}</span>`;

  const body = document.createElement('span');
  body.className = 'log__text';
  body.textContent = text;

  row.append(at, gen, badge, body);
  list.append(row);
  if (stick) list.scrollTop = list.scrollHeight;
}

function showLatest() {
  $('#latestSel').textContent = latest ? `#${latest.id} · ${latest.label}` : '—';
}

export const log = {
  /** a new user selection or chain restart */
  select(label, { mealId = null } = {}) {
    latest = { id: ++counter, label, mealId };
    add(latest, 'select', label);
    showLatest();
    return latest;
  },

  /** the chain picked a value (category / meal) for this selection */
  choose(tag, detail, mealId) {
    tag.label += ` → ${detail}`;
    if (mealId != null) tag.mealId = String(mealId);
    if (tag === latest) showLatest();
  },

  latest: () => latest,

  start: (tag, url) => add(tag, 'start', `GET ${url}`),
  done: (tag, url, text) => add(tag, 'done', `${url} · ${text}`),
  fail: (tag, url, text) => add(tag, 'fail', `${url} · ${text}`),
  abort: (tag, url, ms) => add(tag, 'abort', `${url} · cancelled after ${ms} ms`),
  wait: (tag, url, ms) => add(tag, 'wait', `${url} · simulated delay ${ms} ms before the request is sent`),

  /** corrected version: a response (or error) from an older selection was dropped */
  ignored(tag, what, current, err) {
    const why = `from #${tag.id}, latest is #${current}`;
    if (err?.aborted) add(tag, 'ignored', `${what} - aborted request (${why}); nothing painted`);
    else if (err) add(tag, 'ignored', `stale error on ${what} "${err.message}" (${why}); not shown`);
    else add(tag, 'ignored', `stale response ${what} (${why}); not painted, no follow-up request`);
  },

  /** called by every render; flags paints that come from an older selection */
  painted(tag, what) {
    if (tag && latest && tag !== latest) {
      add(tag, 'stale', `${what} painted from #${tag.id} over newer selection #${latest.id}`);
    }
  },

  /** anything that escaped a try/catch - should never appear */
  unhandled: (reason) => add(null, 'fail', `UNHANDLED promise rejection: ${reason?.message || reason}`),

  clear() {
    $('#log').innerHTML = '';
  },
};
