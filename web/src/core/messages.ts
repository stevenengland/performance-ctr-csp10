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
  zaehlen: {
    question: 'Für wen?',
    noPersons: 'Noch keine Personen.',
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
