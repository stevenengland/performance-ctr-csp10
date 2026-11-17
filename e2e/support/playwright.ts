import { test as base, expect } from '@playwright/test';

interface CspReport {
  directive: string;
  blocked: string;
  source: string;
}

/**
Every test fails when any page it drove raised a `securitypolicyviolation`
event (projekt2406's CSP guard). The guard is an automatic fixture, so specs
cannot forget it; specs import `test` from here, never from `@playwright/test`.
*/
export const test = base.extend<{ cspGuard: undefined }>({
  cspGuard: [
    async ({ page }, use) => {
      const violations: CspReport[] = [];
      await page.exposeBinding(
        '__reportCspViolation',
        (_source, report: CspReport) => {
          violations.push(report);
        },
      );
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = {
            directive: event.violatedDirective,
            blocked: event.blockedURI,
            source: `${event.sourceFile}:${String(event.lineNumber)}`,
          };
          void (
            globalThis as unknown as {
              __reportCspViolation(r: typeof report): Promise<void>;
            }
          ).__reportCspViolation(report);
        });
      });
      await use(undefined);
      expect(
        violations,
        'securitypolicyviolation events on the pages this test drove',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
export type {
  APIRequestContext,
  Browser,
  Locator,
  Page,
  Request,
} from '@playwright/test';
