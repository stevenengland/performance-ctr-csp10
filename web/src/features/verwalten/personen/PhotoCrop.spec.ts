import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CENTRED, type Framing, placement } from '../../../core/person-photo';
import { createAppVuetify } from '../../../theme';
import PhotoCrop from './PhotoCrop.vue';

/** Edge of the crop frame in CSS pixels (§7i). */
const FRAME = 232;

/** A stand-in for a decoded 400 × 200 picture; jsdom has no `ImageBitmap`. */
const picture = { width: 400, height: 200, close: vi.fn() };

/** jsdom draws nothing: a 2D context that records where the picture lands. */
function stubCanvas() {
  const drawn: unknown[][] = [];
  const context = {
    fillStyle: '',
    imageSmoothingQuality: 'low',
    fillRect: vi.fn(),
    drawImage: vi.fn((...args: unknown[]) => drawn.push(args)),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  return drawn;
}

function crop(props: { framing?: Framing; disabled?: boolean } = {}) {
  const wrapper: VueWrapper = mount(PhotoCrop, {
    props: {
      picture: picture as unknown as ImageBitmap,
      modelValue: props.framing ?? CENTRED,
      disabled: props.disabled ?? false,
      'onUpdate:modelValue': (framing: Framing) =>
        wrapper.setProps({ modelValue: framing }),
    },
    global: { plugins: [createAppVuetify()] },
    attachTo: document.body,
  });
  return wrapper;
}

const canvasOf = (wrapper: VueWrapper) => wrapper.get('canvas');
const framingOf = (wrapper: VueWrapper) =>
  (wrapper.props() as { modelValue: Framing }).modelValue;

async function press(wrapper: VueWrapper, ...keys: string[]) {
  for (const key of keys) await canvasOf(wrapper).trigger('keydown', { key });
}

function pointer(
  wrapper: VueWrapper,
  type: string,
  pointerId: number,
  clientX: number,
  clientY = 0,
) {
  canvasOf(wrapper).element.dispatchEvent(
    new PointerEvent(type, { pointerId, clientX, clientY, bubbles: true }),
  );
}

describe('PhotoCrop', () => {
  let wrapper: VueWrapper | undefined;
  let drawn: unknown[][];

  beforeEach(() => {
    drawn = stubCanvas();
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is a focusable canvas, named, and described by its hint and its keys', () => {
    wrapper = crop();

    const canvas = canvasOf(wrapper).element;
    expect(canvas.tabIndex).toBe(0);
    // An application, so a screen reader passes the arrow keys on instead of reading on.
    expect(canvas.getAttribute('role')).toBe('application');
    expect(canvas.getAttribute('aria-roledescription')).toBe('Fotoausschnitt');
    expect(canvas.getAttribute('aria-label')).toBe('Ausschnitt des Fotos');
    const description = (canvas.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent.trim());
    expect(description).toEqual([
      'Ziehen zum Verschieben · zoomen mit zwei Fingern oder dem Regler',
      'Pfeiltasten verschieben, Plus und Minus zoomen.',
    ]);
  });

  it('follows the canvas with the zoom slider, named Zoom, whose value says the zoom', async () => {
    wrapper = crop();

    await press(wrapper, '+');

    const slider = wrapper.get('[role="slider"]');
    expect(slider.attributes('aria-label')).toBe('Zoom');
    expect(slider.attributes('aria-valuetext')).toBe('×1,15');
    const order = [...wrapper.element.querySelectorAll('[tabindex="0"]')];
    expect(order).toEqual([canvasOf(wrapper).element, slider.element]);
  });

  it('draws the framed picture at the device’s pixel ratio', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const framing = { zoom: 1.5, x: 0.1, y: 0 };

    wrapper = crop({ framing });

    const canvas = canvasOf(wrapper).element;
    expect([canvas.width, canvas.height]).toEqual([2 * FRAME, 2 * FRAME]);
    const at = placement(400, 200, framing, 2 * FRAME);
    expect(drawn.at(-1)).toEqual([
      picture,
      at.left,
      at.top,
      at.width,
      at.height,
    ]);
  });

  it('moves with the arrow keys and zooms with plus and minus', async () => {
    wrapper = crop({ framing: { zoom: 2, x: 0, y: 0 } });

    await press(wrapper, 'ArrowLeft', 'ArrowUp');
    expect(framingOf(wrapper).x).toBeCloseTo(-0.03);
    expect(framingOf(wrapper).y).toBeCloseTo(-0.03);

    await press(wrapper, 'ArrowRight', 'ArrowRight', 'ArrowDown');
    expect(framingOf(wrapper).x).toBeCloseTo(0.03);
    expect(framingOf(wrapper).y).toBeCloseTo(0);

    await press(wrapper, '+');
    expect(framingOf(wrapper).zoom).toBeCloseTo(2.15);
    await press(wrapper, '-', '-');
    expect(framingOf(wrapper).zoom).toBeCloseTo(1.85);
  });

  it('redraws when the framing changes', async () => {
    wrapper = crop();
    const before = drawn.length;

    await press(wrapper, 'ArrowRight');

    const at = placement(400, 200, framingOf(wrapper), FRAME);
    expect(drawn.length).toBeGreaterThan(before);
    expect(drawn.at(-1)).toEqual([
      picture,
      at.left,
      at.top,
      at.width,
      at.height,
    ]);
  });

  it('never moves or zooms out so far that the frame shows an edge', async () => {
    wrapper = crop();

    await press(wrapper, ...Array<string>(40).fill('ArrowRight'), 'ArrowUp');
    await press(wrapper, '-');

    expect(framingOf(wrapper)).toEqual({ zoom: 1, x: 0.5, y: 0 });
  });

  it('moves with a dragging pointer, in fractions of the frame', async () => {
    wrapper = crop();

    pointer(wrapper, 'pointerdown', 1, 100, 50);
    pointer(wrapper, 'pointermove', 1, 100 + FRAME / 4, 50);
    pointer(wrapper, 'pointerup', 1, 100 + FRAME / 4, 50);
    pointer(wrapper, 'pointermove', 1, 300, 50);
    await wrapper.vm.$nextTick();

    expect(framingOf(wrapper)).toEqual({ zoom: 1, x: 0.25, y: 0 });
  });

  it('zooms with a two-finger pinch', async () => {
    wrapper = crop();

    pointer(wrapper, 'pointerdown', 1, 100);
    pointer(wrapper, 'pointerdown', 2, 140);
    pointer(wrapper, 'pointermove', 2, 180);
    await wrapper.vm.$nextTick();

    expect(framingOf(wrapper).zoom).toBeCloseTo(2);
  });

  it('zooms in and out with the wheel', async () => {
    wrapper = crop();

    await canvasOf(wrapper).trigger('wheel', { deltaY: -100 });
    expect(framingOf(wrapper).zoom).toBeCloseTo(1.08);
    await canvasOf(wrapper).trigger('wheel', { deltaY: 100 });
    expect(framingOf(wrapper).zoom).toBeCloseTo(1);
  });

  it('zooms with the slider', async () => {
    wrapper = crop({ framing: { zoom: 1, x: 0.5, y: 0 } });

    wrapper.findComponent({ name: 'VSlider' }).vm.$emit('update:modelValue', 3);
    await wrapper.vm.$nextTick();

    expect(framingOf(wrapper)).toEqual({ zoom: 3, x: 0.5, y: 0 });
  });

  it('is frozen while disabled: no key, pointer, wheel or slider changes the framing', async () => {
    wrapper = crop({ disabled: true });

    await press(wrapper, 'ArrowRight', '+');
    pointer(wrapper, 'pointerdown', 1, 0);
    pointer(wrapper, 'pointermove', 1, 100);
    await canvasOf(wrapper).trigger('wheel', { deltaY: -100 });
    wrapper.findComponent({ name: 'VSlider' }).vm.$emit('update:modelValue', 3);
    await wrapper.vm.$nextTick();

    expect(framingOf(wrapper)).toEqual(CENTRED);
    expect(canvasOf(wrapper).attributes('aria-disabled')).toBe('true');
    expect(wrapper.get('[role="slider"]').attributes('tabindex')).toBe('-1');
  });
});
