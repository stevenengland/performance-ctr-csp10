/** Every user-visible German text of the app. */
export const messages = {
  appName: 'Performance',
  navigation: {
    label: 'Hauptnavigation',
    zaehlen: 'Zählen',
    rangliste: 'Rangliste',
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
    /** The saved snackbar (§6.3): `2× Bier · Daniel`. */
    saved: (quantity: number, drink: string, person: string) =>
      `${String(quantity)}× ${drink} · ${person}`,
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
  },
  verwalten: {
    persons: 'Personen',
    drinks: 'Getränke',
    factors: 'Faktoren',
    accounts: 'Konten',
  },
  personen: {
    title: 'Personen',
    create: 'Person anlegen',
    name: 'Name',
    empty: 'Noch keine Personen.',
  },
  getraenke: {
    title: 'Getränke',
    create: 'Getränk anlegen',
    name: 'Name',
    points: 'Punkte',
    empty: 'Noch keine Getränke.',
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
