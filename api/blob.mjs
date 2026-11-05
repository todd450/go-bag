// Serves kit photos at /_blob/<id> (vercel.json rewrites it here), the path the page already uses on
// claude.ai. Reads the member's access token from the gb_at cookie that web/runtime.js sets, asks the
// database which household that token belongs to, then asks Supabase Storage for a short-lived signed
// URL of photos/<household_id>/<id> with that token, and redirects to it (issue #72). The folder comes
// only from my_household_id(), never from the request, and Storage's own policies check it again.
import { SUPABASE_URL, SUPABASE_KEY } from "./_member.mjs";

const ID = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cookie = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(name + "="))?.slice(name.length + 1);
const text = (body, status) => new Response(body, { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
const asCaller = token => ({ apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" });

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID.test(id)) return text("Not found", 404);
  const token = cookie(request, "gb_at");
  if (!token || !SUPABASE_URL) return text("Sign in to see photos", 401);

  const who = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_household_id`, { method: "POST", headers: asCaller(token), body: "{}" }).catch(() => null);
  if (who?.status === 401) return text("Sign in to see photos", 401);
  if (!who?.ok) return text("Photos are unavailable", 502);
  const household = await who.json().catch(() => undefined);
  if (household === null) return text("Sign in to see photos", 401);
  if (typeof household !== "string" || !UUID.test(household)) return text("Photos are unavailable", 502);

  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/photos/${household}/${id}`, {
    method: "POST", headers: asCaller(token), body: JSON.stringify({ expiresIn: 3600 }),
  }).catch(() => null);
  if (!r) return text("Photos are unavailable", 502);
  if (!r.ok) return text("Not found", 404);
  const { signedURL } = await r.json().catch(() => ({}));
  if (typeof signedURL !== "string" || !signedURL.startsWith("/")) return text("Photos are unavailable", 502);
  return new Response(null, { status: 302, headers: { location: `${SUPABASE_URL}/storage/v1${signedURL}`, "cache-control": "private, max-age=3000" } });
}
