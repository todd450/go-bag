// Go Bag's core (issues #112 and #113): data tables, the household model, scoring, shopping and packing.
// It reads the saved household from HOUSEHOLD, never the page or the screen's state S, has no markup and saves
// nothing: check.sh holds it to that. In the browser it is a plain script loaded before the page's own
// (tools/page.js and tools/build-web.js), so its names are globals the page uses; in Node,
// require("./core.js") gives the same names, for the api/ functions and tests.
/* ---------- reference data ---------- */
const CATS = {
  water: ["Water", "bottled water, water pouches or jugs (filters and purification tablets go here too but don't add litres)"],
  food: ["Food", "ration bars, canned, freeze-dried or shelf-stable food"],
  first_aid: ["First aid", "general first-aid kits, adhesive bandages, gauze, antiseptic, tweezers, gloves"],
  wound: ["Wound care", "saline wound and eye wash, butterfly closures, non-stick pads, antibiotic ointment, splinter tweezers"],
  trauma: ["Bleeding control", "tourniquet, hemostatic or compression gauze, pressure (Israeli) bandage, trauma shears"],
  burns: ["Burn care", "burn gel, burn dressings, non-stick pads"],
  splint: ["Splints & sprains", "SAM splint, elastic wrap, triangular bandage or sling, instant cold packs"],
  cpr: ["CPR & airway", "CPR face shield or pocket mask, AED"],
  allergy: ["Allergy & anaphylaxis", "epinephrine auto-injectors, antihistamines"],
  breathing: ["Breathing", "rescue inhaler (albuterol), spacer, nebulizer and its medicine"],
  aspirin: ["Heart attack aid", "chewable 81 mg aspirin (prescribed nitroglycerin goes under Medications)"],
  naloxone: ["Overdose reversal", "naloxone (Narcan) nasal spray"],
  sugar: ["Fast sugar", "glucose tablets or gel for low blood sugar, prescribed glucagon (nasal spray or auto-injector)"],
  seizure: ["Seizure rescue", "prescribed seizure rescue medication (nasal midazolam or diazepam, rectal diazepam), written seizure action plan"],
  co_alarm: ["CO alarm", "battery or plug-in carbon monoxide alarm"],
  bites: ["Bites & stings", "tick remover, sting relief wipes, hydrocortisone cream, instant cold pack"],
  poison: ["Poison safety", "Poison Control number saved and posted, locking medicine box, cabinet latches"],
  diagnostics: ["Health monitoring", "thermometer, pulse oximeter, blood-pressure cuff, glucose meter and test strips"],
  medications: ["Medications", "prescriptions such as nitroglycerin, pain relievers, allergy meds, spare glasses"],
  light: ["Light", "flashlights, headlamps, lanterns, light sticks"],
  power: ["Power", "batteries, power banks, solar or crank chargers, cables"],
  communication: ["Comms", "NOAA or hand-crank radio, whistle, two-way radios, printed contact list"],
  documents: ["Documents & cash", "copies of IDs and insurance, cash, USB drive of records"],
  shelter: ["Shelter & warmth", "emergency blankets, sleeping bags, tarp, tent, hand warmers"],
  clothing: ["Clothing", "change of clothes, rain gear, sturdy shoes, gloves, hats"],
  hygiene: ["Hygiene", "wipes, soap, sanitizer, toothbrush, menstrual products"],
  sanitation: ["Sanitation", "heavy garbage bags, bucket toilet, toilet paper, bleach"],
  tools: ["Tools", "multi-tool, knife, duct tape, utility shut-off wrench, rope, lighter or matches, plastic sheeting"],
  masks: ["Masks", "N95 or P100 respirators"],
  fire_safety: ["Fire safety", "fire extinguisher, escape ladder, fire blanket"],
  car: ["Vehicle gear", "jumper cables, tire inflator, ice scraper, tow strap, flares, shovel"],
  comfort: ["Everyday comfort", "phone charger and cable, snacks, wet wipes, tissues, umbrella, spare socks or sweatshirt, pen and paper, plastic bags, sunscreen, lip balm"],
  pets: ["Pet supplies", "pet food, leash, carrier, bowls, pet medications"],
  baby: ["Baby supplies", "diapers, formula, bottles, baby wipes"],
  kids: ["Kids' comfort", "comfort toy, cards, books, crayons, games for children"],
  other: ["Other", "anything that fits nowhere else"],
};
/* The flat-lay's zones, in the order the Contents panel shows them. Every CATS key is in exactly one, and an
   item whose category isn't in CATS goes to Other. */
const ZONES = [
  { label: "Water & food", cats: ["water", "food"] },
  { label: "First aid & medicine", cats: ["first_aid", "wound", "trauma", "burns", "splint", "cpr", "allergy", "breathing", "aspirin", "naloxone", "sugar", "seizure", "bites", "diagnostics", "medications"] },
  { label: "Light, power & comms", cats: ["light", "power", "communication"] },
  { label: "Shelter, clothing & hygiene", cats: ["shelter", "clothing", "hygiene", "sanitation", "masks"] },
  { label: "Tools & safety", cats: ["tools", "fire_safety", "co_alarm", "poison", "car"] },
  { label: "Documents & cash", cats: ["documents"] },
  { label: "Family & pets", cats: ["pets", "baby", "kids"] },
  { label: "Other", cats: ["comfort", "other"] },
];
const zoneOf = c => ZONES.find(z => z.cats.includes(c)) || ZONES.at(-1);
/* The named essentials a kit needs in five checklist categories. An item's `essential` stores one of these ids,
   or "none" when the household said it is not one of them. Ids are saved in item docs, so they never change once
   shipped: new ones can be added, and an id taken off the list just reads as untagged. `perMed` is needed once
   for each person on daily medication. */
const ESSENTIALS = {
  documents: [{ id: "id_copies", label: "ID copies" }, { id: "insurance", label: "Insurance cards" }, { id: "cash", label: "Cash" }, { id: "records", label: "Records (USB or printed)" }],
  fire_safety: [{ id: "extinguisher", label: "Fire extinguisher" }, { id: "fire_blanket", label: "Fire blanket" }, { id: "escape_ladder", label: "Escape ladder" }],
  communication: [{ id: "radio", label: "Emergency radio" }, { id: "whistle", label: "Whistle" }, { id: "contact_list", label: "Printed contact list" }],
  tools: [{ id: "multitool", label: "Multi-tool or knife" }, { id: "duct_tape", label: "Duct tape" }, { id: "shutoff_wrench", label: "Utility shut-off wrench" }, { id: "fire_starter", label: "Lighter or matches" }],
  medications: [{ id: "pain_reliever", label: "Pain or fever reliever" }, { id: "allergy_med", label: "Allergy medicine" }, { id: "prescriptions", label: "Prescriptions", perMed: true }],
};
const essentialList = cat => Object.hasOwn(ESSENTIALS, cat) ? ESSENTIALS[cat] : [];
/* The essential an item is: an id on its current category's list, "none", or "" (untagged) for anything else. */
function essentialOf(it) {
  const e = it?.essential;
  if (e === "none") return "none";
  return typeof e === "string" && essentialList(it.category).some(x => x.id === e) ? e : "";
}
/* Whether `v` may be saved as the essential of an item in category `cat`: one of its ids, or "none", in the five only. */
const essentialOk = (cat, v) => essentialList(cat).length > 0 && !!v && essentialOf({ category: cat, essential: v }) === v;
/* The essentials one checklist row needs for household `h`. One person's prescriptions carry their name;
   with several, no label says whose is in the kit. */
function essentialsFor(cat, h) {
  const onMeds = (Array.isArray(h?.members) ? h.members : []).map((m, i) => [m, i]).filter(([m]) => m && onDailyMeds(m));
  return essentialList(cat).flatMap(({ id, label, perMed }) => !perMed ? [{ id, label }]
    : onMeds.length === 1 ? [{ id, label: `${personName(...onMeds[0])}'s prescriptions` }]
    : onMeds.map((_, n) => ({ id, label: `${label} (${n + 1} of ${onMeds.length})` })));
}
const AGE = { adult: ["Adult", 2000], teen: ["Teen (13–17)", 2200], child: ["Child (3–12)", 1600], infant: ["Under 3", 1000], senior: ["Senior (65+)", 1800] };
/* An exact age, when given, decides the group and the calories (roughly the USDA estimates for a
   moderately active person); without one the saved group is used. */
const yearsOf = m => m.years === "" || m.years == null || !(num(m.years) >= 0) ? null : Math.min(120, num(m.years));
const groupOf = m => {
  const y = yearsOf(m);
  if (y == null) return AGE[m.age] ? m.age : "adult";
  return y < 3 ? "infant" : y < 13 ? "child" : y < 18 ? "teen" : y < 65 ? "adult" : "senior";
};
const kcalFor = m => {
  const y = yearsOf(m);
  if (y == null) return AGE[groupOf(m)][1];
  return y < 1 ? 800 : y < 4 ? 1000 : y < 9 ? 1400 : y < 14 ? 1800 : y < 19 ? 2200 : y < 65 ? 2000 : 1800;
};
const personNeeds = m => {
  const g = groupOf(m);
  const extra = { infant: " · diapers, formula, wipes", child: " · a comfort or activity item", senior: " · raises cardiac risk" }[g] || "";
  return `${yearsOf(m) == null ? AGE[g][0] + " · " : ""}${kcalFor(m).toLocaleString()} kcal + 3.8 L water a day${extra}`;
};
const ageText = m => { const y = yearsOf(m); return y == null ? AGE[groupOf(m)][0] : `age ${y < 1 ? "under 1" : Math.floor(y)}`; };
const CONDITIONS = {
  meds: "Takes daily medication",
  allergy: "Severe allergy, carries an EpiPen",
  diabetes: "Diabetes",
  heart: "Heart condition",
  asthma: "Asthma or COPD, uses a rescue inhaler",
  seizures: "Epilepsy or seizures",
  opioids: "Takes opioid pain medication",
  device: "Uses a powered medical device",
  mobility: "Limited mobility",
};
/* Conditions that mean someone takes medication every day, so a pharmacy closing cuts them off. */
const DAILY_MEDS = ["meds", "diabetes", "seizures", "opioids"];
const onDailyMeds = m => Array.isArray(m.conditions) && m.conditions.some(c => DAILY_MEDS.includes(c));
/* Words in a person's note naming a health need. Notes never score: a match only offers to switch it on. */
const CONDITION_WORDS = {
  meds: /\b(medications?|medicines?(?! cabinet)|meds|prescription (meds|drugs?|medicines?)|daily pills|blood[- ]pressure|thyroid)\b/,
  allergy: /\b(epi-?pens?|anaphyla\w*|severe allerg\w*)\b/,
  diabetes: /\b(diabet\w*|insulin|blood sugar)\b/,
  heart: /\b(heart (condition|disease|failure|problems?|attack)|cardiac|pacemaker|a-?fib|arrhythmia)\b/,
  asthma: /\b(asthma|copd|inhalers?)\b/,
  seizures: /\b(epilep\w*|seizures?)\b/,
  opioids: /\b(opioids?|oxycodone|oxycontin|hydrocodone|morphine|fentanyl|methadone)\b/,
  device: /\b(oxygen|c-?pap|ventilator|nebuli[sz]er|dialysis)\b/,
  mobility: /\b(wheelchair|crutches|(an?|uses|with) (cane|walker)|limited mobility|mobility (aid|issues?|problems?))\b/,
};
function conditionHints(m) {
  const have = new Set(Array.isArray(m.conditions) ? m.conditions : []);
  const clauses = String(m.needs || "").toLowerCase().replace(/[‘’]/g, "'").split(/[,;.\n]|\band\b|\bbut\b/)
    .filter(c => !/\b(no|not|non|none|never|off|stopped|quit|without|\w+n't)\b/.test(c));
  return Object.keys(CONDITIONS).filter(k => !have.has(k) && !(k === "meds" && onDailyMeds(m)) && clauses.some(c => CONDITION_WORDS[k].test(c)));
}
const KIT_TYPES = { go: "Go-bag", home: "Home supply", car: "Vehicle kit" };
const MODES = {
  evacuate: { label: "Evacuate", kits: ["go", "car"] },
  shelter: { label: "Shelter in place", kits: ["home", "go"] },
  vehicle: { label: "In the car", kits: ["car"] },
};
const LEVELS = { high: ["High", 3], moderate: ["Moderate", 2], low: ["Low", 1], none: ["Not relevant", 0] };
/* How much an emergency matters to this household, on top of how likely it is: multiplies its weight in the score. */
const IMPORTANCE = { normal: ["As much as the others", 1], more: ["More than most", 2], most: ["One of our top priorities", 3] };
const importanceOf = id => (IMPORTANCE[HOUSEHOLD.hazards?.importance?.[id]] || IMPORTANCE.normal)[1];
/* How bad it is to face an emergency unprepared. Fixed per emergency, never re-rated: multiplies its weight in the score.
   Doubling per step keeps a life-threatening gap ahead of a minor one, however much likelier the minor one is. */
const SEVERITY = {
  minor: ["Minor", 1, "uncomfortable, and it can be put right later"],
  serious: ["Serious", 2, "real harm or a big loss, with hours to respond"],
  critical: ["Life-threatening", 4, "minutes matter"],
};
const severityOf = hz => SEVERITY[hz.severity][1];
const weightOf = (hz, rel) => LEVELS[rel][1] * severityOf(hz) * importanceOf(hz.id);
const HAZARDS = [
  { id: "outage", name: "Extended power outage", severity: "serious", mode: "shelter", days: 7, base: "moderate", needs: ["water", "food", "light", "power", "communication", "first_aid", "medications", "hygiene", "sanitation"] },
  { id: "evacuation", name: "Short-notice evacuation", severity: "critical", mode: "evacuate", days: 3, base: "moderate", needs: ["water", "food", "first_aid", "medications", "documents", "light", "power", "communication", "clothing", "hygiene", "shelter"] },
  { id: "housefire", name: "House fire", severity: "critical", mode: "evacuate", days: 1, base: "moderate", needs: ["fire_safety", "documents", "medications", "light", "clothing"] },
  { id: "stranded", name: "Stranded on the road", severity: "serious", mode: "vehicle", days: 1, base: "moderate", vehicle: true, needs: ["water", "food", "shelter", "light", "car", "first_aid", "communication"] },
  { id: "earthquake", name: "Earthquake", severity: "critical", mode: "shelter", days: 14, needs: ["water", "food", "first_aid", "tools", "light", "sanitation", "shelter", "clothing", "communication"] },
  { id: "wildfire", name: "Wildfire & smoke", severity: "critical", mode: "evacuate", days: 3, needs: ["masks", "documents", "water", "food", "medications", "communication", "first_aid", "clothing", "light"] },
  { id: "hurricane", name: "Hurricane", severity: "critical", mode: "shelter", days: 14, needs: ["water", "food", "light", "power", "communication", "first_aid", "tools", "sanitation", "documents"] },
  { id: "flood", name: "Flooding", severity: "critical", mode: "evacuate", days: 3, needs: ["water", "food", "documents", "communication", "light", "first_aid", "clothing", "hygiene"] },
  { id: "tornado", name: "Tornado", severity: "critical", mode: "shelter", days: 1, needs: ["light", "communication", "first_aid", "clothing", "tools"] },
  { id: "winter", name: "Winter storm", severity: "serious", mode: "shelter", days: 7, needs: ["shelter", "water", "food", "light", "power", "communication", "first_aid"] },
  { id: "heat", name: "Extreme heat", severity: "serious", mode: "shelter", days: 3, needs: ["water", "first_aid", "power", "communication", "medications"] },
  { id: "pandemic", name: "Pandemic or quarantine", severity: "serious", mode: "shelter", days: 14, needs: ["water", "food", "masks", "medications", "hygiene", "first_aid"] },
  { id: "chemical", name: "Hazmat shelter-in-place", severity: "critical", mode: "shelter", days: 1, needs: ["tools", "masks", "communication", "water", "light"] },
  { id: "tsunami", name: "Tsunami", severity: "critical", mode: "evacuate", days: 3, needs: ["water", "food", "documents", "communication", "first_aid", "clothing", "light"] },
  /* Everyday: small things that go wrong often. A kit that handles them gets opened, so it gets kept up. */
  { id: "mishap", group: "everyday", name: "Small mishaps on the road", severity: "minor", mode: "vehicle", vehicle: true, days: 1, when: "Spills, delays, a dead phone, a forgotten jacket", base: () => "moderate", needs: ["comfort", "power", "hygiene", "clothing"], kidsToo: true },
  /* Health emergencies: likelihood comes from who lives here; `kits` says which kits are within reach. */
  { id: "cuts", group: "health", name: "Cuts, scrapes and splinters", severity: "minor", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · most weeks", base: h => h.kids || h.infants ? "high" : "moderate", needs: ["wound", "first_aid"] },
  { id: "injury", group: "health", name: "Heavy bleeding", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · call 911, press hard on the wound", base: () => "moderate", needs: ["trauma", "first_aid"] },
  { id: "fall", group: "health", name: "Falls, sprains and broken bones", severity: "serious", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · first hour", base: h => h.kids || h.seniors || h.mobility ? "moderate" : "low", needs: ["splint", "first_aid", "light"] },
  { id: "burns", group: "health", name: "Burns and scalds", severity: "serious", mode: "anywhere", kits: ["home", "go"], days: 1, when: "Mostly the kitchen · first minutes", base: h => h.kids || h.infants ? "moderate" : "low", needs: ["burns", "first_aid", "fire_safety"] },
  { id: "choking", group: "health", name: "Choking", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Mealtimes, small toys · first minutes", base: h => h.kids || h.infants || h.seniors ? "moderate" : "low", needs: ["cpr"] },
  { id: "heartattack", group: "health", name: "Heart attack", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · call 911, then chew an aspirin", base: h => h.heart || h.seniors ? "moderate" : "low", needs: ["aspirin"] },
  { id: "cardiac", group: "health", name: "Cardiac arrest", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · call 911, start CPR", base: h => h.heart || h.seniors ? "moderate" : "low", needs: ["cpr"] },
  { id: "poison", group: "health", name: "Poisoning", severity: "serious", mode: "anywhere", kits: ["home"], days: 1, when: "Mostly at home · call Poison Control first", base: h => h.kids || h.infants ? "moderate" : "low", needs: ["poison"] },
  { id: "overdose", group: "health", name: "Opioid overdose", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · call 911, give naloxone", base: h => h.opioids ? "moderate" : "low", needs: ["naloxone", "cpr"] },
  { id: "co", group: "health", name: "Carbon monoxide poisoning", severity: "critical", mode: "anywhere", kits: ["home"], days: 1, when: "At home · worst in outages, with generators and heaters", base: h => /^(House|Townhouse|Mobile home)$/.test(h.home) ? "moderate" : "low", needs: ["co_alarm"] },
  { id: "bites", group: "health", name: "Bites and stings", severity: "minor", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Pets, outdoors · first hour", base: h => h.pets || h.kids ? "moderate" : "low", needs: ["bites", "wound", "medications"] },
  { id: "anaphylaxis", group: "health", name: "Severe allergic reaction", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · use the epinephrine, then call 911", base: h => h.allergic ? "high" : "none", needs: ["allergy", "first_aid"] },
  { id: "illness", group: "health", name: "Serious illness at home", severity: "serious", mode: "shelter", days: 3, when: "At home · 72 h", base: () => "moderate", needs: ["diagnostics", "medications", "hygiene", "masks", "water", "food"] },
  { id: "meds", group: "health", name: "Medication supply cut off", severity: "serious", mode: "anywhere", kits: ["home", "go"], days: 14, when: "Pharmacy closed or evacuated · 2 weeks", base: h => h.dailyMeds ? "high" : "none", needs: ["medications", "diagnostics"] },
  { id: "asthma", group: "health", name: "Asthma attack", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · smoke and colds set it off", base: h => h.asthma ? "high" : "none", needs: ["breathing"], qty: { breathing: h => Math.max(1, h.asthma) } },
  { id: "seizure", group: "health", name: "Seizure", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · time it, call 911 past 5 minutes", base: h => h.seizures ? "high" : "none", needs: ["seizure"], qty: { seizure: h => Math.max(1, h.seizures) } },
  { id: "lowsugar", group: "health", name: "Low blood sugar", severity: "critical", mode: "anywhere", kits: ["home", "go", "car"], days: 1, when: "Anywhere · 15 g of fast sugar, recheck in 15 minutes", base: h => h.diabetes ? "high" : "none", needs: ["sugar", "diagnostics"], qty: { sugar: h => Math.max(1, h.diabetes) } },
  { id: "device", group: "health", name: "Power loss for a medical device", severity: "critical", mode: "shelter", days: 3, when: "At home · 72 h", base: h => h.devices ? "high" : "none", needs: ["power", "light", "communication"], qty: { power: h => 2 + 2 * h.devices } },
];
const kitsFor = hz => hz.kits || MODES[hz.mode].kits;
const HZ = Object.fromEntries(HAZARDS.map(h => [h.id, h]));

/* ---------- the saved household ---------- */
// The single docs under household/, each kept in HOUSEHOLD under its own name. Boot subscribes to each of these and to
// every collection in COLS, and the page counts as loaded once all of them have answered.
const HOUSEHOLD_DOCS = ["profile", "hazards", "review", "shopping", "plan"];
// The saved household, and the core's only state. S's fields of the same names read and write it.
const HOUSEHOLD = { profile: null, hazards: null, review: null, shopping: null, plan: null, kits: [], items: [] };

/* ---------- helpers ---------- */
const num = x => { const n = +x; return Number.isFinite(n) && n > 0 ? n : 0; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 20);
const f1 = n => (Math.round(n * 10) / 10).toLocaleString();
const clone = o => JSON.parse(JSON.stringify(o ?? null));
const strip = ({ id, ...rest }) => rest;
// An example kit stops being an example once it holds anything you added yourself.
const isExampleKit = k => !!k.example && !HOUSEHOLD.items.some(i => i.kitId === k.id && !i.example);
// Readiness bands, so 4% and 67% don't look alike: each has a word, and the views give it a colour (statusColor)
const BANDS = [[75, "Ready"], [40, "Partway"], [0, "Low"]];
const band = s => BANDS.find(b => s >= b[0]);
const catLabel = c => (Object.hasOwn(CATS, c) ? CATS[c] : CATS.other)[0];
/* Where to buy an item on Amazon: a saved product page when one was found (only a plain amazon.com/dp/ link counts),
   else the search Claude wrote while reading the photo. Nothing searches from the page: Amazon refuses AI agents. */
function amazonLink(it) {
  const url = typeof it?.amazonUrl === "string" ? it.amazonUrl.trim() : "";
  if (/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}$/.test(url)) return { href: url, exact: true };
  const q = typeof it?.shopQuery === "string" ? it.shopQuery.trim() : "";
  return q ? { href: "https://www.amazon.com/s?k=" + encodeURIComponent(q.slice(0, 120)), exact: false } : null;
}
function expState(it) {
  if (!/^\d{4}-\d{2}$/.test(it.expires || "")) return null;
  const [y, m] = it.expires.split("-").map(Number);
  const days = (new Date(y, m, 1) - new Date()) / 864e5;
  return days < 0 ? "expired" : days < 90 ? "soon" : null;
}

/* ---------- the readiness model ---------- */
function household() {
  const p = HOUSEHOLD.profile || {};
  const members = Array.isArray(p.members) && p.members.length ? p.members : [{ age: "adult" }];
  const has = (...cs) => members.filter(m => Array.isArray(m.conditions) && cs.some(c => m.conditions.includes(c))).length;
  return {
    dailyMeds: has(...DAILY_MEDS), allergic: has("allergy"), diabetes: has("diabetes"),
    heart: has("heart"), devices: has("device"), mobility: has("mobility"),
    asthma: has("asthma"), seizures: has("seizures"), opioids: has("opioids"),
    seniors: members.filter(m => groupOf(m) === "senior").length,
    members,
    people: members.length,
    kcalDay: members.reduce((a, m) => a + kcalFor(m), 0),
    pets: (Array.isArray(p.pets) ? p.pets : []).reduce((a, x) => a + num(x.count), 0),
    infants: members.filter(m => groupOf(m) === "infant").length,
    kids: members.filter(m => groupOf(m) === "child").length,
    vehicles: num(p.vehicles),
    home: typeof p.home === "string" ? p.home : "",
  };
}
function relevance(hz, h) {
  const lv = HOUSEHOLD.hazards?.levels?.[hz.id];
  if (hz.vehicle && h.vehicles === 0) return "none";
  if (LEVELS[lv]) return lv;
  return (typeof hz.base === "function" ? hz.base(h) : hz.base) || "none";
}
const FACT_WORDS = { seniors: "aged 65 or over", mobility: "with limited mobility", heart: "with a heart condition", dailyMeds: "on daily medication", allergic: "with a severe allergy", asthma: "with asthma or COPD", seizures: "with epilepsy or seizures", diabetes: "with diabetes", opioids: "on opioid pain medication", devices: "on a powered medical device" };
const FACTS = ["kids", "infants", "pets", ...Object.keys(FACT_WORDS)];
const factText = (k, n) => k === "pets" ? `${n} pet${n > 1 ? "s" : ""}` : k === "kids" || k === "infants" ? `${n} ${n > 1 ? "children" : "child"} ${k === "kids" ? "aged 3 to 12" : "under 3"}` : `${n > 1 ? n + " people" : "someone"} ${FACT_WORDS[k]}`;
/* Why a health or everyday emergency is rated as it is (the location check writes no reason for these):
   the household's own rating, then each fact that alone raises it above a household with none. */
function householdWhy(hz, h) {
  const at = x => (typeof hz.base === "function" ? hz.base(x) : hz.base) || "none";
  const rank = x => LEVELS[at(x)]?.[1] ?? 0;
  const bare = { ...h, home: "" };
  for (const k of FACTS) bare[k] = 0;
  const floor = rank(bare);
  const facts = FACTS.filter(k => h[k] && rank({ ...bare, [k]: h[k] }) > floor).map(k => factText(k, h[k]));
  const home = h.home && rank({ ...bare, home: h.home }) > floor;
  if (hz.vehicle && !h.vehicles) return "There's no vehicle in your household.";
  const own = HOUSEHOLD.hazards?.levels?.[hz.id], lv = at(h), out = [];
  if (LEVELS[own] && own !== lv) out.push(`You ${own === "none" ? "marked this as not relevant" : "rated this " + LEVELS[own][0].toLowerCase()} (${LEVELS[lv][0].toLowerCase()} from who lives here).`);
  if (facts.length) out.push(`Your household includes ${orList(facts, "and")}.`);
  if (home) out.push(`You live in a ${h.home.toLowerCase()}.`);
  if (!facts.length && !home) out.push(floor < LEVELS.moderate[1] ? "Nothing about who lives here or your home raises it." : hz.vehicle ? "Anyone who drives faces this." : "Every household faces this, whoever lives there.");
  return out.join(" ");
}
/* The items in every kit of these types. */
function itemsIn(types) {
  const kitIds = new Set(HOUSEHOLD.kits.filter(k => types.includes(k.type)).map(k => k.id));
  return HOUSEHOLD.items.filter(it => kitIds.has(it.kitId));
}
const stock = types => stockItems(itemsIn(types));
/* What a set of items holds: units per category, litres, calories, and in the five checklist categories
   how many items are tagged with each named essential. Expired items hold nothing. */
function stockItems(items) {
  const st = { count: {}, ess: {}, liters: 0, kcal: 0 };
  for (const it of items) {
    if (expState(it) === "expired") continue;
    const c = CATS[it.category] ? it.category : "other";
    st.count[c] = (st.count[c] || 0) + Math.max(1, num(it.qty));
    const e = essentialOf(it);
    if (e && e !== "none") { const x = st.ess[c] ||= {}; x[e] = (x[e] || 0) + 1; }
    st.liters += num(it.liters); st.kcal += num(it.kcal);
  }
  return st;
}
function needFor(cat, hz, h) {
  const d = hz.days;
  if (Object.hasOwn(ESSENTIALS, cat)) return { need: essentialsFor(cat, h).length };
  if (hz.qty?.[cat]) return { need: hz.qty[cat](h) };
  switch (cat) {
    case "trauma": return { need: 2 };
    case "allergy": return { need: Math.max(1, 2 * h.allergic) };
    case "diagnostics": return { need: h.diabetes ? 2 : 1 };
    case "water": return { need: Math.round((h.people * 3.8 + h.pets * 1) * d), unit: "L" };
    case "food": return { need: h.kcalDay * d, unit: "kcal" };
    case "light": return { need: Math.max(1, Math.ceil(h.people / 2)) };
    case "shelter": case "masks": return { need: h.people };
    case "clothing": return { need: hz.mode === "evacuate" ? h.people : 1 };
    case "car": return { need: 3 };
    case "comfort": return { need: 4 };
    case "pets": return { need: Math.max(1, h.pets) };
    case "baby": return { need: h.infants * 2 };
    case "kids": return { need: h.kids };
    default: return { need: 1 };
  }
}
function model() {
  const h = household();
  const stocks = Object.fromEntries(Object.entries(MODES).map(([m, d]) => [m, stock(d.kits)]));
  const results = HAZARDS.map(hz => {
    const rel = relevance(hz, h);
    const needs = [...hz.needs];
    if (!hz.group && hz.mode !== "vehicle" && h.pets) needs.push("pets");
    if (!hz.group && hz.mode !== "vehicle" && h.infants) needs.push("baby");
    if ((!hz.group && hz.mode !== "vehicle" || hz.kidsToo) && h.kids) needs.push("kids");
    const st = stocks[hz.mode] || stock(kitsFor(hz));
    const rows = needs.map(cat => needRow(cat, hz, h, st));
    return { hz, rel, wt: weightOf(hz, rel), rows, score: scoreRows(rows) };
  });
  const active = results.filter(r => r.wt > 0);
  const tw = active.reduce((a, r) => a + r.wt, 0);
  const overall = tw ? Math.round(active.reduce((a, r) => a + r.wt * r.score, 0) / tw) : null;
  /* One gap per counted category short anywhere, and one per missing named essential: each prescriptions
     slot is its own gap, so two people's prescriptions are two. */
  const g = {};
  for (const r of active) for (const row of r.rows) {
    if (row.cov >= 1) continue;
    const add = (key, gap, share) => {
      const x = g[key] ||= { ...gap, imp: 0, worst: null, hazards: [] };
      x.imp += r.wt * share * row.w;
      x.hazards.push(r.hz.name);
      if (!x.worst || row.need > x.worst.need) x.worst = { ...row, hz: r.hz };
    };
    if (!row.ess) { add(row.cat, { cat: row.cat }, 1 - row.cov); continue; }
    const nth = {};
    for (const e of row.ess) {
      nth[e.id] = (nth[e.id] || 0) + 1;
      if (!e.have) add(`${row.cat}|${e.id}|${nth[e.id]}`, { cat: row.cat, essential: e.id, label: e.label }, 1 / row.need);
    }
  }
  const gaps = Object.values(g).sort((a, b) => b.imp - a.imp);
  const kitName = Object.fromEntries(HOUSEHOLD.kits.map(k => [k.id, k.name]));
  const exp = HOUSEHOLD.items.map(it => ({ it, st: expState(it), kit: kitName[it.kitId] })).filter(x => x.st && x.kit)
    .sort((a, b) => String(a.it.expires).localeCompare(String(b.it.expires)));
  const kitRes = Object.fromEntries(HOUSEHOLD.kits.map(k => [k.id, kitReadiness(k, h, active)]));
  return { h, stocks, results, active, overall, gaps, exp, kitRes };
}
const haveOf = (cat, st) => cat === "water" ? st.liters : cat === "food" ? st.kcal : (st.count[cat] || 0);
function needRow(cat, hz, h, st) {
  const { need, unit } = needFor(cat, hz, h);
  const ess = essentialsFor(cat, h);
  return fillRow({ cat, need, unit, ...(ess.length ? { ess } : {}), w: cat === "water" || cat === "food" || cat === "comfort" && hz.mode === "vehicle" ? 2 : 1 }, st);
}
/* A checklist row's have and coverage from stock `st`. A row of named essentials (`ess`, one per essential,
   each marked `have`) counts each one once, and each prescriptions item for one person, so it never has
   more than it needs. */
function fillRow(r, st) {
  if (!r.ess) { const have = haveOf(r.cat, st); return { ...r, have, cov: r.need > 0 ? Math.min(1, have / r.need) : 1 }; }
  const n = st.ess?.[r.cat] || {}, used = {};
  const ess = r.ess.map(e => ({ ...e, have: (used[e.id] = (used[e.id] || 0) + 1) <= (n[e.id] || 0) }));
  return essCov({ ...r, ess });
}
const essCov = r => { const have = r.ess.filter(e => e.have).length; return { ...r, have, cov: r.need > 0 ? Math.min(1, have / r.need) : 1 }; };
const rawScore = rows => rows.length ? 100 * rows.reduce((a, r) => a + r.w * r.cov, 0) / rows.reduce((a, r) => a + r.w, 0) : 0;
const scoreRows = rows => Math.round(rawScore(rows));
/* The household score if these list entries were in the kits: a counted category fully stocked, and a named
   essential filled once. What closing a gap is worth when there is no kit to work it out exactly. A line in
   the five checklist categories without an essential fills nothing, as the untagged item it makes does. */
function overallIf(M, es) {
  const tw = M.active.reduce((a, r) => a + r.wt, 0);
  if (!tw) return null;
  const full = new Set(es.filter(e => !Object.hasOwn(ESSENTIALS, e.cat)).map(e => e.cat));
  const adds = {};
  for (const e of es) if (Object.hasOwn(ESSENTIALS, e.cat) && typeof e.essential === "string") (adds[e.cat] ||= []).push(e.essential);
  const fill = x => {
    if (full.has(x.cat)) return { ...x, cov: 1 };
    if (!x.ess || !adds[x.cat]) return x;
    const left = [...adds[x.cat]];
    return essCov({ ...x, ess: x.ess.map(e => { const i = e.have ? -1 : left.indexOf(e.id); if (i < 0) return e; left.splice(i, 1); return { ...e, have: true }; }) });
  };
  return Math.round(M.active.reduce((a, r) => a + r.wt * scoreRows(r.rows.map(fill)), 0) / tw);
}
const orList = (xs, word = "or") => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + ` ${word} ` + xs.at(-1);
const gal = l => f1(l / 3.785);
/* A gap in plain language: how much to get, sized for the emergency that needs the most of it. */
function gapPlan(g, h) {
  const row = g.worst, short = Math.max(0, row.need - row.have);
  const kits = kitsFor(row.hz);
  const others = g.hazards.length - 1;
  const why = `For ${row.hz.name.toLowerCase()}${others ? ` and ${others} other emergenc${others > 1 ? "ies" : "y"}` : ""}. Goes in a ${orList(kits.map(k => KIT_TYPES[k].toLowerCase()))}.`;
  const hint = (CATS[g.cat] || CATS.other)[1];
  if (g.essential) return { kits, why, hint, qty: 1, unit: "", name: g.label, title: `Add ${g.label}`, detail: `One of the ${catLabel(g.cat).toLowerCase()} essentials. One in a kit is enough.`, text: `${g.label} (${catLabel(g.cat)})` };
  if (row.unit === "L") {
    const L = Math.ceil(short), days = L / (h.people * 3.8 + h.pets);
    return { kits, why, hint, qty: L, unit: "L", name: "Drinking water", title: `Add ${gal(L)} gallons of drinking water`, detail: `${L} L: ${f1(days)} more days for everyone.`, text: `Drinking water: ${gal(L)} gal (${L} L)` };
  }
  if (row.unit === "kcal") {
    const k = Math.ceil(short / 100) * 100, days = f1(k / h.kcalDay);
    return { kits, why, hint, qty: k, unit: "kcal", name: "Shelf-stable food", title: `Add ${days} days of food for everyone`, detail: `About ${k.toLocaleString()} calories: ${hint}.`, text: `Shelf-stable food: ${days} days (${k.toLocaleString()} kcal)` };
  }
  const n = Math.ceil(short);
  return { kits, why, hint, qty: n, unit: "", name: catLabel(g.cat), title: `${catLabel(g.cat)}: add ${n}`, detail: `Such as ${hint}.`, text: `${catLabel(g.cat)} × ${n}` };
}
/* Readiness if these list entries were bought and put in the kit each would go in, the same sum ticking uses.
   An entry with no kit of the right type yet can only be estimated (overallIf), as if its category were full or its essential filled. */
function scoreIfShopped(M, es) {
  return es.every(e => shopKit(e)) ? scoreIfBought(es) : overallIf(M, es);
}
const scoreIfFilled = (M, gaps) => scoreIfShopped(M, gaps.map(g => shopFromGap(g, M.h)));

/* ---------- shopping list ---------- */
/* What to put in the cart for a gap: store-sized packs, a ballpark US price for comparing and budgeting
   (null means prescription only, 0 means you likely have it at home), and a tip for the aisle. */
const pl = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const whoIs = (h, f) => h.members.map((m, i) => [m, personName(m, i)]).filter(([m]) => f(m)).map(([, n]) => n);
const hasCond = c => m => (m.conditions || []).includes(c);
/* A prescription-only rescue medicine: who it's for, and asking their doctor for a spare for the kit. */
const forWho = who => who.length ? ` for ${orList(who, "and")}` : "";
const rxAsk = (who, what, doctor = "doctor") => `Prescription only. Ask ${who.length ? orList(who, "and") + "'s" : "the"} ${doctor} for ${what}`;
/* What to buy for one named essential (ESSENTIALS): [line, price, tip]. The medications are worked out from who lives here. */
const ESS_BUY = {
  id_copies: ["Copies of everyone's ID, made at home", 0, "Copy the front and back of each driver's license, passport and birth certificate, and seal them in a zip-top bag. Keep the originals somewhere safe."],
  insurance: ["Copies of your insurance cards, front and back", 0, "Health, home and car. Write each policy number and claims phone number on the copy."],
  cash: ["Cash in small bills, in a waterproof pouch", 8, "$100 to $200 in ones, fives and tens. Card machines and ATMs stop working when the power's out. The cash isn't in the price."],
  records: ["A USB drive with scans of your records", 10, "Scan IDs, insurance, prescriptions, deeds and medical records onto it. A printed set in a waterproof pouch works too."],
  extinguisher: ["A 5 lb ABC fire extinguisher (2-A:10-B:C or bigger)", 45, "Mount it near the kitchen exit, not over the stove, and check its gauge every month."],
  fire_blanket: ["A fire blanket for the kitchen", 20, "Hang it near the stove, not over it. It smothers a pan fire: never throw water on burning oil."],
  escape_ladder: ["A fire escape ladder for an upstairs window", 45, "Keep it in the bedroom it hooks onto, and practice opening that window. A three-story ladder costs about $80."],
  radio: ["A hand-crank NOAA emergency radio with a phone charger", 30, "It still gets weather alerts when phones and the internet are down. Crank it every few months to check it works."],
  whistle: ["A loud safety whistle", 5, "Three blasts means help. It carries further than a voice and takes less breath than shouting."],
  contact_list: ["A printed contact list, written at home", 0, "Family, neighbors, doctors, school and an out-of-area contact: phones die and numbers are hard to remember. Seal it in a zip-top bag."],
  multitool: ["A multi-tool with a knife blade", 25, "Pliers, a knife, screwdrivers and a can opener cover most jobs."],
  duct_tape: ["A roll of duct tape", 6, "It patches a tarp, a hose or a broken window. Wind a few feet around a pencil to save room in a go-bag."],
  shutoff_wrench: ["A gas and water shut-off wrench", 12, "Hang it by the gas meter, and note where it is on the Household tab. Only shut the gas off if you smell or hear a leak: the gas company has to turn it back on."],
  fire_starter: ["A lighter and waterproof matches", 8, "Keep them dry in a zip-top bag. After an earthquake, never strike one indoors until you know there's no gas leak."],
};
/* The checked Amazon product for a shopping line (issue #97): one pick is one unit of what the line counts.
   A product is a plain /dp/ page with no tag; `q` is a fixed search for a line that isn't one product.
   Changed only through a pull request, and never built from a line's text, which can name household members. */
const PICKS = {
  water_home: { name: "Reliance Aqua-Tainer 7-gallon container", url: "https://www.amazon.com/dp/B001QC31G6" },
  water_go: { name: "Crystal Geyser Alpine Spring Water", url: "https://www.amazon.com/dp/B0CMV9PF5Y", heavy: true },
  food_go: { name: "Datrex 3,600-calorie ration bar", url: "https://www.amazon.com/dp/B0014EL48S" },
  food_home: { q: "canned soup chili beans" },
  extinguisher: { name: "Amerex B500 5 lb ABC extinguisher, 2-A:10-B:C", url: "https://www.amazon.com/dp/B0777R7JVF" },
  radio: { name: "Midland ER210 hand-crank NOAA radio", url: "https://www.amazon.com/dp/B015QICDD2" },
  masks: { name: "3M 8511 N95 respirators, box of 10", url: "https://www.amazon.com/dp/B0002YKBV2" },
  blanket_go: { name: "UST Survival Blanket 2.0, reusable", url: "https://www.amazon.com/dp/B00YDQJ9EK" },
  light: { name: "Petzl Tikkina headlamp", url: "https://www.amazon.com/dp/B01KYTR76Q" },
  first_aid: { name: "Be Smart Get Prepared 110-piece first-aid kit", url: "https://www.amazon.com/dp/B00CYBXH7G" },
  co_alarm: { name: "Kidde battery carbon monoxide alarm", url: "https://www.amazon.com/dp/B004Y6V6K4" },
  fire_blanket: { name: "Tonyko fiberglass fire blanket", url: "https://www.amazon.com/dp/B076X7CRGH" },
  escape_ladder: { name: "Kidde fire escape ladder", url: "https://www.amazon.com/dp/B00005OU7B" },
  whistle: { name: "Fox 40 Sonik Blast CMG whistle", url: "https://www.amazon.com/dp/B00FOJCL1S" },
  multitool: { name: "Leatherman Wave+ multi-tool", url: "https://www.amazon.com/dp/B079MJ6MLV" },
  duct_tape: { name: "Scotch 2930 multi-use duct tape", url: "https://www.amazon.com/dp/B0013B1XHE" },
  shutoff_wrench: { name: "Green Goods gas and water shut-off tool", url: "https://www.amazon.com/dp/B001CSCC7I" },
};
/* Prescriptions are one line per person on daily medication. With several, every line names them all and
   none says whose is already in a kit, since the kit doesn't record whose an item is. */
function essentialGuide(id, h) {
  const kids = [...whoIs(h, m => groupOf(m) === "infant"), ...whoIs(h, m => groupOf(m) === "child")];
  const allergic = whoIs(h, hasCond("allergy")), onMeds = whoIs(h, onDailyMeds);
  if (id === "pain_reliever") return { line: `A bottle of pain and fever reliever${kids.length ? `, plus children's ibuprofen for ${orList(kids, "and")}` : ""}`, price: kids.length ? 16 : 8,
    tip: `Ibuprofen or acetaminophen. Store-brand versions work the same and cost much less.${kids.length ? " Children's doses go by weight: check the label." : ""}` };
  if (id === "allergy_med") return { line: "A box of antihistamine allergy tablets", price: 8,
    tip: allergic.length ? `It eases hives and itching, but it doesn't stop anaphylaxis: ${orList(allergic, "and")} still ${allergic.length > 1 ? "need" : "needs"} their epinephrine.` : "It eases hives, itching and hay fever. Many kinds don't make you drowsy." };
  if (id === "prescriptions") return onMeds.length > 1
    ? { line: `A spare week of prescriptions for ${orList(onMeds)}`, price: null, tip: `Prescription only. ${orList(onMeds, "and")} each need a spare week of their own, one line each. Ask each pharmacy about an early refill, swap the spare into daily use before it expires, and track refills on the Household tab.` }
    : { line: `A spare week of ${onMeds.length ? onMeds[0] + "'s " : ""}prescriptions`, price: null, tip: `${rxAsk(onMeds, "a spare week to keep in the kit", "pharmacy")}. Swap it into daily use before it expires, and track refills on the Household tab.` };
  const [line, price, tip] = ESS_BUY[id];
  return { line, price, tip, ...(PICKS[id] ? { pick: id, qty: 1 } : {}) };
}
/* A line that is `qty` of one product names its pick; a count of none (water or food of 0) names nothing. */
const pk = (pick, qty) => qty >= 1 ? { pick, qty } : {};
/* A line for a named essential (`ess`, on the category's own list) gets that essential's suggestion;
   anything else, including old lines saved without one, gets the category's. */
function buyGuide(cat, qty, unit, kt, h, ess) {
  if (essentialList(cat).some(x => x.id === ess)) return essentialGuide(ess, h);
  const n = Math.max(1, Math.ceil(num(qty))), q = num(qty), go = kt === "go" || kt === "car";
  const kids = whoIs(h, m => groupOf(m) === "child"), little = whoIs(h, m => groupOf(m) === "infant");
  const allergic = whoIs(h, hasCond("allergy")), onMeds = whoIs(h, onDailyMeds);
  switch (cat) {
    case "water": {
      if (go) { const c = Math.ceil(q / 12); return { line: `${pl(c, "case")} of 24 half-litre bottles`, price: c * 6, ...pk("water_go", c), tip: "Bottles fit in a bag and don't leak. Pick cases with a best-by date printed on them." }; }
      const j = Math.ceil(q / 26.5), g1 = Math.ceil(q / 3.785);
      return { line: `${pl(j, "7-gallon water container")}, filled from your tap`, price: j * 22, ...pk("water_home", j), tip: `The cheapest way to store a lot of water. Keep them out of sunlight and refill every 6 months. Or buy ${g1} one-gallon jugs, about $${Math.round(g1 * 1.5)}, which are easier to carry.` };
    }
    case "food": {
      if (go) { const b = Math.ceil(q / 3600); return { line: pl(b, "3,600-calorie ration bar"), price: b * 10, ...pk("food_go", b), tip: "They last 5 years, need no water or cooking, and won't make you thirsty." }; }
      const safe = allergic.length > 0;
      const cans = Math.ceil(q * .35 / 450), jars = Math.ceil(q * .25 / 6700), crack = Math.ceil(q * .2 / 1800), snack = Math.ceil(q * .2 / (safe ? 1900 : 2700));
      return { line: `${pl(cans, "can")} of soup, chili and beans, ${pl(jars, "big jar")} of ${safe ? "sunflower seed butter" : "peanut butter"}, ${pl(crack, "box", "boxes")} of crackers and ${safe ? pl(snack, "box", "boxes") + " of nut-free granola bars" : pl(snack, "bag") + " of trail mix"}`,
        price: Math.round(cans * 1.8 + jars * 6 + crack * 4 + snack * (safe ? 5 : 8)), pick: "food_home",
        tip: `${safe ? `Nut-free picks because ${orList(allergic, "and")} ${allergic.length > 1 ? "have" : "has"} a severe allergy. Check every label. ` : ""}Choose food that needs no cooking and that you already eat, and get ring-pull cans or a manual can opener. Eat and replace it before it expires.` };
    }
    case "first_aid": return { line: n > 1 ? pl(n, "family first-aid kit") : "A family first-aid kit (around 100 pieces)", price: n * 25, ...pk("first_aid", n), tip: "Get one with a printed contents list, so you can see what's been used and restock it." };
    case "trauma": return { line: pl(n, "CAT or SOF-T tourniquet"), price: n * 30, tip: "Buy from a medical supplier rather than a marketplace seller: counterfeit tourniquets break. A one-hour Stop the Bleed class shows you how to use one." };
    case "burns": return { line: "Burn gel and 2 sterile burn dressings", price: 15, tip: "Cool a burn under running water for 20 minutes first. The gel comes after." };
    case "splint": return { line: "A SAM splint and 2 elastic wraps", price: 20, tip: "A SAM splint rolls flat and bends to fit an arm, leg or ankle." };
    case "cpr": return { line: "A CPR face shield or pocket mask", price: 10, tip: "A CPR class matters far more than this. Many fire stations run free ones." };
    case "allergy": return { line: `${pl(n, "epinephrine auto-injector")}${forWho(allergic)}, plus an antihistamine`, price: null,
      tip: `${rxAsk(allergic, "an extra two-pack to keep in the kit")}, and check its expiry every year.` };
    case "breathing": {
      const who = whoIs(h, hasCond("asthma"));
      return { line: `${pl(n, "spare rescue inhaler")} with a spacer${forWho(who)}`, price: null,
        tip: `${rxAsk(who, "a spare to keep in the kit")}, and check its expiry every year. A spacer gets more of each puff into the lungs, and it's what makes an inhaler work for a small child.` };
    }
    case "aspirin": return { line: "A bottle of chewable 81 mg aspirin", price: 5,
      tip: "For a suspected heart attack, call 911 first, then chew 4 of them (325 mg) unless the person is allergic to aspirin or a doctor has said not to. Keep a strip in every kit." };
    case "naloxone": return { line: pl(n, "two-dose pack of naloxone (Narcan) nasal spray", "two-dose packs of naloxone (Narcan) nasal spray"), price: n * 45,
      tip: "Sold over the counter, and it can't hurt someone who hasn't taken opioids. Call 911, give one spray in a nostril, and give the second after 2 to 3 minutes if they still aren't breathing normally. Many health departments and pharmacies give it out free." };
    case "sugar": {
      const who = whoIs(h, hasCond("diabetes"));
      return { line: `${pl(n, "tube")} of glucose tablets${forWho(who)}`, price: n * 6,
        tip: `At a low, take 15 g (4 tablets) and recheck in 15 minutes. Someone who can't swallow safely gets nothing by mouth: that's what glucagon is for. ${rxAsk(who, "a glucagon nasal spray or auto-injector for the kit")}, then call 911 after giving it.` };
    }
    case "seizure": {
      const who = whoIs(h, hasCond("seizures"));
      return { line: `Rescue seizure medication${forWho(who)} and a printed seizure action plan`, price: null,
        tip: `${rxAsk(who, "a spare dose to keep in the kit", "neurologist")}. Time every seizure: past 5 minutes, give the rescue medication and call 911.` };
    }
    case "co_alarm": return { line: pl(n, "battery carbon monoxide alarm"), price: n * 30, ...pk("co_alarm", n),
      tip: "Put one on each floor and outside the bedrooms. Never run a generator, grill or camp stove indoors or in the garage, even with the door open. If it sounds, get everyone outside before calling 911." };
    case "diagnostics": {
      const dia = whoIs(h, hasCond("diabetes"));
      return dia.length ? { line: `A spare glucose meter and test strips for ${orList(dia, "and")}`, price: 40, tip: "Keep it with spare lancets and fast sugar such as glucose tablets." }
        : { line: "A digital thermometer and a fingertip pulse oximeter", price: 30, tip: "Low oxygen readings (under 92%) are a reason to get help fast." };
    }
    case "medications": {
      const kidsMed = [...little, ...kids];
      return { line: `Pain relievers, an antihistamine and anti-diarrhea tablets${kidsMed.length ? `, plus children's ibuprofen for ${orList(kidsMed, "and")}` : ""}`, price: kidsMed.length ? 30 : 20,
        tip: onMeds.length ? `${orList(onMeds, "and")} also ${onMeds.length > 1 ? "need" : "needs"} a spare week of daily medication. Ask the pharmacy about an early refill, and track it on the Household tab.` : "Store-brand versions work the same and cost much less. Spare glasses go here too." };
    }
    case "light": return { line: pl(n, "LED headlamp"), price: n * 12, ...pk("light", n), tip: "Headlamps keep both hands free. Get ones that take the same AA or AAA batteries as your radio." };
    case "power": return { line: "A 20,000 mAh power bank and a pack of lithium AA batteries", price: 40,
      tip: h.devices ? "Someone uses a powered medical device. Ask its supplier for a backup battery sized for it: a power bank won't be enough." : "Charge the power bank every 3 months. Lithium AAs keep for about 20 years in storage." };
    case "communication": return { line: "A hand-crank NOAA weather radio", price: 30, ...pk("radio", 1), tip: "Pick one with a USB port so it can charge a phone. Put a printed contact list next to it." };
    case "documents": return { line: "A waterproof document pouch, a USB drive and cash in small bills", price: 15, tip: "Copy IDs, insurance and prescriptions onto the drive. Card machines stop working when the power's out. The cash isn't in the price." };
    case "shelter": return go ? { line: pl(n, "reusable emergency blanket"), price: n * 5, ...pk("blanket_go", n), tip: "The thicker reusable kind lasts. Thin foil ones tear the first time." }
      : { line: pl(n, "warm blanket or sleeping bag", "warm blankets or sleeping bags"), price: 0, tip: "Spare bedding from home counts. Put it in the bin and add it to the kit." };
    case "clothing": return { line: n > 1 ? `A change of clothes for ${h.members.length <= n ? "everyone" : n + " people"}` : "A change of clothes", price: 0, tip: `From your closet: sturdy shoes, socks, a rain jacket and a warm layer.${kids.length + little.length ? " Size kids' clothes up each year." : ""}` };
    case "hygiene": return { line: "Wet wipes, hand sanitizer, soap and travel toothbrushes", price: 20, tip: "Add menstrual products and any skin or eye care people use every day." };
    case "sanitation": return { line: "A 5-gallon bucket with a toilet seat lid, heavy-duty bags and kitty litter", price: 35, tip: "After an earthquake toilets may not flush for weeks. It's the thing people most often wish they'd bought." };
    case "tools": return { line: "A multi-tool, duct tape and a gas shut-off wrench", price: 40, tip: "Hang the wrench by the gas meter, and note where it is on the Household tab." };
    case "masks": { const packs = Math.ceil(n / 10); return { line: `${pl(packs, "pack")} of 10 N95 masks`, price: packs * 15, ...pk("masks", packs), tip: kids.length + little.length ? `Adult masks won't seal on small faces. Look for kids' sizes for ${orList([...kids, ...little], "and")}.` : "Look for NIOSH approval printed on each mask." }; }
    case "fire_safety": return { line: "An ABC fire extinguisher (2-A:10-B:C or bigger)", price: 45, ...pk("extinguisher", 1), tip: "Mount it near the kitchen exit, not over the stove." };
    case "wound": return { line: "Saline wound wash, butterfly closures, non-stick pads and fine-point tweezers", price: 20, tip: "Rinse a cut under clean running water for a few minutes, then close and cover it. Saline also works as an eye wash." };
    case "bites": return { line: "A tick remover, sting relief wipes, hydrocortisone cream and an instant cold pack", price: 18,
      tip: `Pull ticks straight out, close to the skin. Wash any animal bite with soap and water for 5 minutes and see a doctor if it broke the skin.${allergic.length ? ` If ${orList(allergic)} ${allergic.length > 1 ? "are" : "is"} stung, follow their anaphylaxis plan.` : " Swelling of the face or trouble breathing after a sting means call 911."}` };
    case "poison": return { line: little.length + kids.length ? "A locking medicine box and cabinet latches" : "A locking medicine box", price: little.length + kids.length ? 35 : 25,
      tip: "Save Poison Control (1-800-222-1222 in the US) in every phone and on the fridge, and call it before doing anything else. Don't make anyone vomit." };
    case "comfort": return { line: `A car comfort pouch: a phone cable and car charger, snacks, wet wipes, tissues, spare socks and an umbrella${kids.length + little.length ? `, plus a small treat for ${orList([...kids, ...little], "and")}` : ""}`, price: 35,
      tip: "It's the bag you'll actually open: a spilled drink, a long wait, a dead phone, sudden rain. Swap the snacks every few months so they're ones people want." };
    case "car": return { line: "Jumper cables, a tire inflator and an ice scraper", price: 70, tip: "A plug-in tire inflator is easier than a spare tire on the side of the road." };
    case "pets": {
      const kinds = (HOUSEHOLD.profile?.pets || []).map(p => String(p.kind || "").toLowerCase()).filter(Boolean);
      return { line: `A week of food for the ${kinds.length ? orList(kinds, "and") : "pets"}, a spare leash and a collapsible bowl`, price: 35 * Math.max(1, h.pets), tip: "Add a copy of vaccination records and a recent photo, in case you get separated." };
    }
    case "baby": return { line: `Diapers, wipes and a week of formula or toddler food${little.length ? ` for ${orList(little, "and")}` : ""}`, price: 45, tip: "Check the size before you buy: kids outgrow diapers between restocks." };
    case "kids": return { line: kids.length ? `A small comfort kit each for ${orList(kids, "and")}` : pl(n, "comfort kit"), price: n * 10, tip: "A toy, cards and a book. Let them choose: something familiar helps more than something new." };
    default: return { line: `${catLabel(cat)} × ${n}`, tip: "" };
  }
}
/* The kit item a list entry becomes when ticked. A line for a named essential makes an item already tagged with it. */
const itemFromShop = (e, kitId) => ({ kitId, name: e.name || catLabel(e.cat), category: e.cat, qty: e.unit ? 1 : Math.max(1, num(e.qty)), liters: e.unit === "L" ? num(e.qty) : 0, kcal: e.unit === "kcal" ? num(e.qty) : 0, expires: "", note: "Bought from the shopping list", source: "list",
  ...(essentialList(e.cat).some(x => x.id === e.essential) ? { essential: e.essential } : {}) });
/* Household readiness if these entries were bought and put in their kits: the same sum ticking them does. */
function scoreIfBought(list) {
  const add = list.filter(e => CATS[e.cat] && shopKit(e)).map(e => ({ id: "_sim", ...itemFromShop(e, shopKit(e)) }));
  if (!add.length) return model().overall;
  HOUSEHOLD.items.push(...add);
  try { return model().overall; } finally { HOUSEHOLD.items.splice(HOUSEHOLD.items.length - add.length); }
}
/* A list entry with everything the row shows, worked out from the household as it is now. */
function shopInfo(e, M) {
  if (!CATS[e.cat]) return { line: e.text, sub: "", tip: "", gain: 0 };
  const kt = HOUSEHOLD.kits.find(k => k.id === (e.done ? e.inKit : shopKit(e)))?.type || (Array.isArray(e.kits) && e.kits[0]) || "home";
  const b = buyGuide(e.cat, e.qty, e.unit, kt, M.h, e.essential);
  // The bold line says what to buy; below it, water and food say how much and everything else its category
  return { ...b, sub: e.unit ? e.text : catLabel(e.cat), gain: e.done || e.kitId === "none" || M.overall == null ? 0 : Math.max(0, scoreIfShopped(M, [e]) - M.overall) };
}
/* The one trip that buys an open line (#123): free is from home, no price the pharmacy, a checked product Amazon, else a
   store run. `i` is its shopInfo, when the caller has it. TRIPS is Review's order. */
const TRIPS = { home: "From home", store: "One store run", amazon: "Amazon", pharmacy: "Pharmacy" };
const tripOf = (e, M, i = shopInfo(e, M)) => i.price === 0 ? "home" : i.price === null ? "pharmacy" : PICKS[i.pick]?.url ? "amazon" : "store";
const shopItems = () => Array.isArray(HOUSEHOLD.shopping?.items) ? HOUSEHOLD.shopping.items : [];
/* Gaps and list lines match on category plus essential. Each line still to buy covers one gap, so two
   prescriptions lines cover two people's, and an old line with no essential covers none of the five's. */
const gapKey = x => `${x.cat}|${typeof x.essential === "string" ? x.essential : ""}`;
function splitListed(gaps, lines = shopItems().filter(x => !x.done)) {
  const n = new Map();
  for (const e of lines) n.set(gapKey(e), (n.get(gapKey(e)) || 0) + 1);
  const on = [], off = [];
  for (const g of gaps) { const k = gapKey(g), left = n.get(k) || 0; if (left) { n.set(k, left - 1); on.push(g); } else off.push(g); }
  return { on, off };
}
// A gap inside a sentence: an essential as named, a category lower-cased unless it starts with an acronym ("CPR & airway")
const gapName = g => g.essential ? g.label : catLabel(g.cat).replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase());
// A gap's shopping line. Planned from a kit (#116), the line keeps that kit's id, so ticking it puts the item there.
function shopFromGap(g, h, kitId) {
  const p = gapPlan(g, h);
  return { id: uid(), cat: g.cat, ...(g.essential ? { essential: g.essential } : {}), qty: p.qty, unit: p.unit, name: p.name, text: p.text, note: p.hint, kits: p.kits, kitId: ownKit(kitId), done: false, at: Date.now() };
}
// The id of one of the household's kits, else "": "none" and anything else name no kit
const ownKit = id => id !== "none" && HOUSEHOLD.kits.some(k => k.id === id) ? id : "";
/* The kit a bought item goes into: the one picked on the row, else the first kit of a type that covers the gap. */
function shopKit(e) {
  if (e.kitId === "none") return "";
  if (e.kitId && HOUSEHOLD.kits.some(k => k.id === e.kitId)) return e.kitId;
  const types = Array.isArray(e.kits) ? e.kits : [];
  const k = HOUSEHOLD.kits.filter(k => types.includes(k.type)).sort((a, b) => types.indexOf(a.type) - types.indexOf(b.type) || (a.createdAt || 0) - (b.createdAt || 0))[0];
  return k ? k.id : "";
}
/* A kit's share of the household gaps: those whose line shopKit sends there, in M.gaps order. "" is the gaps no kit takes. */
const kitGaps = (M, kitId) => M.gaps.filter(g => shopKit(shopFromGap(g, M.h)) === kitId);
/* Each kit type has its own standard; relevant hazards of the matching mode add their needs to it. */
const KIT_STD = {
  go: { label: "72-hour go-bag", mode: "evacuate", days: 3, needs: ["water", "food", "first_aid", "medications", "documents", "light", "power", "communication", "clothing", "hygiene", "shelter", "tools"] },
  home: { label: "2-week home supply", mode: "shelter", days: 14, needs: ["water", "food", "first_aid", "medications", "light", "power", "communication", "hygiene", "sanitation", "tools", "shelter", "fire_safety"] },
  car: { label: "24-hour car kit", mode: "vehicle", days: 1, needs: ["water", "food", "shelter", "light", "car", "first_aid", "communication", "tools", "comfort"] },
};
function kitReadiness(kit, h, active, items = HOUSEHOLD.items.filter(i => i.kitId === kit.id)) {
  const std = KIT_STD[kit.type] || KIT_STD.go;
  const serves = Math.min(50, Math.round(num(kit.serves))) || h.people;
  const whole = serves >= h.people;
  const kh = { ...h, people: serves, kcalDay: whole ? h.kcalDay : Math.round(serves * h.kcalDay / h.people), pets: whole ? h.pets : 0, infants: whole ? h.infants : 0, kids: whole ? h.kids : 0 };
  const drivers = active.filter(r => r.hz.kits ? r.hz.kits.includes(kit.type) : r.hz.mode === std.mode);
  const qty = Object.assign({}, ...drivers.map(r => r.hz.qty || {}));
  const needs = new Set(std.needs);
  for (const r of drivers) { r.hz.needs.forEach(n => needs.add(n)); if (r.hz.kidsToo && kh.kids) needs.add("kids"); }
  if (std.mode !== "vehicle" && kh.pets) needs.add("pets");
  if (std.mode !== "vehicle" && kh.infants) needs.add("baby");
  if (std.mode !== "vehicle" && kh.kids) needs.add("kids");
  if (std.mode !== "shelter") needs.delete("fire_safety");
  const st = stockItems(items);
  const rows = [...needs].map(cat => needRow(cat, { mode: std.mode, days: std.days, qty }, kh, st));
  return { std, serves, whole, h, kh, rows, score: scoreRows(rows), drivers };
}

/* ---------- what it costs (#138) ---------- */
/* Dollars saved on an item, or null when the field is empty, cleared or not a price. $0 is a price: a gift. */
const dollars = x => x === "" || x == null || !Number.isFinite(+x) || +x < 0 ? null : +x;
const cents = n => Math.round(n * 100) / 100;
/* What an owned item cost, in a kit of type `kt`: `paid` (from a receipt), else `unitPrice` (its current price, Amazon by
   default) × qty, else what the shopping list would charge for the same category and amount. Both fields are found and
   saved from a Claude session, the way amazonUrl is: the page never reads Amazon or a bank. null prices nothing. */
function itemCost(it, kt, h) {
  const paid = dollars(it.paid);
  if (paid != null) return { price: paid, src: "paid" };
  const n = Math.max(1, num(it.qty)), unit = dollars(it.unitPrice);
  if (unit != null) return { price: cents(unit * n), src: "price" };
  const c = it.category;
  if (!Object.hasOwn(CATS, c) || c === "other") return { price: null, src: "estimate" };
  const [amt, u] = c === "water" ? [num(it.liters), "L"] : c === "food" ? [num(it.kcal), "kcal"] : [n, ""];
  // Water or food with no litres or calories (a filter, purification tablets) says nothing of how much: unpriced, not $0
  if (!amt) return { price: null, src: "estimate" };
  const ess = essentialOf(it), p = buyGuide(c, amt, u, kt, h, ess).price ?? null;
  // A named essential is priced for one, so two extinguishers cost two
  return { price: p != null && essentialList(c).some(x => x.id === ess) ? p * n : p, src: "estimate" };
}
const kitTypeOf = it => HOUSEHOLD.kits.find(k => k.id === it.kitId)?.type || "home";
/* What a set of items cost: the total of the priced ones, how many nothing prices, and how much of it was from receipts. */
function spentOn(items, h) {
  const s = { total: 0, unpriced: 0, paid: 0, n: 0 };
  for (const it of items) {
    if (it.example) continue;
    const c = itemCost(it, kitTypeOf(it), h);
    s.n++;
    if (c.price == null) s.unpriced++;
    else { s.total = cents(s.total + c.price); if (c.src === "paid") s.paid = cents(s.paid + c.price); }
  }
  return s;
}
/* What checklist rows are short, at the shopping list's prices for a kit of type `kt`: each counted row's shortfall
   and each missing essential. Prescriptions have no price, so they are counted, not added. */
function shortOf(rows, kt, h) {
  const s = { total: 0, unpriced: 0, free: 0 };
  const add = p => { if (p == null) s.unpriced++; else { s.total += p; if (!p) s.free++; } };
  for (const r of rows) {
    if (r.cov >= 1) continue;
    if (r.ess) r.ess.filter(e => !e.have).forEach(e => add(essentialGuide(e.id, h).price));
    else add(buyGuide(r.cat, r.need - r.have, r.unit || "", kt, h).price);
  }
  return s;
}
/* A list line's price, for the kit it goes in, as Review and the plan bar price it (undefined outside CATS). */
const lineCost = (e, h) => CATS[e.cat] ? buyGuide(e.cat, e.qty, e.unit, HOUSEHOLD.kits.find(k => k.id === shopKit(e))?.type || (Array.isArray(e.kits) && e.kits[0]) || "home", h, e.essential).price : undefined;
/* A kit: what its items cost, and what taking its own checklist (`r`, from kitReadiness) to 100% would. */
const kitCost = (kit, r, h) => ({ spent: spentOn(HOUSEHOLD.items.filter(i => i.kitId === kit.id), h), toGet: shortOf(r.rows, kit.type, r.kh) });
/* An emergency, at its full cost: what's in the kits it counts, in the categories it needs, and what it's short.
   Supplies serve several emergencies, so emergencies don't add up to the household's total. */
function hzCost(r, h) {
  const cats = new Set(r.rows.map(x => x.cat)), kits = kitsFor(r.hz);
  return { spent: spentOn(itemsIn(kits).filter(i => cats.has(i.category)), h), toGet: shortOf(r.rows, kits[0], h) };
}
/* The household: every item in a kit, and every gap bought once, as planning them all would price them. */
function householdCost(M) {
  const kits = new Set(HOUSEHOLD.kits.map(k => k.id)), toGet = { total: 0, unpriced: 0 };
  for (const g of M.gaps) { const p = lineCost(shopFromGap(g, M.h), M.h); if (p === null) toGet.unpriced++; else toGet.total += p || 0; }
  return { spent: spentOn(HOUSEHOLD.items.filter(i => kits.has(i.kitId)), M.h), toGet };
}

/* ---------- weight and space ---------- */
/* One unit of each category weighs about `g` grams and takes `ml` of bag space; an item with its own
   grams or ml uses those. Water and food are estimated from their litres and calories. `lite` is a
   lighter kind of the same thing that counts the same on the checklist, offered as a swap. */
const PACK = {
  water: { g: 100, ml: 300 }, food: { g: 300, ml: 400 },
  first_aid: { g: 400, ml: 1500, lite: { name: "compact first-aid pouch", g: 150, ml: 500, trade: "covers everyday cuts; keep bleeding control separate" } },
  wound: { g: 150, ml: 400 }, trauma: { g: 150, ml: 350 }, burns: { g: 100, ml: 300 }, splint: { g: 150, ml: 600 },
  cpr: { g: 60, ml: 150 }, allergy: { g: 60, ml: 150 }, breathing: { g: 60, ml: 200 }, aspirin: { g: 30, ml: 60 },
  naloxone: { g: 40, ml: 100 }, sugar: { g: 60, ml: 150 }, seizure: { g: 40, ml: 100 }, co_alarm: { g: 250, ml: 500 }, bites: { g: 60, ml: 150 }, poison: { g: 50, ml: 100 },
  diagnostics: { g: 150, ml: 400 }, medications: { g: 100, ml: 200 },
  light: { g: 300, ml: 800, lite: { name: "headlamp", g: 90, ml: 200, trade: "hands-free, though it lights less of a room than a lantern" } },
  power: { g: 250, ml: 300 }, communication: { g: 350, ml: 1000 }, documents: { g: 150, ml: 300 },
  shelter: { g: 900, ml: 3000, lite: { name: "emergency bivvy", many: "emergency bivvies", g: 110, ml: 250, trade: "far lighter, but less warm than a sleeping bag" } },
  clothing: { g: 600, ml: 2500 }, hygiene: { g: 150, ml: 300 }, sanitation: { g: 400, ml: 1200 },
  tools: { g: 400, ml: 700, lite: { name: "multi-tool", ess: "multitool", g: 250, ml: 150, trade: "one tool for most small jobs" } },
  masks: { g: 15, ml: 100 }, fire_safety: { g: 1500, ml: 3000 }, car: { g: 1500, ml: 3000 },
  comfort: { g: 150, ml: 400 }, pets: { g: 500, ml: 1500 }, baby: { g: 400, ml: 1500 }, kids: { g: 200, ml: 600 }, other: { g: 300, ml: 600 },
};
const WATER_G = 1040, WATER_ML = 1100, FOOD_KCAL_G = 2.5, BAR_KCAL_G = 4.8, BAR_KCAL = 3600;
/* An item's weight and size for the whole line and per unit; `est` when either is a guess. */
function itemLoad(it) {
  const c = Object.hasOwn(CATS, it.category) ? it.category : "other", q = Math.max(1, num(it.qty)), p = Object.hasOwn(PACK, c) ? PACK[c] : PACK.other;
  const L = c === "water" ? num(it.liters) : 0, kc = c === "food" ? num(it.kcal) : 0;
  const estG = L ? L * WATER_G : kc ? kc / FOOD_KCAL_G : p.g * q;
  const estMl = L ? L * WATER_ML : kc ? kc / FOOD_KCAL_G * 1.6 : p.ml * q;
  const g = num(it.grams) || estG, ml = num(it.ml) || estMl;
  return { g, ml, q, unitG: g / q, unitMl: ml / q, est: !num(it.grams) || !num(it.ml), estG, estMl };
}
/* Who can carry what: about a fifth of body weight for an adult, less for teens, children 5 and up,
   seniors or anyone with limited mobility, nothing for children under 5. One bag is one person's load. */
const bodyKg = m => { const y = yearsOf(m); return y == null ? { infant: 10, child: 25, teen: 55, adult: 75, senior: 70 }[groupOf(m)] : y < 13 ? 2 * y + 8 : y < 18 ? 55 : y < 65 ? 75 : 70; };
const carryShare = m => { const y = yearsOf(m), g = groupOf(m); return g === "infant" || y != null && y < 5 ? 0 : hasCond("mobility")(m) || g === "senior" || g === "child" ? .1 : g === "teen" ? .15 : .2; };
const carryKg = m => Math.round(bodyKg(m) * carryShare(m) * 2) / 2;
const PACK_L = { go: 40, car: 60 };
const CONTAINER_KINDS = { backpack: "Backpack", duffel: "Duffel", box: "Bin or box", other: "Other" };
const CTR_MAX = { name: 60, size: 40, rating: 20 };
const cutText = (v, n) => typeof v === "string" ? [...v.trim()].slice(0, n).join("").trim() : "";
/* The kit's own bag or bin (#96), typed by hand, so any value may be odd: the only reader of kit.container.
   Its litres stay in kit.bagL; emptyG 0 means its empty weight wasn't entered. */
function containerOf(kit) {
  const c = kit.container;
  if (!PACK_L[kit.type] || Object.prototype.toString.call(c) !== "[object Object]") return null;
  return { kind: typeof c.kind === "string" && Object.hasOwn(CONTAINER_KINDS, c.kind) ? c.kind : "other", name: cutText(c.name, CTR_MAX.name),
    emptyG: Math.round(num(c.emptyG)), size: cutText(c.size, CTR_MAX.size), rating: cutText(c.rating, CTR_MAX.rating) };
}
/* Go-bags are limited by what their strongest carrier can lift, the bag's own weight included, and by
   the bag's litres; car kits by the space they get in the trunk. Home supplies have no limits. */
function kitLimits(kit, h) {
  if (!PACK_L[kit.type]) return null;
  const carriers = h.members.map((m, i) => ({ name: personName(m, i), kg: carryKg(m) })).filter(c => c.kg > 0).sort((a, b) => b.kg - a.kg);
  const suggestedKg = kit.type === "go" ? carriers[0]?.kg || null : null, container = containerOf(kit);
  return { kg: kit.type === "go" ? num(kit.carryKg) || suggestedKg : null, L: num(kit.bagL) || PACK_L[kit.type], suggestedKg, suggestedL: PACK_L[kit.type],
    carrier: carriers[0]?.name || "", totalKg: carriers.reduce((a, c) => a + c.kg, 0), carriers: carriers.length, container, emptyG: container?.emptyG || 0 };
}
/* What to pack within a kit's limits. Each line splits into steps of whole units (at most 12 per
   line); the search adds the step that gains the most readiness for its share of the tighter limit,
   then tries one-for-one swaps, refilling after each. The score is capped at need per checklist line,
   so each extra unit is worth less than the last, and this lands at or near the best possible pack.
   Water filters and tablets add no litres but are always kept. Points come from kitReadiness on the
   chosen items, so they are the points the kit would really score. The bag's own weight comes off the
   carry limit, so it changes what fits but never what an item scores; g and every weight here are items only. */
function packPlan(kit, ready, lim) {
  const lines = HOUSEHOLD.items.filter(i => i.kitId === kit.id).map(it => ({ it, ...itemLoad(it) }));
  const limG = lim.kg ? Math.max(0, lim.kg * 1000 - (lim.emptyG || 0)) : Infinity, limMl = lim.L * 1000;
  const pick = keep => lines.flatMap((l, i) => keep[i] ? [{ ...l.it, qty: keep[i], liters: num(l.it.liters) * keep[i] / l.q, kcal: num(l.it.kcal) * keep[i] / l.q }] : []);
  const raw = keep => { const st = stockItems(pick(keep)); return rawScore(ready.rows.map(r => fillRow(r, st))); };
  /* Water filters and tablets are kept whatever the limits. Items in the five checklist categories not yet tagged
     earn nothing until they are, but are likely an essential: they go back in while the pack has room, and are
     never offered to take out. */
  const must = lines.map(l => l.it.category === "water" && !num(l.it.liters));
  const untagged = lines.map(l => ready.rows.some(r => r.ess && r.cat === l.it.category) && !essentialOf(l.it) && expState(l.it) !== "expired");
  const sumG = keep => lines.reduce((a, l, i) => a + l.unitG * keep[i], 0), sumMl = keep => lines.reduce((a, l, i) => a + l.unitMl * keep[i], 0);
  const fitsIn = keep => sumG(keep) <= limG + 1e-6 && sumMl(keep) <= limMl + 1e-6;
  const step = (i, keep, dir) => dir > 0 ? Math.min(lines[i].q - keep[i], Math.ceil(lines[i].q / 12)) : Math.min(keep[i], Math.ceil(lines[i].q / 12));
  const full = lines.map(l => l.q), fullRaw = raw(full);
  const fits = fitsIn(full);
  let best = null;
  if (!fits) {
    let keep = lines.map((l, i) => must[i] ? l.q : 0), cur = raw(keep);
    const fill = () => {
      for (;;) {
        let pickI = -1, pickR = 0, pickS = 0, pickN = null;
        lines.forEach((l, i) => {
          const n = step(i, keep, 1); if (!n) return;
          const next = keep.slice(); next[i] += n;
          if (!fitsIn(next)) return;
          const s = raw(next), gain = s - cur; if (gain <= 1e-9) return;
          const r = gain / (Math.max(l.unitG * n / limG, l.unitMl * n / limMl) || 1e-9);
          if (r > pickR) { pickI = i; pickR = r; pickS = s; pickN = next; }
        });
        if (pickI < 0) return;
        keep = pickN; cur = pickS;
      }
    };
    const swap = () => {
      for (let a = 0; a < lines.length; a++) if (keep[a]) for (let b = 0; b < lines.length; b++) {
        if (a === b || !step(b, keep, 1)) continue;
        const next = keep.slice(); next[a] -= step(a, keep, -1); next[b] += step(b, keep, 1);
        if (!fitsIn(next)) continue;
        const s = raw(next); if (s > cur + 1e-9) { keep = next; cur = s; return true; }
      }
      return false;
    };
    let rounds = 0;
    do fill(); while (swap() && ++rounds < 60);
    lines.forEach((l, i) => { while (untagged[i] && keep[i] < l.q) { const next = keep.slice(); next[i]++; if (!fitsIn(next)) break; keep = next; } });
    const chosen = pick(keep);
    best = { keep, items: chosen, score: kitReadiness(kit, ready.h, ready.drivers, chosen).score, g: sumG(keep), ml: sumMl(keep),
      leave: lines.map((l, i) => ({ it: l.it, n: l.q - keep[i], g: l.unitG * (l.q - keep[i]) })).filter(x => x.n > 0).sort((a, b) => b.g - a.g) };
  }
  /* Units that add nothing: taken out heaviest first, each only if the kit keeps every point. */
  const lean = full.slice(), onList = new Set(ready.rows.map(r => r.cat));
  for (const i of lines.map((l, i) => i).sort((a, b) => lines[b].unitG - lines[a].unitG)) {
    const l = lines[i];
    if (must[i] || untagged[i] || l.it.category === "food" && !num(l.it.kcal)) continue;
    let lo = 0, hi = lean[i];
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2), t = lean.slice(); t[i] -= mid; if (raw(t) >= fullRaw - 1e-9) lo = mid; else hi = mid - 1; }
    lean[i] -= lo;
  }
  const takeOut = lines.map((l, i) => ({ it: l.it, n: l.q - lean[i], g: l.unitG * (l.q - lean[i]),
    why: expState(l.it) === "expired" ? "Expired, so it adds nothing" : essentialOf(l.it) === "none" ? "Not one of the essentials" : onList.has(CATS[l.it.category] ? l.it.category : "other") ? "More than this kit needs" : "Not on this kit's checklist" }))
    .filter(x => x.n > 0).sort((a, b) => b.g - a.g);
  /* Lighter kinds of the same thing: same count on the checklist (same calories for food). In the five
     categories only an item that is the essential the lighter one fills, so the swap keeps it. */
  const swaps = lines.flatMap(l => {
    const c = CATS[l.it.category] ? l.it.category : "other", lite = PACK[c]?.lite, name = String(l.it.name || "");
    if (c === "food" && num(l.it.kcal) && !/ration|\bbars?\b|freeze|mre/i.test(name)) {
      const g2 = num(l.it.kcal) / BAR_KCAL_G;
      return l.g - g2 >= 200 ? [{ it: l.it, to: `${pl(Math.ceil(num(l.it.kcal) / BAR_KCAL), "ration bar")} (3,600 kcal each)`, saveG: l.g - g2, trade: "same calories, no cooking or water needed", est: !num(l.it.grams) }] : [];
    }
    if (!lite || essentialList(c).length && essentialOf(l.it) !== lite.ess || new RegExp(lite.name.split(" ").at(-1), "i").test(name) || l.unitG < 1.5 * lite.g) return [];
    return [{ it: l.it, to: pl(l.q, lite.name, lite.many), saveG: (l.unitG - lite.g) * l.q, trade: lite.trade, est: !num(l.it.grams) }];
  }).sort((a, b) => b.saveG - a.saveG).slice(0, 5);
  const waterG = lines.filter(l => l.it.category === "water").reduce((a, l) => a + l.g, 0);
  const waterRow = ready.rows.find(r => r.cat === "water");
  return { lines, fits, g: sumG(full), ml: sumMl(full), bagG: lim.emptyG || 0, score: ready.score, best, takeOut, swaps, waterG,
    waterNeedG: waterRow ? waterRow.need * WATER_G : 0, estN: lines.filter(l => l.est).length };
}
/* Splits a kit's score across its items: each checklist row's points go to the items filling it,
   in proportion to what each supplies, so an item's points add up with the rest to the kit score. */
function itemValues(kit, r) {
  const W = r.rows.reduce((a, x) => a + x.w, 0) || 1;
  const byRow = Object.fromEntries(r.rows.map(x => [x.cat, x]));
  const out = {}, items = HOUSEHOLD.items.filter(i => i.kitId === kit.id), st = stockItems(items);
  for (const it of items) {
    const c = CATS[it.category] ? it.category : "other";
    if (expState(it) === "expired") { out[it.id] = { pts: 0, note: "Expired, so it doesn't count" }; continue; }
    /* A named essential's points are shared by the items tagged with it; an untagged item earns none yet. */
    const row = byRow[c];
    if (row?.ess) {
      const e = essentialOf(it), n = e && e !== "none" ? st.ess[c]?.[e] || 0 : 0;
      const filled = n ? row.ess.filter(x => x.id === e && x.have).length : 0;
      out[it.id] = { pts: n ? 100 * row.w * filled / row.need / W / n : 0,
        note: !e ? "Pick which essential it is so it counts" : e === "none" ? "Not one of the essentials, so it doesn't count" : n > filled ? "Kit has more of these than it needs" : "" };
      continue;
    }
    let pts = 0, over = false;
    const add = (row, amt) => {
      if (!row || !amt || !row.have) return;
      pts += 100 * row.w * row.cov / W * amt / row.have;
      if (row.need > 0 && row.have > row.need) over = true;
    };
    add(byRow.water, num(it.liters));
    add(byRow.food, num(it.kcal));
    if (c !== "water" && c !== "food") add(byRow[c], Math.max(1, num(it.qty)));
    const note = pts ? (over ? `Kit has more ${catLabel(c).toLowerCase()} than it needs` : "")
      : c === "water" ? "Add litres so it counts"
      : c === "food" ? "Add calories so it counts"
      : "Not on this kit's checklist";
    out[it.id] = { pts, note };
  }
  return out;
}
const servesLine = r => `${r.serves} ${r.serves === 1 ? "person" : "people"}${r.kh.pets && r.std.mode !== "vehicle" ?` and ${r.kh.pets} pet${r.kh.pets > 1 ? "s" : ""}` : ""}`;
/* The household gap a row's missing essential is: the same essential with the same label. There is none when every
   emergency that counts has it (another kit covers it, or the emergency doesn't apply), so adding it moves no score. */
const essGap = (M, cat, e) => M.gaps.find(g => g.cat === cat && g.essential === e.id && g.label === e.label);
// What ticking a gap's shopping line adds, worked out once per model, gap and kit: the shopping list's sum. With a kit, planned into it
const gapGains = new WeakMap();
function gapGain(M, g, kitId = "") {
  if (!g || M.overall == null) return 0;
  let c = gapGains.get(M); if (!c) gapGains.set(M, c = new Map());
  let k = c.get(g); if (!k) c.set(g, k = new Map());
  if (!k.has(kitId)) k.set(kitId, Math.max(0, scoreIfShopped(M, [shopFromGap(g, M.h, kitId)]) - M.overall));
  return k.get(kitId);
}
/* A missing essential's name inside a sentence: "insurance cards", but "ID copies" and "Sam's prescriptions" as they are. */
const essWord = (cat, label) => essentialList(cat).some(x => label === x.label || x.perMed && label.startsWith(x.label + " (")) && !/^.[A-Z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
const modeLine = hz => hz.when || `${MODES[hz.mode].label} · ${hz.days === 1 ? "24 h" : hz.days === 3 ? "72 h" : hz.days + " days"}`;
const personName = (m, i) => m.label || `Person ${i + 1}`;
/* Days the stock would keep everyone going: the lower of water (3.8 L a person, about 1 L a pet) and food. */
const daysCovered = (st, h) => !st || !h.people ? 0 : Math.min(st.liters / (h.people * 3.8 + h.pets), h.kcalDay ? st.kcal / h.kcalDay : 0);
const MILESTONES = { home: [1, 3, 7, 14], go: [1, 3] };

/* In Node, every name above; in the browser (no `module`) the names are already globals. */
if (typeof module === "object" && module && module.exports) module.exports = {
  CATS, ZONES, zoneOf, ESSENTIALS, essentialList, essentialOf, essentialOk, essentialsFor, AGE, yearsOf, groupOf,
  kcalFor, personNeeds, ageText, CONDITIONS, DAILY_MEDS, onDailyMeds, CONDITION_WORDS, conditionHints, KIT_TYPES,
  MODES, LEVELS, IMPORTANCE, importanceOf, SEVERITY, severityOf, weightOf, HAZARDS, kitsFor, HZ, HOUSEHOLD_DOCS,
  HOUSEHOLD, num, uid, f1, clone, strip, isExampleKit, BANDS, band, catLabel, amazonLink, expState, household,
  relevance, FACT_WORDS, FACTS, factText, householdWhy, itemsIn, stock, stockItems, needFor, model, haveOf, needRow,
  fillRow, essCov, rawScore, scoreRows, overallIf, orList, gal, gapPlan, scoreIfShopped, scoreIfFilled, pl, whoIs,
  hasCond, forWho, rxAsk, ESS_BUY, PICKS, essentialGuide, pk, buyGuide, itemFromShop, scoreIfBought, shopInfo, TRIPS,
  tripOf, shopItems, gapKey, splitListed, gapName, shopFromGap, ownKit, shopKit, kitGaps, KIT_STD, kitReadiness,
  dollars, cents, itemCost, kitTypeOf, spentOn, shortOf, lineCost, kitCost, hzCost, householdCost, PACK, WATER_G,
  itemLoad, bodyKg, carryShare, carryKg, PACK_L, CONTAINER_KINDS, CTR_MAX, cutText, containerOf, kitLimits, packPlan,
  itemValues, servesLine, essGap, gapGains, gapGain, essWord, modeLine, personName, daysCovered, MILESTONES
};
