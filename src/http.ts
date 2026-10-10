/**
 * The client's single transport.
 *
 * "Call the server, surface its error" used to have two implementations with different behaviour:
 * the mainline one threw `HTTP 503` without reading the body, while the reviews one parsed
 * `{ error }` first — so the same server failure produced different messages depending on which
 * resource you asked for. Both now sit here, with one documented error mode: the server's own
 * message when it sent one, otherwise the status.
 */

async function errorFrom(response: Response, url: string): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return new Error(body?.error ?? `${url} → HTTP ${response.status}`);
}

export async function get<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw await errorFrom(response, url);
  return response.json() as Promise<T>;
}

export async function send<T>(method: 'POST' | 'PUT' | 'DELETE' | 'PATCH', url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(response, url);
  return response.json() as Promise<T>;
}
