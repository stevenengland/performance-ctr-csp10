import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';
import { createAppVuetify } from './theme';

const specPath = resolve(
  import.meta.dirname,
  '../../docs/design/webapp-design-spec.md',
);

/** The role table of the design spec's §3.1, as `{ light, dark }` maps. */
function specRoles(): Record<'light' | 'dark', Record<string, string>> {
  const spec = readFileSync(specPath, 'utf8');
  const section = spec.slice(spec.indexOf('### 3.1'), spec.indexOf('### 3.2'));
  const roles = { light: {}, dark: {} } as Record<
    'light' | 'dark',
    Record<string, string>
  >;
  for (const match of section.matchAll(
    /^\| `([a-z-]+)` \| `(#[0-9a-f]{6})` \| `(#[0-9a-f]{6})` \|$/gm,
  )) {
    const [, role, light, dark] = match as unknown as [
      string,
      string,
      string,
      string,
    ];
    roles.light[role] = light;
    roles.dark[role] = dark;
  }
  return roles;
}

function prefer(scheme: 'light' | 'dark') {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) =>
      ({
        matches: query === `(prefers-color-scheme: ${scheme})`,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

describe('the Vuetify theme', () => {
  afterEach(() => {
    vi.mocked(window.matchMedia).mockReset();
  });

  it('reads all 28 roles of the spec table', () => {
    expect(Object.keys(specRoles().light)).toHaveLength(28);
  });

  it.each(['light', 'dark'] as const)(
    'equals the design spec token table in %s',
    (variant) => {
      const vuetify = createAppVuetify();
      const colors: Record<string, unknown> =
        vuetify.theme.themes.value[variant]?.colors ?? {};
      const roles = specRoles()[variant];
      const themed = Object.fromEntries(
        Object.keys(roles).map((role) => [role, colors[role]]),
      );

      expect(themed).toEqual(roles);
      expect(vuetify.theme.themes.value[variant]?.dark).toBe(
        variant === 'dark',
      );
    },
  );

  it.each(['dark', 'light'] as const)(
    'follows the system colour scheme when it prefers %s',
    async (expected) => {
      prefer(expected);
      const vuetify = createAppVuetify();
      const app = createApp({ render: () => null }).use(vuetify);
      app.mount(document.createElement('div'));
      await nextTick();

      expect(vuetify.theme.global.name.value).toBe(expected);
      app.unmount();
    },
  );
});
