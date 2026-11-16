import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import PersonAvatar from './PersonAvatar.vue';

const PHOTO = '/api/persons/1/photo?v=abc';

function avatar(name: string, photoUrl: string | null, size?: number) {
  return mount(PersonAvatar, {
    props: { name, photoUrl, ...(size === undefined ? {} : { size }) },
  });
}

describe('PersonAvatar', () => {
  it('shows the photo as a decorative image', () => {
    const img = avatar('Anna', PHOTO).get('img');

    expect(img.attributes('src')).toBe(PHOTO);
    expect(img.attributes('alt')).toBe('');
  });

  it('shows the initials without a photo', () => {
    const wrapper = avatar('Anna Lena', null);

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-initials]').attributes('data-initials')).toBe(
      'AL',
    );
  });

  it('falls back to the initials when the photo fails to load', async () => {
    const wrapper = avatar('Daniel', PHOTO);

    await wrapper.get('img').trigger('error');

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-initials]').attributes('data-initials')).toBe(
      'D',
    );
  });

  it('tries a new photo again after an earlier one failed', async () => {
    const wrapper = avatar('Daniel', PHOTO);
    await wrapper.get('img').trigger('error');

    await wrapper.setProps({ photoUrl: '/api/persons/1/photo?v=def' });

    expect(wrapper.get('img').attributes('src')).toBe(
      '/api/persons/1/photo?v=def',
    );
  });

  it.each([
    ['a photo', PHOTO],
    ['initials', null],
  ])('adds no text to its parent and is hidden from assistive technology with %s', (_, photoUrl) => {
    const wrapper = avatar('Anna Lena', photoUrl);

    expect(wrapper.text()).toBe('');
    expect(wrapper.attributes('aria-hidden')).toBe('true');
  });

  it('is as large as asked, 40 px by default', () => {
    expect(avatar('Anna', null).attributes('style')).toContain('width: 40px');
    expect(avatar('Anna', PHOTO, 64).attributes('style')).toContain(
      'height: 64px',
    );
  });
});
