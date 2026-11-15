# Webapp Design Specification — Performance

> **Purpose.** The written UI target of the Performance PWA: its stack, design system,
> information architecture, responsive system, global components, every screen and state, and
> the data each screen binds to. Code changes to `web/` follow it; a deviation is discussed and
> written back here in the same pull request. Design follows spec.
>
> **Source of truth.** Product rules come from PRD #1 (user stories, scoring, delete semantics,
> day window). The API contract is `api/openapi.yaml`. This document surfaces those rules; it
> never invents domain rules.
>
> **Review surface.** The fixture preview (§12) — the real app on canned answers, published as
> one private claude.ai artifact — is where every UI change is looked at before it reaches the
> host.
>
> **Language.** All UI text is German; this document is English with the German labels quoted
> verbatim. Numbers and times render in the `de-DE` locale; times in the browser's time zone.

---

## 1. Audience, goals, principles

**Users.** A small group of friends (2–20) on their own phones during an evening out, often
standing, in loud and dim places, with one hand, after a few drinks, on a flaky mobile
connection. One or two of them are admins.

**Top jobs.**

1. *Log a drink fast* — name, drink, quantity, factor: four taps, no typing.
2. *See who leads tonight* — one glance at the ranking, current to within seconds.
3. *Fix a mistake* — undo immediately, or delete a single entry later the same day.
4. *Set up the evening* — add a person, a drink with its points, or a "Happy Hour ×2" factor in
   a few seconds.

**Principles.**

- **Thumb-first.** Every primary action sits in the lower two thirds of the screen and is at
  least 48 × 48 dp; counting buttons are larger (§6.4).
- **One decision per screen.** The add flow asks exactly one question per step and saves on the
  last answer. No confirm button on the happy path; undo instead.
- **Today only.** Every view covers the current day, from 00:00 in the browser's time zone. No
  view shows other days.
- **Honest state.** The UI never claims a save that did not happen: offline blocks saving,
  failures say so, stale data shows its age.
- **Material 3, unmodified.** Use Vuetify's MD3 components and roles as they are; no custom
  component where a Material one exists.

## 2. Tech stack

| Concern | Choice |
|---|---|
| Framework | Vue 3 + TypeScript (strict), `<script setup lang="ts">`, Composition API |
| Build | Vite |
| Components | Vuetify 3 with the `md3` blueprint |
| Routing | Vue Router, history mode (hash mode in the fixture preview only) |
| PWA | vite-plugin-pwa (Workbox), prompt-style updates, full precache |
| Icons | Material Design Icons via `@mdi/js` (SVG paths, no icon font) |
| Font | Roboto, self-hosted (no Google Fonts CDN; CSP `default-src 'self'`) |
| Colour | Material Color Utilities 0.3.0, `SchemeTonalSpot`, seed `#8b5000` |
| API types | Generated from `api/openapi.yaml` with `openapi-typescript` |

## 3. Design tokens

### 3.1 Colour — Material 3 roles, light and dark

Generated from seed `#8b5000` with Material Color Utilities 0.3.0 (`SchemeTonalSpot`, contrast
level 0). The Vuetify theme is produced from the seed by the same library version; a unit test
asserts that it matches this table. Components use roles, never raw values.

| Role | Light | Dark |
|---|---|---|
| `primary` | `#865319` | `#fdb975` |
| `on-primary` | `#ffffff` | `#4a2800` |
| `primary-container` | `#ffdcbe` | `#6a3c01` |
| `on-primary-container` | `#6a3c01` | `#ffdcbe` |
| `secondary` | `#735a42` | `#e1c1a4` |
| `on-secondary` | `#ffffff` | `#402c18` |
| `secondary-container` | `#ffdcbe` | `#59422d` |
| `on-secondary-container` | `#59422d` | `#ffdcbe` |
| `tertiary` | `#586339` | `#c0cc9a` |
| `on-tertiary` | `#ffffff` | `#2b3410` |
| `tertiary-container` | `#dce8b4` | `#414b24` |
| `on-tertiary-container` | `#414b24` | `#dce8b4` |
| `error` | `#ba1a1a` | `#ffb4ab` |
| `on-error` | `#ffffff` | `#690005` |
| `error-container` | `#ffdad6` | `#93000a` |
| `on-error-container` | `#93000a` | `#ffdad6` |
| `surface` | `#fff8f5` | `#19120c` |
| `on-surface` | `#211a14` | `#efe0d5` |
| `on-surface-variant` | `#51453a` | `#d5c3b5` |
| `surface-container-lowest` | `#ffffff` | `#130d07` |
| `surface-container-low` | `#fff1e7` | `#211a14` |
| `surface-container` | `#faebe0` | `#261e18` |
| `surface-container-high` | `#f4e5db` | `#302822` |
| `surface-container-highest` | `#efe0d5` | `#3c332c` |
| `outline` | `#837468` | `#9e8e81` |
| `outline-variant` | `#d5c3b5` | `#51453a` |
| `inverse-surface` | `#372f28` | `#efe0d5` |
| `inverse-on-surface` | `#fdeee3` | `#372f28` |
| `inverse-primary` | `#fdb975` | `#865319` |
| `scrim` | `#000000` | `#000000` |

**Usage.**

- Theme follows `prefers-color-scheme`; there is no in-app theme switch.
- `primary` / `primary-container`: the counting buttons, the selected navigation destination, the
  leader's row on the Rangliste.
- `tertiary-container`: factor buttons other than "Kein Faktor" (a factor is visibly different
  from the default).
- `error` / `error-container`: destructive dialog actions, the offline banner, failed refresh.
- `inverse-surface` / `inverse-on-surface` / `inverse-primary`: snackbars and their action.
- Manifest `theme_color` and `background_color`: light `surface` (`#fff8f5`).

### 3.2 Typography

Roboto, Material 3 baseline type scale. Only these styles are used:

| Style | Size / line height | Weight | Used for |
|---|---|---|---|
| `headline-small` | 24 / 32 | 400 | Step question ("Welches Getränk?"), dialog titles |
| `title-large` | 22 / 28 | 400 | Top app bar title |
| `title-medium` | 16 / 24 | 500 | Person and drink names on buttons, list row primary text |
| `body-large` | 16 / 24 | 400 | Form fields, empty-state text |
| `body-medium` | 14 / 20 | 400 | List row secondary text, banner text |
| `label-large` | 14 / 20 | 500 | Buttons, snackbar text, chips |
| `label-medium` | 12 / 16 | 500 | Navigation labels, "Stand: hh:mm" |
| `display-small` | 36 / 44 | 400 | Quantity buttons, today's counter on a drink button, score on the leader row |

Numbers that line up in columns (scores, counters) use `font-variant-numeric: tabular-nums`.

### 3.3 Spacing, shape, elevation

- **Grid:** 4 dp. Window margins 16 dp (compact), 24 dp (medium and up). Gap between buttons in
  a grid 12 dp.
- **Shape (corner radius):** buttons `full`; counting tiles and cards `medium` (12 dp); dialogs
  and bottom sheets `extra-large` (28 dp); snackbars `extra-small` (4 dp); chips `small` (8 dp).
- **Elevation:** tonal only (surface-container levels); no shadows except the snackbar (level 3)
  and dialogs (level 3).

### 3.4 Iconography and motion

- Icons (`@mdi/js`): Zählen `mdiGlassMugVariant`, Rangliste `mdiPodium`, Verwalten
  `mdiCogOutline`, Konto `mdiAccountCircleOutline`, back `mdiArrowLeft`, add `mdiPlus`, edit
  `mdiPencilOutline`, delete `mdiDeleteOutline`, offline `mdiWifiOff`, update `mdiUpdate`.
  Icon-only buttons always carry an `aria-label`.
- Motion: Material 3 standard easing; step transitions slide horizontally (forward left, back
  right, 200 ms). With `prefers-reduced-motion: reduce`, transitions are cross-fades of 0 ms.

### 3.5 Localisation and formatting

All user-visible text lives in one German messages module; all formatting goes through one
`de-DE` formatting module.

| Value | Format | Example |
|---|---|---|
| Points, score | up to 2 decimals, comma, no trailing zeros | `4,5`, `12` |
| Multiplier | `×` + up to 2 decimals | `×2`, `×1,5` |
| Counter | as points | `4`, `1,5` |
| Time of an entry | `HH:mm`, browser time zone | `23:41` |
| Last update | `Stand: HH:mm` | `Stand: 23:41` |
| Quantity in text | `<n>×` | `2× Bier` |

Inputs accept a decimal comma or point (`0,5` and `0.5`).

## 4. Information architecture and navigation

```text
/anmelden                                   sign-in (outside the shell)
/zaehlen                                    step 1 — Namen          [nav: Zählen]
/zaehlen/:personId                          step 2 — Getränk
/zaehlen/:personId/:drinkId                 step 3 — Anzahl
/zaehlen/:personId/:drinkId/:quantity       step 4 — Faktor (choice saves)
/rangliste                                  today's ranking         [nav: Rangliste]
/verlauf/:personId                          a person's entries today
/verwalten                                  hub                     [nav: Verwalten]
/verwalten/personen | getraenke | faktoren  master data
/verwalten/konten                           accounts (admins only)
/konto                                      own account (top app bar)
```

- **Navigation bar** (compact) or **navigation rail** (medium and up) with three destinations:
  Zählen, Rangliste, Verwalten. Konto is reached from the top app bar's account icon.
- `/` redirects to `/zaehlen`. Unknown routes redirect to `/zaehlen`.
- The add flow's steps are routes, so the system back gesture steps back one level.
- A route parameter that no longer exists (person deleted on another phone) returns to step 1
  with the snackbar "Nicht mehr vorhanden".
- Not signed in: every route except `/anmelden` redirects there and returns to the requested
  route after sign-in.

## 5. Responsive system

| Window class | Width | Layout |
|---|---|---|
| Compact | < 600 dp | Navigation bar at the bottom; button grids 2 columns; dialogs full-width |
| Medium | 600–839 dp | Navigation rail at the left; grids 3 columns |
| Expanded | ≥ 840 dp | Navigation rail; content max width 840 dp, centred; grids 4 columns |

The app is designed for compact first; medium and expanded only widen grids. Landscape on a
phone uses the medium layout. Text scales to 200 % without horizontal scrolling.

## 6. Global components

### 6.1 Top app bar

Small top app bar: title (the screen's name or, in the add flow, the chosen person), a back
button on every screen below a navigation destination, and the account icon on the right
(opens `/konto`). On the Rangliste the bar also shows "Stand: HH:mm" when data is stale (§6.6).

### 6.2 Navigation bar / rail

Three destinations (§4). The active destination uses `secondary-container` per Material 3.
Hidden on `/anmelden`.

### 6.3 Snackbar

One at a time, bottom, above the navigation bar, `inverse-surface`, 8 s, optional single action
in `inverse-primary`. Announced through an ARIA live region (`polite`). A newer snackbar replaces
an older one.

| Trigger | Text | Action |
|---|---|---|
| Entry saved | `2× Bier · Happy Hour ×2 · Daniel` (factor part omitted for "Kein Faktor") | `Rückgängig` |
| Entry undone | `Rückgängig gemacht` | — |
| Save failed (network) | `Nicht gespeichert – keine Verbindung` | `Erneut versuchen` (same UUID) |
| Problem response | the problem's `title` | — |
| Deleted item | `<Name> gelöscht` | — |
| Update available | `Neue Version verfügbar` | `Neu laden` |

### 6.4 Counting buttons

Large tonal buttons in a grid (§5): `primary-container` fill, `on-primary-container` text,
corner `medium`, minimum height 96 dp, name in `title-medium`. On the drink step a button shows
the drink name, its points in `body-medium` (`1 Punkt`, `3 Punkte`, `0,5 Punkte`) and today's
counter for the chosen person in `display-small`, right-aligned. Quantity buttons 1–5 show the
number in `display-small`.

### 6.5 Offline banner

A full-width banner under the top app bar, `error-container`, icon `mdiWifiOff`, text
`Offline – Getränke können gerade nicht gespeichert werden.` While offline, the add flow's
last step disables its buttons; all other screens keep showing their last data.

### 6.6 Stale indicator

When the latest scoreboard refresh failed, the last data stays visible and `Stand: HH:mm`
(time of the last successful refresh) appears in `label-medium`, `on-surface-variant`. It
disappears after the next successful refresh.

### 6.7 Update prompt and reload floor

- **Update prompt:** a waiting service worker shows the snackbar `Neue Version verfügbar` with
  `Neu laden`; the app never reloads on its own.
- **Reload floor:** when health reports a `minClientVersion` above the running client, a
  non-dismissable dialog `Bitte neu laden` — `Diese Version ist veraltet.` — with one button
  `Neu laden`.
- **Chunk failure:** a failed lazy chunk load reloads the page once; a second failure shows the
  reload-floor dialog.

### 6.8 Maintenance state

While the API answers 503 with `Retry-After` (a migration is running), screens keep their last
data and show the snackbar `Wird aktualisiert – gleich wieder da`; requests retry after the
given delay.

### 6.9 Confirmation dialog

Basic dialog, corner `extra-large`. Title states the action, body states the consequence,
buttons `Abbrechen` (text) and the destructive action (`error` text button).

| Delete | Title | Body |
|---|---|---|
| Person | `Daniel löschen?` | `Daniel und 23 Einträge werden gelöscht.` (no entries: `Daniel wird gelöscht.`) |
| Drink | `Bier löschen?` | `Bier und 12 Einträge werden gelöscht.` |
| Factor | `Happy Hour löschen?` | `5 Einträge zählen danach ×1.` |
| Entry | `Eintrag löschen?` | `2× Bier · Happy Hour ×2 um 23:41` |
| Account | `Konto anna löschen?` | `Einträge von anna bleiben erhalten.` |

### 6.10 Empty and loading states

- **Loading:** skeleton placeholders in the shape of the content; no spinner on the first paint
  longer than 300 ms without a skeleton.
- **Empty:** a short sentence in `body-large` plus, where it applies, the button that fixes it
  (see each screen).

### 6.11 Form fields and validation

Outlined text fields; label above; field errors from the problem's `errors` map shown as
supporting text under the field in `error`; the submit button stays enabled and re-validates on
the server.

## 7. Screens

### 7a. Anmelden `/anmelden`

- Centered card: app name "Performance", fields `Benutzername` and `Passwort` (with show/hide),
  button `Anmelden`.
- 401 → field-less error text `Benutzername oder Passwort falsch.`; 429 →
  `Zu viele Versuche. Bitte später erneut.`
- Success → the originally requested route or `/zaehlen`.

### 7b. Zählen, step 1 — Namen `/zaehlen`

- Question `Für wen?` in `headline-small`.
- Grid of person buttons (§6.4), alphabetical.
- Empty: `Noch keine Personen.` + button `Person anlegen` → `/verwalten/personen` with the create
  dialog open.

### 7c. Zählen, step 2 — Getränk `/zaehlen/:personId`

- Title bar: the person's name. Question `Welches Getränk?`.
- Grid of drink buttons with points and the person's counter for today (§6.4), alphabetical.
- Counters come from the scoreboard feed (§10), not a separate request.
- Empty: `Noch keine Getränke.` + `Getränk anlegen`.

### 7d. Zählen, step 3 — Anzahl `/zaehlen/:personId/:drinkId`

- Title bar: `Daniel · Bier`. Question `Wie viele?`.
- Buttons 1–5 in one row (compact: 3 + 2) and a text button `Andere Anzahl` opening a dialog
  with a number field (1–99) and `Weiter`.
- With no factors defined, choosing the quantity saves (step 4 is skipped).

### 7e. Zählen, step 4 — Faktor `/zaehlen/:personId/:drinkId/:quantity`

- Title bar: `Daniel · 2× Bier`. Question `Faktor?`.
- First button `Kein Faktor` (`surface-container-high`), then one button per factor
  (`tertiary-container`) showing name and multiplier (`Happy Hour ×2`), alphabetical.
- Tapping a button saves: the buttons show a progress state, then the app returns to step 1 and
  shows the saved snackbar (§6.3).
- Save failure: stay on the step, buttons enabled again, snackbar with `Erneut versuchen`
  (retries with the same UUID).
- Offline: buttons disabled under the offline banner.

### 7f. Rangliste `/rangliste`

- Title `Rangliste · Heute`.
- One list row per person with entries today, ranked by score (ties by name):
  - leading: rank number in a circle (`primary` for rank 1, `surface-container-highest` otherwise);
  - primary text: name; secondary text: per-drink counters (`Bier 4 · Margarita 1`);
  - trailing: score in `display-small` for rank 1, `title-medium` otherwise, and total count
    below in `label-medium` (`5 Getränke`).
- Tapping a row opens `/verlauf/:personId`.
- Persons without entries today are not listed.
- Empty: `Heute noch keine Getränke.` + button `Zählen` → `/zaehlen`.
- Stale indicator (§6.6) in the top app bar.

### 7g. Verlauf `/verlauf/:personId`

- Title `Daniel · Heute`, back to the previous screen.
- List of today's entries, newest first: primary `2× Bier`, secondary
  `Happy Hour ×2 · 23:41 · anna` (`Kein Faktor` when none; `gelöschtes Konto` when the account is
  gone); trailing delete icon button opening the confirmation dialog (§6.9).
- Empty: `Heute keine Einträge.`

### 7h. Verwalten `/verwalten`

- List: `Personen`, `Getränke`, `Faktoren`, and `Konten` (admins only), each with its count as
  supporting text.

### 7i. Personen / Getränke / Faktoren

- Alphabetical list; each row: name and, for drinks, `1 Punkt`, for factors, `×2`; trailing edit
  and delete icon buttons.
- Extended FAB `Person anlegen` / `Getränk anlegen` / `Faktor anlegen` (bottom right, above the
  navigation bar).
- Create/edit dialog: `Name`; drinks also `Punkte` (decimal); factors also `Multiplikator`
  (decimal, shown with `×` prefix). Buttons `Abbrechen` and `Speichern`.
- Delete: confirmation dialog with the entry count (§6.9).
- Validation errors inline (§6.11); duplicate name → `Name ist bereits vergeben.`

### 7j. Konten `/verwalten/konten` (admins only)

- List of accounts: user name, `Admin` assist chip for admins; trailing menu with
  `Passwort zurücksetzen`, `Zum Admin machen` / `Adminrechte entziehen`, `Löschen`.
- Extended FAB `Konto anlegen`: dialog with `Benutzername` and `Startpasswort` (minimum 10
  characters).
- Last admin: the menu entries that would remove the last admin are disabled with supporting
  text `Letzter Admin`; the server enforces it regardless (409 → problem title in the snackbar).

### 7k. Konto `/konto`

- Signed-in user name; `Passwort ändern` (dialog: current, new, repeat; minimum 10);
  `Abmelden`; app version and, in `body-medium`, `Server: <app version>` from health.

## 8. Key flows

1. **Log two beers in happy hour:** Zählen → Daniel → Bier → 2 → Happy Hour ×2 → back on
   Namen, snackbar `2× Bier · Happy Hour ×2 · Daniel` with `Rückgängig`.
2. **Undo:** tap `Rückgängig` within 8 s → entry deleted, snackbar `Rückgängig gemacht`, counters
   back.
3. **Lost response:** save fails → `Erneut versuchen` → same UUID → server returns the original
   outcome; no duplicate.
4. **Fix later:** Rangliste → Daniel → Verlauf → delete entry → confirm.
5. **Set up an evening:** Verwalten → Getränke → `Getränk anlegen` → `Margarita`, `3` →
   Speichern; same for a factor.
6. **Midnight:** at 00:00 local time the Rangliste and counters show an empty new day on the next
   refresh.
7. **First run:** sign in with the bootstrap admin → Verwalten → Konten → `Konto anlegen` for a
   friend.

## 9. States and edge cases (every data view defines these)

| State | Behaviour |
|---|---|
| Loading | Skeleton (§6.10) |
| Empty | Sentence + fixing action (per screen) |
| Offline | Banner (§6.5); writes blocked; last data kept |
| Refresh failed | Last data kept + `Stand: HH:mm` (§6.6); retry with backoff up to 60 s |
| 401 | Redirect to `/anmelden`, return afterwards |
| 403 | Snackbar with the problem title; admin-only UI hidden for non-admins anyway |
| 404 on a route parameter | Back to the parent screen + `Nicht mehr vorhanden` |
| 409 / 422 | Problem title in snackbar / field errors inline |
| 429 | Sign-in message (§7a) |
| 503 + `Retry-After` | Maintenance snackbar (§6.8), automatic retry |
| Client too old | Reload-floor dialog (§6.7) |
| Midnight passes | Next refresh shows the new day |

## 10. Accessibility

- WCAG 2.2 AA; Lighthouse accessibility score 100.
- Touch targets ≥ 48 × 48 dp; counting buttons ≥ 96 dp high.
- Contrast from the Material 3 role pairs only (§3.1).
- Every counting button has an accessible name with its state, e.g. `Bier, 1 Punkt, heute 4`.
- Snackbars announced via a polite live region; dialogs trap focus and return it on close.
- Visible focus ring on every interactive element; full keyboard operation on desktop.
- `prefers-reduced-motion` respected (§3.4); text scaling to 200 %.

## 11. API ↔ UI mapping

| Screen / component | Endpoint(s) | Notes |
|---|---|---|
| Anmelden | `POST /api/session` | Sets the cookie |
| Shell (signed-in check) | `GET /api/session` | 401 → `/anmelden` |
| Konto | `GET /api/session`, `PUT /api/session/password`, `DELETE /api/session`, `GET /api/health` | |
| Namen | `GET /api/persons` | |
| Getränk | `GET /api/drinks`, scoreboard feed | Counters from the feed |
| Faktor | `GET /api/factors`, `PUT /api/entries/{uuid}` | Choice saves |
| Snackbar `Rückgängig` | `DELETE /api/entries/{uuid}` | |
| Rangliste | `GET /api/scoreboard?from=` (ETag) | Feed polls every 10 s while visible |
| Verlauf | `GET /api/entries?personId=&from=`, `DELETE /api/entries/{uuid}` | |
| Personen / Getränke / Faktoren | `GET/POST /api/{persons,drinks,factors}`, `GET/PATCH/DELETE …/{id}` | `GET …/{id}` includes the entry count |
| Konten | `GET/POST /api/accounts`, `PATCH/DELETE /api/accounts/{id}` | Admins only |
| Update / reload floor | `GET /api/health` | `minClientVersion` |

`from` is always local midnight of the current day in the browser's time zone, as a UTC instant.

## 12. Fixture preview

`npm run build:preview` builds the real SPA against canned answers into `web/dist-preview/`: a
self-contained bundle with relative asset paths that runs from wherever it is published. It is
the shareable page a UI change is reviewed on before it reaches the host.

- **Nothing in `web/src` knows about it.** A separate Vite config swaps the entry for
  `web/preview/main.ts`, which installs a fixture backend as the global `fetch` before the app
  starts, and gives the router hash history.
- **Typed fixtures.** Response bodies are built by the unit-test builders and typed against the
  generated OpenAPI types, so a contract change breaks the preview build instead of leaving it
  showing shapes the API no longer sends. CI builds the preview on every pull request.
- **Behaviour.** The fixture backend starts signed in as an admin, serves a sample evening
  (marked as sample data: persons, drinks, factors and entries timed relative to now, so the
  preview never ages out of "today"), keeps writes in memory for the session (adds, undo,
  deletes, CRUD), and answers anything else with 503.
- **No service worker.** The preview build does not register the service worker; the update
  prompt and reload floor can be triggered from a small preview-only menu.
- **Publishing.** Each slice that changes the UI rebuilds the preview and republishes it to the
  same private claude.ai artifact, and attaches compact and expanded screenshots to its pull
  request. The artifact link is recorded in the README.

## 13. Out of scope (this spec)

- Views of other days, all-time totals, statistics or charts.
- Theme switch, custom colours per person, avatars.
- English UI.
- Tablet- or desktop-specific layouts beyond widened grids.
- Offline saving.
