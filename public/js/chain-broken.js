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
 * Deliberate extra bug (broken version only):
 *   BUG    a category click sends its own requests at once (L2 → L5 for the
 *          clicked category), but afterwards it also reloads the category
 *          clicked BEFORE it, and that older data paints over L2 → L5.
 *          Click Chicken, then Dessert: /category/Dessert is requested and
 *          shown, then /category/Chicken runs again and the tiles, meal,
 *          ingredients, dossier and lists end up Chicken while the rail
 *          still highlights Dessert.
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
        state.lastClicked = categoryName;            // the next category click reloads this one (BUG)
      }

      /* ---------- L2 ---------- */
      if (depth <= 2) {
        stage = 'tiles';
        ui.highlightRail(entry.keepRail ? state.lastClicked : categoryName);
        if (entry.reload) log.choose(req.tag, `reloads previous "${categoryName}"`);
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

  /* BUG: after the clicked category, the previous one is reloaded and paints over it */
  async function selectCategory(entry) {
    const previous = state.lastClicked;
    state.lastClicked = entry.category;
    const tag = log.select(entry.label);
    ui.highlightRail(entry.category);

    await run({ ...entry, tag, keepRail: true });
    if (previous && previous !== entry.category) {
      await run({ category: previous, tag, keepRail: true, reload: true });
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
