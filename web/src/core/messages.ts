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
  },
  konto: {
    title: 'Konto',
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
