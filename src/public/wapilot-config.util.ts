/** Strip quotes and accidental `Bearer ` prefix from .env values. */
export function normalizeWapilotApiToken(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  let t = String(raw).trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(t)) {
    t = t.replace(/^bearer\s+/i, '').trim();
  }
  return t || undefined;
}

/**
 * For hosts that use `Authorization` (app.wapilot.io, wautopilot.com).
 * @param scheme WAPILOT_AUTH_SCHEME: `bearer` (default), or `raw` / `none` / `token` for `Authorization: <token>` only.
 */
export function buildWapilotAuthorizationValue(token: string, scheme: string | undefined): string {
  const s = (scheme ?? 'bearer').trim().toLowerCase();
  if (s === 'raw' || s === 'none' || s === 'token') {
    return token;
  }
  return `Bearer ${token}`;
}

/** Wapilot Cloud API v2 — uses `token` request header, not Bearer. Docs: https://app.wapilot.net/api-doc/v2 */
export function usesWapilotNetTokenHeader(url: string): boolean {
  return url.includes('api.wapilot.net');
}

/** Primary auth headers for the outbound message request. */
export function buildWapilotPrimaryAuthHeaders(
  url: string,
  token: string,
  authScheme: string | undefined,
): Record<string, string> {
  if (usesWapilotNetTokenHeader(url)) {
    return { token };
  }
  return { Authorization: buildWapilotAuthorizationValue(token, authScheme) };
}

/** Merge into send JSON (e.g. `{"instance_uuid":"..."}` if the API uses a different key than `instance_id`). */
export function parseWapilotExtraBody(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    return { ...(v as Record<string, unknown>) };
  } catch {
    return undefined;
  }
}

/** Optional JSON object of extra request headers (e.g. `{"X-Workspace-Id":"..."}`). Values must be strings. */
export function parseWapilotExtraHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'string') out[k] = val;
      else if (typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}
