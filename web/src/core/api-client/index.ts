import type { components, paths } from './schema';

export type Health = components['schemas']['Health'];
export type ApiPath = keyof paths;

/** An error answer of the API: its RFC 9457 problem, or the bare status when the body was none. */
export class ApiProblem extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly retryAfterSeconds: number | undefined;

  constructor(
    status: number,
    type: string,
    title: string,
    retryAfterSeconds?: number,
  ) {
    super(title);
    this.name = 'ApiProblem';
    this.status = status;
    this.type = type;
    this.title = title;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  static async from(response: Response): Promise<ApiProblem> {
    const retryAfter = Number.parseInt(
      response.headers.get('Retry-After') ?? '',
      10,
    );
    const body = await problemBody(response);
    return new ApiProblem(
      response.status,
      body?.type ?? 'about:blank',
      body?.title ?? response.statusText,
      Number.isNaN(retryAfter) ? undefined : retryAfter,
    );
  }
}

async function problemBody(
  response: Response,
): Promise<components['schemas']['Problem'] | undefined> {
  if (
    !response.headers.get('Content-Type')?.includes('application/problem+json')
  ) {
    return undefined;
  }
  return (await response.json()) as components['schemas']['Problem'];
}

/**
The single fetch wrapper: every HTTP call of the app goes through here. It looks
up the global `fetch` on every call, so whatever is installed at that time answers.
*/
async function request<T>(path: ApiPath, init: RequestInit = {}): Promise<T> {
  const url = `${import.meta.env.BASE_URL}${path.slice(1)}`;
  const response = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...init.headers },
  });
  if (!response.ok) throw await ApiProblem.from(response);
  return (await response.json()) as T;
}

export function getHealth(): Promise<Health> {
  return request<Health>('/api/health');
}
