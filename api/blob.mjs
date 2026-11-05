// Serves kit photos at /_blob/<id> (vercel.json rewrites it here), the path the page already uses on
// claude.ai. Reads the member's access token from the gb_at cookie that web/runtime.js sets, asks
// Supabase Storage for a short-lived signed URL with that token, and redirects to it. Storage's own
// policies check membership, so a non-member's token gets nothing.
import { SUPABASE_URL, SUPABASE_KEY } from "./_member.mjs";

const ID = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
const cookie = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(name + "="))?.slice(name.length + 1);
const text = (body, status) => new Response(body, { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID.test(id)) return text("Not found", 404);
  const token = cookie(request, "gb_at");
  if (!token || !SUPABASE_URL) return text("Sign in to see photos", 401);
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/photos/${id}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 3600 }),
  }).catch(() => null);
  if (!r) return text("Photos are unavailable", 502);
  if (!r.ok) return text(r.status === 401 || r.status === 403 ? "Sign in to see photos" : "Not found", r.status === 401 || r.status === 403 ? 401 : 404);
  const { signedURL } = await r.json();
  return new Response(null, { status: 302, headers: { location: `${SUPABASE_URL}/storage/v1${signedURL}`, "cache-control": "private, max-age=3000" } });
}
