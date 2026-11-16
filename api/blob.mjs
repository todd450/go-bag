// Serves kit photos at /_blob/<id> (vercel.json rewrites it here), the path the page already uses on
// claude.ai. Reads the member's access token from the gb_at cookie that web/runtime.js sets, asks the
// database which household that token belongs to, then reads photos/<household_id>/<id> from Supabase
// Storage with that token and sends the bytes (issues #72 and #157). The folder comes only from
// my_household_id(), never from the request, and Storage's own policies check it again on every read.
//
// A photo's id never points to different bytes (web/runtime.js names each upload with a new uuid and
// never overwrites), so the browser is told to keep it for a year: a photo is fetched once per device,
// not once an hour as the old redirect to a signed link was.
import { SUPABASE_URL, SUPABASE_KEY } from "./_member.mjs";

const ID = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPE = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const cookie = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(name + "="))?.slice(name.length + 1);
const text = (body, status) => new Response(body, { status, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
const asCaller = token => ({ apikey: SUPABASE_KEY, authorization: `Bearer ${token}` });

// Which household a token belongs to, remembered for a few minutes in this warm function, so a kit's
// forty thumbnails ask the database once, not forty times. Only a real household id is remembered, and
// only as the folder to ask Storage for: Storage still checks the token itself on every photo, so a
// token that has expired or lost its household gets nothing from this.
const KEEP_MS = 5 * 60 * 1000, KEEP_MAX = 500;
export const households = new Map(); // token -> { at, answer: Promise<{ household } | { status, body }> }

async function ask(token) {
  const who = await fetch(`${SUPABASE_URL}/rest/v1/rpc/my_household_id`, {
    method: "POST", headers: { ...asCaller(token), "content-type": "application/json" }, body: "{}",
  }).catch(() => null);
  if (who?.status === 401) return { status: 401, body: "Sign in to see photos" };
  if (!who?.ok) return { status: 502, body: "Photos are unavailable" };
  const household = await who.json().catch(() => undefined);
  if (household === null) return { status: 401, body: "Sign in to see photos" };
  if (typeof household !== "string" || !UUID.test(household)) return { status: 502, body: "Photos are unavailable" };
  return { household };
}

function householdOf(token) {
  const kept = households.get(token);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.answer;
  if (households.size >= KEEP_MAX) households.clear();
  const answer = ask(token);
  households.set(token, { at: Date.now(), answer });
  // Anything but a household is asked again next time.
  answer.then(a => { if (!a.household && households.get(token)?.answer === answer) households.delete(token); });
  return answer;
}

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!ID.test(id)) return text("Not found", 404);
  const token = cookie(request, "gb_at");
  if (!token || !SUPABASE_URL) return text("Sign in to see photos", 401);

  const who = await householdOf(token);
  if (!who.household) return text(who.body, who.status);

  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/photos/${who.household}/${id}`, { headers: asCaller(token) }).catch(() => null);
  if (!r) return text("Photos are unavailable", 502);
  if (!r.ok) {
    // Storage refused this token or this photo: forget the household, so the next photo asks the database again.
    households.delete(token);
    return text("Not found", 404);
  }
  // The length is sent on, so a photo cut off part way fails in the browser and is not kept for a year.
  // Storage sends photos as they are; were one ever encoded in transit, its length would no longer be the
  // length of what is sent here, so it goes without one.
  const length = r.headers.get("content-length"), plain = !r.headers.get("content-encoding");
  if (!r.body || length === "0") return text("Photos are unavailable", 502);
  return new Response(r.body, {
    status: 200,
    headers: {
      // The type comes from the id's own extension, never from what Storage or the uploader said.
      "content-type": TYPE[id.slice(id.lastIndexOf(".") + 1)],
      "cache-control": "private, max-age=31536000, immutable",
      ...(plain && /^[1-9]\d*$/.test(length || "") ? { "content-length": length } : {}),
    },
  });
}
