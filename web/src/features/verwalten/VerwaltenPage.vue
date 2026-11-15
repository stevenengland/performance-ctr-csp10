<script setup lang="ts">
import { mdiChevronRight } from '@mdi/js';
import { messages } from '../../core/messages';
import { useSession } from '../../core/session';

const sections = [
  { label: messages.verwalten.persons, to: '/verwalten/personen' },
  { label: messages.verwalten.drinks, to: '/verwalten/getraenke' },
];
const account = useSession();
</script>

<template>
  <ul class="list">
    <li v-for="section in sections" :key="section.to">
      <RouterLink :to="section.to" class="list__row list__link type-row-title">
        <span class="list__main">{{ section.label }}</span>
        <v-icon :icon="mdiChevronRight" size="24" />
      </RouterLink>
    </li>
    <li class="list__row type-row-title">{{ messages.verwalten.factors }}</li>
    <li v-if="account?.isAdmin">
      <RouterLink
        to="/verwalten/konten"
        class="list__row list__link type-row-title"
      >
        <span class="list__main">{{ messages.verwalten.accounts }}</span>
        <v-icon :icon="mdiChevronRight" size="24" />
      </RouterLink>
    </li>
  </ul>
</template>
