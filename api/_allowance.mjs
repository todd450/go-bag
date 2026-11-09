// The daily Claude allowance (issue #75): one call is taken from today's allowance for the
// caller's household before api/sample.mjs calls Claude. Asks Supabase with the caller's own
// token, so the database decides whose household it is (claim_claude_call, migration 0005).
// Imports no SDK, so tests/allowance.test.js runs it without an install.
import { SUPABASE_URL, SUPABASE_KEY } from "./_member.mjs";

// "ok" (a call was claimed), "over" (today's allowance is used up, or there is no household) or
// "error" (the database could not say; the caller must not call Claude).
export async function claimCall(token) {
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) return "error";
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_claude_call`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  }).catch(() => null);
  if (!r?.ok) return "error";
  const claimed = await r.json().catch(() => null);
  return claimed === true ? "ok" : claimed === false ? "over" : "error";
}
