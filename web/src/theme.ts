import { createVuetify, type ThemeDefinition } from 'vuetify';
import { md3 } from 'vuetify/blueprints';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';
import { DARK, LIGHT, type Roles } from './theme-colours';

function theme(dark: boolean, roles: Roles): ThemeDefinition {
  return {
    dark,
    colors: {
      ...roles,
      // Vuetify paints the app background and its on-colour from these names.
      background: roles.surface,
      'on-background': roles['on-surface'],
    },
  };
}

/** Breakpoints of the spec's window classes: compact < 600, medium < 840, expanded. */
const WINDOW_CLASSES = { medium: 600, expanded: 840 } as const;

export function createAppVuetify() {
  return createVuetify({
    blueprint: md3,
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
    theme: {
      defaultTheme: 'system',
      themes: { light: theme(false, LIGHT), dark: theme(true, DARK) },
    },
    display: {
      mobileBreakpoint: 'sm',
      thresholds: {
        xs: 0,
        sm: WINDOW_CLASSES.medium,
        md: WINDOW_CLASSES.expanded,
        lg: 1280,
        xl: 1920,
        xxl: 2560,
      },
    },
  });
}
