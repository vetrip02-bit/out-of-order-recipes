/* ------------------------------------------------------------------ *
 * chain-broken.js - BROKEN VERSION (deliberately).
 *
 *  L1 /categories ─► L2 /category/{name} ─► L3 /meal/{id} ─┬► L4 /area/{name}
 *                                                           └► L4 /ingredient/{name} ─► L5 /by-ingredient/{canonical}
 *
 * Plain fetch-and-display: every response is painted the moment it arrives
 * and immediately starts its follow-up request, even when the user has
 * selected something newer since. There is NO generation, NO stale check
 * and NO abort.
 *
 * Levels always load in order: L1 → L2 → L3 → L4 (both together) → L5.
 *
 * Deliberate extra bugs (broken version only):
 *   BUG 1  a category click is one behind: the rail (L1) highlights the
 *          category just clicked, but L2 → L5 load the category clicked
 *          BEFORE it. Click Chicken, then Dessert: the rail says Dessert,
 *          while tiles, meal, ingredients, dossier and lists are Chicken.
 *   BUG 2  category clicks are queued and run one after another, so a click
 *          made while another category is still loading waits: the older
 *          category's whole chain (L2 → L5) is painted first, and the one
 *          clicked last only appears a little later.
 *
 * (`req.tag` only labels rows in the on-page log; nothing here ever compares it.)
 * ------------------------------------------------------------------ */

import { api } from './api.js';
import { log } from './log.js';
import * as ui from './ui.js';

export function createBrokenChain() {
  const state = { meal: null, lastClicked: null, categoryTurn: 0, mealTurn: 0 };

  async function run(entry = {}) {
    const depth = entry.mealId != null ? 3 : entry.category ? 2 : 1;
    const req = { tag: entry.tag || log.select(entry.label || 'Run chain', { mealId: entry.mealId }) };

    if (depth === 1) ui.refreshing('rail', 'tiles');
    if (depth === 2) ui.refreshing('tiles');
    ui.loading(...ui.MEAL_PANELS);

    let stage = 'rail';
    try {
      let categoryName = entry.category;
      let mealId = entry.mealId;

      /* ---------- L1 ---------- */
      if (depth === 1) {
        const { categories } = await api.categories(req);
        ui.renderRail(categories, req.tag);
        categoryName = categories[state.categoryTurn++ % categories.length].name;
        log.choose(req.tag, categoryName);
        state.lastClicked = categoryName;            // the next category click loads this one (BUG 1)
      }

      /* ---------- L2 ---------- */
      if (depth <= 2) {
        stage = 'tiles';
        ui.highlightRail(entry.railCategory ?? categoryName);
        if (entry.railCategory && entry.railCategory !== categoryName) {
          log.choose(req.tag, `loads "${categoryName}" (previous click) instead`);
        }
        const { meals } = await api.category(categoryName, req);
        ui.renderTiles(categoryName, meals, req.tag);
        const pick = meals[state.mealTurn++ % meals.length];
        mealId = pick.id;
        log.choose(req.tag, `meal ${pick.id} "${pick.name}"`, pick.id);
      }

      /* ---------- L3 ---------- */
      stage = 'meal';
      ui.highlightTile(mealId);
      const { meal } = await api.meal(mealId, req);
      state.meal = meal;
      ui.renderMeal(meal, req.tag);

      /* ---------- L4: started together, then L5 ---------- */
      await Promise.all([
        loadCuisine(meal, req),
        loadIngredient(meal, meal.ingredients[0]?.name, req),
      ]);
    } catch (err) {
      ui.failFrom(stage, err);                       // even an old failure is shown
    }
  }

  /* BUG 2: category clicks wait in a queue and run one after another */
  const categoryQueue = [];
  let categoryBusy = false;

  async function selectCategory(entry) {
    /* BUG 1: the rail shows this click, but L2 → L5 load the category clicked before it */
    const clicked = entry.category;
    entry = { ...entry, railCategory: clicked, category: state.lastClicked ?? clicked };
    state.lastClicked = clicked;
    ui.highlightRail(clicked);

    if (categoryBusy) {
      categoryQueue.push({ ...entry, tag: log.select(`${entry.label} (queued)`) });
      return;
    }
    categoryBusy = true;
    try {
      await run(entry);
      while (categoryQueue.length) {
        await run(categoryQueue.shift());
      }
    } finally {
      categoryBusy = false;
    }
  }

  async function loadCuisine(meal, req) {
    if (!meal.area) {
      ui.notRequested('cuisine', 'Not requested: this meal has no cuisine (area) recorded.');
      return;
    }
    try {
      const res = await api.area(meal.area, req);
      ui.renderRelated('cuisine', res.meals, `${ui.meals(res.count)} from ${res.area}`, req.tag);
    } catch (err) {
      ui.fail('cuisine', err);
    }
  }

  async function loadIngredient(meal, name, req) {
    if (!name) {
      ui.notRequested('dossier', 'Not requested: this meal lists no ingredients.');
      ui.notRequested('also', 'Not requested: no ingredient to follow.');
      return;
    }
    ui.highlightIngredient(name);

    let stage = 'dossier';
    try {
      const { ingredient } = await api.ingredient(name, req);
      ui.renderDossier(ingredient, meal, req.tag);

      stage = 'also';
      const res = await api.byIngredient(ingredient.name, req);
      ui.renderRelated('also', res.meals, `${ui.meals(res.count)} use ${res.ingredient}`, req.tag);
    } catch (err) {
      if (stage === 'dossier') {
        ui.fail('dossier', err, 'Click another ingredient to recover.');
        ui.notRequested('also', 'Not requested: /by-ingredient needs the canonical name from /ingredient.');
      } else {
        ui.fail('also', err);
      }
    }
  }

  function selectIngredient(name) {
    const meal = state.meal;
    if (!meal) return;
    const req = { tag: log.select(`ingredient "${name}" of meal ${meal.id}`, { mealId: meal.id }) };
    ui.loading('dossier', 'also');
    loadIngredient(meal, name, req);
  }

  return { run, selectCategory, selectIngredient };
}
