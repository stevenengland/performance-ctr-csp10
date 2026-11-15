export function redact(text: string, secrets: readonly string[]): string {
  // Longest first, so a secret that contains another is masked whole.
  const ordered = secrets
    .filter((secret) => secret !== '')
    .toSorted((a, b) => b.length - a.length);
  let result = text;
  for (const secret of ordered) result = result.split(secret).join('***');
  return result;
}
