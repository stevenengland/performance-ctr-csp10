import { registerSW } from 'virtual:pwa-register';
import { createWebHistory } from 'vue-router';
import { startApp } from './app';
import { offerUpdates } from './pwa/update-prompt';

startApp(createWebHistory(import.meta.env.BASE_URL));
offerUpdates(registerSW);
