// Claude for the page's photo scan, hazard check, pack estimate and plan review (issue #48).
// The browser shim (web/runtime.js) posts { mode: "text" | "json", prompt, images?, tier? } with the
// member's Supabase access token. ANTHROPIC_API_KEY is set in Doppler (go-bag, prd), which syncs it to Vercel.
import Anthropic from "@anthropic-ai/sdk";
import { membership, json } from "./_member.mjs";
import { parseJson } from "./_json.mjs";

let client; // made on first use, so a missing key is reported instead of crashing the function
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES = 4;
const MAX_PROMPT = 200_000;

// The page asks for "quick" on small lookups (pack weights); everything else gets the default model.
// Server-side fallbacks let a policy decline on Opus be re-run on a fallback model inside the same call.
function params(tier, system, content) {
  const quick = tier === "quick";
  return {
    model: quick ? "claude-haiku-5-5" : "claude-opus-5-5",
    max_tokens: 16000,
    output_config: { effort: quick ? "low" : "medium" },
    ...(quick ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }),
    ...(system ? { system } : {}),
    messages: [{ role: "user", content }],
  };
}

const JSON_SYSTEM = "Reply with only the JSON value the request asks for: no prose before or after it, and no code fences.";

function errorCode(e, hadImages) {
  if (e?.code) return e.code;
  if (e instanceof Anthropic.RateLimitError) return "rate_limited";
  if (e instanceof Anthropic.BadRequestError) return hadImages ? "image_rejected" : "unavailable";
  return "unavailable";
}

export async function POST(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const who = await membership(token);
  if (who === "expired") return json({ code: "session_expired" }, 401);
  if (who !== "member") return json({ code: "not_granted" }, 403);
  if (!process.env.ANTHROPIC_API_KEY) return json({ code: "sampling_disabled", message: "ANTHROPIC_API_KEY is not set: add it to Doppler go-bag prd" }, 503);
  client ||= new Anthropic();

  const body = await request.json().catch(() => null);
  const { mode, prompt, images = [], tier } = body || {};
  if (!["text", "json"].includes(mode) || typeof prompt !== "string" || !prompt || prompt.length > MAX_PROMPT) return json({ code: "invalid_argument" }, 400);
  if (!Array.isArray(images) || images.length > MAX_IMAGES) return json({ code: "images_unavailable" }, 400);
  if (images.some(i => !IMAGE_TYPES.has(i?.media_type) || typeof i?.data !== "string")) return json({ code: "image_rejected" }, 400);

  const content = [
    ...images.map(i => ({ type: "image", source: { type: "base64", media_type: i.media_type, data: i.data } })),
    { type: "text", text: prompt },
  ];

  if (mode === "json") {
    try {
      const msg = await client.beta.messages.stream(params(tier, JSON_SYSTEM, content), { signal: request.signal }).finalMessage();
      if (msg.stop_reason === "refusal") return json({ code: "refused" }, 422);
      const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
      return json({ result: parseJson(text) });
    } catch (e) {
      const code = errorCode(e, images.length > 0);
      return json({ code }, code === "rate_limited" ? 429 : code === "invalid_json" ? 502 : 500);
    }
  }

  // Text streams back one JSON object per line so an error part way through can still be reported.
  const enc = new TextEncoder();
  const stream = client.beta.messages.stream(params(tier, null, content), { signal: request.signal });
  const out = new ReadableStream({
    async start(ctl) {
      const send = o => ctl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") send({ d: ev.delta.text });
        }
        const msg = await stream.finalMessage();
        if (msg.stop_reason === "refusal") send({ error: "refused" });
      } catch (e) {
        if (!request.signal.aborted) send({ error: errorCode(e, false) });
      }
      ctl.close();
    },
    cancel() { stream.abort(); },
  });
  return new Response(out, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
