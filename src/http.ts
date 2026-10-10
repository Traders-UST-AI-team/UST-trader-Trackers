/**
 * The client's single transport.
 *
 * "Call the server, surface its error" used to have two implementations with different behaviour:
 * the mainline one threw `HTTP 503` without reading the body, while the reviews one parsed
 * `{ error }` first — so the same server failure produced different messages depending on which
 * resource you asked for. Both now sit here, with one documented error mode: the server's own
 * message when it sent one, otherwise the status.
 *
 * On a shared deployment writes need the team code (see server/teamauth.ts). It is kept in this
 * browser once entered and sent with every request; a refusal surfaces as `TeamCodeRequired`.
 */

const TEAM_KEY = 'tracker-team-code';

export const teamCode = {
  get(): string | null {
    try { return localStorage.getItem(TEAM_KEY); } catch { return null; }
  },
  set(code: string | null) {
    try {
      if (code) localStorage.setItem(TEAM_KEY, code);
      else localStorage.removeItem(TEAM_KEY);
    } catch { /* storage unavailable: the code lasts for this page only */ }
    window.dispatchEvent(new Event('team-code-changed'));
  },
};

/** A write the server refused because the team code is missing or wrong. */
export class TeamCodeRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamCodeRequired';
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const code = teamCode.get();
  return code ? { ...extra, 'x-team-token': code } : extra;
}

async function errorFrom(response: Response, url: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string; code?: string } | null;
  if (response.status === 401 && body?.code === 'team_code_required') return new TeamCodeRequired(body.error ?? 'The team code is required.');
  return new Error(body?.error ?? `${url} → HTTP ${response.status}`);
}

export async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: headers() });
  if (!response.ok) throw await errorFrom(response, url);
  return response.json() as Promise<T>;
}

export async function send<T>(method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: headers({ 'content-type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(response, url);
  return response.json() as Promise<T>;
}
