/* ------------------------------------------------------------------ *
 * app.js - picks the version from ?mode= and wires the controls.
 *
 *   ?mode=broken      chain-broken.js     (no stale-response protection)
 *   ?mode=corrected   chain-corrected.js  (request generations + guard)
 *
 * Switching version reloads the page, so no request from one version can
 * ever land in the other.
 * ------------------------------------------------------------------ */

import { BASE, DIRECT, HUB } from './api.js';
import { log } from './log.js';
import { createBrokenChain } from './chain-broken.js';
import { createCorrectedChain } from './chain-corrected.js';

const $ = (sel) => document.querySelector(sel);

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'broken' ? 'broken' : 'corrected';
document.body.dataset.mode = mode;

/* keep ?direct=1 when switching version */
for (const link of document.querySelectorAll('.mode')) {
  if (DIRECT) link.href += '&direct=1';
}
$(mode === 'broken' ? '#modeBroken' : '#modeCorrected').classList.add('is-active');
$(mode === 'broken' ? '#modeBroken' : '#modeCorrected').setAttribute('aria-current', 'page');

$('#modeBanner').innerHTML = mode === 'broken'
  ? '<strong>BROKEN VERSION</strong> - plain fetch-and-display. Every response is painted when it arrives, '
    + 'even if you have selected something newer since. Watch for red <b>STALE PAINTED</b> rows in the log.'
  : '<strong>CORRECTED VERSION</strong> - every selection gets a new generation; a response may only paint, '
    + 'or start the next request, while its generation is still the latest. Late answers show as amber <b>IGNORED</b> rows.';

$('#apiBase').textContent = DIRECT ? `API ${BASE}` : `API /api/mealdb → ${HUB}/api/mealdb (local proxy)`;
document.title = `${mode === 'broken' ? 'Broken' : 'Corrected'} · Out of Order`;

$('#abortToggle').hidden = mode !== 'corrected';

const chain = mode === 'broken'
  ? createBrokenChain()
  : createCorrectedChain({ useAbort: () => $('#abortBox').checked });

/* ---------- every entry point is a new selection ---------- */

$('#runBtn').addEventListener('click', () => chain.run({ label: 'Run chain again' }));

$('#failBtn').addEventListener('click', () => {
  const id = $('#failId').value;
  chain.run({ mealId: id, label: `Test failure → /meal/${id}` });
});

$('#clearLog').addEventListener('click', () => log.clear());

document.addEventListener('click', (e) => {
  const category = e.target.closest('[data-category]');
  if (category) {
    /* the broken version routes category clicks through its buggy selectCategory */
    const entry = { category: category.dataset.category, label: `category "${category.dataset.category}"` };
    if (chain.selectCategory) chain.selectCategory(entry);
    else chain.run(entry);
    return;
  }
  const meal = e.target.closest('[data-meal]');
  if (meal) {
    chain.run({ mealId: meal.dataset.meal, label: `meal ${meal.dataset.meal} "${meal.dataset.name}"` });
    return;
  }
  const ingredient = e.target.closest('[data-ingredient]');
  if (ingredient) chain.selectIngredient(ingredient.dataset.ingredient);
});

/* safety net: every request already has a catch, so this should never fire */
window.addEventListener('unhandledrejection', (e) => log.unhandled(e.reason));

chain.run({ label: 'page load' });
