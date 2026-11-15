<script setup lang="ts" generic="T extends { id: number; name: string }">
import { mdiDeleteOutline, mdiPencilOutline } from '@mdi/js';
import { messages } from '../core/messages';

/**
A master-data list (design spec §7i): skeleton rows while `items` is undefined,
the empty sentence for none, and otherwise a row per item with its name, an
optional supporting line and trailing edit and delete icon buttons.
*/
defineProps<{
  items: readonly T[] | undefined;
  label: string;
  empty: string;
  support?: (item: T) => string;
}>();
const emit = defineEmits<{ edit: [item: T]; remove: [item: T] }>();

/** Skeleton rows while the list loads (§6.10). */
const SKELETON_ROWS = 3;
</script>

<template>
  <ul v-if="items === undefined" class="list" aria-busy="true">
    <li v-for="row in SKELETON_ROWS" :key="row" class="list__row">
      <span class="skeleton" />
    </li>
  </ul>
  <p v-else-if="items.length === 0" class="type-body empty-state">
    {{ empty }}
  </p>
  <ul v-else class="list" :aria-label="label">
    <li v-for="item in items" :key="item.id" class="list__row">
      <span class="list__main">
        <span class="type-row-title list__title">{{ item.name }}</span>
        <span v-if="support" class="type-support list__support">{{
          support(item)
        }}</span>
      </span>
      <v-btn
        :icon="mdiPencilOutline"
        :aria-label="messages.row.edit(item.name)"
        variant="text"
        @click="emit('edit', item)"
      />
      <v-btn
        :icon="mdiDeleteOutline"
        :aria-label="messages.row.remove(item.name)"
        variant="text"
        @click="emit('remove', item)"
      />
    </li>
  </ul>
</template>
