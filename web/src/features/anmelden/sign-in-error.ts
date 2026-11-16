import { ApiProblem } from '../../core/api-client';
import { messages } from '../../core/messages';

/** What Anmelden says when signing in fails (design spec §7a). */
export function signInError(error: unknown): string {
  if (!(error instanceof ApiProblem)) return messages.anmelden.unreachable;
  if (error.status === 401) return messages.anmelden.invalid;
  if (error.status === 429) return messages.anmelden.throttled;
  return error.title;
}
