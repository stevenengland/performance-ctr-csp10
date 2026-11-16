/**
A person's photo in the browser. For now only what a person without one shows:
their initials (`PersonAvatar`).
*/

/** Up to two initials: the first letters of the first and last word (`Anna Lena` → `AL`). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = firstLetter(words[0]);
  const last = words.length > 1 ? firstLetter(words.at(-1)) : '';
  return (first + last).toLocaleUpperCase('de-DE');
}

/** By code point, so a letter outside the BMP is not cut in half. */
function firstLetter(word: string | undefined): string {
  return [...(word ?? '')][0] ?? '';
}
