# Out of Order — Chain, Race, Recover

A recipe page built from a real five-level request chain against the assignment API
`https://api-hub-50046202742.development.catalystappsail.in/api/mealdb`.
It has two versions, switched with the two buttons at the top of the page:

| Version | URL | What it does |
|---|---|---|
| **Broken version** | `http://localhost:5173/?mode=broken` | Plain fetch-and-display. Every response is painted when it arrives, even after a newer selection. It also has a deliberate category-click bug (see below). |
| **Corrected version** | `http://localhost:5173/?mode=corrected` | Every selection gets a new **generation**. A response may only paint, or start its next request, while its generation is still the latest. |

Both versions load the levels in the same order, L1 → L2 → L3 → L4 (`/area` and `/ingredient`
together) → L5, for page load, **Run chain again**, category clicks, tile clicks and ingredient
clicks. The broken version differs in two ways:

1. **No stale-response protection** (no generation, no stale check, no abort).
2. **Queued category clicks:** a category clicked while another category is still loading waits
   in a queue. Example: on Beef, click **Dessert**, then click **Pasta** before Dessert has loaded.
   **Dessert loads first** (L2 → L5), and **Pasta only appears a little later** (about 2.5 s) once
   Dessert's whole chain has finished.

The corrected version has neither. A category click goes straight to `/category/{name}` → `/meal`
→ L4 → L5, and only the last-clicked category is painted.

No mock data: every recipe, image and error comes from the assignment API. The original public
MealDB API is not used.

**Live site (GitHub Pages):** https://vetrip02-bit.github.io/out-of-order-recipes/
([broken](https://vetrip02-bit.github.io/out-of-order-recipes/?mode=broken) ·
[corrected](https://vetrip02-bit.github.io/out-of-order-recipes/?mode=corrected)).
The hosted page has no proxy, so it calls the assignment API host directly (the API sends CORS
headers). `.github/workflows/pages.yml` republishes `public/` on every push to `main`.

---

## 1. Run it locally

You need Node 18 or newer. There is nothing to install.

```bash
cd ~/Desktop/out-of-order-recipes
npm start
```

Then open **http://localhost:5173/?mode=broken** or **http://localhost:5173/?mode=corrected**.

`server.js` serves `public/` and proxies `/api/mealdb/*` to the assignment API without adding any
delay, so the page calls `/api/mealdb/...` on its own origin. Each proxied response carries an
`x-proxied-from` header that shows the real upstream URL, and the API's own `x-delay-ms` header is
passed through.

Optional: add `&direct=1` (for example `http://localhost:5173/?mode=broken&direct=1`) to make the
browser call `https://api-hub-50046202742.development.catalystappsail.in/api/mealdb/...` directly.
The API sends CORS headers for this. Use this mode if your Network evidence must show the
assignment host's URLs.

### Files

| File | Role |
|---|---|
| `server.js` | Static server and `/api/mealdb` dev proxy (no dependencies) |
| `public/index.html` | Page layout: mode buttons, controls, panels, log |
| `public/js/api.js` | `fetch` wrapper. Uses `encodeURIComponent` for every path value, turns non-2xx and network errors into `ApiError`, logs START / DONE / FAIL |
| `public/js/chain-broken.js` | **Broken** chain: no generation, no stale checks, plus the `selectCategory` queue bug |
| `public/js/chain-corrected.js` | **Corrected** chain: generation counter, `isStale` guard, optional `AbortController` |
| `public/js/ui.js` | Rendering shared by both versions |
| `public/js/log.js` | On-page request and arrival log |
| `public/js/app.js` | Chooses the version from `?mode=` and wires up clicks |

### The chain (real delays from the API docs)

```
L1 GET /categories                          2000 ms   → choose a category name
L2 GET /category/{name}                     1000 ms   → choose a meal id
L3 GET /meal/{id}                            500 ms   → area + ingredient names
L4 GET /area/{area}            ┐ started     300 ms
L4 GET /ingredient/{name}      ┘ together    300 ms   → canonical ingredient.name
L5 GET /by-ingredient/{canonical name}       200 ms   (only after L4 /ingredient answers)
```

Where you can enter the chain:
- **Run chain again** starts at L1.
- A **category** click starts at L2.
- A **meal tile** or mini-tile click, or **Test failure**, starts at L3.
- An **ingredient** click starts again from L4. `/ingredient` is sent, then `/by-ingredient`. If the cuisine list for the meal has not arrived yet, `/area` is sent again too.

### Reading the on-page log

| Tag | Meaning |
|---|---|
| `#n` | Selection number (in the corrected version this equals the generation) |
| SELECT | A new user selection or chain restart |
| START | Request sent (full URL, as shown in Network) |
| DONE | Response arrived: status, measured ms, and the server's `x-delay-ms` |
| FAIL | Non-2xx response or network failure |
| IGNORED | **Corrected version only:** a stale response or error was dropped. Nothing was painted and no follow-up request was sent |
| ABORTED | Corrected version with the AbortController box ticked: a superseded request was cancelled |
| STALE PAINTED | **Broken version only:** a response from an older selection overwrote the screen |

In the broken version, a red **"⚠ Stale overwrite"** box also appears under the meal title when the
meal on screen came from an older selection.

---

## 2. Planning tables

### 2a. Three representative requests

| Request | Depends on (must wait for) | Runs concurrently with | Stale-response decision (corrected version) |
|---|---|---|---|
| `GET /categories` (L1, ~2000 ms) | Nothing. It is the entry point. | Nothing in the same chain. It can overlap a *newer* selection's requests, which is how the race happens. | After it arrives, check `gen === generation`. If a tile was clicked meanwhile, the response is **ignored**: the rail is not repainted, the category name is not chosen, and **`/category/{name}` is never sent**. |
| `GET /meal/{id}` (L3, ~500 ms) | The meal id, from `/category/{name}` or from a tile click | Nothing at its own level. Its answer starts **`/area` and `/ingredient` at the same time** (neither is awaited before the other starts). | Checked before painting the meal card, ingredients and method, **and before** starting the two L4 requests. If it is stale, the image, name and steps of the old meal never appear, and no L4 request is made for it. |
| `GET /by-ingredient/{name}` (L5, ~200 ms) | The **canonical** `ingredient.name` from `/ingredient/{name}`. The meal only has the lower-case name. | It may overlap the still-running `/area/{name}` from the same generation. | Checked after it arrives. A late list from a previous meal or ingredient is never shown under the new meal. |

### 2b. Race and failure test plan

| # | Test | Steps | Slow request | Fast request | Expected: Broken | Expected: Corrected |
|---|---|---|---|---|---|---|
| R1 | Slow chain vs fast meal | Let the page finish loading. Click **Run chain again**, then within ~1 s click a *different* meal tile. | `/categories` (2000 ms), followed by `/category`, `/meal`, `/area`, `/ingredient`, `/by-ingredient` | `/meal/{clicked id}` (500 ms) | The clicked meal appears, then about 3.5 s after the restart it is **overwritten** by the restart's meal. Rail and tiles change to the next category. The log shows STALE PAINTED rows and the red "Stale overwrite" box appears. | The clicked meal stays. `/categories` arrives and is **IGNORED**. No `/category/...` request follows. |
| R2 | Stale error | Click **Test failure** (`/meal/1`), then within ~50 ms click a valid tile. | `/meal/{valid id}` (500 ms) | `/meal/1` → 404 (~100 ms) | The error shows briefly, then the valid meal paints. The result is correct because the newest request happens to finish last. | The 404 is **IGNORED** as a stale error and never shown. The valid meal paints. |
| R3 | Stale success over an error | Click a valid tile, then within ~50 ms click **Test failure**. | `/meal/{valid id}` (500 ms) | `/meal/1` → 404 (~100 ms) | The 404 shows, then the older valid meal **paints over it**, along with its dossier and by-ingredient list. The "Stale overwrite" box appears. | The 404 stays. The late valid meal is **IGNORED** and no L4 request is sent for it. |
| B1 | One category click (both versions load in order) | Let the page finish loading on Beef. Click **Dessert** once. | `/category/Dessert` (1000 ms) | — | `/category/Dessert` → `/meal/{Dessert meal}` → `/area` + `/ingredient` together → `/by-ingredient`. The Dessert meal is shown. | Same order and result. |
| B2 | Second category clicked before the first loads (broken-only bug) | On Beef, click **Dessert**, then click **Pasta** within ~0.5 s. | Dessert's full run L2 → L5 (~2.7 s) | — | Latest selection says Pasta, but the **Dessert** tiles and meal appear first, with STALE PAINTED rows. About 2.5 s later the **Pasta** tiles appear. | Dessert's response is IGNORED. Only Pasta is painted. |
| F1 | Missing meal | Choose `/meal/1 · missing id (404)` and click **Test failure**. Then click any tile. | — | — | The meal panel shows "HTTP 404 – no meal with id 1". Dependent panels say "Not requested". Clicking a tile recovers. | Same |
| F2 | Invalid meal id | Choose `/meal/0 · invalid id (400)` and click **Test failure**. Then click any tile. | — | — | "HTTP 400 – meal id must be a positive integer", then recovery | Same |
| F3 | Network failure | Stop the server (Ctrl+C) and click a tile. Then restart with `npm start` and click a tile again. | — | — | "Network error – Failed to fetch" (or the proxy's 502 if only the upstream is unreachable). No uncaught promise error. Recovery after restart. | Same |

---

## 3. Test records (prediction → observed result → explanation)

The **"Observed by Claude"** lines were recorded on 2026-10-28, in Claude's built-in browser,
against the real API through the local proxy. They are copied from the on-page log of that run.
Your own millisecond numbers will differ. Fill in the **"Your observation"** lines from your own
run in Chrome.

### Test 1 — Waiting and parallel requests (page load, corrected version)

- **Prediction:** Requests start strictly one after another for L1 → L2 → L3. Each one starts only
  after the previous DONE row. `/area` and `/ingredient` START in the same couple of milliseconds,
  right after `/meal` is DONE. `/by-ingredient` (the fastest endpoint) starts only after
  `/ingredient` is DONE, and so it fills last.
- **Observed by Claude:**
  - `/categories` DONE at +2.133 s (2130 ms, server delay 2000).
  - `/category/Beef` START at +2.136 s, DONE at +3.192 s.
  - `/meal/53281` START at +3.208 s, DONE at +3.760 s.
  - `/area/Algerian` START at +3.767 s and `/ingredient/Ground%20Beef` START at +3.769 s (2 ms apart).
  - `/ingredient` DONE at +4.481 s, then `/by-ingredient/Ground%20Beef` START at +4.485 s, DONE at +4.763 s.
- **Your observation (Network waterfall):** `/categories` ended at ____ ms. `/category/...` started at ____ ms.
  `/area/...` and `/ingredient/...` started at ____ / ____ ms. `/by-ingredient/...` started at ____ ms.
- **Explanation:** Each `await` holds back the next request until its parameter exists. The two
  level-4 functions are called without `await`, so both requests are in flight together.
  `/by-ingredient` needs the canonical name, which exists only in the `/ingredient` answer.

### Test 2 — The race (R1) in both versions

- **Prediction:** In the broken version, the restart's `/categories` (2 s) lands after the clicked
  meal (0.5 s) and drags the page to a different category and meal. In the corrected version, that
  late response is ignored and the clicked meal stays.
- **Observed by Claude, broken version:**
  - Selection #2 = Run chain again. Selection #3 = tile "Arepa pelua" (53329), clicked 400 ms later.
  - "Arepa pelua" painted at +11.173 s.
  - At +12.125 s, #2's `/categories` arrived and was marked STALE PAINTED. It then started `/category/Chicken`.
  - At +13.750 s the meal was replaced by "Ayam Percik" (#53050).
  - The cuisine list became "Malaysian" and the dossier became "Chicken Thighs".
  - The red box read "Stale overwrite: this meal came from selection #2, but your latest selection is #3".
- **Observed by Claude, corrected version:**
  - Same clicks. "Arepa pelua" painted at +19.151 s.
  - #2's `/categories` DONE at +20.256 s, then `IGNORED stale response /categories (from #2, latest is #3); not painted, no follow-up request`.
  - Final meal: still "Arepa pelua". No `/category/...` request was sent.
- **Observed by Claude, corrected version with the AbortController box ticked:** `/categories` was
  `ABORTED … cancelled after 408 ms` at the moment of the tile click, then IGNORED. The meal stayed
  correct.
- **Your observation:** Broken: final meal ______, latest selection ______. Network shows
  `/category/____` started after `/categories` finished: yes / no.
  Corrected: final meal ______. Network shows any `/category/...` after `/categories`: yes / no.
- **Explanation:** The broken chain keeps no record of which selection is current, so whatever
  arrives last wins. The corrected chain compares the response's generation with the latest one
  before painting or continuing. The stale chain stops at its first `await`.

### Test 3 — Failure and recovery (F1, F2, R2, R3)

- **Prediction:** A 404 or 400 from `/meal/{id}` shows a readable error in the meal panel. Every
  dependent panel says "Not requested". Clicking a tile recovers. No uncaught promise errors
  appear. In the corrected version, an error that belongs to an older selection is never shown.
- **Observed by Claude:**
  - `/meal/1` gave `FAIL … HTTP 404 · no meal with id 1` (126 ms). The meal panel showed "⚠ /meal/1 failed: HTTP 404 - no meal with id 1 / Choose any meal tile to recover."
  - The ingredients, method, dossier, cuisine and by-ingredient panels were set to "Not requested", and the hero image was cleared.
  - Clicking "Aussie Burgers" then loaded the full chain normally.
  - `/meal/0` gave `HTTP 400 · meal id must be a positive integer`.
  - Error responses came back in ~60–130 ms, so they are not delayed like successful ones.
  - **R2, corrected:** the 404 arrived after the newer tile click and was logged `IGNORED stale error on /meal/1`. The valid meal painted.
  - **R3, broken:** the 404 showed, then the older "Barbados Pepperpot" was STALE PAINTED over it, with its dossier and by-ingredient list.
  - **R3, corrected:** the 404 stayed, and `/meal/53457` was IGNORED with no follow-up request.
  - **Network failure:** made `fetch` reject once from the console as a temporary test aid. The page showed "Network error - Failed to fetch". Clicking the tile again recovered.
  - The only console errors were the browser's own "Failed to load resource: 404/400" lines. No "Uncaught (in promise)".
- **Your observation:** Error text shown: ______________________. Recovered by clicking: ______.
  Console shows any `Uncaught (in promise)`: yes / no.
- **Explanation:** `api.js` throws an `ApiError` for any non-2xx status and for a rejected `fetch`.
  Every chain function catches it. The corrected version first asks `isStale(...)`, so an error
  can only appear if it belongs to the latest selection.

### Test 4 — Category order and queued clicks (B1, B2), broken vs corrected

- **Prediction:** In the broken version, a category click loads L2 → L3 → L4 → L5 in order.
  Clicking Pasta while Dessert is still loading shows Dessert first, then Pasta a little later.
  In the corrected version only Pasta is ever painted.
- **Observed by Claude, broken version:** on Beef, clicked **Dessert** (#2), then **Pasta** (#3,
  queued) 300 ms later. The log showed:

  | Time | Selection | Request (level) |
  |---|---|---|
  | +5.735 s | #2 | `/category/Dessert` (L2). Dessert tiles painted at +6.857 s as STALE PAINTED |
  | +6.866 s | #2 | `/meal/53138` (L3), "Alfajores" |
  | +7.421 s / +7.422 s | #2 | `/area/Argentina` + `/ingredient/All%20purpose%20flour` (L4, together) |
  | +8.071 s | #2 | `/by-ingredient/All%20purpose%20flour` (L5) |
  | +8.485 s | #3 | `/category/Pasta` (L2). Pasta tiles appeared at +9.544 s |
  | +9.547 s | #3 | `/meal/52835` (L3), "Fettucine alfredo" |
  | +10.103 s / +10.104 s | #3 | `/area/Italian` + `/ingredient/Clotted%20Cream` (L4, together) |
  | +10.720 s | #3 | `/by-ingredient/Clotted%20Cream` (L5) |

  The page ended on Pasta / "Fettucine alfredo".
- **Your observation:** Order of the request URLs after clicking Dessert:
  ______ → ______ → ______ + ______ → ______. Time between Dessert tiles and Pasta tiles: ____ ms.
  Corrected version, final category: ______.
- **Explanation:** The broken version puts later category clicks in a queue and only starts the
  next one after the previous chain has finished, so an older category is painted before the one
  the user asked for last. The corrected chain has no queue: each click is a new generation, and
  the generation check drops every category response except the latest.

---

## 4. Collecting Network panel evidence (both versions)

Do not reuse anyone else's screenshots. Take these yourself.

**Setup (once):**
1. Run `npm start` and open the page in Chrome.
2. Open DevTools (Cmd+Opt+I) and go to **Network**.
3. Tick **Disable cache**. Choose the **Fetch/XHR** filter, which hides image requests.
4. Right-click a column header and make sure **Status**, **Time** and **Waterfall** are shown.
5. Optional: open the **Waterfall** header menu and sort by **Start Time**.

**For each version** (first `?mode=broken`, then `?mode=corrected`):

1. Load the URL and wait until the log shows the `/by-ingredient/...` DONE row.
2. Click the 🚫 **Clear** icon in Network, and **Clear** on the page log.
3. Click **Run chain again**. Within about 1 second, click a *different* meal tile.
4. Wait about 5 seconds.
5. Take one screenshot showing the Network list and waterfall, the on-page log, and the meal card.

**What to capture**

| Request URL (`/api/mealdb/...`) | Broken: expected order | Corrected: expected order |
|---|---|---|
| `categories` | 1st to start, finishes at ~2 s | 1st to start, finishes at ~2 s |
| `meal/{clicked id}` | 2nd to start, finishes first (~0.5 s) | same |
| `area/{its area}` + `ingredient/{its first ingredient}` | start together after `meal` finishes | same |
| `by-ingredient/{canonical name}` | starts after `ingredient` finishes | same |
| `category/{next category}` | **starts right after `categories` finishes** (stale follow-up) | **absent**: the stale response was ignored |
| `meal/{another id}`, its `area`, `ingredient`, `by-ingredient` | **present**, and they repaint the screen | **absent** |

6. Click each of these rows and note the following in a table like the one in section 3:
   - **Timing** tab: "Waiting for server response" (about 2000 / 1000 / 500 / 300 / 200 ms).
   - **Headers** tab: `x-delay-ms`, and in proxy mode `x-proxied-from`.
7. Optional, corrected version: tick **also abort superseded requests** and repeat. `categories` now
   shows as **(canceled)** in Network.
8. Failure evidence: clear Network, click **Test failure**, then click a tile.
   - Capture the red `meal/1` row with status **404**, its Response tab (`{"error":{...}}`), and the following successful `meal/{id}` row.
   - Repeat with `/meal/0` to capture a **400**.

If your submission must show the assignment host in the URL column, use
`?mode=broken&direct=1` and `?mode=corrected&direct=1`. The requests then go straight to
`https://api-hub-50046202742.development.catalystappsail.in/api/mealdb/...`.

---

## 5. The corrected lines that block stale updates

From `public/js/chain-corrected.js`:

```js
19  let generation = 0;     // id of the latest selection - the only one allowed to paint
```
> "One number that says which selection is the latest. Only that selection is allowed to change
> the screen."

```js
25  function newSelection(label, mealId) {
26    const gen = ++generation;
27    controller?.abort();
28    controller = useAbort() ? new AbortController() : null;
```
> "Every click or restart takes a new number and remembers it as `gen`. Optionally I also cancel
> the previous selection's requests. That is only a bonus; the number check below is what
> protects the page."

```js
34  function isStale(gen, req, what, err) {
35    if (gen === generation) return false;
36    log.ignored(req.tag, what, generation, err);
37    return true;
```
> "When an answer comes back, I compare the number it was sent with against the latest number.
> If they differ, someone has clicked something newer. I log it as IGNORED and stop."

```js
66        const { categories } = await api.categories(req);
67        if (isStale(gen, req, what)) return;
...
80        const { meals } = await api.category(categoryName, req);
81        if (isStale(gen, req, what)) return;
...
94      const { meal } = await api.meal(mealId, req);
95      if (isStale(gen, req, what)) return;
```
> "This check comes right after every `await`, **before** anything is painted and **before** the
> next request is started. That is why a stale `/categories` cannot paint the rail or start
> `/category/...`."

```js
103    } catch (err) {
104      if (isStale(gen, req, what, err)) return;     // an old failure - ignore it
```
> "Errors get the same check, so an old failure can't put an error message on a newer meal."

```js
118      if (isStale(gen, req, what)) return;          // after /area
140      if (isStale(gen, req, what)) return;          // after /ingredient, before /by-ingredient starts
147      if (isStale(gen, req, what)) return;          // after /by-ingredient
```
> "The two parallel level-4 branches and level 5 are guarded the same way."

```js
51    if (depth === 1) ui.refreshing('rail', 'tiles');
52    if (depth === 2) { ui.settle('rail'); ui.refreshing('tiles'); }
53    if (depth === 3) ui.settle('rail', 'tiles');
54    ui.loading(...ui.MEAL_PANELS);
```
> "When a new selection starts, I reset everything it makes out of date. The old image, steps,
> dossier and lists go back to skeletons. Any 'loading…' badge left by an abandoned chain is
> removed, so no loading state or image from an older selection stays on screen. The old tiles
> stay clickable."

To compare: `public/js/chain-broken.js` has none of these lines. It also contains the two
deliberate category-click queue, marked with a `BUG` comment.

---

## 6. Live demo script

1. **Waiting (sequential dependencies):** Open `?mode=corrected` and narrate the log as it fills.
   `categories` takes about 2 s. Then `category/...` takes about 1 s, then `meal/...` about 0.5 s.
   Each one starts only after the previous DONE row.
2. **Parallel requests:** Point at the two START rows for `/area/...` and `/ingredient/...`. They
   are the same millisecond or close to it. `/by-ingredient` starts only after `/ingredient` is
   DONE, because it needs the canonical name (for example `soy sauce` becomes `Soy Sauce`).
   Click any ingredient chip to replay L4 → L5 for that ingredient.
3. **The race, broken:** Click **Broken version**, wait for the load to finish, click **Run chain
   again**, and click a different tile right away.
   - The clicked meal appears.
   - About 3 seconds later the page jumps to another category and meal.
   - Red STALE PAINTED rows and the "Stale overwrite" box appear.
4. **The race, corrected:** Click **Corrected version** and repeat the same clicks. The meal stays.
   The log shows `IGNORED stale response /categories`, and no `/category/...` request follows.
   Optionally tick the AbortController box and show `ABORTED`.
5. **Queued category clicks (broken only):** In **Broken version**, on Beef, click **Dessert**
   and then quickly **Pasta**.
   - Point at the log order: `/category` (L2) → `/meal` (L3) → `/area` + `/ingredient` (L4) → `/by-ingredient` (L5), first for Dessert.
   - Dessert's whole chain paints first, and Pasta's tiles appear only about 2.5 s later.
   - Repeat in **Corrected version**: only Pasta is painted.
6. **Failure and recovery:** Click **Test failure** (404) and show the error in the meal panel and
   the "Not requested" panels. Click any tile to recover. Switch the dropdown to `/meal/0` to show
   the 400.
7. **Stale error (corrected):** Click **Test failure**, then immediately click a tile. The log
   shows `IGNORED stale error on /meal/1`, and the valid meal shows.

No artificial delays are added anywhere. The race uses only the API's own 2000 ms vs 500 ms
timings.
