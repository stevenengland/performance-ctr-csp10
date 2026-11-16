<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { initialsOf } from '../core/person-photo';

/**
A person's round avatar (a beer mat seen from above): the photo when there is one,
otherwise the initials on `secondary-container`, the same size either way so rows
and tiles line up. Decorative: the name next to it carries the meaning (§10), so it
adds nothing to accessible names. A photo that fails to load falls back to the
initials.
*/
const props = withDefaults(
  defineProps<{ name: string; photoUrl: string | null; size?: number }>(),
  { size: 40 },
);

const failed = ref(false);
watch(
  () => props.photoUrl,
  () => (failed.value = false),
);
const showPhoto = computed(() => props.photoUrl !== null && !failed.value);
const initials = computed(() => initialsOf(props.name));
</script>

<template>
  <span
    class="person-avatar"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.round(size * 0.42)}px`,
    }"
    aria-hidden="true"
  >
    <img
      v-if="showPhoto"
      :src="photoUrl ?? undefined"
      alt=""
      decoding="async"
      class="person-avatar__photo"
      @error="failed = true"
    />
    <span v-else class="person-avatar__initials" :data-initials="initials" />
  </span>
</template>

<style scoped>
.person-avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 50%;
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

.person-avatar__photo {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Drawn from an attribute, so the initials never join the row's text (§10). */
.person-avatar__initials::before {
  content: attr(data-initials);
}

.person-avatar__initials {
  font-family: var(--font-display);
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
</style>
