// The sign-in card (issue #76), for the Vercel version: one email form for both sign-up and log-in,
// then a "Check your inbox" step. web/runtime.js calls it while nobody is signed in:
//   window.goBagSignIn(sb)                            the form (copy from ?start=new|login)
//   window.goBagSignIn(sb, { state: "unavailable" })  "Couldn't open your household", Try again
// `sb` is the page's supabase-js client. The sender's address shows when GO_BAG_CONFIG.senderEmail is
// set. The card sits in the page's document, so it draws only in the page's own tokens (:root in
// emergency-kit-audit.html), and every class it uses starts with gb-auth.
(() => {
  // Every string the card shows. Templates fill {name} with text, never markup.
  const TEXT = Object.freeze({
    newHeading: "Create your household",
    newLead: "Enter your email and we'll send you a link. Opening it creates your household. No password.",
    newFoot: "Already have an account? The same link logs you in.",
    loginHeading: "Log in",
    loginLead: "Enter the email you signed up with and we'll send you a link.",
    loginFoot: "New here? The same link creates your household.",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    send: "Email me a link",
    sending: "Sending…",
    invalid: "Enter a full email address, like alex@example.com",
    tooMany: "You've asked for several links in a short time. Wait 5 minutes, then send again.",
    sendFailed: "Couldn't send the link. Check your connection and try again.",
    sentHeading: "Check your inbox",
    sentTo: "We sent a link to",
    from: "From",
    fromName: "Emergency Kit Audit",
    fromAddress: "({address})",
    subject: "Subject",
    subjectLine: "Your sign-in link for Emergency Kit Audit",
    linkLife: "The link works once, for one hour.",
    noEmail: "Nothing after a few minutes? Check spam or Promotions.",
    resend: "Send it again",
    resendIn: "Send again in {time}",
    otherEmail: "Use a different email",
    closeTab: "You can close this tab. The link opens the app wherever you tap it.",
    expiredHeading: "That link has expired",
    expiredLead: "Links work once, for an hour. A link can also be used up if your email app opened it first. Send yourself a new one.",
    expiredSend: "Email me a new link",
    linkFailed: "That link didn't work. Send yourself a new one.",
    unavailableHeading: "Couldn't open your household",
    retry: "Try again",
  });

  // Seconds before Send it again opens: after a link goes, and after Supabase answers 429.
  const WAIT = 60, WAIT_TOO_MANY = 300;
  // A whole address: something, @, then a domain with a dot. A quoted local part may hold spaces.
  const EMAIL = /^(?:[^\s@"]+|"[^"\r\n]*")@[^\s@."]+(?:\.[^\s@."]+)+$/;

  // The page's caseMark(75, 40), copied as markup, with its classes renamed into the card's own.
  const MARK = '<svg class="gb-auth-case" viewBox="0 0 64 64" width="40" height="40" aria-hidden="true"><g fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path class="gb-auth-cf" d="M25 21V17A2 2 0 0 1 27 15H37A2 2 0 0 1 39 17V21"/><path class="gb-auth-ct" d="M32 54H13A5 5 0 0 1 8 49V26A5 5 0 0 1 13 21H32"/><path class="gb-auth-ct" d="M32 54H51A5 5 0 0 0 56 49V26A5 5 0 0 0 51 21H32"/><path class="gb-auth-cf" d="M32 54H13A5 5 0 0 1 8 49V26A5 5 0 0 1 13 21H32" pathLength="100" style="stroke-dasharray:75 100"/><path class="gb-auth-cf" d="M32 54H51A5 5 0 0 0 56 49V26A5 5 0 0 0 51 21H32" pathLength="100" style="stroke-dasharray:75 100"/><path class="gb-auth-cf" d="M10.5 29H53.5"/></g><rect class="gb-auth-cs" x="15" y="25.5" width="6" height="7" rx="1.5"/><rect class="gb-auth-cs" x="43" y="25.5" width="6" height="7" rx="1.5"/><path class="gb-auth-cs" d="M29.7 35H34.3V39.2H38.5V43.8H34.3V48H29.7V43.8H25.5V39.2H29.7Z"/></svg>';

  // The page's .panel, .btn, .btn.ghost, .notice and label.f, redrawn under gb-auth names.
  const CSS = `
.gb-auth{position:fixed;inset:0;z-index:2147483647;display:grid;overflow-y:auto;overscroll-behavior:contain;padding:24px 16px;
  background:var(--paper);color:var(--ink);font:15px/1.5 var(--f-body);-webkit-font-smoothing:antialiased}
.gb-auth *{box-sizing:border-box}
.gb-auth p{margin:0}
.gb-auth-card{margin:auto;width:100%;max-width:380px;min-width:0;display:grid;gap:14px;background:var(--card);
  border:1px solid var(--rule);border-radius:16px;padding:20px 24px;box-shadow:var(--shadow)}
@media (max-width:560px){.gb-auth-card{padding:16px;border-radius:14px}}
.gb-auth-case{display:block}
.gb-auth-ct{stroke:var(--brand-track)}
.gb-auth-cf{stroke:var(--brand)}
.gb-auth-cs{fill:var(--brand)}
.gb-auth-h{margin:0;font-size:1.4rem;font-weight:600;line-height:1.25;letter-spacing:-.01em;text-wrap:balance}
.gb-auth-h:focus{outline:none}
.gb-auth-muted{color:var(--ink-2)}
.gb-auth-small{font-size:.85rem;color:var(--ink-2)}
.gb-auth-bad{font-size:.85rem;font-weight:500;color:var(--bad)}
.gb-auth-field{display:grid;gap:6px;font-size:.85rem;font-weight:500;color:var(--ink-2)}
.gb-auth-input{width:100%;min-width:0;font:inherit;font-size:1rem;font-weight:400;color:var(--ink);background:var(--card);
  border:1px solid var(--rule-2);border-radius:8px;padding:7px 10px}
.gb-auth-input:focus{border-color:var(--ink);outline:none;box-shadow:0 0 0 1px var(--ink)}
.gb-auth-input[aria-invalid="true"]{border-color:var(--bad);box-shadow:0 0 0 1px var(--bad)}
.gb-auth-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:40px;padding:8px 18px;
  border:1px solid var(--accent);border-radius:999px;background:var(--accent);color:var(--accent-ink);
  font:inherit;font-size:.9rem;font-weight:600;font-variant-numeric:tabular-nums;text-align:center;cursor:pointer}
.gb-auth-ghost{width:auto;background:var(--card);color:var(--ink);border-color:var(--rule-2)}
.gb-auth-btn[disabled]{opacity:.45;cursor:not-allowed}
.gb-auth-link{padding:0;border:0;background:none;font:inherit;color:var(--ink);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.gb-auth-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}
.gb-auth-addr{font-weight:600;overflow-wrap:anywhere}
.gb-auth-notice{display:grid;gap:8px;padding:12px 16px;border:1px solid var(--rule);border-radius:12px;background:var(--paper);font-size:.9rem}
.gb-auth-notice dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;margin:0}
.gb-auth-notice dt{color:var(--ink-2)}
.gb-auth-notice dd{margin:0;min-width:0;overflow-wrap:anywhere}
`;

  const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
  const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  // An element with attributes and children. Strings become text nodes, never markup.
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v; else el.setAttribute(k, v === true ? "" : v);
    }
    el.append(...kids.filter(k => k != null && k !== false && k !== ""));
    return el;
  };
  const text = (tag, attrs, s) => { const el = h(tag, attrs); el.textContent = s; return el; };
  const mark = () => { const el = h("div"); el.innerHTML = MARK; return el; };
  const heading = s => text("h2", { class: "gb-auth-h", id: "gb-auth-h", tabindex: "-1" }, s);
  const bad = (s, id) => text("p", { class: "gb-auth-bad", id, role: "alert" }, s);

  let sb, start = "login", root, timer = null, gen = 0;
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  // runtime.js runs from <head>, so the card waits for <body>.
  const bodyReady = () => document.body ? Promise.resolve() : new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));

  // Puts `card` in the overlay in place of whatever was there, and returns its generation, so an
  // answer that arrives after the card moved on draws nothing.
  function draw(card) {
    stop();
    if (!root) {
      const st = document.createElement("style");
      st.textContent = CSS;
      document.head.append(st);
      root = h("div", { class: "gb-auth", role: "dialog", "aria-modal": "true", "aria-labelledby": "gb-auth-h" });
      document.body.append(root);
    }
    root.replaceChildren(card);
    return ++gen;
  }

  // Asks Supabase for a link. Resolves to null when it went, or the TEXT key that says why not.
  async function send(email) {
    try {
      const { error } = (await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + "/app" } })) || {};
      if (!error) return null;
      return error.status === 429 || /rate_limit/.test(error.code || "") ? "tooMany" : "sendFailed";
    } catch { return "sendFailed"; }
  }

  // The form. `kind` is new, login or expired; `note` is a problem with the link that brought them here.
  function showForm({ kind = start, email = "", invalid = false, error = null, note = null, focus = false } = {}) {
    const copy = {
      new: [TEXT.newHeading, TEXT.newLead, TEXT.send, TEXT.newFoot],
      login: [TEXT.loginHeading, TEXT.loginLead, TEXT.send, TEXT.loginFoot],
      expired: [TEXT.expiredHeading, TEXT.expiredLead, TEXT.expiredSend, null],
    }[kind];
    const input = h("input", {
      class: "gb-auth-input", type: "email", name: "email", autocomplete: "email", inputmode: "email",
      autocapitalize: "off", spellcheck: "false", placeholder: TEXT.emailPlaceholder,
      "aria-invalid": invalid && "true", "aria-describedby": invalid && "gb-auth-err",
    });
    input.value = email;
    const btn = text("button", { class: "gb-auth-btn", type: "submit" }, copy[2]);
    const form = h("form", { class: "gb-auth-card", novalidate: true },
      mark(), heading(copy[0]), text("p", { class: "gb-auth-muted" }, copy[1]),
      note && bad(note),
      h("label", { class: "gb-auth-field" }, TEXT.emailLabel, input),
      invalid && bad(TEXT.invalid, "gb-auth-err"),
      btn,
      error && bad(TEXT[error]),
      copy[3] && text("p", { class: "gb-auth-small" }, copy[3]));
    let busy = false;
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      if (busy) return;
      const typed = input.value, addr = typed.trim().toLowerCase();
      if (!EMAIL.test(addr)) return showForm({ kind, email: typed, invalid: true });
      busy = true;
      btn.disabled = true;
      btn.textContent = TEXT.sending;
      const mine = gen, why = await send(addr);
      if (mine !== gen) return;
      if (why) showForm({ kind, email: addr, error: why });
      else showSent(addr, WAIT);
    });
    draw(form);
    if (invalid || focus) input.focus();
  }

  // The second step: where the link went, what the email looks like, and what to do if it doesn't come.
  function showSent(email, wait, error = null) {
    const cfg = window.GO_BAG_CONFIG || {};
    const sender = typeof cfg.senderEmail === "string" ? cfg.senderEmail.trim() : "";
    const again = h("button", { class: "gb-auth-btn gb-auth-ghost", type: "button" });
    const other = text("button", { class: "gb-auth-link", type: "button" }, TEXT.otherEmail);
    const from = h("dd", null, text("b", null, TEXT.fromName), sender && " ", sender && text("span", null, fill(TEXT.fromAddress, { address: sender })));
    const head = heading(TEXT.sentHeading);
    const mine = draw(h("div", { class: "gb-auth-card" },
      mark(), head,
      h("div", null, text("p", null, TEXT.sentTo), text("p", { class: "gb-auth-addr" }, email)),
      h("div", { class: "gb-auth-notice" },
        h("dl", null, text("dt", null, TEXT.from), from, text("dt", null, TEXT.subject), h("dd", null, text("b", null, TEXT.subjectLine))),
        text("p", { class: "gb-auth-muted" }, TEXT.linkLife)),
      text("p", { class: "gb-auth-small" }, TEXT.noEmail),
      error && bad(TEXT[error]),
      h("div", { class: "gb-auth-row" }, again, other),
      text("p", { class: "gb-auth-small" }, TEXT.closeTab)));
    head.focus();

    // Counted from the clock, not from ticks, so a tab the browser slowed down still opens on time.
    const until = Date.now() + wait * 1000;
    const tick = () => {
      const left = Math.ceil((until - Date.now()) / 1000);
      if (left > 0) { again.disabled = true; again.textContent = fill(TEXT.resendIn, { time: clock(left) }); return; }
      stop();
      again.disabled = false;
      again.textContent = TEXT.resend;
    };
    tick();
    if (wait > 0) timer = setInterval(tick, 1000);

    let busy = false;
    again.addEventListener("click", async () => {
      if (again.disabled || busy) return;
      busy = true;
      stop();
      again.disabled = true;
      again.textContent = TEXT.sending;
      const why = await send(email);
      if (mine !== gen) return;
      showSent(email, why === "tooMany" ? WAIT_TOO_MANY : why ? 0 : WAIT, why);
    });
    other.addEventListener("click", () => showForm({ email, focus: true }));
  }

  function showUnavailable() {
    const retry = text("button", { class: "gb-auth-btn", type: "button" }, TEXT.retry);
    retry.addEventListener("click", () => location.reload());
    draw(h("div", { class: "gb-auth-card" }, mark(), heading(TEXT.unavailableHeading), retry));
  }

  // A failed magic link comes back to /app with error=… (and error_code=otp_expired when it was spent
  // or too old), in the hash or the query. Reads it once and takes it out of the address.
  function linkError() {
    const KEYS = ["error", "error_code", "error_description"];
    const parts = { search: location.search.replace(/^\?/, ""), hash: location.hash.replace(/^#/, "") };
    let code = null, failed = false;
    for (const [part, raw] of Object.entries(parts)) {
      const p = new URLSearchParams(raw);
      if (!KEYS.some(k => p.has(k))) continue;
      failed = true;
      code = code || p.get("error_code");
      for (const k of KEYS) p.delete(k);
      parts[part] = p.toString();
    }
    if (!failed) return null;
    // A frame or sandbox can refuse this; the card still shows what happened.
    try { history.replaceState(null, "", location.pathname + (parts.search ? "?" + parts.search : "") + (parts.hash ? "#" + parts.hash : "")); } catch {}
    return code === "otp_expired" ? "expired" : "failed";
  }

  window.goBagSignIn = async (client, opts = {}) => {
    sb = client;
    start = new URLSearchParams(location.search).get("start") === "new" ? "new" : "login";
    await bodyReady();
    if (opts && opts.state === "unavailable") return showUnavailable();
    const link = linkError();
    if (link === "expired") showForm({ kind: "expired" });
    else showForm({ note: link === "failed" ? TEXT.linkFailed : null });
  };
  window.goBagSignIn.TEXT = TEXT;
})();
