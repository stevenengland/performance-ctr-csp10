<script setup lang="ts">
import { mdiMagnifyMinusOutline, mdiMagnifyPlusOutline } from '@mdi/js';
import { onMounted, ref, watch } from 'vue';
import { messages } from '../../../core/messages';
import {
  clampFraming,
  drawFramed,
  type Framing,
  MAX_ZOOM,
} from '../../../core/person-photo';

/**
Framing a chosen photo (§7i): drag to move, pinch, wheel or the slider to zoom,
inside a round frame — what is inside the circle becomes the avatar. Arrow keys
move and `+`/`-` zoom, so it works without a pointer (§10). Drawn on a canvas, so
the CSP needs no blob: or data: images.
*/
const props = defineProps<{ picture: ImageBitmap; name: string }>();
const framing = defineModel<Framing>({ required: true });

/** Edge of the frame in CSS pixels. */
const EDGE = 232;
const KEY_STEP = 0.03;
const ZOOM_STEP = 0.15;

const canvas = ref<HTMLCanvasElement>();

function set(next: Framing) {
  framing.value = clampFraming(props.picture.width, props.picture.height, next);
}

function draw() {
  const element = canvas.value;
  const context = element?.getContext('2d');
  if (!element || !context) return;
  const ratio = window.devicePixelRatio || 1;
  const pixels = Math.round(EDGE * ratio);
  if (element.width !== pixels) {
    element.width = pixels;
    element.height = pixels;
  }
  drawFramed(context, props.picture, framing.value, pixels);
}

onMounted(draw);
watch([framing, () => props.picture], draw);

/** Active pointers, for drag (one) and pinch (two). */
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart: { distance: number; zoom: number } | undefined;

function distance(): number {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function down(event: PointerEvent) {
  canvas.value?.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    pinchStart = { distance: distance(), zoom: framing.value.zoom };
  }
}

function move(event: PointerEvent) {
  const last = pointers.get(event.pointerId);
  if (!last) return;
  const current = { x: event.clientX, y: event.clientY };
  pointers.set(event.pointerId, current);
  if (pointers.size === 2 && pinchStart && pinchStart.distance > 0) {
    set({
      ...framing.value,
      zoom: (pinchStart.zoom * distance()) / pinchStart.distance,
    });
    return;
  }
  if (pointers.size === 1) {
    set({
      ...framing.value,
      x: framing.value.x + (current.x - last.x) / EDGE,
      y: framing.value.y + (current.y - last.y) / EDGE,
    });
  }
}

function up(event: PointerEvent) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinchStart = undefined;
}

function wheel(event: WheelEvent) {
  set({
    ...framing.value,
    zoom: framing.value.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08),
  });
}

function key(event: KeyboardEvent) {
  const { x, y, zoom } = framing.value;
  const moves: Record<string, Partial<Framing>> = {
    ArrowLeft: { x: x - KEY_STEP },
    ArrowRight: { x: x + KEY_STEP },
    ArrowUp: { y: y - KEY_STEP },
    ArrowDown: { y: y + KEY_STEP },
    '+': { zoom: zoom + ZOOM_STEP },
    '=': { zoom: zoom + ZOOM_STEP },
    '-': { zoom: zoom - ZOOM_STEP },
  };
  const change = moves[event.key];
  if (!change) return;
  event.preventDefault();
  set({ ...framing.value, ...change });
}
</script>

<template>
  <div class="photo-crop">
    <div
      class="photo-crop__frame"
      :style="{ width: `${EDGE}px`, height: `${EDGE}px` }"
    >
      <canvas
        ref="canvas"
        class="photo-crop__canvas"
        tabindex="0"
        role="img"
        :aria-label="messages.personen.cropLabel(name)"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        @wheel.prevent="wheel"
        @keydown="key"
      />
      <span class="photo-crop__mask" aria-hidden="true" />
    </div>
    <p class="type-support photo-crop__hint">
      {{ messages.personen.cropHint }}
    </p>
    <v-slider
      :model-value="framing.zoom"
      :min="1"
      :max="MAX_ZOOM"
      :step="0.01"
      :prepend-icon="mdiMagnifyMinusOutline"
      :append-icon="mdiMagnifyPlusOutline"
      :aria-label="messages.personen.zoom"
      color="primary"
      hide-details
      class="photo-crop__zoom"
      @update:model-value="(zoom: number) => set({ ...framing, zoom })"
    />
  </div>
</template>

<style scoped>
.photo-crop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.photo-crop__frame {
  position: relative;
  overflow: hidden;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
}

.photo-crop__canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

.photo-crop__canvas:active {
  cursor: grabbing;
}

.photo-crop__canvas:focus-visible {
  outline: 3px solid rgb(var(--v-theme-primary));
  outline-offset: -3px;
}

/* Everything outside the circle is dimmed: what is inside becomes the avatar. */
.photo-crop__mask {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 200px rgba(var(--v-theme-scrim), 0.5);
  outline: 2px solid rgb(255 255 255 / 0.85);
  pointer-events: none;
}

.photo-crop__hint {
  color: rgb(var(--v-theme-on-surface-variant));
}

.photo-crop__zoom {
  width: 100%;
}
</style>
