/**
 * Lightweight fetch helpers.
 */

export async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

export async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

/** Convenience GET that builds a query string from an object. */
export async function fetchJSONWithQuery(url, query = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  const qs = params.toString();
  return fetchJSON(qs ? `${url}?${qs}` : url);
}
