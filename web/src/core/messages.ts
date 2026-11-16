/** `1 Eintrag`, `23 Einträge`; nothing for none. */
function counted(count: number, one: string, many: string) {
  if (count === 0) return undefined;
  return count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
}

/** Every user-visible German text of the app. */
export const messages = {
  appName: 'Performance',
  navigation: {
    label: 'Hauptnavigation',
    zaehlen: 'Zählen',
    rangliste: 'Rangliste',
    spiele: 'Spiele',
    verwalten: 'Verwalten',
  },
  topBar: {
    back: 'Zurück',
    account: 'Konto',
    today: 'Heute',
  },
  points: { one: 'Punkt', other: 'Punkte' },
  zaehlen: {
    question: 'Für wen?',
    noPersons: 'Noch keine Personen.',
    createPerson: 'Person anlegen',
    scoreToday: 'Punkte heute',
    nothingYet: 'noch nichts',
    /** Accessible name of a person tile; `score` is formatted, absent without entries today. */
    personTile: (name: string, score?: string) =>
      score === undefined
        ? `${name}, noch nichts`
        : `${name}, ${score} Punkte heute`,
    drinkQuestion: 'Welches Getränk?',
    noDrinks: 'Noch keine Getränke.',
    createDrink: 'Getränk anlegen',
    /** Accessible name of a drink tile (§10): `Bier, 1 Punkt, heute 4`. */
    drinkTile: (name: string, points: string, counter: string) =>
      `${name}, ${points}, heute ${counter}`,
    quantityQuestion: 'Wie viele?',
    less: 'Eins weniger',
    more: 'Eins mehr',
    drinkToday: (drink: string) => `${drink} heute`,
    delta: (booked: string, added: number) =>
      `bisher ${booked}, neu dazu ${String(added)}`,
    save: 'Speichern',
    next: 'Weiter',
    /** The quantity of a drink in text: `2× Bier` (§3.5). */
    quantityOf: (quantity: number, drink: string) =>
      `${String(quantity)}× ${drink}`,
    factorQuestion: 'Faktor?',
    noFactor: 'Kein Faktor',
    countsOnce: 'zählt einfach',
    /** Supporting text of a factor tile; `multiplier` is formatted without `×`: `zählt 1,5-fach`. */
    countsTimes: (multiplier: string) => `zählt ${multiplier}-fach`,
    /** Accessible name of a factor tile: `Happy Hour, ×2`. */
    factorTile: (name: string, multiplier: string) => `${name}, ${multiplier}`,
    /** The saved snackbar (§6.3): `2× Bier · Happy Hour ×2 · Daniel`, without the factor part for none. */
    saved: (quantity: number, drink: string, person: string, factor?: string) =>
      [`${String(quantity)}× ${drink}`, factor, person]
        .filter((part) => part !== undefined)
        .join(' · '),
    undo: 'Rückgängig',
    undone: 'Rückgängig gemacht',
    notSaved: 'Nicht gespeichert – keine Verbindung',
    notUndone: 'Nicht rückgängig gemacht – keine Verbindung',
    retry: 'Erneut versuchen',
    gone: 'Nicht mehr vorhanden',
  },
  rangliste: {
    noDrinks: 'Heute noch keine Getränke.',
    count: 'Zählen',
    /** A total count: `9 Getränke`, `1 Getränk`. */
    drinks: (formatted: string, count: number) =>
      `${formatted} ${count === 1 ? 'Getränk' : 'Getränke'}`,
    /** Accessible name of a place (§7f): `Platz 1, Daniel, 13,5 Punkte, 9 Getränke`. */
    label: (rank: number, name: string, points: string, drinks: string) =>
      `Platz ${String(rank)}, ${name}, ${points}, ${drinks}`,
  },
  verlauf: {
    title: 'Verlauf',
    /** The list's accessible name: `Einträge von Daniel`. */
    list: (person: string) => `Einträge von ${person}`,
    empty: 'Heute keine Einträge.',
    /** The logging account once it is deleted. */
    deletedAccount: 'gelöschtes Konto',
    /** A row's supporting line: `Happy Hour ×2 · 23:41 · anna`. */
    details: (factor: string, time: string, account: string) =>
      `${factor} · ${time} · ${account}`,
    /** The delete icon button: `2× Bier um 23:41 löschen`. */
    remove: (entry: string, time: string) => `${entry} um ${time} löschen`,
    removeTitle: 'Eintrag löschen?',
    /** The dialog body (§6.9): `2× Bier · Happy Hour ×2 um 23:41`, without the factor part for none. */
    removeBody: (entry: string, time: string, factor?: string) =>
      `${factor === undefined ? entry : `${entry} · ${factor}`} um ${time}`,
    removed: 'Eintrag gelöscht',
    /** The link from a person's row under Personen: `Verlauf von Daniel`. */
    open: (person: string) => `Verlauf von ${person}`,
  },
  /** The time of the last successful refresh while the latest one failed (§6.6). */
  stand: (time: string) => `Stand: ${time}`,
  /** A 503 with `Retry-After`: a migration is running (§6.8). */
  maintenance: 'Wird aktualisiert – gleich wieder da',
  verwalten: {
    persons: 'Personen',
    drinks: 'Getränke',
    factors: 'Faktoren',
    accounts: 'Konten',
    games: 'Spiele',
    /** The counts on the hub (§7h); `formatted` is the count in `de-DE`. */
    personCount: (formatted: string, count: number) =>
      `${formatted} ${count === 1 ? 'Person' : 'Personen'}`,
    drinkCount: (formatted: string, count: number) =>
      `${formatted} ${count === 1 ? 'Getränk' : 'Getränke'}`,
    factorCount: (formatted: string, count: number) =>
      `${formatted} ${count === 1 ? 'Faktor' : 'Faktoren'}`,
    gameCount: (formatted: string, count: number) =>
      `${formatted} ${count === 1 ? 'Spiel' : 'Spiele'}`,
    accountCount: (formatted: string, count: number) =>
      `${formatted} ${count === 1 ? 'Konto' : 'Konten'}`,
    audit: 'Protokoll',
    /** The Protokoll row's fixed supporting line: the hub does not load the log. */
    auditSupport: 'Wer hat was geändert',
  },
  /** The audit log screen (§7l): application-level append-only history. */
  protokoll: {
    title: 'Protokoll',
    note: 'Jede Änderung mit Konto und Zeit. Das Protokoll kann nicht bearbeitet oder gelöscht werden.',
    empty: 'Noch keine Änderungen.',
    /** The first page failed (no answer, or a problem the snackbar names). */
    notLoaded: 'Protokoll nicht geladen.',
    retry: 'Erneut versuchen',
    more: 'Ältere laden',
    today: 'Heute',
    yesterday: 'Gestern',
    kind: {
      entry: 'Eintrag',
      person: 'Person',
      drink: 'Getränk',
      factor: 'Faktor',
      game: 'Spiel',
      match: 'Partie',
      result: 'Ergebnis',
    },
    operation: {
      create: 'Angelegt',
      update: 'Geändert',
      delete: 'Gelöscht',
    },
    /** A row's subject: `Getränk Bier`. */
    subject: (kind: string, name: string) => `${kind} ${name}`,
    /** An entry's name: `2× Bier für Daniel`. */
    entry: (quantityOf: string, person: string) =>
      `${quantityOf} für ${person}`,
    /** A match's name: `Anna – Ben`. */
    match: (first: string, second: string) => `${first} – ${second}`,
    /** A side of a match whose person was deleted. */
    deletedPerson: 'gelöschte Person',
    /** A match's outcome: `Anna gewinnt`. */
    wins: (name: string) => `${name} gewinnt`,
    draw: 'Remis',
    game: 'Spiel',
    /** A game's setting: `Regel: Remis möglich → kein Remis`. */
    rule: 'Regel',
    /** A game's restart, which begins a new run. */
    restarted: 'Neu gestartet',
    /** A match side cleared by a person deletion: `Ben → gelöschte Person`. */
    replaced: (before: string, after: string) => `${before} → ${after}`,
    outcome: 'Ergebnis',
    /** A changed value: `Punkte: 1 Punkt → 0,5 Punkte`. */
    change: (label: string, before: string, after: string) =>
      `${label}: ${before} → ${after}`,
    name: 'Name',
    points: 'Punkte',
    multiplier: 'Multiplikator',
    factor: 'Faktor',
    /** A row's supporting line: `23:41 · anna`. */
    by: (time: string, userName: string) => `${time} · ${userName}`,
    /** A consequential row's cause: `durch Löschen von Wein`. */
    causedBy: (name: string) => `durch Löschen von ${name}`,
  },
  personen: {
    title: 'Personen',
    create: 'Person anlegen',
    edit: 'Person bearbeiten',
    name: 'Name',
    empty: 'Noch keine Personen.',
  },
  getraenke: {
    title: 'Getränke',
    create: 'Getränk anlegen',
    edit: 'Getränk bearbeiten',
    name: 'Name',
    points: 'Punkte',
    empty: 'Noch keine Getränke.',
  },
  faktoren: {
    title: 'Faktoren',
    create: 'Faktor anlegen',
    edit: 'Faktor bearbeiten',
    name: 'Name',
    multiplier: 'Multiplikator',
    empty: 'Noch keine Faktoren.',
  },
  /** The icon buttons of a row in Personen, Getränke and Faktoren (§7i). */
  row: {
    edit: (name: string) => `${name} bearbeiten`,
    remove: (name: string) => `${name} löschen`,
  },
  /** Deleting master data (§6.9). */
  remove: {
    title: (name: string) => `${name} löschen?`,
    confirm: 'Löschen',
    done: (name: string) => `${name} gelöscht`,
    /** A deleted person's or drink's entries go with it. */
    cascadeBody: (name: string, entries: number) => {
      if (entries === 0) return `${name} wird gelöscht.`;
      const counted =
        entries === 1 ? '1 Eintrag' : `${String(entries)} Einträge`;
      return `${name} und ${counted} werden gelöscht.`;
    },
    /**
    A deleted person's entries and results go with them (`Daniel, 23 Einträge und
    7 Ergebnisse werden gelöscht.`); their matches stay, with their side shown as
    `gelöschte Person`.
    */
    personBody: (
      name: string,
      entries: number,
      results: number,
      matches: number,
    ) => {
      const gone = [
        counted(entries, 'Eintrag', 'Einträge'),
        counted(results, 'Ergebnis', 'Ergebnisse'),
      ].filter((part) => part !== undefined);
      const last = gone.pop();
      const first =
        last === undefined
          ? `${name} wird gelöscht.`
          : `${[name, ...gone].join(', ')} und ${last} werden gelöscht.`;
      if (matches === 0) return first;
      const kept =
        matches === 1
          ? '1 Partie bleibt'
          : `${String(matches)} Partien bleiben`;
      return `${first} ${kept} mit „gelöschte Person“.`;
    },
    /** A deleted factor's entries stay and count ×1. */
    factorBody: (name: string, entries: number) => {
      if (entries === 0) return `${name} wird gelöscht.`;
      if (entries === 1) return '1 Eintrag zählt danach ×1.';
      return `${String(entries)} Einträge zählen danach ×1.`;
    },
  },
  /** Spiele, a game's page (§7n, §7o) and Verwalten → Spiele (§7m). */
  spiele: {
    title: 'Spiele',
    empty: 'Noch keine Spiele.',
    create: 'Spiel anlegen',
    edit: 'Spiel bearbeiten',
    name: 'Name',
    kind: 'Art',
    kindFixed: 'Die Art bleibt nach dem Anlegen fest.',
    duel: 'Duell',
    points: 'Punktespiel',
    duelHint: 'Zwei Personen, eine gewinnt – oder Remis',
    pointsHint: 'Eine Person, eine Punktzahl',
    drawsAllowed: 'Remis möglich',
    noDraws: 'kein Remis',
    /** The duel rule above a game's ranking, where it stands alone. */
    noDrawsRule: 'Kein Remis',
    higherWins: 'Höchste Summe gewinnt',
    lowerWins: 'Niedrigste Summe gewinnt',
    /** A game's setting in the list: `Duell · Remis möglich`. */
    setting: (kind: string, setting: string) => `${kind} · ${setting}`,
    /** `seit 15.09.`, or `seit heute, 19:30` for a game (re)started today. */
    since: (day: string) => `seit ${day}`,
    sinceToday: (time: string) => `seit heute, ${time}`,
    /** A game's context line: `Duell · seit 15.09.`. */
    context: (kind: string, since: string) => `${kind} · ${since}`,
    /** A game's leader in the Spiele list: `1. Anna · 4 Punkte`. */
    leader: (name: string, value: string) => `1. ${name} · ${value}`,
    noResults: 'noch keine Ergebnisse',
    /** Game points with their unit: `7,5 Punkte`, `1 Punkt`, `−20 Punkte`. */
    gamePoints: (formatted: string, value: number) =>
      `${formatted} ${Math.abs(value) === 1 ? 'Punkt' : 'Punkte'}`,
    /** A duel place's record: `5 Partien · 3 S · 1 R · 1 N`. */
    record: (played: number, wins: number, draws: number, losses: number) =>
      `${String(played)} ${played === 1 ? 'Partie' : 'Partien'} · ${String(wins)} S · ${String(draws)} R · ${String(losses)} N`,
    /** A points place's count: `3 Ergebnisse`. */
    resultCount: (count: number) =>
      `${String(count)} ${count === 1 ? 'Ergebnis' : 'Ergebnisse'}`,
    /** Accessible name of a place: `Platz 1, Anna, 3,5 Punkte, 5 Partien · …`. */
    place: (rank: number, name: string, value: string, details: string) =>
      `Platz ${String(rank)}, ${name}, ${value}, ${details}`,
    noneYetDuel: 'Seit dem Start noch keine Partien.',
    noneYetPoints: 'Seit dem Start noch keine Ergebnisse.',
    /** A duel player's tile: `5 Partien`. */
    played: (count: number) =>
      `${String(count)} ${count === 1 ? 'Partie' : 'Partien'}`,
    recordMatch: 'Partie eintragen',
    recordResult: 'Ergebnis eintragen',
    firstQuestion: 'Wer spielt?',
    secondQuestion: 'Gegen wen?',
    outcomeQuestion: 'Wie ging es aus?',
    personQuestion: 'Für wen?',
    pointsQuestion: 'Wie viele Punkte?',
    wins: (name: string) => `${name} gewinnt`,
    draw: 'Remis',
    winSupport: '1 Punkt für den Sieg',
    drawSupport: 'je ½ Punkt',
    /** The pairing: `Anna – Ben`, `Anna – …` while the second player is open. */
    pairing: (first: string, second: string) => `${first} – ${second}`,
    /** The saved snackbar: `Anna – Ben · Anna gewinnt`. */
    savedMatch: (pairing: string, outcome: string) => `${pairing} · ${outcome}`,
    /** The saved snackbar of a result: `Daniel · −20 Punkte`. */
    savedResult: (person: string, points: string) => `${person} · ${points}`,
    /** Under the points being typed: the person's sum so far, `bisher −11 Punkte`. */
    soFar: (points: string) => `bisher ${points}`,
    /** The number pad's keys (accessible names). */
    digit: (digit: number) => `Ziffer ${String(digit)}`,
    sign: 'Vorzeichen wechseln',
    erase: 'Letzte Ziffer löschen',
    save: 'Speichern',
    /** A game's Verlauf: its matches or results since the start (§7r). */
    history: 'Verlauf',
    restart: 'Neu starten',
    restartTitle: (name: string) => `${name} neu starten?`,
    restartBody:
      'Die Rangliste beginnt wieder bei null. Bisherige Ergebnisse bleiben gespeichert, werden aber nicht mehr angezeigt.',
    restarted: (name: string) => `${name} neu gestartet`,
    /** The Verlauf's context line: `Schach · seit 15.09.`. */
    historyContext: (game: string, since: string) => `${game} · ${since}`,
    /** A side of a match whose person was deleted. */
    deletedPerson: 'gelöschte Person',
    /** A Verlauf row's supporting line: `15.11., 21:00 · anna`. */
    details: (day: string, time: string, account: string) =>
      `${day}, ${time} · ${account}`,
    /** The delete icon button of a Verlauf row: `Anna – Ben vom 15.11. löschen`. */
    removeRecorded: (what: string, day: string) => `${what} vom ${day} löschen`,
    removeMatchTitle: 'Partie löschen?',
    removeResultTitle: 'Ergebnis löschen?',
    /** The dialog body (§6.9): `Anna – Ben · Anna gewinnt am 15.11. um 21:00`. */
    removeRecordedBody: (what: string, day: string, time: string) =>
      `${what} am ${day} um ${time}`,
    removedMatch: 'Partie gelöscht',
    removedResult: 'Ergebnis gelöscht',
    more: 'Ältere laden',
    /** A deleted game's matches or results go with it. */
    removeBody: (name: string, kind: 'duel' | 'points', count: number) => {
      if (count === 0) return `${name} wird gelöscht.`;
      const [one, many] =
        kind === 'duel' ? ['Partie', 'Partien'] : ['Ergebnis', 'Ergebnisse'];
      const counted = count === 1 ? `1 ${one}` : `${String(count)} ${many}`;
      return `${name} und ${counted} werden gelöscht.`;
    },
  },
  anmelden: {
    title: 'Anmelden',
    /** The app name on Anmelden, set in two lines at the soft hyphen (§7a). */
    appName: 'Perfor\u00ADmance',
    userName: 'Benutzername',
    password: 'Passwort',
    submit: 'Anmelden',
    invalid: 'Benutzername oder Passwort falsch.',
    throttled: 'Zu viele Versuche. Bitte später erneut.',
    unreachable: 'Keine Verbindung. Bitte später erneut.',
  },
  field: {
    showPassword: 'Passwort anzeigen',
    hidePassword: 'Passwort verbergen',
  },
  dialog: {
    cancel: 'Abbrechen',
    save: 'Speichern',
  },
  konten: {
    title: 'Konten',
    create: 'Konto anlegen',
    userName: 'Benutzername',
    startPassword: 'Startpasswort',
    admin: 'Admin',
    /** The menu button of an account's row: `Aktionen für anna`. */
    actions: (userName: string) => `Aktionen für ${userName}`,
    resetPassword: 'Passwort zurücksetzen',
    grantAdmin: 'Zum Admin machen',
    revokeAdmin: 'Adminrechte entziehen',
    remove: 'Löschen',
    /** Supporting text of the menu entries that would remove the last admin. */
    lastAdmin: 'Letzter Admin',
    granted: (userName: string) => `${userName} ist jetzt Admin`,
    revoked: (userName: string) => `${userName} ist kein Admin mehr`,
    resetTitle: (userName: string) => `Passwort von ${userName} zurücksetzen`,
    resetBody: (userName: string) =>
      `${userName} wird auf allen Geräten abgemeldet.`,
    newPassword: 'Neues Passwort',
    resetDone: (userName: string) => `Passwort von ${userName} zurückgesetzt`,
    /** The delete dialog (§6.9): `Konto anna löschen?` – `Einträge von anna bleiben erhalten.` */
    removeTitle: (userName: string) => `Konto ${userName} löschen?`,
    removeBody: (userName: string) =>
      `Einträge von ${userName} bleiben erhalten.`,
  },
  konto: {
    title: 'Konto',
    signedInAs: 'Angemeldet als',
    admin: 'Admin',
    changePassword: 'Passwort ändern',
    currentPassword: 'Aktuelles Passwort',
    newPassword: 'Neues Passwort',
    repeatPassword: 'Neues Passwort wiederholen',
    mismatch: 'Passwörter stimmen nicht überein.',
    changed: 'Passwort geändert',
    signOut: 'Abmelden',
    version: (version: string) => `Version ${version}`,
    server: (version: string) => `Server: ${version}`,
    serverUnknown: 'Server: nicht erreichbar',
  },
  offline: 'Offline – Getränke können gerade nicht gespeichert werden.',
  update: {
    available: 'Neue Version verfügbar',
    reload: 'Neu laden',
  },
  reloadFloor: {
    title: 'Bitte neu laden',
    body: 'Diese Version ist veraltet.',
    reload: 'Neu laden',
  },
} as const;
