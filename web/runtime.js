// Vercel only (issue #48): stands in for claude.ai's window.claude, so emergency-kit-audit.html runs
// unchanged outside claude.ai. tools/build-web.js loads it after supabase-js and before the page.
//   db      kits/<id>, items/<id>, household/<name> in Supabase's `docs` table, live through Realtime
//   assets  kit photos in the private `photos` bucket, shown through /_blob/<id> (api/blob.mjs)
//   sample  Claude, through api/sample.mjs
//   user    every signed-in member can edit
// Nothing resolves until someone on the household's allowlist is signed in; until then a sign-in
// card covers the page.
(() => {
  const cfg = window.GO_BAG_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  const COLS = ["kits", "items", "household"];
  const clone = x => JSON.parse(JSON.stringify(x));
  const fail = (code, message) => Object.assign(new Error(message || code), { code });

  /* ---------- sign-in ---------- */
  // Photos load as <img src="/_blob/...">, which can't carry a header, so the access token rides in a
  // cookie scoped to that path.
  const setCookie = s => {
    document.cookie = s
      ? `gb_at=${s.access_token}; Path=/_blob; Max-Age=${Math.max(60, (s.expires_at || 0) - Math.floor(Date.now() / 1000))}; Secure; SameSite=Lax`
      : "gb_at=; Path=/_blob; Max-Age=0; Secure; SameSite=Lax";
  };

  let card;
  // This script runs from <head>, so the card waits for <body>.
  const bodyReady = () => document.body ? Promise.resolve() : new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));
  async function showCard(html) {
    await bodyReady();
    if (!card) {
      const st = document.createElement("style");
      st.textContent = `
        .gb-auth{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;
          background:var(--gb-bg);color:var(--gb-fg);font:16px/1.45 system-ui,-apple-system,sans-serif;
          --gb-bg:#f6f5f1;--gb-card:#fff;--gb-fg:#1d1d1b;--gb-muted:#5f5e58;--gb-line:#d9d7cf;--gb-accent:#1f5f4a}
        @media (prefers-color-scheme:dark){.gb-auth{--gb-bg:#161615;--gb-card:#212120;--gb-fg:#ecebe6;--gb-muted:#a5a39b;--gb-line:#3a3936;--gb-accent:#7fc4a8}}
        .gb-auth form,.gb-auth .gb-box{width:100%;max-width:380px;background:var(--gb-card);border:1px solid var(--gb-line);border-radius:14px;padding:24px}
        .gb-auth h1{font-size:20px;margin:0 0 6px}.gb-auth p{margin:0 0 16px;color:var(--gb-muted)}
        .gb-auth input{width:100%;box-sizing:border-box;font:inherit;padding:10px 12px;border:1px solid var(--gb-line);border-radius:10px;background:transparent;color:inherit;margin-bottom:12px}
        .gb-auth button{width:100%;font:inherit;font-weight:600;padding:10px 12px;border:0;border-radius:10px;background:var(--gb-accent);color:var(--gb-card);cursor:pointer}
        .gb-auth button[disabled]{opacity:.6;cursor:default}.gb-auth .gb-msg{margin:12px 0 0;min-height:1.4em}`;
      document.head.append(st);
      card = document.createElement("div");
      card.className = "gb-auth";
      document.body.append(card);
    }
    card.innerHTML = html;
    return card;
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

  async function signInCard() {
    const el = await showCard(`<form novalidate>
      <h1>Emergency Kit Audit</h1>
      <p>Enter your email and we'll send you a link to sign in.</p>
      <input type="email" name="email" autocomplete="email" placeholder="you@example.com" required aria-label="Email">
      <button type="submit">Email me a sign-in link</button>
      <p class="gb-msg" role="status"></p></form>`);
    const form = el.querySelector("form"), msg = el.querySelector(".gb-msg"), btn = el.querySelector("button");
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      const email = form.email.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = "Enter an email address."; return; }
      btn.disabled = true; msg.textContent = "Sending…";
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/" } });
      btn.disabled = false;
      msg.textContent = error ? (error.status === 429 ? "Too many links sent. Wait a few minutes and try again." : "Couldn't send the link. Try again.")
        : `Check ${email} for a sign-in link. You can close this tab.`;
    });
  }

  async function notMemberCard(email) {
    const el = await showCard(`<div class="gb-box"><h1>Not on the list yet</h1>
      <p>${esc(email || "This account")} isn't on this household's list. Ask whoever runs it to add you, then sign in again.</p>
      <button type="button">Use a different email</button></div>`);
    el.querySelector("button").addEventListener("click", () => sb.auth.signOut().then(() => location.reload()));
  }

  // Resolves once a member is signed in; stays pending (with a card up) otherwise.
  const ready = (async () => {
    if (/[?&]signout\b/.test(location.search)) { await sb.auth.signOut().catch(() => {}); setCookie(null); history.replaceState(null, "", "/"); }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { setCookie(null); signInCard(); return new Promise(() => {}); }
    setCookie(session);
    const { data: ok, error } = await sb.rpc("is_member");
    if (error || ok !== true) { notMemberCard(session.user?.email); return new Promise(() => {}); }
    sb.auth.onAuthStateChange((event, s) => {
      if (s) setCookie(s);
      if (event === "SIGNED_OUT") { setCookie(null); location.reload(); }
    });
    return session;
  })();

  /* ---------- db ---------- */
  const store = Object.fromEntries(COLS.map(c => [c, new Map()]));
  const subs = new Set();
  const metadata = { fromCache: false, hasPendingWrites: false };
  let loaded = false, loading = null;
  const notify = col => { for (const s of subs) if (s.col === col) s.fire(); };

  async function loadAll() {
    const fresh = Object.fromEntries(COLS.map(c => [c, new Map()]));
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("docs").select("col,id,data").order("col").order("id").range(from, from + 999);
      if (error) throw fail("unavailable", error.message);
      for (const r of data) fresh[r.col]?.set(r.id, r.data);
      if (data.length < 1000) break;
    }
    for (const c of COLS) store[c] = fresh[c];
    loaded = true;
    COLS.forEach(notify);
  }
  const ensureLoaded = () => loading || (loading = loadAll().catch(e => { loading = null; for (const s of subs) s.err?.(e); throw e; }));

  function listen() {
    let joined = false;
    sb.channel("docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, p => {
        if (p.eventType === "DELETE") { const { col, id } = p.old || {}; if (store[col]?.delete(id)) notify(col); }
        else { const { col, id, data } = p.new || {}; if (store[col]) { store[col].set(id, data); notify(col); } }
      })
      // Changes made while the socket was down never arrive, so a rejoin reloads everything.
      .subscribe(status => { if (status === "SUBSCRIBED") { if (joined) loadAll().catch(() => {}); joined = true; } });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && loaded) loadAll().catch(() => {}); });
  }

  const subscribe = (col, fire, err) => {
    const s = { col, fire, err };
    subs.add(s);
    if (loaded) queueMicrotask(fire); else ensureLoaded().catch(() => {});
    return () => subs.delete(s);
  };

  // Writes show at once and roll back if Supabase refuses them.
  async function write(col, id, next, run) {
    const map = store[col];
    if (!map) throw fail("invalid_argument", "unknown collection " + col);
    const had = map.has(id), prev = map.get(id);
    if (next === undefined) map.delete(id); else map.set(id, clone(next));
    notify(col);
    const { error } = await run();
    if (error) {
      if (had) map.set(id, prev); else map.delete(id);
      notify(col);
      throw fail(error.code === "42501" ? "invalid_argument" : "unavailable", error.message);
    }
  }

  const db = {
    collection: col => ({
      onSnapshot: (cb, err) => subscribe(col, () => cb({ metadata, docs: [...(store[col] || [])].map(([id, d]) => ({ id, data: () => clone(d) })) }), err),
    }),
    doc: path => {
      const [col, id] = String(path).split("/");
      return {
        onSnapshot: (cb, err) => subscribe(col, () => {
          const m = store[col], exists = !!m?.has(id);
          cb({ metadata, id, exists, data: () => (exists ? clone(m.get(id)) : undefined) });
        }, err),
        set: data => write(col, id, data, () => sb.from("docs").upsert({ col, id, data, updated_at: new Date().toISOString() })),
        delete: () => write(col, id, undefined, () => sb.from("docs").delete().eq("col", col).eq("id", id)),
      };
    },
  };

  /* ---------- assets ---------- */
  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const assets = {
    upload: async (blob, { type } = {}) => {
      const t = EXT[type || blob.type] ? type || blob.type : "image/jpeg";
      const id = `${crypto.randomUUID()}.${EXT[t]}`;
      const { error } = await sb.storage.from("photos").upload(id, blob, { contentType: t, cacheControl: "31536000", upsert: false });
      if (error) throw fail("unavailable", error.message);
      return { id };
    },
    delete: async id => { const { error } = await sb.storage.from("photos").remove([id]); if (error) throw fail("unavailable", error.message); },
  };

  /* ---------- sample (Claude) ---------- */
  const MAX_IMAGES = 4; // keeps one request under Vercel's 4.5 MB body limit at the page's 1600px photos
  const b64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]);
    r.onerror = () => rej(fail("image_rejected"));
    r.readAsDataURL(blob);
  });

  async function post(body, signal) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw fail("session_expired");
    let res;
    try {
      res = await fetch("/api/sample", { method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(body) });
    } catch (e) { throw fail(signal?.aborted ? "cancelled" : "unavailable", e?.message); }
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw fail(j.code || "unavailable", j.message); }
    return res;
  }

  // Streams text: the function sends one JSON object per line, {"d": "..."} for text and
  // {"error": "<code>"} if Claude fails part way.
  async function sample(prompt, { signal, onText, modelTier } = {}) {
    const res = await post({ mode: "text", prompt, tier: modelTier }, signal);
    const reader = res.body.getReader(), dec = new TextDecoder();
    let text = "", buf = "";
    const line = l => {
      if (!l.trim()) return;
      const m = JSON.parse(l);
      if (m.error) throw fail(m.error);
      if (m.d) { text += m.d; onText?.({ text }); }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n"); buf = parts.pop();
        parts.forEach(line);
      }
      line(buf);
    } catch (e) { throw e?.code ? e : fail(signal?.aborted ? "cancelled" : "unavailable", e?.message); }
    return { text };
  }
  sample.json = async (prompt, { images = [], signal, modelTier } = {}) => {
    if (images.length > MAX_IMAGES) throw fail("images_unavailable");
    const imgs = await Promise.all(images.map(async b => ({ media_type: EXT[b.type] ? b.type : "image/jpeg", data: await b64(b) })));
    const res = await post({ mode: "json", prompt, images: imgs, tier: modelTier }, signal);
    return (await res.json()).result;
  };
  sample.limits = async () => ({ images: { maxCount: MAX_IMAGES } });

  /* ---------- user ---------- */
  const user = { canEdit: async () => true };

  const caps = { db, assets, sample, user };
  let listening = false;
  window.claude = {
    use: async name => {
      await ready;
      if (name === "db" && !listening) { listening = true; listen(); }
      return caps[name] || null;
    },
  };
})();
