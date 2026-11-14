// Vercel only (issues #48 and #78): stands in for claude.ai's window.claude, so emergency-kit-audit.html
// runs unchanged outside claude.ai. tools/build-web.js loads it after supabase-js and web/signin.js,
// before the page, at /app. Everything is scoped to the signed-in account's own household:
//   db      kits/<id>, items/<id>, household/<name> in Supabase's `docs` table, keyed by household,
//           live through the household's private Realtime Broadcast channel (issue #74)
//   assets  kit photos at <household_id>/<id> in the private `photos` bucket, shown through
//           /_blob/<id> (api/blob.mjs, issue #72)
//   sample  Claude, through api/sample.mjs
//   user    every signed-in member can edit
// Nothing resolves until someone is signed in and their household is known; until then
// web/signin.js's card covers the page.
(() => {
  const cfg = window.GO_BAG_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  const COLS = ["kits", "items", "household"];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const clone = x => JSON.parse(JSON.stringify(x));
  const fail = (code, message) => Object.assign(new Error(message || code), { code });
  const never = () => new Promise(() => {});
  // web/signin.js's card: goBagSignIn(sb) for the form, goBagSignIn(sb, { state: "unavailable" }) otherwise.
  const card = (...opts) => { try { window.goBagSignIn?.(sb, ...opts); } catch {} };

  /* ---------- sign-in ---------- */
  // Photos load as <img src="/_blob/...">, which can't carry a header, so the access token rides in a
  // cookie scoped to that path.
  const setCookie = s => {
    document.cookie = s
      ? `gb_at=${s.access_token}; Path=/_blob; Max-Age=${Math.max(60, (s.expires_at || 0) - Math.floor(Date.now() / 1000))}; Secure; SameSite=Lax`
      : "gb_at=; Path=/_blob; Max-Age=0; Secure; SameSite=Lax";
  };
  // Realtime joins a private channel with the access token, and needs each refreshed one.
  const realtimeAuth = s => Promise.resolve(s?.access_token && sb.realtime.setAuth(s.access_token)).catch(() => {});

  // The household every read and write names. Set once, before anything resolves.
  let hid = null;

  /* ---------- the account button (#154) ---------- */
  // A round button with the signed-in person's initial, at the right end of the page's header (.hdr-end),
  // after the readiness score. It opens a small panel saying who is signed in, with Log out: a plain link to
  // /app?signout (below), so it works however the page is doing. A <details> disclosure, so it opens and
  // closes from the keyboard with no script; a click elsewhere or Escape closes it. The page file is the
  // claude.ai Artifact too and never changes for Vercel, so the button is added here, once someone is signed in.
  const ACCOUNT_CSS = `.gb-acct{position:relative;flex:none;align-self:center}
.gb-acct>summary{list-style:none;cursor:pointer;display:block;border-radius:999px}
.gb-acct>summary::-webkit-details-marker{display:none}
.gb-acct>summary:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.gb-av{width:40px;height:40px;border-radius:999px;display:grid;place-items:center;background:var(--ink);color:var(--card);font-weight:600;font-size:.95rem;line-height:1}
.gb-acct>summary:hover .gb-av,.gb-acct[open] .gb-av{box-shadow:0 0 0 4px var(--rule)}
.gb-menu{position:absolute;right:0;top:calc(100% + 8px);z-index:9;display:grid;gap:2px;min-width:220px;max-width:min(320px,calc(100vw - 32px));
  background:var(--card);border:1px solid var(--rule);border-radius:14px;box-shadow:0 8px 28px rgba(0,0,0,.14);padding:8px}
.gb-who{margin:0;padding:8px 12px 10px;border-bottom:1px solid var(--rule);margin-bottom:4px;font-size:.85rem;line-height:1.4;color:var(--ink-2);overflow-wrap:anywhere}
.gb-who b{display:block;color:var(--ink);font-weight:600}
.gb-out{display:block;padding:10px 12px;border-radius:8px;color:var(--ink);font-weight:500;text-decoration:none}
.gb-out:hover{background:var(--paper)}
.gb-out:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
@media (max-width:640px){.gb-av{width:34px;height:34px;font-size:.85rem}}`;
  // The initial on the button: the first letter or digit of the email, or "?" with none.
  const initial = email => (String(email || "").match(/[a-z0-9]/i)?.[0] || "?").toUpperCase();
  function addAccount(session) {
    const put = () => {
      const top = document.querySelector?.(".top-in");
      if (!top || document.querySelector?.(".gb-acct")) return;
      const st = document.createElement("style");
      st.textContent = ACCOUNT_CSS;
      document.head.append(st);
      const email = session.user?.email || "";
      const el = (tag, className, text) => { const e = document.createElement(tag); e.className = className; if (text != null) e.textContent = text; return e; };
      const box = el("details", "gb-acct"), sum = el("summary", ""), menu = el("div", "gb-menu");
      sum.setAttribute("aria-label", email ? `Account: signed in as ${email}` : "Account");
      sum.append(el("span", "gb-av", initial(email)));
      if (email) { const who = el("p", "gb-who", "Signed in as"); who.append(el("b", "", email)); menu.append(who); }
      const out = el("a", "gb-out", "Log out");
      out.setAttribute("href", "/app?signout");
      menu.append(out);
      box.append(sum, menu);
      // At the right end of the header's row, after the score; an older page without .hdr-end gets it at the row's end.
      (top.querySelector?.(".hdr-end") || top).append(box);
      try {
        document.addEventListener("click", e => { if (box.open && !box.contains(e.target)) box.open = false; });
        document.addEventListener("keydown", e => { if (e.key === "Escape" && box.open) { box.open = false; sum.focus(); } });
      } catch {}
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", put, { once: true });
    else put();
  }

  // Resolves once someone is signed in and their household is known; stays pending (with a card up)
  // otherwise. my_household() makes the household on a first real sign-in.
  const ready = (async () => {
    // Log out signs out this browser only: the family's other phones and laptops stay signed in.
    if (/[?&]signout\b/.test(location.search)) {
      await sb.auth.signOut({ scope: "local" }).catch(() => {});
      setCookie(null);
      try { history.replaceState(null, "", "/app"); } catch {}
    }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { setCookie(null); card(); return never(); }
    setCookie(session);
    const { data, error } = await Promise.resolve().then(() => sb.rpc("my_household")).catch(e => ({ error: e }));
    if (error || typeof data !== "string" || !UUID.test(data)) { card({ state: "unavailable" }); return never(); }
    hid = data.toLowerCase();
    const uid = session.user?.id;
    sb.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_OUT" || !s) { setCookie(null); location.reload(); return; }
      // Another account signed in in another tab: its household isn't this one.
      if (s.user?.id !== uid) { location.reload(); return; }
      setCookie(s);
      realtimeAuth(s);
    });
    try { addAccount(session); } catch {}
    return session;
  })();

  /* ---------- db ---------- */
  const store = Object.fromEntries(COLS.map(c => [c, new Map()]));
  const subs = new Set();
  const metadata = { fromCache: false, hasPendingWrites: false };
  let loaded = false, loading = null;
  const notify = col => { for (const s of subs) if (s.col === col) s.fire(); };
  const docs = () => sb.from("docs");

  async function loadAll() {
    const fresh = Object.fromEntries(COLS.map(c => [c, new Map()]));
    for (let from = 0; ; from += 1000) {
      const { data, error } = await docs().select("col,id,data").eq("household_id", hid).order("col").order("id").range(from, from + 999);
      if (error) throw fail("unavailable", error.message);
      for (const r of data) fresh[r.col]?.set(r.id, r.data);
      if (data.length < 1000) break;
    }
    for (const c of COLS) store[c] = fresh[c];
    loaded = true;
    COLS.forEach(notify);
  }
  const ensureLoaded = () => loading || (loading = loadAll().catch(e => { loading = null; for (const s of subs) s.err?.(e); throw e; }));

  // Each message is only {col, id}: the doc itself is always read through the docs table's RLS. The
  // newest message for a doc wins, so a read that comes back late never undoes a later change.
  const seq = new Map();
  async function changed(event, p) {
    const col = p?.col, id = p?.id;
    if (!store[col] || typeof id !== "string" || !id) return;
    const key = col + "/" + id, mine = (seq.get(key) || 0) + 1;
    seq.set(key, mine);
    let found;
    if (event !== "delete") {
      const { data, error } = await docs().select("data").eq("household_id", hid).eq("col", col).eq("id", id).maybeSingle();
      if (error || seq.get(key) !== mine) return;
      found = data;
    }
    if (found) store[col].set(id, found.data);
    else if (!store[col].delete(id)) return;
    notify(col);
  }

  async function listen(session) {
    let joined = false;
    await realtimeAuth(session);
    const ch = sb.channel(`household:${hid}`, { config: { private: true } });
    for (const event of ["insert", "update", "delete"]) ch.on("broadcast", { event }, m => { changed(event, m?.payload).catch(() => {}); });
    // Changes made while the socket was down never arrive, so a rejoin reloads everything.
    ch.subscribe(status => { if (status === "SUBSCRIBED") { if (joined) loadAll().catch(() => {}); joined = true; } });
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
        set: data => write(col, id, data, () => docs().upsert({ household_id: hid, col, id, data, updated_at: new Date().toISOString() }, { onConflict: "household_id,col,id" })),
        delete: () => write(col, id, undefined, () => docs().delete().eq("household_id", hid).eq("col", col).eq("id", id)),
      };
    },
  };

  /* ---------- assets ---------- */
  // The page's ids stay <uuid>.<ext>; the household's folder is added here and in api/blob.mjs.
  const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
  const PHOTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;
  const photos = () => sb.storage.from("photos");
  const assets = {
    upload: async (blob, { type } = {}) => {
      const t = EXT[type || blob.type] ? type || blob.type : "image/jpeg";
      const id = `${crypto.randomUUID()}.${EXT[t]}`;
      const { error } = await photos().upload(`${hid}/${id}`, blob, { contentType: t, cacheControl: "31536000", upsert: false });
      if (error) throw fail("unavailable", error.message);
      return { id };
    },
    delete: async id => {
      if (typeof id !== "string" || !PHOTO.test(id)) throw fail("invalid_argument", "not a photo id");
      const { error } = await photos().remove([`${hid}/${id}`]);
      if (error) throw fail("unavailable", error.message);
    },
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
      const session = await ready;
      if (name === "db" && !listening) { listening = true; listen(session).catch(() => {}); }
      return caps[name] || null;
    },
  };
})();
