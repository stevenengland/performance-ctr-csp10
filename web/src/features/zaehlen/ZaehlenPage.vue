<script setup lang="ts">
import { messages } from '../../core/messages';
</script>

<template>
  <section>
    <h2 class="type-question page-question">{{ messages.zaehlen.question }}</h2>
    <p class="type-body empty-state">{{ messages.zaehlen.noPersons }}</p>
  </section>
</template>
