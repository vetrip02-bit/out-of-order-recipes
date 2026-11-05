# Out of Order — Chain, Race, Recover

A recipe page built from a real five-level request chain against the assignment API
`https://api-hub-50046202742.development.catalystappsail.in/api/mealdb`.
It has two versions, switched with the **Broken / Corrected** toggle at the top of the page.

**Live site (GitHub Pages):** https://vetrip02-bit.github.io/out-of-order-recipes/
([broken](https://vetrip02-bit.github.io/out-of-order-recipes/?mode=broken) ·
[corrected](https://vetrip02-bit.github.io/out-of-order-recipes/?mode=corrected)).
The hosted page has no proxy, so it calls the assignment API host directly (the API sends CORS
headers). `.github/workflows/pages.yml` republishes `public/` on every push to `main`.

## The only difference between the two versions

Both versions run the same page, the same chain and the same code (`public/js/chain.js`).
One switch, `corrected`, changes one thing:

| Version | URL | When you click something new… |
|---|---|---|
| **Broken** | `?mode=broken` | …the previous click's requests are **not aborted**. They keep running, and when they answer they paint over the newer click (red **STALE PAINTED** rows, "⚠ Stale overwrite" box). |
| **Corrected** | `?mode=corrected` | …the previous click's requests are **aborted** with an `AbortController` (**ABORTED** rows). A generation number is also checked after every `await` as the final safeguard. |

## The four meal cards

Clicking a category (L1) shows the **first 4 meals** of that category as cards (L2). Each card
waits a different time before its `/meal/{id}` request is sent:

| Card | Wait before `/meal/{id}` | Total time to answer |
|---|---|---|
| Card 1 | 4 s | about 4.5 s |
| Card 2 | 3 s | about 3.5 s |
| Card 3 | 2 s | about 2.5 s |
| Card 4 | 1 s | about 1.5 s |

So a card clicked first can answer last. Click **card 1**, then **card 2** straight away:

- **Broken:** card 2 shows first, then card 1's late answer replaces it.
- **Corrected:** card 1 is aborted the moment card 2 is clicked, so only card 2 is shown.

Why the wait is simulated: the API answers every `/meal/{id}` in the same ~500 ms, so two meal
clicks would always finish in click order. The wait (`pause()` in `api.js`) is the only artificial
delay in the project. It appears as a **DELAY** row in the log and is followed by a real request
to the real API. Each card shows a countdown bar and then **answered**, **aborted** or **failed**.

No mock data: every recipe, image and error comes from the assignment API. The original public
MealDB API is not used.

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
passed through. Add `&direct=1` to call the assignment host directly instead (the hosted site
always does).

### Files

| File | Role |
|---|---|
| `server.js` | Static server and `/api/mealdb` dev proxy (no dependencies) |
| `public/index.html` | Page layout: version toggle, controls, the five levels, log |
| `public/css/styles.css` | Theme (light and dark), layout, card countdown, panel states |
| `public/js/api.js` | `fetch` wrapper. `encodeURIComponent` on every path value; non-2xx and network errors become `ApiError`; card wait (`pause`); logs DELAY / START / DONE / FAIL / ABORTED |
| `public/js/chain.js` | The chain for **both** versions. `corrected` turns on abort + the generation check |
| `public/js/ui.js` | Rendering shared by both versions |
| `public/js/log.js` | On-page request and arrival log |
| `public/js/app.js` | Chooses the version from `?mode=` and wires up clicks |

### The chain (real delays from the API)

```
L1 /categories (2000 ms)
 └─► L2 /category/{name} (1000 ms)            → first 4 meals become cards
      └─► L3 /meal/{id} (card wait + 500 ms)
           ├─► L4 /area/{area} (300 ms)          ┐ started together
           └─► L4 /ingredient/{name} (300 ms)    ┘
                └─► L5 /by-ingredient/{canonical name} (200 ms)
```

- **Page load** and **Run chain again** start at L1, pick the next category, then a card (fastest
  card first).
- A **category** click starts at L2. A **card** or **Test failure** click starts at L3.
- An **ingredient** click starts again from L4: `/ingredient`, then `/by-ingredient`.
- The meal lists in L4 / L5 are clickable too (no card wait).
- Panels stay clickable while loading: old content stays visible with a "loading…" badge.

### Reading the on-page log

| Tag | Meaning |
|---|---|
| `#n` | Selection number (one per click / restart) |
| SELECT | A new user selection or chain restart |
| DELAY | A card's simulated wait before `/meal/{id}` is sent |
| START | Request sent (full URL, as shown in Network) |
| DONE | Response arrived: status, measured ms, and the server's `x-delay-ms` |
| FAIL | Non-2xx response or network failure |
| ABORTED | **Corrected only:** the request was cancelled because of a newer click |
| IGNORED | **Corrected only:** an aborted or stale response / error was dropped, nothing painted |
| STALE PAINTED | **Broken only:** a response from an older click overwrote the screen |

---

## 2. Planning tables

### 2a. Three representative requests

| Request | Depends on | Runs in parallel with | What the corrected version does after it returns |
|---|---|---|---|
| `GET /category/{name}` (L2, ~1000 ms) | The category name, from `/categories` or a click | Nothing at its level | Checks the generation before painting the 4 cards and before starting `/meal`. If a newer click happened, the request was already aborted. |
| `GET /meal/{id}` (L3, card wait + ~500 ms) | The meal id, from a card | Nothing at its level. Its answer starts **`/area` and `/ingredient` together** | Checks before painting the meal, ingredients and method, and before starting L4. A superseded `/meal` is aborted during its wait or in flight. |
| `GET /by-ingredient/{canonical}` (L5, ~200 ms) | The canonical name returned by `/ingredient` (e.g. `soy sauce` → `Soy Sauce`) | `/area` may still be in flight | Checks before painting the list. |

### 2b. Race and failure test plan

| ID | Scenario | Steps | Broken (no abort) | Corrected (abort) |
|---|---|---|---|---|
| C1 | Earlier card answers later | Click **card 1** (4 s), then **card 2** (3 s) within 1 s | Card 2 paints, then card 1 **paints over it** with the "Stale overwrite" box | Card 1 is **ABORTED** at once. Only card 2 paints |
| R1 | Slow chain vs fast click | Click **Run chain again**, then a card within ~1 s | The card's meal shows, then the old chain repaints the rail, the cards and a different meal | `/categories` is **ABORTED**; no `/category/...` follows. The clicked meal stays |
| R2 | Stale error | Click **Test failure**, then a card within ~50 ms | The 404 may show briefly, then the meal | `/meal/1` is **ABORTED**; the 404 is never shown |
| R3 | Stale success over an error | Click **card 4**, then **Test failure** within ~50 ms | The 404 shows, then the older meal **paints over it** | Card 4's request is **ABORTED**; the 404 stays |
| F1 | Missing meal | **Test failure** with `/meal/1 · missing (404)`, then a card | "HTTP 404 - no meal with id 1". Lower panels say "Not requested". A card click recovers | Same |
| F2 | Invalid id | **Test failure** with `/meal/0 · invalid (400)` | HTTP 400 shown, same recovery | Same |

---

## 3. Test records (prediction → observed result → explanation)

"Observed by Claude" lines are what was actually seen on the running page (local proxy, Chrome).
Fill in the "Your observation" lines from your own run.

### Test 1 — Waiting and parallel requests (page load, broken version)

- **Prediction:** Each level waits for the previous one. `/area` and `/ingredient` start together.
  `/by-ingredient` waits for `/ingredient`. The automatically picked card is card 4 (1 s wait).
- **Observed by Claude:**

  | Request | Started | Finished |
  |---|---|---|
  | `/categories` | +0.002 s | +2.186 s (2184 ms) |
  | `/category/Beef` | +2.188 s | +3.247 s (1059 ms) |
  | `/meal/53133` "Asado" (card 4, 1 s wait) | +4.250 s | +4.813 s (563 ms) |
  | `/area/Argentina` | +4.815 s | +5.168 s |
  | `/ingredient/Mixed%20Beef%20Cuts` | +4.816 s | +5.222 s |
  | `/by-ingredient/Mixed%20Beef%20Cuts` | +5.224 s | +5.524 s |

- **Your observation:** `/area` start: ______ `/ingredient` start: ______ `/by-ingredient` start: ______
- **Explanation:** Each request needs a value from the one before it, so the code `await`s it.
  `/area` and `/ingredient` only need the meal, so both start without waiting for each other.

### Test 2 — Earlier card answers later (C1)

- **Prediction:** Broken: card 2 shows, then card 1 replaces it. Corrected: card 1 is aborted.
- **Observed by Claude, broken:**

  | Time | Selection | Log row |
  |---|---|---|
  | +7.462 s | #2 | SELECT card 1 "Algerian Kefta (Meatballs)" (4 s) |
  | +7.764 s | #3 | SELECT card 2 "Arepa Pabellón" (3 s) |
  | +10.766 s | #3 | START `/meal/53334` |
  | +11.366 s | #3 | DONE `/meal/53334`, Arepa Pabellón painted |
  | +11.465 s | #2 | START `/meal/53281` (card 1 was never stopped) |
  | +12.124 s | #2 | DONE `/meal/53281` |
  | +12.125 s | #2 | **STALE PAINTED** meal "Algerian Kefta (Meatballs)" over newer selection #3 |

  The page ended on Algerian Kefta with "⚠ Stale overwrite … your latest selection is #3".
- **Observed by Claude, corrected:** card 1 clicked at +5.839 s, card 2 at +6.143 s. At +6.144 s:
  `ABORTED /meal/53281 · cancelled after 302 ms` and `IGNORED … aborted request; nothing painted`.
  Card 1 showed **aborted**. Card 2's `/meal/53334` started at +9.144 s and finished at +9.695 s.
  The page ended on **Arepa Pabellón**, with no Stale overwrite box.
- **Your observation:** Broken, final meal: ______. Corrected, final meal: ______.
  Corrected, ABORTED row for: ______.
- **Explanation:** Without abort, card 1's request keeps running and the chain paints whatever
  arrives. With abort, `controller.abort()` cancels card 1's wait and request the moment card 2 is
  clicked, so nothing of card 1 can arrive.

### Test 3 — Slow chain vs fast click (R1)

- **Prediction:** Broken: the 2 s `/categories` from Run chain again arrives after the clicked meal
  and repaints everything. Corrected: `/categories` is aborted.
- **Observed by Claude, broken:** clicked Run chain again, then card 4 "Asado" 150 ms later. Asado
  showed, then STALE PAINTED rows for the category list (+7.903 s), the Chicken cards (+9.004 s),
  the meal "Belgian Waterzooi Chicken" (+11.668 s), its dossier and by-ingredient list. The page
  ended on **Chicken / Belgian Waterzooi Chicken** with the Stale overwrite box.
- **Observed by Claude, corrected:** same clicks. `/categories` was `ABORTED … cancelled after
  155 ms` and IGNORED. No `/category/...` request followed. The page stayed on **Asado**, rail on
  Beef.
- **Your observation:** Broken, final meal: ______. Corrected: `/category/...` request present
  (yes / no): ______.
- **Explanation:** In the broken version the old chain is still alive, so its answer starts L2,
  L3, L4 and L5 for a category nobody asked for. Aborting it stops the whole chain at L1.

### Test 4 — Failure and recovery (F1, F2, R2, R3)

- **Prediction:** A 404 / 400 shows a clear error, the lower panels say "Not requested", and a card
  click recovers. No "Uncaught (in promise)" errors.
- **Observed by Claude:**
  - **F1:** "⚠ /meal/1 failed: HTTP 404 - no meal with id 1 · Choose any meal card to recover."
    Lower panels went to "Not requested". Clicking card 4 recovered every panel.
  - **R3, broken:** card 4 then Test failure 50 ms later. `/meal/1` failed at +13.605 s and the
    404 showed. Card 4's meal finished at +15.146 s and was **STALE PAINTED** over the error.
  - **R3, corrected:** card 4's `/meal/53133` was ABORTED 53 ms after it started waiting. `/meal/1`
    failed at +14.256 s and the 404 **stayed**.
  - **R2, corrected:** Test failure then card 4 20 ms later. `/meal/1` was ABORTED after 25 ms, so
    no 404 was shown. The page ended on Asado.
  - No UNHANDLED rows in the log in either version.
- **Your observation:** Error text: ______. Recovered by clicking: ______.
  Console shows any `Uncaught (in promise)`: yes / no.
- **Explanation:** `api.js` turns non-2xx responses and rejected `fetch` calls into `ApiError`, and
  every chain step catches it. In the corrected version an aborted request throws an
  `AbortError`, which `isStale(...)` recognises as belonging to an older click and drops.

---

## 4. Collecting Network panel evidence (both versions)

Do not reuse anyone else's screenshots. Take these yourself.

**Setup (once):**
1. Open the page in Chrome (local or the live site).
2. Open DevTools (Cmd+Opt+I) and go to **Network**.
3. Tick **Disable cache**. Choose the **Fetch/XHR** filter, which hides image requests.
4. Make sure **Status**, **Time** and **Waterfall** columns are shown.

**For each version** (first `?mode=broken`, then `?mode=corrected`):

1. Load the URL and wait until the log shows the `/by-ingredient/...` DONE row.
2. Clear Network, and click **Clear** on the page log.
3. Click **card 1**, then **card 2** straight away. Wait about 6 seconds.
4. Take one screenshot showing the Network list and waterfall, the on-page log and the meal.

| Request URL (`/api/mealdb/...`) | Broken: expected | Corrected: expected |
|---|---|---|
| `meal/{card 2 id}` | starts after ~3 s, finishes first | same |
| `meal/{card 1 id}` | **present**, starts after ~4 s, finishes last and repaints | **absent** (aborted during its wait, before it was sent) |
| `area`, `ingredient`, `by-ingredient` for card 2 | present | present |
| `area`, `ingredient`, `by-ingredient` for card 1 | **present** | **absent** |

5. Repeat with **Run chain again** + a quick card click. In the corrected version `categories`
   shows as **(canceled)** in Network.
6. Click a few rows and note: **Timing** tab "Waiting for server response" (about 2000 / 1000 /
   500 / 300 / 200 ms) and the **Headers** tab `x-delay-ms`.
7. Failure evidence: clear Network, click **Test failure**, then a card. Capture the red `meal/1`
   row with status **404**, its Response tab, and the following successful `meal/{id}` row.
   Repeat with `/meal/0` for a **400**.

---

## 5. The corrected lines (`public/js/chain.js`)

Both versions run this file. `corrected` is `false` in the broken version and `true` in the
corrected one.

**Line 28 — the latest selection's number**
```js
let generation = 0;
```
> "I keep a counter that says which click is the newest one."

**Lines 35–38 — abort the previous click (the difference between the versions)**
```js
const gen = ++generation;
if (corrected) {
  controller?.abort();
  controller = new AbortController();
}
```
> "Every click gets a new number. In the corrected version I also cancel every request of the
> previous click, including a card that is still waiting, and give the new click a fresh
> controller. The broken version skips this, so old requests keep running."

**Lines 45–46 — the final safeguard**
```js
function isStale(gen, req, what, err) {
  if (!corrected || gen === generation) return false;
```
> "After every response or error I ask: is this still the newest click? If not, I drop it and
> log IGNORED. In the broken version this check is switched off, so old answers are painted."

**After every `await` — lines 78 (`/categories`), 92 (`/category`), 116 (`/meal`), 141 (`/area`),
163 (`/ingredient`), 170 (`/by-ingredient`); in every `catch` — lines 127, 146, 174**
```js
if (isStale(gen, req, what)) return;
```
> "Nothing is painted, and no next request is started, unless the answer belongs to the newest
> click. An aborted request ends up in the `catch`, where the same check drops it quietly instead
> of showing 'request aborted' as an error."

The signal reaches the network in `api.js`: line 57 (`pause(req.delayMs, req.signal)`, the card
wait) and line 70 (`fetch(url, { signal: req.signal, … })`).

---

## 6. Live demo script

1. **Waiting (sequential dependencies):** Open `?mode=corrected` and narrate the log as it fills:
   `categories` about 2 s, then `category/...` about 1 s, then the card's wait, then `meal/...`.
2. **Parallel requests:** Point at the two START rows for `/area/...` and `/ingredient/...` (same
   millisecond). `/by-ingredient` starts only after `/ingredient` is DONE because it needs the
   canonical name. Click any ingredient to replay L4 → L5.
3. **Cards, broken:** Switch to **Broken**. Click **card 1** (4 s), then **card 2** (3 s). Card 2
   appears, then card 1 replaces it. Red STALE PAINTED rows and the "Stale overwrite" box appear.
4. **Cards, corrected:** Switch to **Corrected** and repeat. Card 1 shows **aborted** at once, the
   log shows ABORTED, and card 2 stays.
5. **Run chain again, both versions:** Click **Run chain again** and then a card. Broken jumps to
   another category and meal; corrected aborts `/categories` and keeps the card.
6. **Failure and recovery:** Click **Test failure** (404), show the error and the "Not requested"
   panels, then click a card to recover. Switch the dropdown to `/meal/0` for the 400.
