<script setup lang="ts">
import {
  mdiCardsPlayingOutline,
  mdiCogOutline,
  mdiGlassMugVariant,
  mdiPodium,
} from '@mdi/js';
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { messages } from '../core/messages';
import type { Destination } from '../router';

defineProps<{ variant: 'bar' | 'rail' }>();

const destinations: { name: Destination; to: string; icon: string }[] = [
  { name: 'zaehlen', to: '/zaehlen', icon: mdiGlassMugVariant },
  { name: 'rangliste', to: '/rangliste', icon: mdiPodium },
  { name: 'spiele', to: '/spiele', icon: mdiCardsPlayingOutline },
  { name: 'verwalten', to: '/verwalten', icon: mdiCogOutline },
];

const route = useRoute();
const active = computed(() => route.meta.destination);
</script>

<template>
  <nav
    class="navigation"
    :class="`navigation--${variant}`"
    :aria-label="messages.navigation.label"
  >
    <RouterLink
      v-for="destination in destinations"
      :key="destination.name"
      :to="destination.to"
      class="navigation__item"
      :class="{ 'navigation__item--active': active === destination.name }"
      :aria-current="active === destination.name ? 'page' : undefined"
    >
      <span class="navigation__pill">
        <v-icon :icon="destination.icon" size="24" />
      </span>
      <span class="type-caption">{{
        messages.navigation[destination.name]
      }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.navigation {
  display: flex;
  background: rgb(var(--v-theme-surface-container));
}

.navigation--bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 8px 8px calc(12px + env(safe-area-inset-bottom));
}

.navigation--rail {
  position: sticky;
  top: 0;
  flex-direction: column;
  gap: 12px;
  align-self: flex-start;
  width: 88px;
  height: 100dvh;
  padding: 24px 0;
}

.navigation__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  min-height: 48px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-decoration: none;
  border-radius: 16px;
}

.navigation__item:focus-visible {
  outline: 3px solid rgb(var(--v-theme-tertiary));
  outline-offset: 2px;
}

.navigation__item--active {
  color: rgb(var(--v-theme-on-surface));
}

.navigation__pill {
  display: grid;
  place-items: center;
  width: 64px;
  height: 32px;
  border-radius: 16px;
}

.navigation__item--active .navigation__pill {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}
</style>
