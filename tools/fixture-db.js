// Preview only, never published: a stand-in for claude.ai's window.claude whose `db` serves a
// fixture household from memory, so the page boots the way it does on claude.ai, with data in it.
// tools/page.js sets window.GO_BAG_FIXTURE just before this runs. Writes change the memory copy
// only, and every other capability resolves null, as it does when one is missing on claude.ai.
(() => {
  const f = window.GO_BAG_FIXTURE || {};
  const cols = { kits: new Map(), items: new Map(), household: new Map() };
  for (const c of ["kits", "items"]) for (const { id, ...doc } of f[c] || []) cols[c].set(id, doc);
  // Household docs come from the fixture the first time the page names one (household/<name> is the
  // fixture's <name>), so the page's own list decides which there are and none is copied here.
  const named = new Set();
  const household = id => { if (!named.has(id)) { named.add(id); if (f[id]) cols.household.set(id, f[id]); } };
  const copy = x => JSON.parse(JSON.stringify(x));
  const metadata = { fromCache: false, hasPendingWrites: false };
  const subs = new Set();
  const listen = (c, fire) => { const s = { c, fire }; subs.add(s); setTimeout(fire); return () => subs.delete(s); };
  const changed = c => subs.forEach(s => s.c === c && s.fire());
  const col = c => cols[c] || (cols[c] = new Map());
  const db = {
    collection: c => ({
      onSnapshot: cb => listen(c, () => cb({ metadata, docs: [...col(c)].map(([id, d]) => ({ id, data: () => copy(d) })) })),
    }),
    doc: path => {
      const [c, id] = path.split("/");
      if (c === "household") household(id);
      return {
        onSnapshot: cb => listen(c, () => cb({ metadata, id, exists: col(c).has(id), data: () => col(c).has(id) ? copy(col(c).get(id)) : undefined })),
        set: async d => { col(c).set(id, copy(d)); changed(c); },
        delete: async () => { col(c).delete(id); changed(c); },
      };
    },
  };
  window.claude = { use: async name => (name === "db" ? db : null) };
})();
