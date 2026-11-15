<script setup lang="ts">
import { computed } from 'vue';
import { formatNumber } from '../core/format';
import { messages } from '../core/messages';
import TallyMarks from './TallyMarks.vue';

/**
The quantity stepper (design spec §6.4, §7d): the count starts at what is booked
today; `+` adds a new drink, `−` takes a new one back but never a booked one, and at
most `max` drinks are new. The model is the number of new drinks.
*/
const added = defineModel<number>({ required: true });
const props = withDefaults(
  defineProps<{ booked: number; drink: string; max?: number }>(),
  { max: 99 },
);

const total = computed(() => props.booked + added.value);
</script>

<template>
  <div class="stepper">
    <div class="stepper__row">
      <button
        type="button"
        class="tile stepper__button"
        :aria-label="messages.zaehlen.less"
        :disabled="added <= 0"
        @click="added -= 1"
      >
        <span class="stepper__sign" aria-hidden="true">−</span>
      </button>
      <p class="stepper__count">
        <output class="stepper__total" aria-live="polite">{{
          formatNumber(total)
        }}</output>
        <span class="type-support stepper__caption">{{
          messages.zaehlen.drinkToday(drink)
        }}</span>
      </p>
      <button
        type="button"
        class="tile tile--pressed stepper__button"
        :aria-label="messages.zaehlen.more"
        :disabled="added >= max"
        @click="added += 1"
      >
        <span class="stepper__sign" aria-hidden="true">+</span>
      </button>
    </div>
    <div class="stepper__delta">
      <TallyMarks
        :count="total"
        :height="34"
        :new-from="Math.floor(booked)"
        class="stepper__tally"
      />
      <p class="type-label">
        {{ messages.zaehlen.delta(formatNumber(booked), added) }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.stepper__row {
  display: grid;
  grid-template-columns: 88px 1fr 88px;
  gap: 12px;
  align-items: center;
  margin-top: 8px;
}

.stepper__button {
  align-items: center;
  justify-content: center;
  height: 88px;
  min-height: 88px;
}

.stepper__sign {
  font-family: var(--font-display);
  font-size: 56px;
  font-weight: 900;
  line-height: 50px;
}

.stepper__count {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.stepper__total {
  font-family: var(--font-display);
  font-size: 128px;
  font-weight: 900;
  line-height: 115px;
  font-variant-numeric: tabular-nums;
}

.stepper__caption {
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
}

.stepper__delta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 28px 0 24px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.stepper .stepper__tally {
  color: rgb(var(--v-theme-on-surface));
}
</style>
