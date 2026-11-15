<script setup lang="ts">
import { messages } from '../../core/messages';
</script>

<template>
  <section class="empty-state">
    <p class="type-body">{{ messages.rangliste.noDrinks }}</p>
    <v-btn
      to="/zaehlen"
      variant="flat"
      color="primary"
      rounded="lg"
      class="type-row-title"
    >
      {{ messages.rangliste.count }}
    </v-btn>
  </section>
</template>
