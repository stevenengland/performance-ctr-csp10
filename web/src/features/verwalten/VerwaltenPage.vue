<script setup lang="ts">
import { mdiChevronRight } from '@mdi/js';
import { messages } from '../../core/messages';
import { useSession } from '../../core/session';

const sections = [
  messages.verwalten.persons,
  messages.verwalten.drinks,
  messages.verwalten.factors,
];
const account = useSession();
</script>

<template>
  <ul class="list">
    <li
      v-for="section in sections"
      :key="section"
      class="list__row type-row-title"
    >
      {{ section }}
    </li>
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
