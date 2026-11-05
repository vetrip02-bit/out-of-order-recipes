/* ------------------------------------------------------------------ *
 * app.js - picks the version from ?mode= and wires the controls.
 *
 *   ?mode=broken      createChain({ corrected: false })  never aborts
 *   ?mode=corrected   createChain({ corrected: true })   aborts the previous click
 *
 * Switching version reloads the page, so no request from one version can
 * ever land in the other.
 * ------------------------------------------------------------------ */

import { BASE, DIRECT, HUB } from './api.js';
import { log } from './log.js';
import { createChain } from './chain.js';

const $ = (sel) => document.querySelector(sel);

const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'broken' ? 'broken' : 'corrected';
document.body.dataset.mode = mode;

/* keep ?direct=1 when switching version */
for (const link of document.querySelectorAll('.switch__opt')) {
  if (params.has('direct')) link.href += '&direct=1';
}
const active = $(mode === 'broken' ? '#modeBroken' : '#modeCorrected');
active.classList.add('is-active');
active.setAttribute('aria-current', 'page');

const TEXT = {
  broken: {
    eyebrow: 'Broken version',
    title: 'A new click never aborts the previous request',
    text: 'Click card 1 (4 s) and then card 2 (3 s) straight away. Card 2 answers first, then card 1 is still '
      + 'running and its late answer paints over it. Watch for red STALE PAINTED rows in the log.',
  },
  corrected: {
    eyebrow: 'Corrected version',
    title: 'A new click aborts the previous request',
    text: 'Click card 1 (4 s) and then card 2 (3 s) straight away. Card 1’s request is aborted the moment you '
      + 'click card 2, so only card 2 is shown. Watch for ABORTED rows in the log.',
  },
}[mode];
$('#modeEyebrow').textContent = TEXT.eyebrow;
$('#modeTitle').textContent = TEXT.title;
$('#modeText').textContent = TEXT.text;

$('#apiBase').textContent = DIRECT ? `API ${BASE}` : `API /api/mealdb → ${HUB}/api/mealdb (local proxy)`;
document.title = `${mode === 'broken' ? 'Broken' : 'Corrected'} · Out of Order`;

const chain = createChain({ corrected: mode === 'corrected' });

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
    chain.run({ category: category.dataset.category, label: `category "${category.dataset.category}"` });
    return;
  }
  const meal = e.target.closest('[data-meal]');
  if (meal) {
    const delayMs = Number(meal.dataset.delay) || 0;   // meal cards wait 4 / 3 / 2 / 1 s
    chain.run({
      mealId: meal.dataset.meal,
      delayMs,
      label: `meal ${meal.dataset.meal} "${meal.dataset.name}"${delayMs ? ` (${delayMs / 1000} s card)` : ''}`,
    });
    return;
  }
  const ingredient = e.target.closest('[data-ingredient]');
  if (ingredient) chain.selectIngredient(ingredient.dataset.ingredient);
});

/* safety net: every request already has a catch, so this should never fire */
window.addEventListener('unhandledrejection', (e) => log.unhandled(e.reason));

chain.run({ label: 'page load' });
