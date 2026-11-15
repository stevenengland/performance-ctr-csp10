<script setup lang="ts">
import { mdiAccountCircleOutline, mdiArrowLeft } from '@mdi/js';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { messages } from '../core/messages';
import { useTopBarContent } from '../core/top-bar';

/** Steps of the add flow; the factor step (4) is skipped while no factors exist (§6.1). */
const STEPS = 3;

const route = useRoute();
const router = useRouter();
const meta = computed(() => route.meta);
const content = useTopBarContent();
const title = computed(() => content.value?.title ?? meta.value.title);
const context = computed(() => content.value?.context ?? meta.value.context);
const hasBack = computed(
  () => route.meta.destination === undefined || route.meta.child === true,
);

function back() {
  if (window.history.length > 1) router.back();
  else void router.push(`/${route.meta.destination ?? 'zaehlen'}`);
}
</script>

<template>
  <header class="top-bar">
    <div class="top-bar__row">
      <v-btn
        v-if="hasBack"
        :icon="mdiArrowLeft"
        :aria-label="messages.topBar.back"
        variant="text"
        class="top-bar__icon"
        @click="back"
      />
      <div class="top-bar__heading">
        <h1 class="type-title">{{ title }}</h1>
        <p v-if="context" class="type-label top-bar__context">
          {{ context }}
        </p>
      </div>
      <p v-if="content?.score !== undefined" class="top-bar__score">
        <span class="type-title">{{ content.score }}</span>
        <span class="type-caption top-bar__score-caption">{{
          messages.zaehlen.scoreToday
        }}</span>
      </p>
      <p v-if="content?.stale" class="type-caption top-bar__stale">
        {{ content.stale }}
      </p>
      <v-btn
        :icon="mdiAccountCircleOutline"
        :aria-label="messages.topBar.account"
        to="/konto"
        :active="false"
        variant="text"
        class="top-bar__icon"
      />
    </div>
    <div
      v-if="meta.step"
      class="top-bar__steps"
      role="progressbar"
      :aria-valuemin="1"
      :aria-valuemax="STEPS"
      :aria-valuenow="meta.step"
      :aria-label="`Schritt ${meta.step} von ${STEPS}`"
    >
      <span
        v-for="step in STEPS"
        :key="step"
        class="top-bar__step"
        :class="{ 'top-bar__step--done': step <= meta.step }"
      />
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  width: 100%;
  max-width: 840px;
  margin: 0 auto;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.top-bar__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 64px;
  padding: 12px var(--app-margin) 8px;
}

.top-bar__heading {
  flex: 1;
  min-width: 0;
}

.top-bar__heading h1 {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-bar__context {
  margin-top: 4px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.top-bar__icon {
  flex: none;
}

.top-bar__score {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: flex-end;
  font-variant-numeric: tabular-nums;
}

.top-bar__score-caption {
  color: rgb(var(--v-theme-on-surface-variant));
}

.top-bar__stale {
  flex: none;
  color: rgb(var(--v-theme-error));
}

.top-bar__steps {
  display: flex;
  gap: 6px;
  padding: 0 var(--app-margin) 4px;
}

.top-bar__step {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgb(var(--v-theme-outline-variant));
}

.top-bar__step--done {
  background: rgb(var(--v-theme-primary));
}
</style>
