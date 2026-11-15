<script setup lang="ts">
import { computed } from 'vue';
import TallyMarks from './TallyMarks.vue';

/**
A counting tile (design spec §6.4), a real button. A person tile shows the name at
the top and, at the bottom, the supporting text left and the numeral right. A drink
tile shows name and numeral at the top, supporting text and tally at the bottom.
*/
const props = defineProps<{
  variant: 'person' | 'drink';
  name: string;
  /** The accessible name, with the tile's state (§10). */
  label: string;
  support: string;
  /** Formatted; omitted when there is nothing to count. */
  numeral?: string;
  /** Strokes to draw (drink tiles). */
  tally?: number;
}>();
const emit = defineEmits<{ click: [] }>();

/** Names that do not fit shrink one step (28 → 24 → 20) before they ellipsize (§3.2). */
const nameSize = computed(() => {
  const length = [...props.name].length;
  if (length > 11) return 'count-tile__name--small';
  if (length > 9) return 'count-tile__name--medium';
  return undefined;
});
</script>

<template>
  <button
    type="button"
    class="tile count-tile"
    :aria-label="label"
    @click="emit('click')"
  >
    <span class="count-tile__row">
      <span class="type-tile-name count-tile__name" :class="nameSize">{{
        name
      }}</span>
      <span v-if="variant === 'drink' && numeral" class="type-numeral">{{
        numeral
      }}</span>
    </span>
    <span class="count-tile__row">
      <span class="type-support count-tile__support">{{ support }}</span>
      <span v-if="variant === 'person' && numeral" class="type-numeral">{{
        numeral
      }}</span>
      <TallyMarks
        v-if="variant === 'drink' && tally !== undefined"
        :count="tally"
        :height="18"
        class="count-tile__tally"
      />
    </span>
  </button>
</template>

<style scoped>
.count-tile__row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.count-tile__name {
  overflow: hidden;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count-tile__name--medium {
  font-size: 24px;
  line-height: 28px;
}

.count-tile__name--small {
  font-size: 20px;
  line-height: 28px;
}

.count-tile__support {
  color: rgb(var(--v-theme-on-surface-variant));
}

.tile:active .count-tile__support,
.tile--pressed .count-tile__support {
  color: inherit;
}

.count-tile .count-tile__tally {
  flex: none;
  color: rgb(var(--v-theme-primary));
}

.tile:active .count-tile__tally {
  color: inherit;
}
</style>
