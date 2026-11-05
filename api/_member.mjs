// Shared by the Vercel functions: is this access token a signed-in member of the household?
// Asks Supabase with the caller's own token, so the database's allowlist (is_member) decides.
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

// "member", "expired" (token missing, expired or invalid) or "outsider".
export async function membership(token) {
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) return "expired";
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_member`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  }).catch(() => null);
  if (!r || r.status === 401) return "expired";
  if (!r.ok) return "outsider";
  return (await r.json()) === true ? "member" : "outsider";
}

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
