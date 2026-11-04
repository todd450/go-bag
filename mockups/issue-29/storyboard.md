# Issue #29 · Score checklist categories by named essentials

Storyboard and option specs for the brief in issue #29. One designer per option builds
`mockups/issue-29/<letter>.html` from the spec below; this file is the only source they share.

## Who, appetite, no-gos (what bounds every option)

- **Who:** the founder's household, the only one the product serves. In particular whoever opens
  an emergency (House fire), sees a green row and trusts it. Today that row can say
  *Medications · 4 of 1* in green.
- **Appetite:** one week. If it runs over, it ships Documents & cash, Fire safety and Medications
  only, with Comms and Tools still counted. An option that only fits by using that fallback says so.
- **No-gos:** no item-level scoring or one row per product; no splitting Documents from Cash; the
  quantity categories (water, food, light, clothing, masks, shelter, power, comfort, kids) keep
  counting; pets, baby, first aid, vehicle gear, sanitation and hygiene are not converted; the
  household can't edit the essentials lists; severity, likelihood, importance and the emergency
  list don't change; nothing is written to live data until the founder taps "Tag N items" or
  picks a tag; no automatic migration.

## The journey, frame by frame

| # | Where | What happens | What the person has to trust | What earns it |
|---|---|---|---|---|
| 1 | Outside: the founder's phone, a week ago | Opens House fire, sees *Medications · 4 of 1* in green, *Documents & cash · 0 of 1*. Realises one envelope of cash would turn Documents green. Stops believing green. | n/a: this is the broken trust the change repairs. | n/a |
| 2 | Outside: a message from the team | "Scoring changed: checklist rows now count named essentials. Your number will drop." Founder opens the Artifact. | That the drop is honest, not data loss. | Frame 3 says so in words before any number is read. |
| 3 | Readiness tab, top | The ring reads lower (example below: **41 → 33**, and lower still, **22**, until items are tagged). A one-time note says why: nothing left a kit; the old count was too generous. Next steps leads with **Tag 7 items**. | That nothing was deleted. That the number is now right. | The note names the cause and the five categories; it offers the fix (tag) in the same place. |
| 4 | Next steps → tag review | Tapping **Tag 7 items** shows each item with the app's guess (*Cash envelope → Cash*, *Ibuprofen 200 mg → Pain or fever reliever*), one it can't place (*Zip pouch of papers → pick one*), and saves only on **Save tags**. Score rises to 33. | That the guesses are right, and that nothing saves behind their back. | Every guess is visible and editable before saving; the unknown one says "not sure" instead of guessing. |
| **5** | **Readiness → House fire, opened** | **KEY MOMENT.** The checklist rows read *Documents & cash · 1 of 4* and name what's missing: ID copies, insurance cards, records. *Medications · 1 of 3*: four pain relievers count once; missing allergy medicine and Sam's prescriptions. No row reads more than its need. Green now means every named essential is in the kit. | **That green means ready.** | Present essentials are named (so the person can check them against the closet), missing ones are named, and duplicates visibly count once. |
| 6 | House fire → shopping list | Adds the missing essentials. The list gets one line per essential: *Insurance card copies*, *Fire blanket*, *Allergy medicine (antihistamine)*, each with the points ticking it adds. | That the points shown are the points they'll get. | Points come from `scoreIfShopped`; the line names the thing, not "Documents & cash × 3". |
| 7 | Outside: the copy shop, the hardware store, the bedroom drawer | Photocopies the insurance cards, buys a fire blanket, puts a strip of Zyrtec in the go-bag. | n/a | n/a |
| 8 | Shopping list → tick | Ticks *Insurance card copies*. It becomes an item in Hall closet go-bag, already tagged. House fire's Documents row reads *2 of 4*; readiness rises by the points the line showed. | That ticking did what it said. | The number moves by exactly the shown points, and the row now lists the new essential as present. |
| 9 | Kits → item editor (later, when adding by hand or fixing a scan) | Category = Documents & cash shows an **Essential** picker beside it (ID copies · Insurance cards · Cash · Records · Not one of these). Photo scan fills it; a bad tag from Claude falls back to untagged. | That a wrong tag can be fixed. | The picker is right next to Category, with "Not one of these" as a real choice. |
| 10 | Outside: issue #29, three weeks later | The founder posts a screenshot of House fire for the check-back: no "4 of 1", every red or amber checklist row names what's missing. | n/a | n/a |

**The moment that matters most is frame 5**: opening an emergency and being able to believe the
green. Every option is judged by what that frame shows. Frames 3, 4 and 6 support it and every
option shows them; frame 9 is shown small.

## Stars for frame 5

- **1 star:** the row's count is fixed: *Documents & cash · 1 of 4* instead of *0 of 1*. You still
  don't know which three are missing.
- **3 stars:** the row says *1 of 4* and a line under it says *Missing: ID copies, insurance cards,
  records*.
- **5 stars:** each checklist row opens into its named essentials, each ticked or not: what's there
  is named (and four pain relievers visibly count once), what's missing is named with the points
  adding it is worth and an add-to-list. The score drop is explained before it's read; tagging old
  items is one reviewed tap.
- **7 stars:** the row shows *where* each essential is (*Cash · Hall closet go-bag*), and items the
  app isn't sure about sit inside the very row they'd fill: *"Ibuprofen 200 mg: counts as pain or
  fever reliever?" Yes / Not this*, so tagging happens at the moment of doubt, not in a separate
  queue.
- **9 stars:** standing at the open closet, the app walks the kit essential by essential ("Do you
  see ID copies?"), and a photo of the bag confirms each one.
- **11 stars:** the kit stays true by itself: it knows the insurance card renews in March and asks
  for a fresh copy, and runs a two-minute family fire drill that checks the bag is where the plan
  says.

Nine and eleven need new capabilities (guided camera checks, renewal dates per document) and a
second brief. Seven is the most the week could stretch to, and only with the fallback.

## Shared content for every mockup (use exactly this, so the options compare)

Made-up household from `tests/household.json`: Alex 41, **Sam 39 (takes daily medication)**, Jordan
9, Riley 6 (severe allergy), Casey 2, one dog, one car. Springfield, OR. Kits: Hall closet go-bag
(72-hour go-bag), Basement bin (2-week home supply), Trunk bag (24-hour car kit). English (US) is the
only language the product ships; all text is English. No lorem ipsum.

Essentials lists (from the brief):

- **Documents & cash:** ID copies · Insurance cards · Cash · Records (USB or printed)
- **Fire safety:** Fire extinguisher · Fire blanket · Escape ladder
- **Comms:** Emergency radio · Whistle · Printed contact list
- **Tools:** Multi-tool or knife · Duct tape · Utility shut-off wrench · Lighter or matches
- **Medications:** Pain or fever reliever · Allergy medicine · Sam's prescriptions (one per person
  marked "Takes daily medication")

Items (in Hall closet go-bag unless said):

| Item | Category | Guess for tagging |
|---|---|---|
| Cash envelope ($200 in small bills) | Documents & cash | Cash |
| Zip pouch of papers | Documents & cash | *Not sure: pick one* |
| Ibuprofen 200 mg, 50 tablets | Medications | Pain or fever reliever |
| Children's Tylenol, 4 fl oz | Medications | Pain or fever reliever |
| Acetaminophen 500 mg | Medications | Pain or fever reliever |
| Advil Liqui-Gels | Medications | Pain or fever reliever |
| Fire extinguisher, 2.5 lb (Basement bin) | Fire safety | Fire extinguisher |
| Old ibuprofen (expired 2020-01) | Medications | not offered: expired items don't count |

House fire (Evacuate · 24 h · Moderate risk, critical if unprepared), after tagging:

| Row | Kind | Reads | Present | Missing (points each) |
|---|---|---|---|---|
| Fire safety | essentials | 1 of 3 | Fire extinguisher | Fire blanket (+2), Escape ladder (+1) |
| Documents & cash | essentials | 1 of 4 | Cash | ID copies (+1), Insurance cards (+1), Records (+1) |
| Medications | essentials | 1 of 3 | Pain or fever reliever (4 items, counts once) | Allergy medicine (+2), Sam's prescriptions (+2) |
| Light | quantity, unchanged | 2 of 3 | | |
| Clothing | quantity, unchanged | 0 of 5 | | |

House fire was **73%** under the old count; **32%** now. Household readiness was **41**; **22**
before tagging; **33** after tagging. Points shown on a missing essential are what ticking it adds
(`scoreIfShopped`); a mockup never shows a number it couldn't compute.

Longest strings to set at phone width (390 px) without breaking a row: *Records (USB or printed)*,
*Utility shut-off wrench*, *Pain or fever reliever*, *Cash envelope ($200 in small bills)*. Also
check one long person name in a prescriptions essential: *Josephine's prescriptions*.

## Design language (every option)

Build from the product's own tokens and components, copied from `emergency-kit-audit.html`
(`:root` variables `--paper --card --ink --ink-2 --rule --rule-2 --accent --brand --meter --good
--warn --bad --shadow`, Inter, 15px/1.5): `.panel`, `.notice`, `.btn` / `.btn.ghost` / `.btn.sm`,
`.chip` / `.chip.full`, `.hz-row` / `.hz-detail`, `.bar`, `.ring`, `.acts` / `.act` with `.gain`,
`.shop-row`, `label.f`, `select`, the category line icons, the sticky top bar with the readiness
pill, and on phones the bottom tab bar. Status colours stay `--good / --warn / --bad`; orange is
for the brand and progress only. No new fonts, no new colours. Anything not in that list is a new
component and the option names it below.

Each page is one self-contained HTML file: inline CSS, no scripts from the web, no web fonts
fetched (fall back to `system-ui` in the stack). It must work at 390 px and 1440 px.

**Page order:** the screenshot is a tall view of the top of the page, so every page **opens with
frame 5, House fire opened**, inside the Readiness tab chrome (top bar, tabs, the Emergencies list
with House fire expanded). Below it, labelled as frames with a small `.eyebrow` caption ("Frame 3 ·
Readiness, first open after the change"), in this order: frame 3, frame 4, frame 6/8 (shopping
list, one line already ticked), frame 9 (item editor, small). Same data in every frame.

---

## Option A · Named gaps (3 stars)

**Frame 5:** House fire opens as today, a wrap of chips, but the three essentials chips now read
*Fire safety · 1 of 3*, *Documents & cash · 1 of 4*, *Medications · 1 of 3*, and under the chips one
`.small` line per short checklist row says what's missing: **Documents & cash:** missing ID copies,
insurance cards, records. Present essentials aren't listed. One ghost button under them: **Add 7
missing to shopping list**.

- **Frame 3:** a single `.notice` above Next steps: "Checklist rows now count named essentials, so
  your score dropped from 41 to 22. Nothing left a kit. Tag 7 items to count what you already
  have." Next steps' first act row: *Tag 7 items* with the refile icon and a `Tag` button.
- **Frame 4:** tapping Tag doesn't open a review. The act row expands in place into a plain list
  (*Cash envelope → Cash*) with one **Save tags** button, and the item the guesser can't place is
  left out with "1 item to tag by hand on the Kits tab".
- **Frame 6/8:** shopping lines are essential-named (*Insurance card copies · +1 · $0 From home*),
  using the existing `.shop-row` as is.
- **Frame 9:** inventory row: an **Essential** `select` under Category, shown only for the five
  categories.
- **What sets it apart:** the least screen change. The chip row stays the display; trust comes from
  the words "missing: …", not from a checklist. Present essentials are never named, so "4 pain
  relievers count once" is only implied by "1 of 3".
- **New components:** none.
- **Cost:** about 2 days of the week's UI work; the rest of the week goes to the scoring, tagging and
  test changes every option shares. Fits the appetite with room.

## Option B · Essentials checklist in the row (5 stars, recommended)

**Frame 5:** in House fire's detail, the quantity categories stay a chip wrap (Light, Clothing), but
each essentials category becomes a short block: a header line with its icon, name, *1 of 4* and a
thin `.bar`, then its essentials as a wrap of **essential pills**: a present one is a `.chip.full`
with a check (*✓ Cash*), a missing one is an outlined pill with an empty circle and its points
(*○ ID copies · +1*). Medications' present pill says *✓ Pain or fever reliever · 4 items, counts
once*. Each block with gaps ends with a ghost **Add 3 to list**. Order inside a block: present
first, then missing by points. On phones the pills wrap; no horizontal scroll.

- **Frame 3:** a `.notice` with a before/after line, "**41 → 33** once your items are tagged (22
  until then)", and a `<details>` "Why did it drop?" that names the five categories and says the
  old count gave full credit for any one item. It's dismissible, and it disappears after tagging
  is saved. Next steps first act: *Tag 7 items · 6 guessed, 1 to pick* with **Review** as the
  button and the gain *+11*.
- **Frame 4:** a review panel (in place of Next steps, not a modal): one row per item: name, kit,
  and a `select` preset to the guess (the guess marked "guess"); the unplaced one shows "Not sure,
  pick one" in `--warn`. Footer: **Save 7 tags** and "Nothing is saved until you tap Save."
- **Frame 6/8:** shopping lines named per essential, with the category as the sub-line
  (*Insurance card copies*, sub: *Documents & cash · for house fire and 2 other emergencies*). The
  ticked line shows "In Hall closet go-bag · tagged Insurance cards" and the House fire row
  re-reads *2 of 4* (show it as a small inset).
- **Frame 9:** inventory row gets **Essential** beside Category (desktop: its own column after
  Category; phone card: under Category). Options are the category's essentials plus "Not one of
  these".
- **Kit readiness panel** (Kits tab) uses the same blocks, so a kit and an emergency read alike.
  Show it once, small, under frame 9.
- **What sets it apart:** the row is a checklist you can hold against the closet. Present and
  missing are both named, a duplicate visibly counts once, and every missing essential carries
  its own points and route to the list. Tagging is a reviewed batch, separate from the row.
- **New component (a proposal of its own):** the **essential pill**, a variant of `.chip` with
  an empty-or-checked mark and an optional `+N` gain. Nothing else is new.
- **Cost:** about 4 days of UI on top of the shared scoring and test work: the full week. If it
  runs over, the brief's fallback (Documents, Fire safety, Medications only) applies and the pill
  design doesn't change.

## Option C · Confirm where you look (7 stars)

**Frame 5:** the same essentials blocks as B, plus two things. Each present essential says where it
is: *✓ Cash · Hall closet go-bag*, *✓ Fire extinguisher · Basement bin*. And untagged items appear
**inside the row they'd fill**, as a question: in Documents & cash, *"Zip pouch of papers: which is
it?"* with the four essentials as small buttons and "None"; in Medications, *"Ibuprofen 200 mg and
3 more: pain or fever reliever?"* **Yes** / **Not this**. Each answer saves that one tag and the
row re-reads in place (show one before/after pair for Documents: *1 of 4* → *2 of 4* after
"Records" is tapped on the zip pouch).

- **Frame 3:** a `.notice` saying the score now counts named essentials, "Some items need a yes
  from you; they're waiting in the emergencies they'd count for." Next steps' first act is
  *Confirm 7 items* and opens the emergency with the most points waiting (House fire), not a
  review list.
- **Frame 4** is folded into frame 5: there's no separate review screen. Show instead how many
  questions are left across all emergencies, in the House fire header: "3 questions left in other
  emergencies".
- **Frame 6/8:** as B, and a ticked line places the item into the kit shown, so the row's
  where-label reads the new kit.
- **Frame 9:** as B.
- **What sets it apart:** tagging moves out of a queue and into the moment of doubt: you answer
  "is this the allergy medicine?" while looking at the row that needs it, and every present
  essential says which bag to open to check it. It's the most trustworthy, and the most to build.
- **New components (proposals):** the essential pill (as B); the **in-row question** (an item name
  and a set of `.btn.sm` answers inside `.hz-detail`); the **where-label** on a present pill.
- **Cost:** about 7 days of UI on top of the shared work, so **over the one-week appetite**. To fit,
  it has to ship the fallback (Documents, Fire safety, Medications) and push Comms and Tools to a
  second cycle. One answer saves one live tag, so the "nothing saves until tapped" rule holds, but
  it's many small writes rather than one reviewed one.

---

## Recommendation

**B.** It's the five-star version of the key moment at the size of the week: the row names what's
there and what's missing, so green can be believed again, and tagging stays one reviewed tap that
matches the brief's "shown first, saved only when tapped". A is cheaper but leaves the person
trusting a count they can't check against the closet; C is the better experience but only fits by
dropping two of the five categories.

## Review after build (for whoever reviews the rendered screens)

Judge the journey and the chosen star, not only the match to the mockup: from the founder's first
open after publishing, does frame 3 explain the drop before the number is read? Does frame 5 show
no row above its need and name every missing essential? Does ticking a named line move the score
by exactly its shown points? Check at 390 px and 1440 px, light and dark, with the long strings
above.
