import { describe, expect, it } from 'vitest';
import { initialsOf } from './person-photo';

describe('initialsOf', () => {
  it.each([
    ['Anna', 'A'],
    ['Anna Lena', 'AL'],
    ['Anna Lena Schmidt', 'AS'],
    ['  daniel   von   berg ', 'DB'],
    ['Øyvind Ærø', 'ØÆ'],
    ['😀 Tom', '😀T'],
    ['', ''],
  ])('takes the first letters of the first and last word of %j', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});
