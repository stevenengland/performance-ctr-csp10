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
- **Readable across the table.** Names and numbers are set large in a condensed display face;
  a glance from arm's length in a dim bar is enough.
- **One loud thing per screen.** Amber marks the single thing that matters now (the tile being
  tapped, tonight's leader); everything else stays bottle green and quiet.
- **Vuetify underneath, our own face on top.** Vuetify supplies behaviour and accessibility
  (dialogs, fields, snackbars, navigation); the look comes from §3, and counting tiles, the
  leader card and tally marks are app components.

## 2. Tech stack

| Concern | Choice |
|---|---|
| Framework | Vue 3 + TypeScript (strict), `<script setup lang="ts">`, Composition API |
| Build | Vite |
| Components | Vuetify 3 (`md3` blueprint as the base), themed per §3; app components for tiles, leader card and tally marks |
| Routing | Vue Router, history mode (hash mode in the fixture preview only) |
| PWA | vite-plugin-pwa (Workbox), prompt-style updates, full precache |
| Icons | Material Design Icons via `@mdi/js` (SVG paths, no icon font) |
| Fonts | Big Shoulders Display and Hanken Grotesk, self-hosted via `@fontsource` (no CDN; CSP `default-src 'self'`) |
| Colour | Hand-picked role table (§3.1), applied as the Vuetify theme |
| API types | Generated from `api/openapi.yaml` with `openapi-typescript` |

## 3. Design tokens

### 3.0 Visual identity — "Bierdeckel"

The app is the tally sheet from a beer mat (*Strichliste*), shown on a stadium scoreboard:
bottle green and amber, tall condensed numerals, and every whole-number counter drawn a second
time as tally marks. `docs/design/mockup.html` is the visual reference for every screen in light
and dark; where this text and the mockup disagree, fix whichever is wrong in the same pull
request.

*Owner decision (2026-11-15), overriding PRD #1 and the slice issues:* the palette is
hand-picked, not generated from seed `#8b5000`; fonts are Big Shoulders Display and Hanken
Grotesk, not Roboto; Vuetify stays as the component engine but is themed and, for counting
tiles, the leader card and tally marks, replaced by app components. Wherever an issue says
"seed `#8b5000`", "Material Color Utilities" or "Roboto", this section applies instead.

### 3.1 Colour — roles, light and dark

Hand-picked. The Vuetify theme is defined from this table; a unit test asserts that the theme
equals it in light and dark. Components use roles, never raw values.

| Role | Light | Dark |
|---|---|---|
| `primary` | `#14523f` | `#f6c453` |
| `on-primary` | `#ffffff` | `#2a1c00` |
| `primary-container` | `#f6c453` | `#f6c453` |
| `on-primary-container` | `#2a1c00` | `#2a1c00` |
| `secondary` | `#3d5a4e` | `#b9cdc0` |
| `on-secondary` | `#ffffff` | `#12261f` |
| `secondary-container` | `#d5e6da` | `#24493d` |
| `on-secondary-container` | `#12261f` | `#dff0e4` |
| `tertiary` | `#b3264f` | `#ff8fab` |
| `on-tertiary` | `#ffffff` | `#4a0a1e` |
| `tertiary-container` | `#ffd3de` | `#5e1a30` |
| `on-tertiary-container` | `#4a0a1e` | `#ffd3de` |
| `error` | `#b3261e` | `#ffb4a9` |
| `on-error` | `#ffffff` | `#5c0f0a` |
| `error-container` | `#ffdad5` | `#7a1b14` |
| `on-error-container` | `#5c0f0a` | `#ffdad5` |
| `surface` | `#fbfaf4` | `#0e1f1a` |
| `on-surface` | `#12261f` | `#f1eddc` |
| `on-surface-variant` | `#4c5f56` | `#a9b8ae` |
| `surface-container-low` | `#f4f2e8` | `#132821` |
| `surface-container` | `#eceadc` | `#183129` |
| `surface-container-high` | `#e3e0cf` | `#213d34` |
| `outline` | `#7c8b82` | `#6f8277` |
| `outline-variant` | `#cfd2c2` | `#2c463c` |
| `inverse-surface` | `#12261f` | `#f1eddc` |
| `inverse-on-surface` | `#f4f2e8` | `#12261f` |
| `inverse-primary` | `#f6c453` | `#14523f` |
| `scrim` | `#000000` | `#000000` |

**Usage.**

- Theme follows `prefers-color-scheme`; there is no in-app theme switch.
- `surface-container-high`: counting tiles at rest, with a 3 dp inset bottom edge in
  `outline-variant` (the coaster's edge).
- `primary-container` (amber): the tile being pressed or saving, and the leader card on the
  Rangliste. Amber means "this one"; nothing else is amber.
- `primary`: tally marks, the step indicator, filled buttons, the FAB, links.
- `tertiary-container` (raspberry): factor tiles other than "Kein Faktor".
- `error` / `error-container`: destructive dialog actions, the offline banner, the stale time.
- `inverse-surface` / `inverse-on-surface` / `inverse-primary`: snackbars and their action.
- `secondary-container`: the active navigation destination's pill.
- Manifest `theme_color` and `background_color`: light `surface` (`#fbfaf4`); the dark
  `theme-color` meta is `#0e1f1a`.
- Every text/background pair used must reach WCAG AA; if a pair fails, change the token here
  and in the theme together.

### 3.2 Typography

Two self-hosted families (`@fontsource`, latin subset, no CDN):

- **Big Shoulders Display** 700 and 900 — everything that is shouted across a bar: screen
  titles, names on tiles, numerals, step questions, dialog titles. Always upper case (applied
  with `text-transform`, so screen readers get normal case), letter-spacing 0.015–0.02em.
- **Hanken Grotesk** 400 and 600 — everything that is read: supporting text, lists, forms,
  buttons, navigation labels, snackbars.

| Style | Family / weight | Size / line height | Used for |
|---|---|---|---|
| `score-hero` | Display 900 | 84 / 68 | Leader's score |
| `numeral-xl` | Display 900 | 64 / 58 | Quantity tiles |
| `name-hero` | Display 900 | 44 / 42 | Leader's name; app name on Anmelden (64) |
| `numeral` | Display 900 | 34 / 32 | Counter on a drink tile, scores of ranks 2+, multiplier on a factor tile |
| `title` | Display 900 | 30 / 30 | Top app bar title |
| `tile-name` | Display 900 | 28 / 28 | Person, drink and factor names on tiles; dialog titles |
| `rank-name` | Display 900 | 24 / 24 | Names on Rangliste rows |
| `question` | Display 700 | 22 / 26 | Step question, in `on-surface-variant` |
| `body` | Text 400 | 16 / 24 | Form fields, empty-state text, dialog body |
| `row-title` | Text 600 | 16 / 24 | List row primary text, buttons |
| `label` | Text 600 | 14 / 20 | Snackbar, bar context line, text buttons |
| `support` | Text 400 | 13 / 18 | Supporting text on tiles and rows |
| `caption` | Text 600 | 12 / 16 | Navigation labels, `Stand HH:mm`, field labels |

All numerals use `font-variant-numeric: tabular-nums`. Tile names that do not fit shrink one
step (28 → 24 → 20) before they ellipsize.

### 3.3 Spacing, shape, elevation

- **Grid:** 4 dp. Window margins 16 dp (compact), 24 dp (medium and up). Gap between tiles
  12 dp.
- **Shape (corner radius):** tiles 14 dp; leader card 18 dp; buttons, fields, snackbar and FAB
  10 dp; dialogs 20 dp; navigation pill 16 dp. No fully round buttons.
- **Elevation:** none. Depth comes from surface tones and the tile's inset bottom edge; no
  shadows anywhere, dialogs sit on a 50 % scrim.

### 3.4 Iconography, tally marks and motion

- Icons (`@mdi/js`): Zählen `mdiGlassMugVariant`, Rangliste `mdiPodium`, Verwalten
  `mdiCogOutline`, Konto `mdiAccountCircleOutline`, back `mdiArrowLeft`, add `mdiPlus`, edit
  `mdiPencilOutline`, delete `mdiDeleteOutline`, offline `mdiWifiOff`, update `mdiUpdate`.
  Icon-only buttons always carry an `aria-label`.
- **Tally marks (`TallyMarks` component):** an inline SVG that draws a count as bundles of five
  — four upright strokes and one diagonal across them — stroke 2.2, round caps, `currentColor`
  (`primary`; `on-primary-container` on amber). Each stroke leans by a small fixed amount
  derived from its index, so it looks hand-drawn but never changes between renders. It draws
  the whole part of the value (a counter of 4,5 draws four); above 25 it is omitted and the
  numeral stands alone. It is decorative: `aria-hidden`, the number next to it carries the
  meaning. Heights: 18 dp on drink and quantity tiles, 26 dp on the
  leader card, 30 dp on Anmelden.
- **Motion:** step transitions slide horizontally (forward left, back right, 200 ms, standard
  easing). A tapped tile turns amber immediately. When a count rises, only the new strokes draw
  in (120 ms each). The snackbar carries a thin `inverse-primary` bar that runs out over its
  8 s. With `prefers-reduced-motion: reduce` all of these are instant.

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

Flat bar on `surface`: title in `title` style (the screen's name or, in the add flow, the chosen
person), an optional context line under it in `label` (`Bier`, `2× Bier`, `Heute`), a back
button on every screen below a navigation destination, and the account icon on the right
(opens `/konto`). In the add flow a four-segment step indicator sits directly under the bar
(4 dp high, filled segments in `primary`; three segments when no factors exist). On add-flow
steps 2–4 the bar also shows, right-aligned before the account icon, the chosen person's
total score for today — all drinks, factors applied — as a numeral (`title`) over the caption
`Punkte heute` (from the scoreboard feed; `0` when there are no entries). On the
Rangliste the bar also shows `Stand HH:mm` in `error` when data is stale (§6.6).

### 6.2 Navigation bar / rail

Three destinations (§4) on `surface-container`. The active destination's icon sits in a
`secondary-container` pill and its label is `on-surface`; the others are `on-surface-variant`.
Hidden on `/anmelden`.

### 6.3 Snackbar

One at a time, bottom, above the navigation bar, `inverse-surface`, corner 10 dp, 8 s, optional
single action in `inverse-primary`, and a thin `inverse-primary` bar along its bottom edge that
runs out over the 8 s. Announced through an ARIA live region (`polite`). A newer snackbar replaces
an older one.

| Trigger | Text | Action |
|---|---|---|
| Entry saved | `2× Bier · Happy Hour ×2 · Daniel` (factor part omitted for "Kein Faktor") | `Rückgängig` |
| Entry undone | `Rückgängig gemacht` | — |
| Save failed (network) | `Nicht gespeichert – keine Verbindung` | `Erneut versuchen` (same UUID) |
| Problem response | the problem's `title` | — |
| Deleted item | `<Name> gelöscht` | — |
| Update available | `Neue Version verfügbar` | `Neu laden` |

### 6.4 Counting tiles

`CountTile` — a real `<button>` in a grid (§5): `surface-container-high`, corner 14 dp, minimum
height 104 dp, padding 12 × 14 dp, a 3 dp inset bottom edge in `outline-variant`, content
left-aligned. Pressed or saving: `primary-container` / `on-primary-container`, edge removed.

- **Person tile:** name (`tile-name`) at the top; at the bottom `Punkte heute` in `support` on
  the left and the person's total score for today (`numeral`) on the right, or just
  `noch nichts` in `support` when there are no entries today. No tally marks here.
- **Drink tile:** top row — name left, today's counter for the chosen person right (`numeral`,
  omitted at 0); bottom row — points in `support` (`1 Punkt`, `3 Punkte`, `0,5 Punkte`) left,
  tally (18 dp) right.
- **Quantity stepper** (step 3, replaces fixed quantity tiles — owner decision 2026-11-15): a
  row of a `−` tile (88 dp square), the count in the display face (128 dp) with the caption
  `<Getränk> heute`, and a `+` tile (88 dp, amber). Under it a 34 dp tally of the count — the
  strokes already booked in `on-surface`, the new ones in `tertiary` — with the line
  `bisher 4, neu dazu 2`, then a full-width filled button.
- **Factor tile:** full width, one column. `Kein Faktor` is a normal tile with the supporting
  text `zählt einfach`; each factor is `tertiary-container` / `on-tertiary-container`, no edge,
  name left and multiplier right (`numeral`, `×2`).

### 6.5 Offline banner

A full-width banner under the top app bar, `error-container`, icon `mdiWifiOff`, text
`Offline – Getränke können gerade nicht gespeichert werden.` While offline, the add flow's
last step disables its buttons; all other screens keep showing their last data.

### 6.6 Stale indicator

When the latest scoreboard refresh failed, the last data stays visible and `Stand: HH:mm`
(time of the last successful refresh) appears in `caption`, `error`, at the right of the top app bar. It
disappears after the next successful refresh.

### 6.7 Update prompt and reload floor

- **Update prompt:** a waiting service worker shows the snackbar `Neue Version verfügbar` with
  `Neu laden`; the app never reloads on its own. Unlike other snackbars it does not time out: it stays until
  the user taps `Neu laden` or a newer snackbar replaces it.
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

Dialog on `surface-container`, corner 20 dp, title in `tile-name`. Title states the action, body
states the consequence, buttons `Abbrechen` (text) and the destructive action (filled, `error`).

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
- **Empty:** a short sentence in `body` plus, where it applies, the button that fixes it
  (see each screen).

### 6.11 Form fields and validation

Outlined text fields, corner 10 dp, 1.5 dp `outline` border (2 dp `primary` when focused);
label inside the top of the field in `caption`; field errors from the problem's `errors` map shown as
supporting text under the field in `error`; the submit button stays enabled and re-validates on
the server.

## 7. Screens

### 7a. Anmelden `/anmelden`

- No card: on plain `surface`, vertically centred, left-aligned — the app name `Performance`
  in the display face (64 dp, two lines), a row of tally marks under it (30 dp), then the
  outlined fields `Benutzername` and `Passwort` (with show/hide) and a full-width filled button
  `Anmelden`. Content max width 400 dp.
- 401 → field-less error text `Benutzername oder Passwort falsch.`; 429 →
  `Zu viele Versuche. Bitte später erneut.`
- Success → the originally requested route or `/zaehlen`.

### 7b. Zählen, step 1 — Namen `/zaehlen`

- Title `Zählen`; step indicator at 1. Question `Für wen?` in `question`.
- Grid of person tiles (§6.4), alphabetical, each with the person's total score for today
  (from the scoreboard feed).
- Empty: `Noch keine Personen.` + button `Person anlegen` → `/verwalten/personen` with the create
  dialog open.

### 7c. Zählen, step 2 — Getränk `/zaehlen/:personId`

- Title bar: the person's name; step indicator at 2. Question `Welches Getränk?`.
- Grid of drink tiles with points, the person's counter for today and its tally (§6.4),
  alphabetical.
- Counters come from the scoreboard feed (§10), not a separate request.
- Empty: `Noch keine Getränke.` + `Getränk anlegen`.

### 7d. Zählen, step 3 — Anzahl `/zaehlen/:personId/:drinkId`

- Title bar: `Daniel` with the context line `Bier`; step indicator at 3. Question `Wie viele?`.
- **Quantity stepper** (§6.4), replacing the 1–5 buttons and `Andere Anzahl` named in PRD #1
  and the slice issues (owner decision 2026-11-15; this section wins). The count starts at
  what is already booked today for this person and drink (the counter from the scoreboard
  feed, factors applied); `+` adds one new drink, `−` takes one new drink back. `−` is
  disabled at the booked count — booked drinks are corrected with `Rückgängig` or in the
  Verlauf — and `+` stops at 99 new drinks. The button reads `Weiter` (or `Speichern` when
  no factors exist, in which case it saves) and is disabled until at least one drink is new;
  the quantity sent to the API is the number of new drinks.
- With no factors defined, `Speichern` saves (step 4 is skipped).

### 7e. Zählen, step 4 — Faktor `/zaehlen/:personId/:drinkId/:quantity`

- Title bar: `Daniel` with the context line `2× Bier`; step indicator at 4. Question `Faktor?`.
- One column of factor tiles (§6.4): `Kein Faktor` first, then one raspberry tile per factor
  showing name and multiplier (`Happy Hour`, `×2`), alphabetical.
- Tapping a tile saves: the tapped tile turns amber and the others dim, then the app returns to step 1 and
  shows the saved snackbar (§6.3).
- Save failure: stay on the step, buttons enabled again, snackbar with `Erneut versuchen`
  (retries with the same UUID).
- Offline: buttons disabled under the offline banner.

### 7f. Rangliste `/rangliste`

- Title `Rangliste` with the context line `Heute`.
- Persons with entries today, ranked by score (ties by name):
  - **Rank 1 — leader card:** `primary-container`, corner 18 dp. Name (`name-hero`) and the
    tally of the total count (26 dp) on the left, score (`score-hero`) on the right; below,
    the total count (`9 Getränke`, `label`) and the per-drink counters
    (`Bier 4 · Margarita 1`, `support`).
  - **Ranks 2+ — rows** separated by `outline-variant` hairlines: rank numeral (`title`,
    `on-surface-variant`), name (`rank-name`) with per-drink counters beneath (`support`),
    and on the right the score (`numeral`) with the total count beneath (`caption`).
- Tapping the card or a row opens `/verlauf/:personId`; both are buttons with the accessible
  name `Platz 1, Daniel, 13,5 Punkte, 9 Getränke`.
- Persons without entries today are not listed.
- Empty: `Heute noch keine Getränke.` + button `Zählen` → `/zaehlen`.
- Stale indicator (§6.6) in the top app bar.

### 7g. Verlauf `/verlauf/:personId`

- Title `Daniel` with the context line `Heute`, back to the previous screen.
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
  navigation bar; `primary`, corner 10 dp, no shadow). Rows are separated by `outline-variant`
  hairlines; primary text in `row-title`.
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
  `Abmelden`; app version and, in `support`, `Server: <app version>` from health.
- At the top, the app name in the display face (`name-hero`) with a decorative row of tally
  marks (30 dp, as on Anmelden). The version lines read `Version <app version>` (`row-title`) and
  `Server: <app version>` (`support`), or `Server: nicht erreichbar` when health cannot be read.

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
- Touch targets ≥ 48 × 48 dp; counting tiles ≥ 104 dp high.
- Contrast from the role pairs in §3.1 only; every pair in use meets AA.
- Tally marks are decorative and hidden from assistive technology; upper-case display text is
  produced with CSS so it is read in normal case.
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
