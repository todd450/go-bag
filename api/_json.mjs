// Pulls the JSON value out of a reply, tolerating a stray code fence or sentence around it.
export function parseJson(text) {
  const t = String(text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
  try { return JSON.parse(t); } catch (_) {}
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (start >= 0 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch (_) {} }
  throw Object.assign(new Error("invalid_json"), { code: "invalid_json" });
}
