/*
Lighthouse CI's puppeteerScript (lighthouserc.json): runs in the audit browser before
each URL is audited. Every screen but Anmelden is audited signed in as the e2e stack's
bootstrap admin (e2e/stack/config.php, e2e/support/session.ts); Anmelden is audited
signed out. The session is an HttpOnly cookie, which Lighthouse's storage reset keeps.

On a stack without persons it first seeds one group's evening (six persons, four
drinks, a few rounds, each verified by a second account, as the four-eyes rule wants),
so the signed-in screens are audited with the data the app is made for. CI audits
before the e2e suite adds its own data. Every request names the release's version (from
health, which needs none), as the app does, so the API's client floor serves it.
*/
const ADMIN = { userName: 'e2e-admin', password: 'e2e-admin-passwort' };
/** The e2e suite's verifier (e2e/support/session.ts). */
const VERIFIER = { userName: 'e2e-pruefer', password: 'e2e-pruefer-passwort' };
const EVENING = {
  persons: ['Anna', 'Ben', 'Daniel', 'Lea', 'Mara', 'Tom'],
  drinks: [
    { name: 'Aperol', points: 2.5 },
    { name: 'Bier', points: 1 },
    { name: 'Schnaps', points: 1.5 },
    { name: 'Wasser', points: 0 },
  ],
  /** [person, drink, quantity] by index. */
  rounds: [
    [0, 1, 2],
    [1, 1, 3],
    [2, 0, 1],
    [2, 1, 4],
    [3, 3, 2],
    [4, 2, 3],
    [5, 1, 1],
    [0, 2, 1],
  ],
};

/** Runs in the page: signs in or out, and seeds the evening once. */
async function prepare({ signOut, account, verifier, evening }) {
  const { appVersion } = await (await fetch('/api/health')).json();
  const headers = { 'X-Client-Version': appVersion };
  const json = (method, body) => ({
    method,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (signOut) {
    await fetch('/api/session', { method: 'DELETE', headers });
    return 'signed out';
  }
  const signIn = (as) => fetch('/api/session', json('POST', as));
  const session = await signIn(account);
  if (session.status !== 200) return `sign-in failed: ${session.status}`;
  const { persons: existing } = await (
    await fetch('/api/persons', { headers })
  ).json();
  if (existing.length > 0) return 'signed in';
  const created = async (path, body) => {
    const response = await fetch(path, json('POST', body));
    if (response.status !== 201) throw new Error(`${path}: ${response.status}`);
    return (await response.json()).id;
  };
  const persons = [];
  for (const name of evening.persons) {
    persons.push(await created('/api/persons', { name }));
  }
  const drinks = [];
  for (const drink of evening.drinks) {
    drinks.push(await created('/api/drinks', drink));
  }
  const entries = [];
  for (const [person, drink, quantity] of evening.rounds) {
    const entry = {
      personId: persons[person],
      drinkId: drinks[drink],
      quantity,
      factorId: null,
    };
    const id = crypto.randomUUID();
    const response = await fetch(`/api/entries/${id}`, json('PUT', entry));
    if (response.status !== 201) throw new Error(`entry: ${response.status}`);
    entries.push(id);
  }
  // Another account verifies the evening, so it counts; then the admin signs in again.
  const verifierCreated = await fetch('/api/accounts', json('POST', verifier));
  if (![201, 409].includes(verifierCreated.status)) {
    throw new Error(`verifier: ${verifierCreated.status}`);
  }
  if ((await signIn(verifier)).status !== 200) {
    throw new Error('verifier sign-in failed');
  }
  for (const id of entries) {
    const verified = await fetch(
      `/api/entries/${id}/verification`,
      json('PUT', {}),
    );
    if (verified.status !== 204) {
      throw new Error(`verification: ${verified.status}`);
    }
  }
  const again = await signIn(account);
  return again.status === 200 ? 'signed in' : `sign-in failed: ${again.status}`;
}

module.exports = async function signIn(browser, { url }) {
  const target = new URL(url);
  const page = await browser.newPage();
  try {
    await page.goto(`${target.origin}/api/health`);
    const outcome = await page.evaluate(prepare, {
      signOut: target.pathname === '/anmelden',
      account: ADMIN,
      verifier: VERIFIER,
      evening: EVENING,
    });
    if (!outcome.startsWith('signed')) {
      throw new Error(`Lighthouse ${outcome}`);
    }
  } finally {
    await page.close();
  }
};
