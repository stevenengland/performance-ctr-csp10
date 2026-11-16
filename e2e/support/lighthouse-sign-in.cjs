/*
Lighthouse CI's puppeteerScript (lighthouserc.json): runs in the audit browser before
each URL is audited. Every screen but Anmelden is audited signed in as the e2e stack's
bootstrap admin (e2e/stack/config.php, e2e/support/session.ts); Anmelden is audited
signed out. The session is an HttpOnly cookie, which Lighthouse's storage reset keeps.

On a stack without persons it first seeds one group's evening (six persons, four
drinks, a few rounds), so the signed-in screens are audited with the data the app is
made for. CI audits before the e2e suite adds its own data.
*/
const ADMIN = { userName: 'e2e-admin', password: 'e2e-admin-passwort' };
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
async function prepare({ signOut, account, evening }) {
  const json = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (signOut) {
    await fetch('/api/session', { method: 'DELETE' });
    return 'signed out';
  }
  const session = await fetch('/api/session', json('POST', account));
  if (session.status !== 200) return `sign-in failed: ${session.status}`;
  const { persons: existing } = await (await fetch('/api/persons')).json();
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
  for (const [person, drink, quantity] of evening.rounds) {
    const entry = {
      personId: persons[person],
      drinkId: drinks[drink],
      quantity,
      factorId: null,
    };
    const response = await fetch(
      `/api/entries/${crypto.randomUUID()}`,
      json('PUT', entry),
    );
    if (response.status !== 201) throw new Error(`entry: ${response.status}`);
  }
  return 'signed in';
}

module.exports = async function signIn(browser, { url }) {
  const target = new URL(url);
  const page = await browser.newPage();
  try {
    await page.goto(`${target.origin}/api/health`);
    const outcome = await page.evaluate(prepare, {
      signOut: target.pathname === '/anmelden',
      account: ADMIN,
      evening: EVENING,
    });
    if (!outcome.startsWith('signed')) {
      throw new Error(`Lighthouse ${outcome}`);
    }
  } finally {
    await page.close();
  }
};
