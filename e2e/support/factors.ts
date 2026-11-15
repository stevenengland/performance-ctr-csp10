import type { Page } from './playwright.ts';

/**
Answers the page's factor list with none. Factors are shared by everyone on the
stack, and `factors.spec.ts` creates some while other specs run, so a spec that
walks the add flow without the factor step says so here; that step then is
skipped, as on an installation without factors.
*/
export async function withoutFactors(page: Page): Promise<void> {
  await page.route('**/api/factors', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({ json: { factors: [] } });
  });
}
