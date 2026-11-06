#!/usr/bin/env node
// One-off (issue #89, part of #70): moves every kit photo at the root of the `photos` bucket into the
// family household's folder, <family_id>/<name>, so 0003_photo_folders.sql can apply. Run once, on the
// founder's machine, with a service-role key that sits in Doppler `dev` only for the run:
//   doppler run --config dev -- node tools/move-photos.js [--dry-run]
// It moves with Storage's own move, never with SQL on storage.objects: the stored file is keyed by its
// name. It's safe to run twice: a name that already exists in the family folder is skipped, never
// overwritten. It never prints the key. Nothing deployed uses this file.
const BUCKET = "photos";
const PAGE = 100;
const SHOW = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOW = "doppler run --config dev -- node tools/move-photos.js [--dry-run]";

class Stop extends Error {}

// 0 when every move worked (or there was nothing to move), 1 when a move or a listing failed, 2 when
// it refused to start. `fetch`, `stdout` and `stderr` are parameters so the tests need no network.
async function main({ argv = process.argv.slice(2), env = process.env, fetch = globalThis.fetch, stdout = process.stdout, stderr = process.stderr } = {}) {
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const hide = s => key ? String(s).split(key).join("[service key]") : String(s);
  const out = s => stdout.write(hide(s) + "\n");
  const err = s => stderr.write(hide(s) + "\n");

  const unknown = argv.find(a => a !== "--dry-run");
  if (unknown !== undefined) { err(`move-photos: unknown argument ${JSON.stringify(unknown)}. Usage: ${HOW}. Nothing moved.`); return 2; }
  const dry = argv.includes("--dry-run");
  const base = (env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!base || !key) { err(`move-photos: set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Usage: ${HOW}. Nothing moved.`); return 2; }

  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const call = async (path, init = {}) => {
    const r = await fetch(base + path, { ...init, headers });
    const text = await r.text().catch(() => "");
    let data = text;
    try { data = JSON.parse(text); } catch (_) {}
    return { ok: r.ok, status: r.status, data };
  };
  const why = r => `HTTP ${r.status}${r.data && r.data.message ? ` ${r.data.message}` : ""}`;

  // The names of the files (not folders) directly inside `prefix` ("" is the bucket root), every page.
  // Storage lists one folder level, a folder as an entry with id null. A page with nothing new on it
  // stops the listing, so a server that ignores `offset` can't loop it forever.
  const objects = async prefix => {
    const where = prefix ? `${prefix}/` : "the bucket root";
    const seen = new Set(), names = [];
    for (let offset = 0; ; ) {
      const r = await call(`/storage/v1/object/list/${BUCKET}`, {
        method: "POST",
        body: JSON.stringify({ prefix, limit: PAGE, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!r.ok || !Array.isArray(r.data)) throw new Stop(`could not list ${where} (${why(r)})`);
      if (!r.data.length) return names;
      let fresh = 0;
      for (const o of r.data) {
        const entry = `${o && o.id == null ? "folder" : "file"}:${o && o.name}`;
        if (seen.has(entry)) continue;
        seen.add(entry);
        fresh++;
        if (o && o.id != null && typeof o.name === "string" && o.name && !o.name.includes("/")) names.push(o.name);
      }
      if (!fresh) throw new Stop(`listing ${where} repeated itself at offset ${offset}`);
      offset += r.data.length;
    }
  };

  try {
    const h = await call("/rest/v1/households?select=id&name=eq.family", { method: "GET" });
    if (!h.ok || !Array.isArray(h.data)) throw new Stop(`could not read households (${why(h)})`);
    if (h.data.length !== 1) { err(`move-photos: found ${h.data.length} households named 'family', not exactly 1. Nothing moved.`); return 2; }
    const family = h.data[0] && h.data[0].id;
    if (typeof family !== "string" || !UUID.test(family)) { err("move-photos: the family household's id is not a uuid. Nothing moved."); return 2; }

    const root = await objects("");
    const there = new Set(await objects(family));
    const todo = root.filter(n => !there.has(n));
    const already = root.length - todo.length;
    out(`move-photos: ${root.length} photo(s) at the root of '${BUCKET}'; family folder ${family}/`);

    if (dry) {
      out(`dry run: would move ${todo.length}, would skip ${already} already in ${family}/. Nothing changed.`);
      for (const n of todo.slice(0, SHOW)) out(`  ${n} -> ${family}/${n}`);
      if (todo.length > SHOW) out(`  ...and ${todo.length - SHOW} more`);
      out(`root count: ${root.length}`);
      return 0;
    }

    let moved = 0, skipped = already, failed = 0;
    for (const name of todo) {
      const r = await call("/storage/v1/object/move", {
        method: "POST",
        body: JSON.stringify({ bucketId: BUCKET, sourceKey: name, destinationKey: `${family}/${name}` }),
      }).catch(e => ({ ok: false, status: 0, data: { message: e && e.message } }));
      if (r.ok) moved++;
      else if (r.status === 409 || (r.data && (String(r.data.statusCode) === "409" || r.data.error === "Duplicate"))) skipped++;
      else { failed++; err(`failed: ${name} (${why(r)})`); }
    }
    out(`moved ${moved}, skipped ${skipped}, failed ${failed}`);
    const left = (await objects("")).length;
    out(`root count: ${left}`);
    if (left && !failed) out(`${left} root photo(s) already have a copy in ${family}/ and were left for you to compare. 0003 won't apply until the root is empty.`);
    return failed ? 1 : 0;
  } catch (e) {
    err(`move-photos: ${e instanceof Stop ? e.message : `stopped: ${e && e.message}`}.`);
    return 1;
  }
}

module.exports = { main };

if (require.main === module) main().then(code => { process.exitCode = code; });
