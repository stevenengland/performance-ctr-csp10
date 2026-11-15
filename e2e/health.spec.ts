import { expect, test } from './support/playwright';

test('health reports the versions, schema and migration state of the stack', async ({
  request,
}) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/json');
  const health = (await response.json()) as Record<string, unknown>;
  expect(health).toMatchObject({
    phpVersion: expect.stringMatching(/^8\.\d+\.\d+$/),
    database: {
      engine: expect.stringMatching(/^(MySQL|MariaDB)$/),
      version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
    },
    schemaVersion: 1,
    migration: 'ok',
    minClientVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/),
  });
  expect(health.appVersion).toEqual(expect.stringMatching(/^\d+\.\d+\.\d+/));
});

test('the web app shows the app version it received from health', async ({
  page,
  request,
}) => {
  const { appVersion } = (await (
    await request.get('/api/health')
  ).json()) as { appVersion: string };

  await page.goto('/konto');

  await expect(page.getByTestId('server-version')).toHaveText(
    `Server: ${appVersion}`,
  );
});
