/* ------------------------------------------------------------------ *
 * chain.js - the request chain, shared by both versions.
 *
 *  L1 /categories ─► L2 /category/{name} ─► L3 /meal/{id} ─┬► L4 /area/{name}
 *                                                           └► L4 /ingredient/{name} ─► L5 /by-ingredient/{canonical}
 *
 * A category shows 4 meal cards. Each card waits a different time before
 * its /meal request is sent (CARD_DELAYS: 4 s, 3 s, 2 s, 1 s), so a card
 * clicked first can answer last.
 *
 * The ONLY difference between the two versions is `corrected`:
 *   broken     a new click never aborts anything. The older click's
 *              requests keep running and paint over the newer click when
 *              they arrive.
 *   corrected  a new click aborts every request of the previous click
 *              (AbortController). A generation number is also checked after
 *              each await, as the final safeguard.
 * ------------------------------------------------------------------ */

import { api } from './api.js';
import { log } from './log.js';
import * as ui from './ui.js';

/* card 1 … card 4: simulated wait before /meal/{id} is sent */
export const CARD_DELAYS = [4000, 3000, 2000, 1000];

export function createChain({ corrected }) {
  let generation = 0;     // id of the latest selection
  let controller = null;  // corrected only: cancels the previous selection's requests

  const state = { meal: null, cuisineFor: null, categoryTurn: 0, mealTurn: 0 };

  /* every user selection / restart starts a new generation */
  function newSelection(label, mealId) {
    const gen = ++generation;
    if (corrected) {
      controller?.abort();                  // THE difference: stop the previous click's requests
      controller = new AbortController();
    }
    const tag = log.select(label, { mealId });
    return { gen, req: { tag, signal: controller?.signal } };
  }

  /* corrected only: true when a newer selection exists - the caller must stop */
  function isStale(gen, req, what, err) {
    if (!corrected || gen === generation) return false;
    log.ignored(req.tag, what, generation, err);
    return true;
  }

  /**
   * entry decides where the chain starts:
   *   { }                    level 1 - full chain (page load, Run chain again)
   *   { category }           level 2 - a category was clicked
   *   { mealId, delayMs }    level 3 - a meal card / Test failure was clicked
   */
  async function run(entry = {}) {
    const depth = entry.mealId != null ? 3 : entry.category ? 2 : 1;
    const { gen, req } = newSelection(entry.label || 'Run chain', entry.mealId);

    if (depth === 1) ui.refreshing('rail', 'tiles');
    if (depth === 2) { ui.settle('rail'); ui.refreshing('tiles'); }
    if (depth === 3) ui.settle('rail', 'tiles');
    ui.loading(...ui.MEAL_PANELS);
    state.meal = null;
    state.cuisineFor = null;

    let stage = 'rail';
    let what = '/categories';
    try {
      let categoryName = entry.category;
      let mealId = entry.mealId;
      let delayMs = entry.delayMs || 0;

      /* ---------- L1 ---------- */
      if (depth === 1) {
        const { categories } = await api.categories(req);
        if (isStale(gen, req, what)) return;

        ui.renderRail(categories, req.tag);
        categoryName = categories[state.categoryTurn++ % categories.length].name;
        log.choose(req.tag, categoryName);
      }

      /* ---------- L2: the category name came from L1 (or a click) ---------- */
      if (depth <= 2) {
        stage = 'tiles';
        what = `/category/${categoryName}`;
        ui.highlightRail(categoryName);

        const { meals } = await api.category(categoryName, req);
        if (isStale(gen, req, what)) return;

        const cards = meals.slice(0, CARD_DELAYS.length).map((m, i) => ({ ...m, delayMs: CARD_DELAYS[i] }));
        ui.renderCards(categoryName, meals.length, cards, req.tag);
        const pick = cards[cards.length - 1 - (state.mealTurn++ % cards.length)];   // fastest card first
        mealId = pick.id;
        delayMs = pick.delayMs;
        log.choose(req.tag, `card "${pick.name}" (${delayMs / 1000} s)`, pick.id);
      }

      /* ---------- L3: the id came from L2 (or a click) ---------- */
      stage = 'meal';
      what = `/meal/${mealId}`;
      ui.highlightCard(mealId);
      ui.cardWaiting(mealId, delayMs);

      let meal;
      try {
        ({ meal } = await api.meal(mealId, { ...req, delayMs }));
        ui.cardSettled(mealId, 'answered');
      } catch (err) {
        ui.cardSettled(mealId, err.aborted ? 'aborted' : 'failed');
        throw err;
      }
      if (isStale(gen, req, what)) return;

      state.meal = meal;
      ui.renderMeal(meal, req.tag);

      /* ---------- L4: both need only the meal - start together ---------- */
      await Promise.all([
        loadCuisine(meal, gen, req),
        loadIngredient(meal, meal.ingredients[0]?.name, gen, req),
      ]);
    } catch (err) {
      if (isStale(gen, req, what, err)) return;     // corrected: an aborted / old failure - ignore it
      ui.failFrom(stage, err);                       // broken: even an old failure is shown
    }
  }

  /* L4 - area name from L3 */
  async function loadCuisine(meal, gen, req) {
    if (!meal.area) {
      ui.notRequested('cuisine', 'Not requested: this meal has no cuisine (area) recorded.');
      return;
    }
    const what = `/area/${meal.area}`;
    try {
      const res = await api.area(meal.area, req);
      if (isStale(gen, req, what)) return;

      state.cuisineFor = meal.id;
      ui.renderRelated('cuisine', res.meals, `${ui.meals(res.count)} from ${res.area}`, req.tag);
    } catch (err) {
      if (isStale(gen, req, what, err)) return;
      ui.fail('cuisine', err);
    }
  }

  /* L4 - ingredient name from L3, then L5 with the canonical name from L4 */
  async function loadIngredient(meal, name, gen, req) {
    if (!name) {
      ui.notRequested('dossier', 'Not requested: this meal lists no ingredients.');
      ui.notRequested('also', 'Not requested: no ingredient to follow.');
      return;
    }
    ui.highlightIngredient(name);

    let what = `/ingredient/${name}`;
    try {
      const { ingredient } = await api.ingredient(name, req);
      if (isStale(gen, req, what)) return;

      ui.renderDossier(ingredient, meal, req.tag);

      /* L5 - only now does the canonical name exist */
      what = `/by-ingredient/${ingredient.name}`;
      const res = await api.byIngredient(ingredient.name, req);
      if (isStale(gen, req, what)) return;

      ui.renderRelated('also', res.meals, `${ui.meals(res.count)} use ${res.ingredient}`, req.tag);
    } catch (err) {
      if (isStale(gen, req, what, err)) return;
      if (what.startsWith('/ingredient/')) {
        ui.fail('dossier', err, 'Click another ingredient to recover.');
        ui.notRequested('also', 'Not requested: /by-ingredient needs the canonical name from /ingredient.');
      } else {
        ui.fail('also', err);
      }
    }
  }

  /* clicking an ingredient is a new selection from level 4 down */
  function selectIngredient(name) {
    const meal = state.meal;
    if (!meal) return;
    const { gen, req } = newSelection(`ingredient "${name}" of meal ${meal.id}`, meal.id);

    ui.loading('dossier', 'also');
    /* the cuisine list still belongs to this meal - keep it unless it never arrived */
    if (state.cuisineFor !== meal.id) {
      ui.loading('cuisine');
      loadCuisine(meal, gen, req);
    }
    loadIngredient(meal, name, gen, req);
  }

  return { run, selectIngredient };
}
