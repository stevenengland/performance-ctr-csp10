<script setup lang="ts">
import { mdiMagnifyMinusOutline, mdiMagnifyPlusOutline } from '@mdi/js';
import { onMounted, ref, useId, watch } from 'vue';
import { formatMultiplier } from '../../../core/format';
import { messages } from '../../../core/messages';
import {
  clampFraming,
  drawFramed,
  type Framing,
  MAX_ZOOM,
} from '../../../core/person-photo';

/**
Framing a chosen photo (§7i): what is inside the round mask becomes the avatar.
Drag with one pointer, pinch with two, the wheel or the slider to zoom; the arrow
keys move and `+`/`-` zoom, so it works without a pointer (§10). The canvas is
the preview, so the CSP needs no `blob:` or `data:` images. Every change keeps
the frame covered. `disabled` freezes it (while saving, or once encoded).
*/
const props = defineProps<{ picture: ImageBitmap; disabled: boolean }>();
const framing = defineModel<Framing>({ required: true });

/** Edge of the frame in CSS pixels. */
const EDGE = 232;
/** An arrow key moves the picture by this fraction of the frame's edge. */
const KEY_STEP = 0.03;
/** `+`/`-` change the zoom by this much. */
const KEY_ZOOM = 0.15;
const WHEEL_ZOOM = 1.08;

const id = useId();
const canvas = ref<HTMLCanvasElement>();

function set(next: Partial<Framing>) {
  if (props.disabled) return;
  framing.value = clampFraming(props.picture.width, props.picture.height, {
    ...framing.value,
    ...next,
  });
}

function draw() {
  const element = canvas.value;
  const context = element?.getContext('2d');
  if (!element || !context) return;
  const pixels = Math.round(EDGE * (window.devicePixelRatio || 1));
  element.width = pixels;
  element.height = pixels;
  drawFramed(context, props.picture, framing.value, pixels);
}

onMounted(draw);
watch([framing, () => props.picture], draw);

/** Active pointers: one drags, two pinch. */
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { distance: number; zoom: number } | undefined;

function spread(): number {
  const [a, b] = [...pointers.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}

function down(event: PointerEvent) {
  if (props.disabled) return;
  canvas.value?.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  pinch =
    pointers.size === 2
      ? { distance: spread(), zoom: framing.value.zoom }
      : undefined;
}

function move(event: PointerEvent) {
  const last = pointers.get(event.pointerId);
  if (!last) return;
  const current = { x: event.clientX, y: event.clientY };
  pointers.set(event.pointerId, current);
  if (pinch && pinch.distance > 0) {
    set({ zoom: (pinch.zoom * spread()) / pinch.distance });
  } else if (pointers.size === 1) {
    set({
      x: framing.value.x + (current.x - last.x) / EDGE,
      y: framing.value.y + (current.y - last.y) / EDGE,
    });
  }
}

function up(event: PointerEvent) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = undefined;
}

function wheel(event: WheelEvent) {
  const factor = event.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM;
  set({ zoom: framing.value.zoom * factor });
}

function key(event: KeyboardEvent) {
  const { x, y, zoom } = framing.value;
  const changes: Partial<Record<string, Partial<Framing>>> = {
    ArrowLeft: { x: x - KEY_STEP },
    ArrowRight: { x: x + KEY_STEP },
    ArrowUp: { y: y - KEY_STEP },
    ArrowDown: { y: y + KEY_STEP },
    '+': { zoom: zoom + KEY_ZOOM },
    '=': { zoom: zoom + KEY_ZOOM },
    '-': { zoom: zoom - KEY_ZOOM },
  };
  const change = changes[event.key];
  if (!change) return;
  event.preventDefault();
  set(change);
}
</script>

<template>
  <div class="photo-crop">
    <div class="photo-crop__frame" :style="{ width: `${EDGE}px` }">
      <canvas
        ref="canvas"
        class="photo-crop__canvas"
        role="img"
        :tabindex="disabled ? -1 : 0"
        :aria-label="messages.personen.crop"
        :aria-describedby="`${id}-hint ${id}-keys`"
        :aria-disabled="disabled"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        @wheel.prevent="wheel"
        @keydown="key"
      />
      <span class="photo-crop__mask" aria-hidden="true" />
    </div>
    <p :id="`${id}-hint`" class="type-support photo-crop__hint">
      {{ messages.personen.cropHint }}
    </p>
    <span :id="`${id}-keys`" hidden>{{ messages.personen.cropKeys }}</span>
    <v-slider
      :model-value="framing.zoom"
      :min="1"
      :max="MAX_ZOOM"
      :step="0.01"
      :name="messages.personen.zoom"
      :value-format="({ value }: { value: number }) => formatMultiplier(value)"
      :prepend-icon="mdiMagnifyMinusOutline"
      :append-icon="mdiMagnifyPlusOutline"
      :disabled="disabled"
      color="primary"
      hide-details
      class="photo-crop__zoom"
      @update:model-value="(zoom: number) => set({ zoom })"
    />
  </div>
</template>

<style scoped>
.photo-crop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.photo-crop__frame {
  position: relative;
  overflow: hidden;
  aspect-ratio: 1;
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

.photo-crop__canvas[aria-disabled='true'] {
  cursor: default;
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
  text-align: center;
}

.photo-crop__zoom {
  width: 100%;
}
</style>
