import { beforeEach, describe, expect, it } from 'vitest';
import { ApiProblem } from './api-client';
import { useCreateForm } from './create-form';
import { dismissSnackbar, useSnackbar } from './snackbar';

describe('a create dialog’s submit', () => {
  beforeEach(dismissSnackbar);

  it('shows a 422’s field errors inline', async () => {
    const form = useCreateForm('name');

    const created = await form.submit(() =>
      Promise.reject(
        new ApiProblem(422, 'urn:x', 'Bitte Eingaben prüfen', undefined, {
          points: 'Zahl von 0 bis 9.999,99.',
        }),
      ),
    );

    expect(created).toBe(false);
    expect(form.errors.value).toEqual({ points: 'Zahl von 0 bis 9.999,99.' });
    expect(useSnackbar().value).toBeUndefined();
  });

  it('shows a taken name (409) under the name field', async () => {
    const form = useCreateForm('name');

    await form.submit(() =>
      Promise.reject(
        new ApiProblem(409, 'urn:x', 'Name ist bereits vergeben.'),
      ),
    );

    expect(form.errors.value).toEqual({ name: 'Name ist bereits vergeben.' });
  });

  it('shows anything else in the snackbar and clears old errors on success', async () => {
    const form = useCreateForm('name');
    await form.submit(() => Promise.reject(new TypeError('offline')));

    expect(useSnackbar().value?.text).toBe(
      'Keine Verbindung. Bitte später erneut.',
    );

    form.errors.value = { name: 'alt' };
    await expect(form.submit(() => Promise.resolve())).resolves.toBe(true);
    expect(form.errors.value).toEqual({});
  });
});
