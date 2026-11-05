/* ------------------------------------------------------------------ *
 * ui.js - DOM painting shared by both versions.
 *
 * Nothing here decides *whether* to paint; the chain does. Each render takes
 * the selection tag of the response it paints so the log can flag a paint
 * that comes from an older selection (only the broken version does that).
 *
 * Panel states (data-state):
 *   loading     skeleton only
 *   refreshing  old content stays visible and clickable, "loading…" badge
 *   ready       content
 *   error       red message           idle   grey "not requested" message
 * ------------------------------------------------------------------ */

import { asset } from './api.js';
import { log } from './log.js';

const $ = (sel) => document.querySelector(sel);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PANELS = {
  rail: '#panelRail',
  tiles: '#panelTiles',
  meal: '#panelMeal',
  ings: '#panelIngredients',
  steps: '#panelSteps',
  dossier: '#panelDossier',
  cuisine: '#panelCuisine',
  also: '#panelAlso',
};

/* everything that belongs to one selected meal */
export const MEAL_PANELS = ['meal', 'ings', 'steps', 'dossier', 'cuisine', 'also'];

export const meals = (n) => `${n} meal${n === 1 ? '' : 's'}`;

const panel = (name) => $(PANELS[name]);
const stateOf = (name) => panel(name).dataset.state;

/* ---------- state changes ---------- */

export function loading(...names) {
  for (const name of names) {
    panel(name).dataset.state = 'loading';
    if (name === 'meal') {
      $('#heroImg').removeAttribute('src');          // no image from the previous meal
      $('#heroImg').alt = '';
      $('#mismatch').hidden = true;
    }
    if (name === 'dossier') $('#dossierImg').removeAttribute('src');
  }
}

/** keep what is on screen (and clickable) while a new request is out */
export function refreshing(...names) {
  for (const name of names) {
    panel(name).dataset.state = stateOf(name) === 'ready' || stateOf(name) === 'refreshing' ? 'refreshing' : 'loading';
  }
}

/** the request a "refreshing" panel was waiting for no longer matters */
export function settle(...names) {
  for (const name of names) {
    if (stateOf(name) === 'refreshing') panel(name).dataset.state = 'ready';
  }
}

export const hasContent = (name) => ['ready', 'refreshing'].includes(stateOf(name));

export function fail(name, err, hint = '') {
  const el = panel(name);
  el.dataset.state = 'error';
  const box = el.querySelector('.panel__err');
  box.classList.remove('is-muted');
  box.textContent = '';
  const strong = document.createElement('strong');
  strong.textContent = `⚠ ${err.path ? `${err.path} failed: ` : ''}${err.message || 'request failed'}`;
  box.append(strong);
  if (hint) box.append(document.createElement('br'), hint);
}

export function notRequested(name, message) {
  const el = panel(name);
  el.dataset.state = 'idle';
  const box = el.querySelector('.panel__err');
  box.classList.add('is-muted');
  box.textContent = message;
}

/** a level of the main chain failed: show it there, and say why the levels below are empty */
export function failFrom(stage, err) {
  if (stage === 'rail') {
    fail('rail', err, 'Click "Run chain again" to retry.');
    if (hasContent('tiles')) settle('tiles');
    else notRequested('tiles', 'Not requested: needs a category name from /categories.');
    for (const name of MEAL_PANELS) notRequested(name, 'Not requested: needs a meal id from the levels above.');
  } else if (stage === 'tiles') {
    fail('tiles', err, 'Pick another category to retry.');
    for (const name of MEAL_PANELS) notRequested(name, 'Not requested: needs a meal id from /category/{name}.');
  } else {
    fail('meal', err, 'Choose any meal card to recover.');
    for (const name of MEAL_PANELS.slice(1)) notRequested(name, 'Not requested: needs a successful /meal/{id}.');
  }
}

/* ---------- level 1 ---------- */

export function renderRail(categories, tag) {
  log.painted(tag, 'category list');
  $('#rail').innerHTML = categories.map((c) => `
    <li>
      <button class="rail__item" type="button" data-category="${esc(c.name)}">
        <img class="rail__img" src="${esc(asset(c.thumb))}" alt="" loading="lazy" />
        <span class="rail__name">${esc(c.name)}</span>
      </button>
    </li>`).join('');
  panel('rail').dataset.state = 'ready';
}

export function highlightRail(name) {
  document.querySelectorAll('.rail__item').forEach((el) =>
    el.classList.toggle('is-current', el.dataset.category === name));
}

/* ---------- level 2: four meal cards, each with its own wait ---------- */

export function renderCards(category, total, cards, tag) {
  log.painted(tag, `meal cards for "${category}"`);
  $('#tilesLabel').textContent =
    `First ${cards.length} of ${meals(total)} in ${category}. Each card waits a different time before its request, so a card clicked first can answer last.`;
  $('#tiles').innerHTML = cards.map((m, i) => `
    <li>
      <button class="mcard" type="button" data-meal="${esc(m.id)}" data-name="${esc(m.name)}" data-delay="${m.delayMs}">
        <span class="mcard__media">
          <img class="mcard__img" src="${esc(asset(m.thumb))}" alt="" loading="lazy" />
          <span class="mcard__delay">${m.delayMs / 1000} s</span>
        </span>
        <span class="mcard__body">
          <span class="mcard__no">Card ${i + 1}</span>
          <span class="mcard__name">${esc(m.name)}</span>
          ${m.area || m.country ? `<span class="mcard__area">${esc(m.area || m.country)}</span>` : ''}
        </span>
        <span class="mcard__status"></span>
        <span class="mcard__bar"><i></i></span>
      </button>
    </li>`).join('');
  panel('tiles').dataset.state = 'ready';
}

const cardEl = (id) => document.querySelector(`.mcard[data-meal="${CSS.escape(String(id))}"]`);

export function highlightCard(id) {
  document.querySelectorAll('.mcard').forEach((el) =>
    el.classList.toggle('is-current', el.dataset.meal === String(id)));
}

/** a card's /meal request is waiting its delay: show a countdown bar */
export function cardWaiting(id, ms) {
  const el = cardEl(id);
  if (!el) return;
  clearTimeout(el._fade);
  el.style.setProperty('--wait', `${ms}ms`);
  el.querySelector('.mcard__bar').innerHTML = '<i></i>';   // restart the bar
  el.querySelector('.mcard__status').textContent = ms ? `waiting ${ms / 1000} s…` : 'loading…';
  el.dataset.status = 'waiting';
}

/** the card's /meal request ended: answered, aborted or failed */
export function cardSettled(id, outcome) {
  const el = cardEl(id);
  if (!el) return;
  el.dataset.status = outcome;
  el.querySelector('.mcard__status').textContent = outcome;
  clearTimeout(el._fade);
  el._fade = setTimeout(() => { delete el.dataset.status; }, outcome === 'answered' ? 1500 : 4000);
}

/* ---------- level 3 ---------- */

export function renderMeal(meal, tag) {
  log.painted(tag, `meal "${meal.name}" (#${meal.id})`);

  const img = $('#heroImg');
  img.alt = meal.name;
  if (meal.image || meal.thumb) img.src = asset(meal.image || meal.thumb);
  else img.removeAttribute('src');

  $('#mealId').textContent = `meal #${meal.id} · selection #${tag.id}`;
  $('#mealName').textContent = meal.name;
  $('#mealWhere').textContent = [meal.category, meal.area, meal.country].filter(Boolean).join(' · ') || '—';
  $('#mealTags').innerHTML = (meal.tags || []).map((t) => `<li class="tag">${esc(t)}</li>`).join('');

  /* visible proof of the bug: what is on screen is not what was asked for last */
  const latest = log.latest();
  const mismatch = $('#mismatch');
  mismatch.hidden = tag === latest;
  mismatch.textContent = tag === latest ? '' :
    `⚠ Stale overwrite: this meal came from selection #${tag.id}, but your latest selection is #${latest.id} (${latest.label}).`;
  panel('meal').dataset.state = 'ready';

  $('#steps').innerHTML = (meal.instructions || []).map((s) => `<li>${esc(s)}</li>`).join('')
    || '<li>No instructions published.</li>';
  panel('steps').dataset.state = 'ready';

  $('#ingsLabel').textContent = `${meal.ingredients.length} items · click one to follow it through L4 and L5`;
  $('#ings').innerHTML = meal.ingredients.map((i) => `
    <li>
      <button class="ing" type="button" data-ingredient="${esc(i.name)}">
        <img class="ing__img" src="${esc(asset(i.thumb))}" alt="" loading="lazy" />
        <span class="ing__text">
          <span class="ing__name">${esc(i.name)}</span>
          ${i.measure ? `<span class="ing__measure">${esc(i.measure)}</span>` : ''}
        </span>
      </button>
    </li>`).join('');
  panel('ings').dataset.state = 'ready';
}

export function highlightIngredient(name) {
  const key = String(name).toLowerCase();
  document.querySelectorAll('.ing').forEach((el) =>
    el.classList.toggle('is-current', el.dataset.ingredient.toLowerCase() === key));
}

/* ---------- level 4 ---------- */

export function renderDossier(ingredient, meal, tag) {
  log.painted(tag, `ingredient dossier "${ingredient.name}"`);

  $('#dossierImg').src = asset(ingredient.thumb);
  $('#dossierImg').alt = ingredient.name;
  $('#dossierName').textContent = ingredient.name;

  const line = meal.ingredients.find((i) => i.name.toLowerCase() === ingredient.name.toLowerCase());
  $('#dossierMeasure').textContent = [
    `canonical name "${ingredient.name}"`,
    line?.measure ? `${meal.name} uses ${line.measure}` : '',
  ].filter(Boolean).join(' · ');

  $('#dossierText').textContent = ingredient.description
    ? ingredient.description.split(/\r?\n/)[0]
    : 'No description published for this ingredient.';
  panel('dossier').dataset.state = 'ready';
}

/* ---------- levels 4 + 5 ---------- */

export function renderRelated(name, list, label, tag) {
  log.painted(tag, name === 'cuisine' ? `cuisine list (${label})` : `by-ingredient list (${label})`);
  const target = name === 'cuisine' ? '#cuisineList' : '#alsoList';
  $(target).innerHTML = list.slice(0, 16).map((m) => `
    <li>
      <button class="mini" type="button" data-meal="${esc(m.id)}" data-name="${esc(m.name)}">
        <img class="mini__img" src="${esc(asset(m.thumb))}" alt="" loading="lazy" />
        <span class="mini__name">${esc(m.name)}</span>
      </button>
    </li>`).join('');
  panel(name).querySelector('.panel__count').textContent = label;
  panel(name).dataset.state = 'ready';
}
