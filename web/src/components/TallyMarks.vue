<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    count: number;
    height?: number;
    /** Strokes from this count on are drawn as new (`tertiary`), the ones before as booked. */
    newFrom?: number;
  }>(),
  { height: 18, newFrom: undefined },
);

/** Above this the numeral stands alone. */
const MAX_STROKES = 25;
const GAP = 6;
const INSET = 2.5;

interface Stroke {
  kind: 'upright' | 'diagonal';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A small lean derived from the stroke's index: hand-drawn, yet the same on every render. */
function lean(index: number): number {
  return (((index * 37) % 5) - 2) * 0.5;
}

const strokes = computed<Stroke[]>(() => {
  const whole = Math.floor(props.count);
  if (whole <= 0 || whole > MAX_STROKES) return [];
  const h = props.height;
  const list: Stroke[] = [];
  let x = 2;
  for (let index = 0; index < whole; index += 1) {
    if (index % 5 < 4) {
      const tilt = lean(index);
      list.push({
        kind: 'upright',
        x1: x + tilt,
        y1: INSET,
        x2: x - tilt,
        y2: h - INSET,
      });
    } else {
      list.push({ kind: 'diagonal', x1: x - 27, y1: h - 5, x2: x - 3, y2: 5 });
    }
    x += GAP;
  }
  return list;
});

const width = computed(() => strokes.value.length * GAP + 2);
</script>

<template>
  <svg
    v-if="strokes.length > 0"
    class="tally-marks"
    :viewBox="`0 0 ${width} ${height}`"
    :width="width"
    :height="height"
    aria-hidden="true"
    focusable="false"
  >
    <line
      v-for="(stroke, index) in strokes"
      :key="index"
      :data-stroke="stroke.kind"
      :class="{
        'tally-marks__new': newFrom !== undefined && index >= newFrom,
      }"
      :x1="stroke.x1"
      :y1="stroke.y1"
      :x2="stroke.x2"
      :y2="stroke.y2"
    />
  </svg>
</template>

<style scoped>
.tally-marks {
  display: block;
  color: inherit;
  stroke: currentcolor;
  stroke-width: 2.2;
  stroke-linecap: round;
  fill: none;
}

.tally-marks__new {
  stroke: rgb(var(--v-theme-tertiary));
}
</style>
