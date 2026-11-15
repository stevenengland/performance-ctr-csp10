<script setup lang="ts">
import { messages } from '../../core/messages';

const sections = [messages.verwalten.persons, messages.verwalten.drinks, messages.verwalten.factors];
</script>

<template>
  <ul class="hub">
    <li v-for="section in sections" :key="section" class="hub__row type-row-title">
      {{ section }}
    </li>
  </ul>
</template>

<style scoped>
.hub {
  padding: 0;
  list-style: none;
}

.hub__row {
  display: flex;
  align-items: center;
  min-height: 56px;
  padding: 12px 4px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}
</style>
