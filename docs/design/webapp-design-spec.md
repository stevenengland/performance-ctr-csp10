# Webapp Design Specification — Performance

> **Purpose.** The written UI target of the Performance PWA: its stack, design system,
> information architecture, responsive system, global components, every screen and state, and
> the data each screen binds to. Code changes to `web/` follow it; a deviation is discussed and
> written back here in the same pull request. Design follows spec.
>
> **Source of truth.** Product rules come from PRD #1 (user stories, scoring, delete semantics,
> day window) and PRD #14 (the audit log). The API contract is `api/openapi.yaml`. This document surfaces those rules; it
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
  view shows other days — with two recorded exceptions: Protokoll (§7l), the admins' audit log,
  covers all days, since looking up what happened yesterday or last week is its purpose; and a
  game (§7n, §7o) covers its current run, from its last (re)start (`seit 15.09.`), since a
  chess ladder runs for weeks. The server owns the run; drink views keep local midnight.
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
| Components | Vuetify 4 (4.3.3, pinned in `web/package.json`; `md3` blueprint as the base), themed per §3; app components for tiles, leader card and tally marks |
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
| `caption` | Text 600 | 12 / 16 | Navigation labels, `Stand: HH:mm`, field labels |

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
  `mdiPencilOutline`, delete `mdiDeleteOutline`, offline `mdiWifiOff`, update `mdiUpdate`,
  change password `mdiLockReset`, sign out `mdiLogout`, show/hide password `mdiEyeOutline` /
  `mdiEyeOffOutline`, a list row that opens a screen `mdiChevronRight`.
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
| Start of a game's run | `seit dd.MM.`, or `seit heute, HH:mm` when it lies after local midnight; browser time zone; turns into the date at the next local midnight, or when the screen is shown or focused again after it | `seit 15.09.`, `seit heute, 19:30` |
| Day heading (Protokoll) | `Heute`, `Gestern`, else short weekday and date, browser time zone | `Sa., 14.11.2026` |
| Changed value (Protokoll) | `<label>: <before> → <after>` | `Punkte: 1 Punkt → 0,5 Punkte` |

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
/spiele                                     the games               [nav: Spiele]
/spiele/:gameId                             a game: its rule and its ranking since the start
/spiele/:gameId/partie                      duel step 1 — Wer spielt?
/spiele/:gameId/partie/:firstId             duel step 2 — Gegen wen?
/spiele/:gameId/partie/:firstId/:secondId   duel step 3 — Ergebnis (choice saves)
/spiele/:gameId/ergebnis                    points step 1 — Für wen?
/spiele/:gameId/ergebnis/:personId          points step 2 — Wie viele Punkte? (Speichern)
/spiele/:gameId/verlauf                     a game's matches or results since the start
/verwalten                                  hub                     [nav: Verwalten]
/verwalten/personen | getraenke | faktoren  master data
/verwalten/spiele                           games: create, edit, delete (?anlegen opens create)
/verwalten/konten                           accounts (admins only)
/verwalten/protokoll                        audit log, all days (admins only)
/konto                                      own account (top app bar)
```

- **Navigation bar** (compact) or **navigation rail** (medium and up) with four destinations:
  Zählen (`mdiGlassMugVariant`), Rangliste (`mdiPodium`), Spiele (`mdiCardsPlayingOutline`),
  Verwalten (`mdiCogOutline`). Konto is reached from the top app bar's account icon. The bar
  splits its width into four equal columns.
- `/` redirects to `/zaehlen`. Unknown routes redirect to `/zaehlen`.
- The add flow's, the duel flow's and the points flow's steps are routes, so the system back
  gesture and the back arrow step back one level.
- A route parameter that no longer exists (person deleted on another phone) returns to step 1
  with the snackbar "Nicht mehr vorhanden"; a game or player that no longer exists returns to
  `/spiele` the same way.
- Not signed in: every route except `/anmelden` redirects there
  (`/anmelden?weiter=<requested route>`) and returns to the requested route after sign-in; a
  signed-in user who opens `/anmelden` goes straight on. A 401 on any later request (signed out
  on another device, password changed, session expired) leads to `/anmelden` the same way.
  While the server cannot be reached the session is unknown and screens open anyway (the
  installed app works offline; its requests fail on their own).
  Nothing renders until the first navigation, and with it the session check, has resolved, so
  a signed-out browser paints Anmelden directly instead of the shell first.

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
(4 dp high, filled segments in `primary`; three segments when no factors exist); the duel flow
(§7p) always has three, the points flow (§7q) two. On add-flow
steps 2–4 the bar also shows, right-aligned before the account icon, the chosen person's
total score for today — all drinks, factors applied — as a numeral (`title`) over the caption
`Punkte heute` (from the scoreboard feed; `0` when there are no entries). On the
Rangliste and a game's page (§7o) the bar also shows `Stand: HH:mm` in `error` when data is
stale (§6.6).

### 6.2 Navigation bar / rail

Four destinations (§4) on `surface-container`. The active destination's icon sits in a
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
| Match saved (§7p) | `Anna – Ben · Anna gewinnt`, `Ben – Carla · Remis` | `Rückgängig` |
| Result saved (§7q) | `Daniel · −20 Punkte`, `Anna · 1 Punkt` | `Rückgängig` |
| Entry, match or result undone | `Rückgängig gemacht` | — |
| Save failed (network) | `Nicht gespeichert – keine Verbindung` | `Erneut versuchen` (same UUID, this attempt only; returns to the names — or to `Wer spielt?` / `Für wen?` — only while the step is still shown) |
| Undo failed (network) | `Nicht rückgängig gemacht – keine Verbindung` | `Erneut versuchen` |
| Route item gone (§4) | `Nicht mehr vorhanden` | — |
| Problem response | the problem's `title` | — |
| Deleted item | `<Name> gelöscht` | — |
| Deleted entry (Verlauf) | `Eintrag gelöscht` | — |
| Deleted match or result (a game's Verlauf, §7r) | `Partie gelöscht` / `Ergebnis gelöscht` | — |
| Game restarted (§7o) | `Schach neu gestartet` | — |
| Update available | `Neue Version verfügbar` | `Neu laden` |
| Own password changed | `Passwort geändert` | — |
| Password reset (Konten) | `Passwort von anna zurückgesetzt` | — |
| Admin rights changed (Konten) | `anna ist jetzt Admin` / `anna ist kein Admin mehr` | — |

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
  name left and multiplier right (`numeral`, `×2`), with the supporting text `zählt 2-fach`
  (`zählt 1,5-fach`; one form for every multiplier, where the mockup first had `zählt doppelt`
  and `zählt anderthalbfach`). The tile being saved turns amber like any other tile; disabled
  tiles are dimmed (38 % opacity). Accessible names: `Kein Faktor, zählt einfach`,
  `Happy Hour, ×2`.

### 6.5 Offline banner

A full-width banner under the top app bar, `error-container`, icon `mdiWifiOff`, text
`Offline – Getränke können gerade nicht gespeichert werden.` While offline, the add flow's
last step disables its buttons; all other screens keep showing their last data.

### 6.6 Stale indicator

When the latest refresh of the scoreboard or of a game's ranking failed, the last data stays
visible and `Stand: HH:mm`
(time of the last successful refresh) appears in `caption`, `error`, at the right of the top app bar. It
disappears after the next successful refresh.

The *ScoreboardFeed* (`core/scoreboard-feed.ts`) behind it runs while a screen that shows
scores or counters is open (Rangliste and the add flow) and the page is visible: it asks every
10 s with `If-None-Match` (304 keeps the standings), at once on focus, on becoming visible and
after the device's own writes, and never while hidden. Each request computes `from` anew, so
the next refresh after local midnight shows the new day; an answer overtaken by a newer request
or a new day is dropped. After a failure it retries after 5, 10, 20, 40, then every 60 s; a
503 with `Retry-After` shows `Wird aktualisiert – gleich wieder da` and retries after that delay.

The mechanism is a keyed *polled resource* (`core/polled-resource.ts`): the drink feed is one
instance, and each game has at most one for its ranking (`GET /api/games/{id}/standings`,
ETag = data revision), shared by every screen that shows it (the game's page §7o, the duel
flow's player steps §7p and the points flow's steps §7q) and stopped when the last one closes. The Spiele list (§7n) never
polls: it reads each game's ranking on open and on focus only.

### 6.7 Update prompt and reload floor

- **Update prompt:** a waiting service worker shows the snackbar `Neue Version verfügbar` with
  `Neu laden`; the app never reloads on its own. Unlike other snackbars it does not time out: it stays until
  the user taps `Neu laden` or a newer snackbar replaces it.
- **Reload floor:** when health reports a `minClientVersion` above the running client at
  start-up, or any later request is refused with the problem `client-outdated` (every request
  sends the app version in `X-Client-Version`), a non-dismissable dialog `Bitte neu laden` — `Diese Version ist veraltet.` — with one button
  `Neu laden`. A plain reload would get the old shell again from the old service worker, so the
  button first activates the waiting service worker through the same path as the update prompt
  (`SKIP_WAITING`) and reloads once it is active. When no worker is waiting, it first asks the
  server for a new one and activates that if one installs. It reloads in every case: also offline,
  when no newer worker exists, or without a service worker. While it works, the button shows
  a progress indicator.
- **Chunk failure:** a failed lazy chunk load reloads the page once; a second failure shows the
  reload-floor dialog.

### 6.8 Maintenance state

While the API answers 503 with `Retry-After` (a migration is running), screens keep their last
data and show the snackbar `Wird aktualisiert – gleich wieder da`; requests retry after the
given delay (the scoreboard feed retries after exactly the `Retry-After` seconds and shows
`Stand: HH:mm` meanwhile).

### 6.9 Confirmation dialog

Dialog on `surface-container`, corner 20 dp, title in `tile-name`. Title states the action, body
states the consequence, buttons `Abbrechen` (text) and the destructive action (filled, `error`).

| Delete | Title | Body |
|---|---|---|
| Person | `Daniel löschen?` | What goes with the person, every day's, game's and run's: `Daniel, 23 Einträge und 7 Ergebnisse werden gelöscht.` (only one kind: `Daniel und 23 Einträge werden gelöscht.`, `Daniel und 7 Ergebnisse werden gelöscht.`; one: `1 Eintrag`, `1 Ergebnis`; none: `Daniel wird gelöscht.`), then the matches that stay: `4 Partien bleiben mit „gelöschte Person“.` (one: `1 Partie bleibt …`; none: nothing) |
| Drink | `Bier löschen?` | `Bier und 12 Einträge werden gelöscht.` (one and none as for a person) |
| Factor | `Happy Hour löschen?` | `5 Einträge zählen danach ×1.` (one: `1 Eintrag zählt danach ×1.`; none: `Happy Hour wird gelöscht.`) |
| Game | `Schach löschen?` | `Schach und 9 Partien werden gelöscht.` (a points game: `Rommé und 8 Ergebnisse werden gelöscht.`; one: `1 Partie` / `1 Ergebnis`; none: `Schach wird gelöscht.`) — every run's, not only the current ranking's |
| Entry | `Eintrag löschen?` | `2× Bier · Happy Hour ×2 um 23:41` (no factor: `1× Margarita um 22:58`) |
| Match | `Partie löschen?` | `Anna – Ben · Anna gewinnt am 15.11. um 21:00` |
| Result | `Ergebnis löschen?` | `Daniel · −20 Punkte am 15.11. um 22:12` |
| Account | `Konto anna löschen?` | `Einträge von anna bleiben erhalten.` |
| Restart (not a delete; action `Neu starten`) | `Schach neu starten?` | `Die Rangliste beginnt wieder bei null. Bisherige Ergebnisse bleiben gespeichert, werden aber nicht mehr angezeigt.` |

### 6.10 Empty and loading states

- **Loading:** skeleton placeholders in the shape of the content; no spinner on the first paint
  longer than 300 ms without a skeleton.
- **Empty:** a short sentence in `body` plus, where it applies, the button that fixes it
  (see each screen).

### 6.11 Form fields and validation

Outlined text fields, corner 10 dp, 1.5 dp `outline` border (2 dp `primary` when focused,
2 dp `error` with an error); label always inside the top of the field in `caption`; field errors
from the problem's `errors` map shown as supporting text under the field in `error`; the submit
button stays enabled and re-validates on the server. Password fields carry a trailing show/hide
icon button (`Passwort anzeigen` / `Passwort verbergen`). Built as the app component
`AppTextField` on a native `<input>` with its `<label>` (not Vuetify's text field): it matches the
mockup exactly and keeps the field framework out of the sign-in screen's bundle. Forms in dialogs
submit on Enter.

## 7. Screens

### 7a. Anmelden `/anmelden`

- No card: on plain `surface`, vertically centred, left-aligned — the app name `Performance`
  in the display face (64 dp, two lines, broken as `Perfor-` / `mance` at a soft hyphen), a
  row of tally marks under it (30 dp), then the outlined fields `Benutzername` and `Passwort`
  (with show/hide) and a full-width filled button `Anmelden`. Content max width 400 dp. No top
  app bar and no navigation.
- 401 → field-less error text (`support`, `error`, between the fields and the button)
  `Benutzername oder Passwort falsch.` — the same for an unknown user name and a wrong
  password; 429 → `Zu viele Versuche. Bitte später erneut.`; no connection →
  `Keine Verbindung. Bitte später erneut.`; any other problem → its `title`.
- Success → the originally requested route or `/zaehlen`.

### 7b. Zählen, step 1 — Namen `/zaehlen`

- Title `Zählen`; step indicator at 1. Question `Für wen?` in `question`.
- Grid of person tiles (§6.4), alphabetical, each with the person's total score for today
  (from the scoreboard feed).
- Empty: `Noch keine Personen.` + button `Person anlegen` → `/verwalten/personen?anlegen` (the
  query opens the create dialog).

### 7c. Zählen, step 2 — Getränk `/zaehlen/:personId`

- Title bar: the person's name; step indicator at 2. Question `Welches Getränk?`.
- Grid of drink tiles with points, the person's counter for today and its tally (§6.4),
  alphabetical.
- Counters come from the scoreboard feed (§10), not a separate request.
- Empty: `Noch keine Getränke.` + `Getränk anlegen` → `/verwalten/getraenke?anlegen`.

### 7d. Zählen, step 3 — Anzahl `/zaehlen/:personId/:drinkId`

- Title bar: `Daniel` with the context line `Bier`; step indicator at 3. Question `Wie viele?`.
- **Quantity stepper** (§6.4), replacing the 1–5 buttons and `Andere Anzahl` named in PRD #1
  and the slice issues (owner decision 2026-11-15; this section wins). The count starts at
  what is already booked today for this person and drink (the counter from the scoreboard
  feed, factors applied); `+` adds one new drink, `−` takes one new drink back. `−` is
  disabled at the booked count — booked drinks are corrected with `Rückgängig` or in the
  Verlauf — and `+` stops at 99 new drinks. The button reads `Weiter` (or `Speichern` when
  no factors exist, in which case it saves) and is disabled until at least one drink is new
  and the factors are known; the quantity sent to the API is the number of new drinks.
  `Weiter` opens step 4 at `/zaehlen/:personId/:drinkId/<new drinks>` and stays enabled
  offline (step 4 then disables its tiles).
- With no factors defined, `Speichern` saves (step 4 is skipped) and the step indicator has
  three segments. Offline, `Speichern` is disabled under the offline banner.
- After saving, the steps walked from the name list are taken back off the history, so the
  system back gesture does not return into the finished flow.
- On medium and expanded windows the stepper and its button keep a phone's width (max 480 dp,
  left-aligned); only grids widen (§5).
- `Rückgängig` on an entry that is already gone (deleted elsewhere) counts as undone.

### 7e. Zählen, step 4 — Faktor `/zaehlen/:personId/:drinkId/:quantity`

- Title bar: `Daniel` with the context line `2× Bier`; step indicator at 4. Question `Faktor?`.
- One column of factor tiles (§6.4): `Kein Faktor` first, then one raspberry tile per factor
  showing name and multiplier (`Happy Hour`, `×2`), alphabetical.
- Tapping a tile saves: the tapped tile turns amber and the others dim, then the app returns to step 1 and
  shows the saved snackbar (§6.3).
- Save failure: stay on the step, buttons enabled again, snackbar with `Erneut versuchen`
  (retries this attempt with the same UUID). Any other save, even of the same content, is a new
  entry with a new UUID. When a save succeeds after the user has left the step (a late answer or
  a retry from the snackbar on another screen), only the snackbar shows; the app does not move.
- Offline: buttons disabled under the offline banner.
- `:quantity` is the number of new drinks, 1–99; any other value is no step (→ `/zaehlen`).
  The factors come from `GET /api/factors` (shared with Verwalten); the step indicator has
  four segments on every step once one exists. After saving, all three walked steps leave
  the history (§7d).
- Like the stepper, the column keeps a phone's width (max 480 dp, left-aligned) on medium and
  expanded windows.

### 7f. Rangliste `/rangliste`

- Title `Rangliste` with the context line `Heute`.
- Persons with entries today, ranked by score (ties by name):
  - **Rank 1 — leader card:** `primary-container`, corner 18 dp. Name (`name-hero`) and the
    tally of the total count (26 dp) on the left, score (`score-hero`) on the right; below,
    the total count (`9 Getränke`, `label`) and the per-drink counters
    (`Bier 4 · Margarita 1`, `support`).
  - **Ranks 2+ — rows** separated by `outline-variant` hairlines: rank numeral (`title`,
    `on-surface-variant`), name (`rank-name`) with per-drink counters beneath (`support`),
    and on the right the score (`numeral`) with the total count beneath (12 dp, Text 400,
    `on-surface-variant`, as in the mockup).
  - The rank is the position in the API's order (score, ties by name); tied persons get
    consecutive ranks. Per-drink counters are listed alphabetically, as the API sends them.
    A total count of one reads `1 Getränk`.
- Card and rows form one ordered list `Rangliste`; each place has the accessible name
  `Platz 1, Daniel, 13,5 Punkte, 9 Getränke`. The card and each row are links with that name
  (inside their list items) and open `/verlauf/:personId`.
- Loading: a skeleton card and three skeleton rows.
- Persons without entries today are not listed.
- Empty: `Heute noch keine Getränke.` + button `Zählen` → `/zaehlen`.
- Stale indicator (§6.6) in the top app bar.

### 7g. Verlauf `/verlauf/:personId`

- Reached from a place on the Rangliste and from a name under Verwalten → Personen (the name
  is a link `Verlauf von Daniel`). It belongs to the Rangliste destination (highlighted in the
  navigation, as in the mockup).
- Title `Daniel` with the context line `Heute` (`Verlauf` until the person has loaded), back to
  the previous screen (the Rangliste when there is none).
- List `Einträge von Daniel` of today's entries (since local midnight; at the next local midnight,
  or when the page is shown or focused again after it, read again for the new day), newest first, rows on
  `outline-variant` hairlines: primary `2× Bier` (`row-title`), secondary
  `Happy Hour ×2 · 23:41 · anna` (`support`; the factor with its current multiplier,
  `Kein Faktor` when none or deleted; the local time; the account's user name, or
  `gelöschtes Konto` when the account is gone); trailing delete icon button named
  `2× Bier um 23:41 löschen`, opening the confirmation dialog (§6.9).
- After `Löschen`: the snackbar `Eintrag gelöscht`, the list is read again and the scoreboard
  feed refreshes at once, so counters and the Rangliste follow. An entry already deleted on
  another phone (404) counts as deleted; any other failure shows the problem title and keeps
  the row. Deleted entries stay deleted: a late retry of their save does not bring them back.
- Loading: three skeleton rows. Empty: `Heute keine Einträge.`
- A person that no longer exists (deleted on another phone): back to the Rangliste with
  `Nicht mehr vorhanden` (§9). Opening another person's Verlauf is a new screen.

### 7h. Verwalten `/verwalten`

- List: `Personen`, `Getränke`, `Faktoren`, `Spiele` (§7m), and `Konten` (admins only), each
  with its count as supporting text in `support`: `6 Personen` / `1 Person`, `6 Getränke` /
  `1 Getränk`, `2 Faktoren` / `1 Faktor`, `3 Spiele` / `1 Spiel`, `4 Konten` / `1 Konto`. A
  row that opens a screen ends in `mdiChevronRight`.
- The counts are the lengths of the lists (`GET /api/persons`, `/api/drinks`, `/api/factors`,
  `/api/games`, and `/api/accounts` for admins only), read when the hub opens; a count shows
  once its list has loaded, and a row without one still opens its screen.
- Last, for admins only: `Protokoll` (§7l) with the fixed supporting line
  `Wer hat was geändert` instead of a count — the hub does not read the log.

### 7i. Personen / Getränke / Faktoren

- Alphabetical list; each row: name and, for drinks, `1 Punkt`, for factors, `×2`; trailing edit
  and delete icon buttons. Under Personen the name is a link `Verlauf von Daniel` to the
  person's Verlauf (§7g).
- Extended FAB `Person anlegen` / `Getränk anlegen` / `Faktor anlegen` (bottom right, above the
  navigation bar; `primary`, corner 10 dp, no shadow). Rows are separated by `outline-variant`
  hairlines; primary text in `row-title`.
- Create/edit dialog: `Name`; drinks also `Punkte` (decimal); factors also `Multiplikator`
  (decimal, shown with `×` prefix). Buttons `Abbrechen` and `Speichern`.
- Delete: confirmation dialog with the entry count (§6.9); for a person also the results that
  go and the matches that stay with `gelöschte Person`.
- Validation errors inline (§6.11); duplicate name → `Name ist bereits vergeben.`; points
  outside 0–9 999,99 (or no number) → `Zahl von 0 bis 9.999,99.`; a multiplier outside
  0 (exclusive) – 99,99 (or no number) → `Zahl über 0 bis 99,99.`, from the server.
- The edit dialog is titled `Person bearbeiten` / `Getränk bearbeiten` / `Faktor bearbeiten`
  and starts with the current values; points and multipliers with a decimal comma and without
  thousands grouping (`9999,99`), so saving unchanged values reads them back as they were.
  The icon buttons are named after the item: `Daniel bearbeiten`, `Daniel löschen`. Before
  the delete dialog opens, `GET …/{id}` reads the entry count (entries of every day, since
  deleting changes or removes all of them); if that read fails (the item is gone), the
  problem title shows in the snackbar and the list reloads. After deleting, the snackbar
  `Daniel gelöscht` (§6.3).
- Deleting a person or a drink deletes its entries; the Rangliste and the counters show it on
  their next refresh. A rename shows on the Rangliste the same way; a drink's new points
  change today's scores of its entries.

### 7j. Konten `/verwalten/konten` (admins only)

- Title `Konten` with a back button; the navigation keeps `Verwalten` active. Non-admins
  never see it: `/verwalten/konten` sends them to `/verwalten`.
- List of accounts by user name: user name (`row-title`), `Admin` assist chip for admins
  (outlined, corner 8 dp, `caption`); a trailing menu button (`mdiDotsVertical`, named
  `Aktionen für anna`) opens a menu on `surface-container` (corner 10 dp) with
  `Passwort zurücksetzen`, `Zum Admin machen` / `Adminrechte entziehen` and `Löschen`.
  Skeleton rows while loading.
- `Passwort zurücksetzen` opens the dialog `Passwort von anna zurücksetzen` with the line
  `anna wird auf allen Geräten abgemeldet.` and the field `Neues Passwort` (with show/hide),
  buttons `Abbrechen` and `Speichern`. A short password → `Mindestens 10 Zeichen.` under the
  field (422), one over 72 bytes in UTF-8 (bcrypt's limit) →
  `Höchstens 72 Byte (Umlaute zählen doppelt).`; success closes the dialog with the snackbar
  `Passwort von anna zurückgesetzt`. The server signs the account out on every device.
- `Zum Admin machen` / `Adminrechte entziehen` act at once, without a dialog: snackbar
  `anna ist jetzt Admin` / `anna ist kein Admin mehr`, and the list reloads. An admin who
  takes their own rights leaves Konten for `/verwalten`.
- `Löschen` opens the confirmation dialog of §6.9 (`Konto anna löschen?` – `Einträge von anna
  bleiben erhalten.`); afterwards the snackbar `anna gelöscht` and the list reloads. The
  account's sessions end; its entries stay and Verlauf shows them as `gelöschtes Konto`
  (§7g). Resetting one's own password or deleting one's own account signs this device out
  too, which leads to Anmelden (§9, 401).
- Extended FAB `Konto anlegen`: dialog `Konto anlegen` with `Benutzername` and `Startpasswort`
  (with show/hide; 10 characters to 72 bytes), buttons `Abbrechen` and `Speichern`. Field errors
  inline (§6.11): 422 under its field, and a taken user name (409) under `Benutzername` as the
  problem title `Benutzername ist bereits vergeben.` On success the dialog closes and the list
  reloads.
- Last admin: while exactly one admin is listed, that account's `Adminrechte entziehen` and
  `Löschen` are disabled (dimmed) with the supporting text `Letzter Admin`;
  `Passwort zurücksetzen` stays available. The server enforces it regardless, also against
  two admins removing each other at once (409 → problem title
  `Der letzte Admin kann nicht entfernt werden.` in the snackbar).

### 7k. Konto `/konto`

- Signed-in user name under `Angemeldet als` (`support`), with the `Admin` chip for admins;
  then two list rows with a leading icon: `Passwort ändern` (`mdiLockReset`) and `Abmelden`
  (`mdiLogout`); then app version and, in `support`, `Server: <app version>` from health.
- `Passwort ändern` opens a dialog with `Aktuelles Passwort`, `Neues Passwort` and
  `Neues Passwort wiederholen` (each with show/hide), buttons `Abbrechen` and `Speichern`.
  A repeat that differs → `Passwörter stimmen nicht überein.` under the repeat field, without
  a request; the server's 422 errors (`Passwort falsch.`, `Mindestens 10 Zeichen.`,
  `Höchstens 72 Byte (Umlaute zählen doppelt).`) under their
  fields. Success closes the dialog with the snackbar `Passwort geändert`; the server signs the
  account out on every other device.
- `Abmelden` revokes the session on the server and opens `/anmelden`.
- At the top, the app name in the display face (`name-hero`) with a decorative row of tally
  marks (30 dp, as on Anmelden). The version lines read `Version <app version>` (`row-title`) and
  `Server: <app version>` (`support`), or `Server: nicht erreichbar` when health cannot be read.

### 7l. Protokoll `/verwalten/protokoll` (admins only)

- The audit log: every create, change and delete of an entry, a person, a drink or a factor,
  with the account that did it. Title `Protokoll` with a back button; the navigation keeps
  `Verwalten` active. Non-admins never see it: the row is missing on the hub and
  `/verwalten/protokoll` sends them to `/verwalten`.
- **All days** — the one exception to "today only" (§1). Events newest first under day
  headings in `label`, `on-surface-variant`: `Heute`, `Gestern`, otherwise the date
  (`Sa., 14.11.2026`), by calendar day in the browser's time zone. The headings move on at local
  midnight and when the page is shown or focused again, so a page left open overnight labels
  yesterday's events `Gestern`; the loaded events are not read again.
- Rows on `outline-variant` hairlines, without actions:
  - primary (`row-title`): the subject with its kind, `Getränk Bier`, `Person Daniel`,
    `Faktor Happy Hour`, `Eintrag 2× Bier für Daniel`, `Spiel Schach`, `Partie Anna – Ben`
    (`gelöschte Person` for a side already cleared), `Ergebnis Daniel` — the names as the event recorded them,
    so the log stays readable after a rename or a deletion;
  - then (`body`), when there is one: for a change the changed values as
    `Punkte: 1 Punkt → 0,5 Punkte`, several joined with ` · ` (`Name: Bier → Pils`,
    `Multiplikator: ×2 → ×1,5`, `Faktor: Happy Hour ×2 → Kein Faktor`, a game's
    `Regel: Remis möglich → kein Remis`); a game's restart reads `Neu gestartet`, and a match
    side cleared by a person deletion reads `Ben → gelöschte Person`, under the match's title as
    it was (`Partie Ben – Anna`); for a creation or a
    deletion the values without the name: `1 Punkt` for a drink, `×2` for a factor,
    `Duell · Remis möglich` or `Punktespiel · Niedrigste Summe gewinnt` for a game (its kind and rule),
    `1 Punkt · Happy Hour ×2` for an entry (the drink's points, and the factor unless none),
    `Schach · Anna gewinnt` or `Schach · Remis` for a match (its game and outcome),
    `Rommé · −20 Punkte` for a result (its game and its points, with a real minus sign);
    a value the event does not hold is left out;
  - then (`support`): the local time and the user name the event recorded, `23:41 · anna`
    (kept after the account is deleted);
  - trailing, an outlined assist chip (corner 8 dp, `caption`) with the operation: `Angelegt`,
    `Geändert`, or `Gelöscht` in `error`.
- A consequential event — an entry removed by the deletion of its person or drink, or an entry
  that lost its factor when the factor was deleted, a match or result removed with its game, a
  match side cleared or a result removed with its person — is indented by 20 dp and its supporting
  line ends with its cause, `23:41 · anna · durch Löschen von Wein`. The cause comes with the
  event itself, so it shows even when the deletion is on another page.
- Pages of 20: below the list the tonal button `Ältere laden` appends the next older page; on
  the last page it is gone. A failed older page shows the problem title and keeps what is
  loaded.
- Loading: four skeleton rows. Empty: `Noch keine Änderungen.` A failed first page has nothing
  to keep, so instead of the skeleton it shows the empty-state pattern: `Protokoll nicht
  geladen.` with the button `Erneut versuchen`, which loads it again (skeleton meanwhile); a
  problem the API names also shows its title in the snackbar. Below everything the closing
  line (`support`) `Jede Änderung mit Konto und Zeit. Das Protokoll kann nicht bearbeitet oder
  gelöscht werden.` — the log is application-level append-only history; the screen has no
  other action.

### 7m. Spiele `/verwalten/spiele`

- Games are the user-created scoreboards beside the drinks; every signed-in account manages
  them, like other master data. Title `Spiele` with a back button; the navigation keeps
  `Verwalten` active. Built like §7i: alphabetical list, rows on `outline-variant` hairlines,
  trailing edit and delete icon buttons named after the game (`Schach bearbeiten`,
  `Schach löschen`), extended FAB `Spiel anlegen`, skeleton rows while loading, empty
  `Noch keine Spiele.`
- Each row: the name (`row-title`) and, in `support`, the kind and its setting:
  `Duell · Remis möglich`, `Duell · kein Remis`, `Punktespiel · Höchste Summe gewinnt`,
  `Punktespiel · Niedrigste Summe gewinnt`.
- Create/edit dialog `Spiel anlegen` / `Spiel bearbeiten`: `Name`; then `Art` (`caption`,
  `on-surface-variant`) over two tiles side by side (§6.4 tile, minimum height 88 dp): `Duell`
  with `Zwei Personen, eine gewinnt – oder Remis` and `Punktespiel` with
  `Eine Person, eine Punktzahl` (`row-title` over `support`); the chosen one is pressed
  (`primary-container`, `aria-pressed`). A new game starts as `Duell`. Under the tiles the
  kind's setting: for a duel the switch `Remis möglich` (on by default), for a points game the
  radio group `Höchste Summe gewinnt` (default) / `Niedrigste Summe gewinnt`. Buttons
  `Abbrechen` and `Speichern`.
- The kind is chosen once: editing starts with the game's values, the other kind's tile is
  disabled, and under the tiles stands `Die Art bleibt nach dem Anlegen fest.` (`support`).
  Saving sends the name and the kind's own setting.
- Validation errors inline (§6.11), from the server: a name outside 1–40 characters →
  `1 bis 40 Zeichen.`; a taken name (ignoring case) → `Name ist bereits vergeben.` under
  `Name`, as in §7i.
- Delete: `GET /api/games/{id}` reads how many matches or results of every run go with the
  game, then the confirmation dialog (§6.9); afterwards the snackbar `Schach gelöscht`. A
  failed read shows the problem title and reloads the list.
- `/verwalten/spiele?anlegen` opens the screen with `Spiel anlegen` already open (the target
  of the Spiele destination's empty state).

### 7n. Spiele `/spiele`

- The fourth navigation destination: every game (§7m) alphabetically, as the API sends them.
  Title `Spiele` without a back button.
- Each game is a tile (§6.4 tile, without its minimum height) linking to its page (§7o), in one
  column on compact windows and two from 600 dp: the name (`tile-name`, one line, ellipsis)
  with a trailing `mdiChevronRight`, and under it in `support`, `on-surface-variant`, the
  context line — the kind and since when its ranking counts: `Duell · seit 15.09.`,
  `Punktespiel · seit heute, 19:30` (§3.5). Under it, 6 dp apart, in `label`, the game's
  leader with the value of its ranking (§7o): `1. Anna · 4 Punkte`, `1. Daniel · −11 Punkte`, or
  `noch keine Ergebnisse` before anything was recorded since the start; the line keeps its
  height (20 dp) until the rankings have loaded. The tiles form the list `Spiele`.
- Loading: three skeleton tiles. Empty: `Noch keine Spiele.` + button `Spiel anlegen` →
  `/verwalten/spiele?anlegen` (Verwalten → Spiele with its create dialog open).
- The list is read when the screen opens and again on focus (`GET /api/games`), then every
  game's ranking (`GET /api/games/{id}/standings`, with `If-None-Match` once known) for its
  leader; no polling per game (§6.6). A failed read keeps the leader shown (a tile never read
  stays without one); a list that cannot be read shows the problem title in the snackbar.

### 7o. Spiel `/spiele/:gameId`

- Belongs to the Spiele destination (highlighted in the navigation) with a back button. Title:
  the game's name (`Spiele` until the games have loaded); context line: as on its tile,
  `Duell · seit 15.09.`.
- The extended FAB (as in §7i) opens the game's recording flow: `Partie eintragen` on a duel
  (§7p), `Ergebnis eintragen` on a points game (§7q); the page keeps 88 dp free below the
  ranking so the FAB covers no place.
- At the top, in `label`, `on-surface-variant`, the rule that decides the ranking:
  `Remis möglich` or `Kein Remis` for a duel, `Höchste Summe gewinnt` or
  `Niedrigste Summe gewinnt` for a points game.
- Below it the game's ranking since the last (re)start, shaped like the Rangliste (§7f):
  - **Rank 1 — leader card:** `primary-container`, corner 18 dp. Name (`name-hero`) on the
    left, the value (`score-hero`) on the right; below, the value with its unit
    (`4 Punkte`, `label`) and the details (`support`).
  - **Ranks 2+ — rows** on `outline-variant` hairlines: rank numeral (`title`,
    `on-surface-variant`), name (`rank-name`) with the details beneath (`support`,
    `on-surface-variant`), and the value (`numeral`) on the right.
  - A **duel**'s value is the points (win 1, draw ½, loss 0) in German format (`3,5`); its
    details are the record, `5 Partien · 3 S · 1 R · 1 N` (one: `1 Partie`). Order: points,
    then wins, then name, as the API sends it.
  - A **points game**'s value is the sum with a real minus sign (`−11`); its details are
    `2 Ergebnisse` (one: `1 Ergebnis`). Order: the sum in the game's direction (lowest first
    when `Niedrigste Summe gewinnt`), then name, as the API sends it.
  - The value's unit: `1 Punkt`, otherwise `Punkte` (`0,5 Punkte`, `−1 Punkt`). Tied persons
    get consecutive ranks, as on the Rangliste. Persons without a match or result since the
    start are not listed; a person deleted since counts for no one, and the other side keeps
    its win, draw or loss.
  - Card and rows form one ordered list named after the game; each place has the accessible
    name `Platz 1, Anna, 4 Punkte, 5 Partien · 3 S · 2 R · 0 N`. Places are not links.
- Empty: `Seit dem Start noch keine Partien.` for a duel, `Seit dem Start noch keine
  Ergebnisse.` for a points game.
- The ranking (`GET /api/games/{id}/standings`) is kept current like the Rangliste (§6.6):
  read when the page opens, every 10 s while visible with `If-None-Match` (304 keeps it), at
  once on focus and after the device's own writes. A failed read keeps what is shown with
  `Stand: HH:mm` in the top bar and retries with backoff up to 60 s.
  The ranking carries the run's start and a points game's direction: the context line's
  `seit …` and the rule line follow each ranking read, so a restart or rule edit on another
  device shows with the ranking it changed. A run's start only moves forward: a ranking read
  before the start the page already knows counts as the new run, still empty. The game's name
  and a duel's draw setting come from the games list (`GET /api/games`), read again on focus
  and on becoming visible, so a rename or draw-setting change elsewhere shows then; a failed
  read keeps the game shown.
- Below the ranking (or the empty state) a row of text buttons (`row-title`, normal case):
  `Verlauf` (`mdiHistory`) opens the game's Verlauf (§7r); `Neu starten` (`mdiRestart`) opens
  the confirmation dialog (§6.9) `Schach neu starten?` – `Die Rangliste beginnt wieder bei null.
  Bisherige Ergebnisse bleiben gespeichert, werden aber nicht mehr angezeigt.` with `Abbrechen`
  and `Neu starten`. Confirming (`POST /api/games/{id}/restart`) starts the game's next run
  from now: once the server answers, the restart is done — the dialog closes, the snackbar
  says `Schach neu gestartet`, the game takes the answer's new start and the ranking is read
  again at once, so the page shows the empty state and the context line `Duell · seit heute,
  19:30`. A failed read after it only marks the ranking stale (never invites a second restart).
  A failed restart shows the problem title, keeps the dialog open and the ranking as it was.
  Every signed-in account may restart a game; nothing recorded is deleted.
- Loading: a skeleton card and three skeleton rows.
- A game that no longer exists (deleted on another phone), found on open or when the
  ranking's poll answers 404 while the page is open: back to Spiele with
  `Nicht mehr vorhanden` (§9); the ranking stops polling.

### 7p. Partie eintragen `/spiele/:gameId/partie[/:firstId[/:secondId]]`

- The duel flow, one decision per screen like the add flow (§1): three routes under the game,
  belonging to the Spiele destination with a back button, and a three-segment step indicator
  (§6.1). Title: the game's name.
- **Step 1 — `Wer spielt?`** (context line `Partie eintragen`): one person tile (§6.4) per
  person, alphabetically, in the tile grid. Instead of today's score each tile shows the
  person's standing in this game since the start: the points (`numeral`, `3,5`) with
  `5 Partien` in `support`, or just `noch nichts`; accessible name `Anna, 3,5 Punkte` /
  `Carla, noch nichts`. The standing comes from the game's ranking (§7o), kept current by the
  game's poller while the step is open.
- **Step 2 — `Gegen wen?`** (context line `Anna – …`): the same tiles without the first person.
- **Step 3 — `Wie ging es aus?`** (context line `Anna – Ben`): one column of tiles, a phone's
  width as in §7e: `Anna gewinnt` (`1 Punkt für den Sieg`), `Remis` (`je ½ Punkt`, a raspberry
  factor tile, only while the game allows draws) and `Ben gewinnt` (`1 Punkt für den Sieg`).
- Tapping an outcome saves (`PUT /api/matches/{uuid}`): the tapped tile turns amber and the
  others dim; then the app returns to `Wer spielt?` for the next match, the two walked steps
  leave the history, the snackbar shows `Anna – Ben · Anna gewinnt` with `Rückgängig` (§6.3) and
  the ranking is read again. `Rückgängig` deletes the match (`DELETE /api/matches/{uuid}`, 404
  counts as undone) and reads the ranking again.
- Save failure, a late answer and offline behave as on the factor step (§7e): stay on the step
  with `Erneut versuchen` (same UUID), never move the user once they left the step, and the
  outcome tiles are disabled under the offline banner.
- A game that no longer exists or is no duel, or a player who no longer exists: back to
  Spiele with `Nicht mehr vorhanden` (§4).

### 7q. Ergebnis eintragen `/spiele/:gameId/ergebnis[/:personId]`

- The points flow, one decision per screen like the duel flow (§7p): two routes under the
  game, belonging to the Spiele destination with a back button, and a two-segment step
  indicator (§6.1). Title: the game's name.
- **Step 1 — `Für wen?`** (context line `Ergebnis eintragen`): the person tiles of §7p, each
  with the person's sum in this game since the start (`numeral`, `−11`, real minus sign) and
  `2 Ergebnisse` in `support`, or just `noch nichts`; accessible name `Daniel, −11 Punkte` /
  `Tom, noch nichts`. Kept current by the game's poller while the step is open.
- **Step 2 — `Wie viele Punkte?`** (context line: the person, `Daniel`): the app's own number
  pad, because a phone's number pad has no minus key; a phone's width as in §7e.
  - The points typed so far, centred and large (display face, 96 dp, tabular figures): `0`
    before the first digit, then `20`, `−20`, `9.876`; under it in `support` the person's sum
    so far, `bisher −11 Punkte`, or `noch keine Ergebnisse`. The value is a polite live region.
  - A 3 × 4 grid of tiles (64 dp high, display face 36 dp): `1`–`9`, then `±` (amber while the
    sign is negative, `aria-pressed`), `0` and erase (`mdiBackspaceOutline`). Accessible names
    `Ziffer 1`, `Vorzeichen wechseln`, `Letzte Ziffer löschen`. At most four digits
    (−9 999 to 9 999); a leading `0` is replaced by the next digit; erasing with no digit left
    clears the sign.
  - A keyboard works too: digits, `-` for the sign, Backspace and Enter (`Speichern`) —
    unless a control has focus: Enter on a focused button or link activates that control (e.g.
    `±` changes the sign), and a focused text field keeps every key.
  - Full-width filled `Speichern` (`primary`, as the dialogs' buttons) below the pad, disabled
    until a digit is typed and while offline (§6.5).
- `Speichern` saves (`PUT /api/results/{uuid}`, the button shows its spinner); then the app
  returns to `Für wen?` for the next player, the walked step leaves the history, the snackbar
  shows `Daniel · −20 Punkte` with `Rückgängig` (§6.3) and the ranking is read again, so the
  tiles and the game's page show the new sum. `Rückgängig` deletes the result
  (`DELETE /api/results/{uuid}`, 404 counts as undone) and reads the ranking again.
- Save failure and a late answer behave as in the duel flow: the step stays with what was
  typed and `Erneut versuchen` (same UUID); a late success never moves a user who left.
- A game that no longer exists or is no points game, or a person who no longer exists: back
  to Spiele with `Nicht mehr vorhanden` (§4).

### 7r. Verlauf of a game `/spiele/:gameId/verlauf`

- Reached from `Verlauf` on the game's page (§7o); belongs to the Spiele destination with a
  back button. Title `Verlauf`; context line the game and its start, `Schach · seit 15.09.`.
- List `Verlauf` of the game's matches or results since the last (re)start, newest first,
  rows on `outline-variant` hairlines (as §7g):
  - **Match:** primary the pairing `Anna – Ben` (`row-title`), secondary
    `Anna gewinnt · 15.11., 21:00 · anna` (`support`: the outcome, `Remis` for a draw; the local
    date and time; the recording account).
  - **Result:** primary `Daniel · −20 Punkte` (real minus sign; `1 Punkt`), secondary
    `15.11., 22:12 · anna`.
  - A person deleted since reads `gelöschte Person` (`gelöschte Person – Ben`,
    `gelöschte Person gewinnt`); an account deleted since reads `gelöschtes Konto`.
  - Trailing delete icon button named `Anna – Ben vom 15.11. löschen` /
    `Daniel · −20 Punkte vom 15.11. löschen`, opening the confirmation dialog (§6.9):
    `Partie löschen?` / `Ergebnis löschen?` with what is deleted and when.
- Pages of 20: below the list the text button `Ältere laden` (`row-title`, normal case) appends
  the next older page of the same run (a restart meanwhile does not mix runs: an open Verlauf
  keeps paging in the run it opened with; reopened, it shows the new run); on the last
  page it is gone. A failed older page shows the problem title and keeps what is loaded.
- After `Löschen`: the snackbar `Partie gelöscht` / `Ergebnis gelöscht`, the row leaves the list
  (the older pages loaded stay) and the game's ranking is read again at once, so the game's
  page and the recording flow follow. A match or result already deleted on another phone (404)
  counts as deleted; any other failure shows the problem title and keeps the row. A deleted
  match or result stays deleted: a late retry of its save does not bring it back.
- Read when the screen opens; not polled.
- Loading: three skeleton rows. Empty: `Seit dem Start noch keine Partien.` /
  `Seit dem Start noch keine Ergebnisse.`
- A game that no longer exists (deleted on another phone): back to Spiele with
  `Nicht mehr vorhanden` (§9).

## 8. Key flows

1. **Log two beers in happy hour:** Zählen → Daniel → Bier → 2 → Happy Hour ×2 → back on
   Namen, snackbar `2× Bier · Happy Hour ×2 · Daniel` with `Rückgängig`.
2. **Undo:** tap `Rückgängig` within 8 s → entry deleted, snackbar `Rückgängig gemacht`, counters
   back.
3. **Lost response:** save fails → `Erneut versuchen` → same UUID → server returns the original
   outcome; no duplicate. A later `Speichern` of the same drink is a new entry with a new UUID.
4. **Fix later:** Rangliste → Daniel → Verlauf → delete entry → confirm.
5. **Set up an evening:** Verwalten → Getränke → `Getränk anlegen` → `Margarita`, `3` →
   Speichern; same for a factor.
6. **Midnight:** at 00:00 local time the Rangliste and counters show an empty new day on the next
   refresh.
7. **First run:** sign in with the bootstrap admin → Verwalten → Konten → `Konto anlegen` for a
   friend.
8. **Record a match:** Spiele → Schach → `Partie eintragen` → Anna → Ben → `Anna gewinnt` → back
   on `Wer spielt?`, snackbar `Anna – Ben · Anna gewinnt` with `Rückgängig`, Anna's tile one
   point up.
9. **Record a Rommé round:** Spiele → Rommé → `Ergebnis eintragen` → Daniel → `2`, `0`, `±` →
   `Speichern` → back on `Für wen?`, snackbar `Daniel · −20 Punkte` with `Rückgängig`, Daniel's
   tile and the game's ranking show the new sum; next player.
10. **Fix a game later:** Spiele → Schach → `Verlauf` → delete the match → confirm →
    `Partie gelöscht`, the ranking without it.
11. **Start a new season:** Spiele → Schach → `Neu starten` → confirm → `Schach neu
    gestartet`, an empty ranking and Verlauf, `Duell · seit heute, 19:30`; the old matches stay
    stored but are no longer shown.

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
- Every counting button has an accessible name with its state, e.g. `Bier, 1 Punkt, heute 4`,
  `Daniel, 13,5 Punkte heute` or `Jule, noch nichts`; the stepper's buttons are `Eins weniger`
  and `Eins mehr`.
- Snackbars announced via a polite live region; dialogs trap focus and return it on close.
- Visible focus ring on every interactive element; full keyboard operation on desktop.
- `prefers-reduced-motion` respected (§3.4); text scaling to 200 %.

## 11. API ↔ UI mapping

| Screen / component | Endpoint(s) | Notes |
|---|---|---|
| Anmelden | `POST /api/session` | Sets the cookie |
| Shell (signed-in check) | `GET /api/session` | 401 → `/anmelden` |
| Konto | `GET /api/session`, `PUT /api/session/password`, `DELETE /api/session`, `GET /api/health` | |
| Namen | `GET /api/persons`, scoreboard feed | Scores from the feed |
| Getränk | `GET /api/drinks`, scoreboard feed | Counters from the feed |
| Anzahl | scoreboard feed, `PUT /api/entries/{uuid}` | Booked count from the feed; saves while no factors exist |
| Faktor | `GET /api/factors`, `PUT /api/entries/{uuid}` | Choice saves |
| Snackbar `Rückgängig` | `DELETE /api/entries/{uuid}` | 404 counts as undone |
| Rangliste | `GET /api/scoreboard?from=` (ETag, `If-None-Match` → 304) | Feed polls every 10 s while visible; ETag = data revision + window |
| Verlauf | `GET /api/persons`, `GET /api/entries?personId=&from=`, `DELETE /api/entries/{uuid}` | Name from the person list; entries newest first with drink, factor (or `null`), `createdAt` and `accountName` (or `null`); 404 → person gone; after a delete the scoreboard feed refreshes |
| Personen / Getränke / Faktoren | `GET/POST /api/{persons,drinks,factors}`, `GET/PATCH/DELETE …/{id}` | `GET …/{id}` includes the entry count (a person also `matchCount` and `resultCount`); `PATCH` takes all fields (persons: `name`; drinks: `name`, `points`; factors: `name`, `multiplier`) |
| Verwalten | `GET /api/{persons,drinks,factors,games}`, `GET /api/accounts` (admins) | Counts are the list lengths; the Protokoll row reads nothing |
| Spiele / Spiel | `GET /api/games`, `GET /api/games/{id}/standings` (ETag, `If-None-Match` → 304) | Name, kind, setting and `startedAt` from the list; a game missing from it is gone. The game's page polls every 10 s while visible, Spiele reads on open and on focus; ETag = data revision. Standings of the current run, tagged by `kind`: a duel's rows `{personId, name, points, wins, draws, losses, played}`, a points game's `{personId, name, sum, results}` with `lowerWins` |
| Verwalten → Spiele | `GET/POST /api/games`, `GET/PATCH/DELETE /api/games/{id}` | Game: `id`, `name`, `kind` (`duel` \| `points`), `drawsAllowed`, `lowerWins`, `startedAt`. `POST` takes `name`, `kind` and the kind's setting; `PATCH` takes `name` and the setting (the kind is fixed); `GET …/{id}` adds `matchCount` and `resultCount` (every run) |
| Partie eintragen | `GET /api/games`, `GET /api/persons`, `GET /api/games/{id}/standings`, `PUT /api/matches/{uuid}` | Body `{gameId, firstPersonId, secondPersonId, outcome}` with `outcome` `first` \| `second` \| `draw`; 201 new, 200 replay; the same UUID with other content is 409 `request-conflict` |
| Snackbar `Rückgängig` (match) | `DELETE /api/matches/{uuid}` | 404 counts as undone; the ranking is read again |
| Ergebnis eintragen | `GET /api/games`, `GET /api/persons`, `GET /api/games/{id}/standings`, `PUT /api/results/{uuid}` | Body `{gameId, personId, points}` with whole `points` from −9 999 to 9 999; 201 new, 200 replay; the same UUID with other content is 409 `request-conflict` |
| Snackbar `Rückgängig` (result) | `DELETE /api/results/{uuid}` | 404 counts as undone; the ranking is read again |
| Verlauf of a game | `GET /api/games`, `GET /api/games/{id}/matches?before=` or `GET /api/games/{id}/results?before=`, `DELETE /api/matches/{uuid}` or `DELETE /api/results/{uuid}` | By the game's kind. Answer `{items, next}`, newest first, 20 a page; `next` is the opaque `before` of `Ältere laden` (the cursor keeps its run), null on the last page. A match item: `id`, `first` / `second` (`{id, name}` or `null` once deleted), `outcome`, `createdAt`, `accountName` (or `null`); a result item: `id`, `person` `{id, name}`, `points`, `createdAt`, `accountName`. 404 → game gone; a delete's 404 counts as deleted; after a delete the ranking is read again. No polling |
| Konten | `GET/POST /api/accounts`, `PATCH/DELETE /api/accounts/{id}` | Admins only |
| Protokoll | `GET /api/audit?before=` | Admins only (401/403). Answer `{events, next}`, newest first; `next` is the `before` of `Ältere laden`, null on the last page. Each event: `occurredAt`, `operation`, `subjectKind`, `actor.userName`, snapshots `before`/`after` (names and values as they were), `cause` (`{id, subjectKind, name}` or null). No polling |
| Update / reload floor | `GET /api/health`; every request | `minClientVersion` at start-up; afterwards 400 `client-outdated` on any request but health (the app version goes along in `X-Client-Version`) |

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
- **Behaviour.** The fixture backend starts signed in as the admin `anna` (the sample
  accounts `anna`, `ben`, `daniel`, `mara` sign in with `beispiel-passwort`), serves a sample evening
  (marked as sample data: persons, drinks, factors and entries timed relative to now, so the
  preview never ages out of "today"), keeps writes in memory for the session (adds, undo,
  deletes, CRUD), and answers anything else with 503. Its games are `Rommé` (points, lowest
  sum wins, started today), `Schach` (duel with draws, two months) and `Tischtennis` (duel
  without draws, three weeks) — on Spiele `Punktespiel · seit heute, 00:00`, `Duell · seit …`; they
  are served by the API's rules (name, kind and setting
  validation, the kind fixed, restart starting the next run from now). Schach holds nine
  sample matches (one with a person deleted since) and Tischtennis three, on evenings before
  today; Rommé holds tonight's eight results. Both rankings are computed like the API's
  (current run only); matches and results are recorded and undone by the API's rules
  (idempotent on the UUID, which is unique across entries, matches and results; a match only
  in a duel, `Remis` only where allowed, two different persons; a result only in a points
  game, whole points from −9 999 to 9 999); deleting a game takes its matches and results along, deleting a
  person keeps their matches with that side cleared and removes their results. Each game's
  Verlauf is paged by the API's rules (newest first, 20 a page, a cursor that keeps its run,
  the other kind's route 404).
- **Audit log in the preview.** Protokoll starts with a seeded log that reaches back over
  several days, holds a cascade (the deletion of `Sekt` with the entries it removed) and names
  an account that no longer exists (`jonas`). The viewer's own catalog and entry writes are
  then recorded in memory by the API's rules (game, match and result writes included, a restart as a change of
  `run` and `startedAt`, a game's or person's deletion with one caused event per match it
  deletes or clears and per result it deletes): one event per change with the signed-in account,
  the entries a deletion removes or changes as consequential events with their cause, and
  nothing for a save that changes nothing, a write that fails, a replayed or conflicting entry,
  match or result request, or an account change.
- **No service worker.** The preview build does not register the service worker; the update
  prompt and reload floor can be triggered from a small preview-only menu. The menu's summary
  `Vorschau · Beispieldaten` (the sample-data marker) is a thin strip above the app that pushes
  it down, so it never covers a control.
- **Publishing.** Each slice that changes the UI rebuilds the preview and republishes it to the
  same private claude.ai artifact, and attaches compact and expanded screenshots to its pull
  request. The artifact link is recorded in the README.

## 13. Out of scope (this spec)

- Views of other days (Protokoll, §7l, excepted), all-time totals, statistics or charts.
- Filters, search or export of the Protokoll; restoring data from it.
- Theme switch, custom colours per person, avatars.
- English UI.
- Tablet- or desktop-specific layouts beyond widened grids.
- Offline saving.
