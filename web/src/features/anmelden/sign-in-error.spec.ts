import { describe, expect, it } from 'vitest';
import { ApiProblem } from '../../core/api-client';
import { signInError } from './sign-in-error';

describe('the sign-in error', () => {
  it('says the same for an unknown user name and a wrong password', () => {
    expect(signInError(new ApiProblem(401, 'x', 'egal'))).toBe(
      'Benutzername oder Passwort falsch.',
    );
  });

  it('asks to wait after too many attempts', () => {
    expect(signInError(new ApiProblem(429, 'x', 'egal'))).toBe(
      'Zu viele Versuche. Bitte später erneut.',
    );
  });

  it('shows any other problem by its title', () => {
    expect(
      signInError(
        new ApiProblem(503, 'x', 'Wird aktualisiert – gleich wieder da'),
      ),
    ).toBe('Wird aktualisiert – gleich wieder da');
  });

  it('names a missing connection', () => {
    expect(signInError(new TypeError('Failed to fetch'))).toBe(
      'Keine Verbindung. Bitte später erneut.',
    );
  });
});
