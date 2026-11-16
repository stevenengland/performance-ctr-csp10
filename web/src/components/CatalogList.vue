<script setup lang="ts" generic="T extends { id: number; name: string }">
import { mdiDeleteOutline, mdiPencilOutline } from '@mdi/js';
import { messages } from '../core/messages';

/**
A master-data list (design spec §7i): skeleton rows while `items` is undefined,
the empty sentence for none, and otherwise a row per item with its name, an
optional supporting line and trailing edit and delete icon buttons. With `link`,
the name opens the item's own screen (a person's Verlauf). The `leading` slot puts
something of each item before its name (a person's avatar); the list itself stays
generic.
*/
defineProps<{
  items: readonly T[] | undefined;
  label: string;
  empty: string;
  support?: (item: T) => string;
  link?: (item: T) => { to: string; label: string };
}>();
const emit = defineEmits<{ edit: [item: T]; remove: [item: T] }>();
const slots = defineSlots<{ leading?(props: { item: T }): unknown }>();

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
      <RouterLink
        v-if="link"
        :to="link(item).to"
        :aria-label="link(item).label"
        class="list__main list__link"
        :class="{ 'list__main--leading': slots.leading }"
      >
        <slot name="leading" :item="item" />
        <span class="type-row-title list__title">{{ item.name }}</span>
      </RouterLink>
      <span
        v-else
        class="list__main"
        :class="{ 'list__main--leading': slots.leading }"
      >
        <slot name="leading" :item="item" />
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
