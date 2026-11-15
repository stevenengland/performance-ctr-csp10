import {
  createRouter,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router';
import { messages } from './core/messages';

export type Destination = 'zaehlen' | 'rangliste' | 'verwalten';

declare module 'vue-router' {
  interface RouteMeta {
    /** Screen name in the top app bar. */
    title: string;
    /** Context line under the title. */
    context?: string;
    /** The navigation destination the screen belongs to; screens without one show a back button. */
    destination?: Destination;
    /** Step of the add flow, for the step indicator. */
    step?: number;
  }
}

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/zaehlen' },
  {
    path: '/zaehlen',
    component: () => import('./features/zaehlen/ZaehlenPage.vue'),
    meta: { title: messages.navigation.zaehlen, destination: 'zaehlen', step: 1 },
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
    path: '/verwalten',
    component: () => import('./features/verwalten/VerwaltenPage.vue'),
    meta: { title: messages.navigation.verwalten, destination: 'verwalten' },
  },
  {
    path: '/konto',
    component: () => import('./features/mein-konto/KontoPage.vue'),
    meta: { title: messages.konto.title },
  },
  { path: '/:pathMatch(.*)*', redirect: '/zaehlen' },
];

export function createAppRouter(history: RouterHistory) {
  return createRouter({ history, routes });
}
