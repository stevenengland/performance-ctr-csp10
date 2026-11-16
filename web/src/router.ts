import {
  createRouter,
  type RouteLocationNormalized,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router';
import { messages } from './core/messages';
// Part of the entry chunk: it is the first screen of every browser without a session.
import AnmeldenPage from './features/anmelden/AnmeldenPage.vue';
import { resolveSession, returnPath, SIGN_IN_PATH } from './core/session';

export type Destination = 'zaehlen' | 'rangliste' | 'spiele' | 'verwalten';

declare module 'vue-router' {
  interface RouteMeta {
    /** Screen name in the top app bar. */
    title: string;
    /** Context line under the title. */
    context?: string;
    /** The navigation destination the screen belongs to; screens without one show a back button. */
    destination?: Destination;
    /** A screen below its destination (shows a back button, keeps the destination active). */
    child?: boolean;
    /** Step of the add flow, for the step indicator. */
    step?: number;
    /** Steps of a flow with a fixed number of them (games); the add flow's depend on the factors. */
    steps?: number;
    /** Open without a session, outside the shell (no top bar, no navigation). */
    public?: boolean;
    /** Only for admins. */
    admin?: boolean;
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/zaehlen' },
  {
    path: SIGN_IN_PATH,
    component: AnmeldenPage,
    meta: { title: messages.anmelden.title, public: true },
  },
  {
    path: '/zaehlen',
    component: () => import('./features/zaehlen/PersonStep.vue'),
    meta: {
      title: messages.navigation.zaehlen,
      destination: 'zaehlen',
      step: 1,
    },
  },
  {
    path: '/zaehlen/:personId(\\d+)',
    component: () => import('./features/zaehlen/DrinkStep.vue'),
    props: true,
    meta: {
      title: messages.navigation.zaehlen,
      destination: 'zaehlen',
      child: true,
      step: 2,
    },
  },
  {
    path: '/zaehlen/:personId(\\d+)/:drinkId(\\d+)',
    component: () => import('./features/zaehlen/QuantityStep.vue'),
    props: true,
    meta: {
      title: messages.navigation.zaehlen,
      destination: 'zaehlen',
      child: true,
      step: 3,
    },
  },
  {
    // `:quantity` is the number of new drinks, 1–99; anything else is no step.
    path: '/zaehlen/:personId(\\d+)/:drinkId(\\d+)/:quantity([1-9]\\d?)',
    component: () => import('./features/zaehlen/FactorStep.vue'),
    props: true,
    meta: {
      title: messages.navigation.zaehlen,
      destination: 'zaehlen',
      child: true,
      step: 4,
    },
  },
  {
    path: '/rangliste',
    component: () => import('./features/rangliste/RanglistePage.vue'),
    meta: {
      title: messages.navigation.rangliste,
      context: messages.topBar.today,
      destination: 'rangliste',
    },
  },
  {
    path: '/verlauf/:personId(\\d+)',
    component: () => import('./features/verlauf/VerlaufPage.vue'),
    props: true,
    meta: {
      title: messages.verlauf.title,
      context: messages.topBar.today,
      destination: 'rangliste',
      child: true,
    },
  },
  {
    path: '/spiele',
    component: () => import('./features/spiele/SpielePage.vue'),
    meta: { title: messages.navigation.spiele, destination: 'spiele' },
  },
  {
    path: '/spiele/:gameId(\\d+)',
    component: () => import('./features/spiele/SpielPage.vue'),
    props: true,
    meta: { title: messages.spiele.title, destination: 'spiele', child: true },
  },
  {
    path: '/spiele/:gameId(\\d+)/verlauf',
    component: () => import('./features/spiele/SpielVerlaufPage.vue'),
    props: true,
    meta: {
      title: messages.spiele.history,
      destination: 'spiele',
      child: true,
    },
  },
  {
    path: '/spiele/:gameId(\\d+)/partie',
    component: () => import('./features/spiele/PlayerStep.vue'),
    props: true,
    meta: {
      title: messages.spiele.title,
      destination: 'spiele',
      child: true,
      step: 1,
      steps: 3,
    },
  },
  {
    path: '/spiele/:gameId(\\d+)/partie/:firstId(\\d+)',
    component: () => import('./features/spiele/PlayerStep.vue'),
    props: true,
    meta: {
      title: messages.spiele.title,
      destination: 'spiele',
      child: true,
      step: 2,
      steps: 3,
    },
  },
  {
    path: '/spiele/:gameId(\\d+)/partie/:firstId(\\d+)/:secondId(\\d+)',
    component: () => import('./features/spiele/OutcomeStep.vue'),
    props: true,
    meta: {
      title: messages.spiele.title,
      destination: 'spiele',
      child: true,
      step: 3,
      steps: 3,
    },
  },
  {
    path: '/spiele/:gameId(\\d+)/ergebnis',
    component: () => import('./features/spiele/PlayerStep.vue'),
    props: true,
    meta: {
      title: messages.spiele.title,
      destination: 'spiele',
      child: true,
      step: 1,
      steps: 2,
    },
  },
  {
    path: '/spiele/:gameId(\\d+)/ergebnis/:personId(\\d+)',
    component: () => import('./features/spiele/PointsStep.vue'),
    props: true,
    meta: {
      title: messages.spiele.title,
      destination: 'spiele',
      child: true,
      step: 2,
      steps: 2,
    },
  },
  {
    path: '/verwalten',
    component: () => import('./features/verwalten/VerwaltenPage.vue'),
    meta: { title: messages.navigation.verwalten, destination: 'verwalten' },
  },
  {
    path: '/verwalten/personen',
    component: () => import('./features/verwalten/personen/PersonenPage.vue'),
    meta: {
      title: messages.personen.title,
      destination: 'verwalten',
      child: true,
    },
  },
  {
    path: '/verwalten/getraenke',
    component: () => import('./features/verwalten/getraenke/GetraenkePage.vue'),
    meta: {
      title: messages.getraenke.title,
      destination: 'verwalten',
      child: true,
    },
  },
  {
    path: '/verwalten/faktoren',
    component: () => import('./features/verwalten/faktoren/FaktorenPage.vue'),
    meta: {
      title: messages.faktoren.title,
      destination: 'verwalten',
      child: true,
    },
  },
  {
    path: '/verwalten/spiele',
    component: () =>
      import('./features/verwalten/spiele/SpieleVerwaltenPage.vue'),
    meta: {
      title: messages.spiele.title,
      destination: 'verwalten',
      child: true,
    },
  },
  {
    path: '/verwalten/konten',
    component: () => import('./features/verwalten/konten/KontenPage.vue'),
    meta: {
      title: messages.konten.title,
      destination: 'verwalten',
      child: true,
      admin: true,
    },
  },
  {
    path: '/konto',
    component: () => import('./features/mein-konto/KontoPage.vue'),
    meta: { title: messages.konto.title },
  },
  { path: '/:pathMatch(.*)*', redirect: '/zaehlen' },
];

/**
Every screen but Anmelden needs a session: a signed-out user goes to Anmelden and
comes back afterwards. While the server cannot be reached the app opens anyway
(the installed app works offline); its requests then fail on their own.
*/
async function requireSession(to: RouteLocationNormalized) {
  const account = await resolveSession();
  if (to.meta.public) {
    return account ? returnPath(to.query.weiter) : true;
  }
  if (account === null) {
    return { path: SIGN_IN_PATH, query: { weiter: to.fullPath } };
  }
  if (to.meta.admin && account && !account.isAdmin) return '/verwalten';
  return true;
}

export function createAppRouter(history: RouterHistory) {
  const router = createRouter({ history, routes });
  router.beforeEach(requireSession);
  return router;
}
