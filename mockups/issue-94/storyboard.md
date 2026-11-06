# Issue #94: buy from the shopping list with Amazon picks and one cart

Storyboard and option specs. One designer builds each option's page from its spec below, at
`mockups/issue-94/<letter>.html`. Brief: https://github.com/todd450/go-bag/issues/94

**Bounds from the brief.** For whoever has the Shopping tab open with "12 to buy" and has to turn
it into an order. Appetite is one week, starting after the hand check. No-gos: no other store, no
Associates tag, no API key, no account linking, no "I already have it" button, no live prices, no
change to scoring or to what a tick does, and a row never shows two checkboxes.

## The journey, frame by frame

The content is the made-up household from `tests/household.json`: Alex (41), Sam (39, daily
meds), Jordan (9), Riley (6, severe allergy), Casey (2) and a dog, in Springfield, OR. Their kits
are **Hall closet go-bag** (go), **Basement bin** (home) and **Trunk bag** (car). Readiness is
**17 / 100**. Today is Friday 6 Nov 2026.

| # | Where | What happens | What they have to trust | What earns it |
|---|---|---|---|---|
| 1 | Outside: the kitchen, evening | Alex decides to deal with the list tonight. The tab bar shows "Shopping 12". | That this won't take all night | The count on the tab, and the list already in order |
| 2 | Shopping tab | Alex scans the 12 lines. Each line names the product it means, or says why it has none (prescription, from home, mixed groceries, a supplier-only item). | That each pick really is the thing the line asks for | The product name and quantity shown on the line, not just a bare link |
| 3 | Shopping tab | Optional: Alex types 150 into "Spend up to $". The list re-ranks as it does today. | That the budget still means the same thing | Nothing about the budget changes |
| 4 | Picker (B, C) or the line links (A) | Alex chooses what goes in this order. Heavy water is left unchecked with its reason. Prescriptions and "From home" lines are listed as not going in, and why. | That only what's checked goes to Amazon, at the right quantities | Each checked line shows its product and quantity, and the button counts them |
| **5** | **Hand-off to Amazon, a new tab (outside)** | **Alex taps "Open Amazon cart (6 items)". Amazon's own page asks to add the 6 products, quantities set, to the cart.** | **That Amazon got exactly what was checked, with nothing added, no tracking tag and no account linked** | **Products and quantities on Amazon match the picker line for line. One plain sentence beside the button says it's a link that fills your cart: no tag, no account, nothing bought until you check out on Amazon.** |
| 6 | Outside: Amazon checkout | Alex removes a pack of masks, pays, and closes the tab. | (Amazon's side) | |
| 7 | Back on the Shopping tab | Go Bag asks "Ordered these 6?". Alex taps Mark ordered. Those lines now read "Ordered 6 Nov" and add **no points**. The score stays at 17. | That the score is honest: nothing counts until it's in a kit | "+9 once it's in a kit" stays on the row, the score doesn't move, and Undo is one tap |
| 8 | Outside: Tuesday, the porch | A box arrives. Amazon's email says "Delivered". | | |
| 9 | Shopping tab, or Readiness (C) | Alex packs the radio and extinguisher into the Basement bin and ticks both lines. Readiness goes from 17 to 26. | That ticking still means what it always did | The same tick, the same points as shown, and the same "In Basement bin" |
| 10 | Kits tab, months later | The radio's row in the kit table shows "On Amazon ↗" (its saved `amazonUrl`). Restocking is one click. | That the link is the same product | It's the exact `/dp/` page the pick used |

**The key moment is frame 5, the hand-off.** The whole bet is that one cart closes many gaps in
one sitting. If what lands in Amazon's cart differs from what was checked, by a product, a
quantity or a line that should never have gone in, the founder stops using it after the first try.
**Frame 7 matters next most**, because it is where points could drift onto things still on a truck
(the brief's metric 3).

**A gap in the brief's flow that every option must handle.** The cart opens in a new tab, and
today's toast with an action closes after 9 seconds (`toast()`, line ~801). Checkout takes minutes,
so a toast fired on click is gone before Alex comes back. B and C each answer this in their own way
(see below). A has no cart, so it has no prompt.

## Stars for the key moment

- **1 star.** Each line has "Find on Amazon ↗", a search built from the line. Alex searches 12
  times and guesses which result is the right one.
- **3 stars.** Each line names one vetted product and links to its exact page. Alex opens 7 tabs one
  at a time. Nothing to trust beyond "this is the right product".
- **5 stars.** A picker turns the list into one Amazon cart: pre-checked from the budget, heavy items
  left out with their reason, quantities set. When Alex comes back, Go Bag asks whether the order
  went through and keeps "ordered" apart from "in the kit". This is the brief as written.
- **7 stars.** The picker also shows what this order does for readiness once it's packed (17 → 39)
  and which kit each thing goes into. Ordered lines move to their own "On the way" shelf with a
  packing prompt, and the Readiness tab says "6 things on the way: tick each as you pack it". The
  order becomes a small run with a clear end: the box is unpacked into the right kits.
- **9 stars.** Go Bag knows when the box lands without being told, and the moment it does it says
  "the Midland radio goes in the Basement bin". Needs Amazon order data: account linking, a no-go.
- **11 stars.** The kit restocks itself: water and ration bars that are about to expire are already
  in a cart, sized to who lives here now, and arrive labelled by kit. Needs an account, live data
  and maybe bundled kits, all no-gos or deferred by the founder.

The appetite (one week, built on a cart link we don't control) allows 3 to 7 stars. The three
options sit at 3, 5 and 7.

## Shared rules for all three pages

- **Tokens and components.** Copy the `:root` block and its dark variants from
  `emergency-kit-audit.html` (lines 10 to 52) unchanged. Reuse the page's own classes and their CSS:
  `.panel`, `.stack`, `.row`, `.btn` / `.btn.ghost` / `.btn.sm`, `.chip`, `.gain`, `.buy`, `.x`,
  `.shop`, `.shop-row`, `.shop-chk`, `.shop-meta`, `.shop-kit`, `.shop-tip`, `.shop-cut`,
  `.shop-tools`, `.toast`, `.muted`, `.small`, and the phone breakpoints at 560 and 640 px.
  Header, tabs and the phone bottom tab bar look as they do now (see any tab). Drop the Google Fonts
  `<link>`, since the page has to be self-contained: the token font stack falls back to system-ui.
- **Content.** Use the 12 lines below exactly, at their real lengths, with readiness 17 / 100. All
  copy is English, the only language the product ships. Product names are illustrative until
  the picks are found in a Claude session. Use them as written, and make every `/dp/` href
  `https://www.amazon.com/dp/` followed by a 10-character placeholder like `B0EXAMPLE1`.
- **Page layout.** Each page is a vertical storyboard of labelled frames ("Frame 5 · The hand-off"),
  with the **key moment first**, so the top-of-page screenshot shows it. The other frames follow in
  journey order. Each frame is a full-width rendering of the screen at that step. On desktop the
  frames sit at the app's 1120 px max width, and at 390 px they render as the phone layout. A
  one-line caption under each frame says what the person is trusting there.
- **Amazon frames** (frame 5's new tab) are drawn as a neutral grey wireframe captioned
  "amazon.com, outside Go Bag". Show only the product names, quantities and "Add to cart". Don't
  copy Amazon's look or logo.
- **Copy rules.** Points are always "+N" in `.gain`. Prices stay the rough guides from today's list,
  never Amazon prices. Lines that can't go in a cart always say why, in the line's own small muted
  text.

### The 12 lines (sorted "Most points first")

| Line (bold text, as `buyGuide` writes it) | Sub | Gain | Price | Kit | Pick (illustrative) | Qty | Notes |
|---|---|---|---|---|---|---|---|
| 2 7-gallon water containers, filled from your tap | 53 L of water | +11 | $44 | Basement bin | Reliance Aqua-Tainer 7-gallon water container | 2 | |
| A 5 lb ABC fire extinguisher (2-A:10-B:C or bigger) | Fire safety | +9 | $45 | Basement bin | First Alert HOME1 rechargeable extinguisher, 2-A:10-B:C | 1 | |
| 2 cases of 24 half-litre bottles | 24 L of water | +8 | $12 | Hall closet go-bag | Amazon purified water, 24 × 16.9 fl oz | 2 | **Heavy**: "Heavy to ship: often cheaper to pick up locally" |
| 28 cans of soup, chili and beans, 2 big jars of sunflower seed butter, 3 boxes of crackers and 4 boxes of nut-free granola bars | 50,400 kcal of food | +8 | $91 | Basement bin | none | | Mixed line: "Find on Amazon ↗" search, never in cart |
| 2 epinephrine auto-injectors for Riley, plus an antihistamine | Allergy | +7 | Prescription | Hall closet go-bag | none | | No link, never in cart |
| A hand-crank NOAA emergency radio with a phone charger | Comms | +6 | $30 | Basement bin | Midland ER310 hand-crank emergency radio | 1 | |
| A spare week of Sam's prescriptions | Medications | +6 | Prescription | Hall closet go-bag | none | | No link, never in cart |
| 2 CAT or SOF-T tourniquets | Trauma | +5 | $60 | Hall closet go-bag | none | | Deliberately no pick: "Buy from a medical supplier: counterfeits are sold on marketplaces" (from today's tip). No link. |
| 3 packs of 10 N95 masks | Masks | +4 | $45 | Hall closet go-bag | 3M Aura 9205+ N95 respirator, 10-pack | 3 | |
| 5 reusable emergency blankets | Shelter | +3 | $25 | Hall closet go-bag | SOL heavy-duty reusable emergency blanket | 5 | |
| 3 LED headlamps | Light | +3 | $36 | Trunk bag | Energizer Vision HD headlamp | 3 | |
| A change of clothes for everyone | Clothing | +2 | From home | Hall closet go-bag | none | | "From home", no link, never in cart |

Totals: 7 lines have a pick. With no budget set, the picker pre-checks the 6 that aren't heavy
(containers, extinguisher, radio, masks, blankets, headlamps): **6 products, 15 units, about $225
by the guide prices**. Readiness if all 6 are packed: **17 → 39**. The list's "About $" line reads
"About $388 plus 2 prescription items. Buying it all takes readiness from 17 to 58."

---

## Option A: Product on every line (3 stars)

**What it does at the key moment.** Every line names its product and quantity under the bold line,
with "On Amazon ↗" opening that exact product page in a new tab. There is no cart and no Ordered
state: Alex opens the products one by one, and ticks a line when it's packed, as today.

**What sets it apart (for its builder).** The floor, and also what ships if the hand check fails or
the cart link later breaks. It adds no new component and no new state. All the work is on the row.

- **Row anatomy (new lines inside the existing `.shop-chk` span, under the sub and tip).** A pick
  line in `.small`: "**Midland ER310 hand-crank emergency radio** · Qty 1 · On Amazon ↗", with the
  `↗` link styled `.buy`. The quantity is what to put in the basket on Amazon's page ("Qty 2" for the
  containers).
- **No-pick lines** get one muted reason in the same slot: "Mixed groceries: Find on Amazon ↗",
  "Prescription: ask the pharmacy", "From home: nothing to buy", "Buy from a medical supplier:
  counterfeits are sold on marketplaces".
- **Heavy line** (water bottles): the pick line, then "Heavy to ship: often cheaper to pick up
  locally" in `--warn`, with no icon.
- **A one-line note** above the list, under the "About $" line: "Each product is one we've checked.
  Links carry no tracking tag."
- **Frames on the page, in order:** frame 5 (the key moment: the list with picks on every row,
  and beside it the Amazon product page wireframe for the radio, Qty 1) · frame 2 (the full 12-row
  list) · frame 9 (radio and extinguisher ticked, "In Basement bin", readiness 26) · frame 10 (the
  Basement bin kit table row "Midland ER310 hand-crank emergency radio", with "On Amazon ↗").
- **Phone (390).** The pick line wraps under the tip, indented like `.shop-meta` (62 px). The
  `↗` link has a 40 px tap target.

**Cost.** About 2 days: the pick table, the row link, the heavy note and the `amazonUrl` saved on
tick. It leaves three days of the week unused, and the brief's one-cart goal unmet.

---

## Option B: Cart sheet and an Ordered mark (5 stars, recommended)

**What it does at the key moment.** An "Amazon cart" button on the list opens a sheet listing the 7
lines with a pick, pre-checked from the budget (or all but the heavy one), each with its product
and quantity. Its footer link, "Open Amazon cart (6 items)", opens Amazon's add-to-cart page in a
new tab. When Alex comes back, a toast asks "Ordered these 6?". Marked lines read "Ordered 6 Nov"
and add no points until they're ticked into a kit.

**What sets it apart (for its builder).** The brief as written, plus a fix for the toast timing. It
is the only option where Ordered is a mark on the row: the line stays where it is in the list.

- **New component, proposed as such: a sheet.** The page has no modal today. Phone: a bottom sheet
  that rises over the dimmed list and the tab bar, 16 px top radius, a grab bar, and a sticky
  footer. Desktop: a centred panel 560 px wide over a dimmed page. Uses `--card`, `--rule`, the
  `.panel` radius and `--shadow`. It closes with ×, Escape or a tap on the dim. Its checkboxes are
  only ever in the sheet, never on a row.
- **Sheet content, top to bottom.**
  - Title: "Amazon cart". Sub: "Pick what goes in this order. Nothing is bought until you check out
    on Amazon."
  - Pick rows: a checkbox, the product name in bold, then "Qty 2 · for: 2 7-gallon water
    containers, filled from your tap" in `.small .muted`, then the guide price on the right.
  - The heavy row is unchecked, with "Heavy to ship: often cheaper to pick up locally".
  - A muted group, "Not in this cart (5)", lists each no-pick line with its one-word reason
    (Prescription · From home · Mixed groceries · Medical supplier). It has no checkboxes.
  - Footer: "About $225 · 15 things in all", then the full-width `.btn`-styled **link** "Open
    Amazon cart (6 items)" (an `<a>`, so popup blockers let it through), then one line in
    `.small .muted`: "A plain link that fills your Amazon cart. No tracking tag, no account."
  - With 0 checked, the link is disabled and reads "Check something to open a cart".
- **The return (frame 7).** The toast fires when the tab is visible again (`visibilitychange`), not
  on click, and stays until answered, with no timeout: "Ordered these 6? [Mark ordered] [Not
  yet]". Draw it over the list on phone (above the tab bar) and desktop.
- **The Ordered row.** Below the bold line, a chip: "Ordered 6 Nov · Undo". In `.shop-meta`, the
  gain becomes muted "+9 once packed". The row's tick is unchanged, and its aria-label becomes
  "Packed into Basement bin". The score in the header stays 17.
- **List header.** Next to "Share list", add a `.btn.ghost.sm` "Amazon cart (7)". The count is the
  lines with a pick.
- **Frames on the page, in order:** frame 4/5 (the key moment: the sheet open over the list, with
  the 6 checked, and on desktop the Amazon wireframe beside it showing the same 6 products and
  quantities) · frame 2 (the list with "Amazon cart (7)" and the per-line "On Amazon ↗" links as
  in A) · frame 7 (back on the tab with the toast; then the same list with 6 rows marked "Ordered 6
  Nov", gains muted, score 17) · frame 9 (two of them ticked, score 26) · frame 3 variant (budget
  $150: the budget's own pick set is clothing, water bottles, containers, extinguisher and radio,
  $131. The sheet pre-checks the three of those with a non-heavy pick (containers, extinguisher,
  radio), so the button reads "Open Amazon cart (3 items)". The water bottles are in the budget but
  stay unchecked with their heavy note).
- **Phone (390).** The sheet fills to 88% of the height and the list scrolls inside it. The footer
  stays pinned with the link at 48 px tall. The long food line in "Not in this cart" wraps to
  2 lines and is cut with "…" after that.

**Cost.** About 5 days, the brief's full scope: the pick table, the row links, the sheet (about a
day of it, as a new component), the cart URL, the toast on return, `orderedAt` with Undo, the heavy
flag, `amazonUrl` on tick, and the tests. That leaves 2 days of slack for the Amazon link's quirks.
If it runs over, the brief's cut applies: Ordered and heavy go.

---

## Option C: Order run with an On-the-way shelf (7 stars)

**What it does at the key moment.** The same sheet as B, but grouped by the kit each thing goes into,
with what the order does for readiness: "Once packed: 17 → 39". After the cart opens, the list holds
an in-panel card asking "Did you order these 6?". Marked lines move off the to-buy list onto their
own "On the way (6)" shelf, and the Readiness tab gets one next step: "6 things on the way: tick
each as you pack it."

**What sets it apart (for its builder).** It treats the order as a run with an end: unpacking the
box into the right kits. Ordered lines leave the to-buy list for their own shelf (B marks them where
they are). The sheet is grouped by kit and shows the payoff (B's is one flat list with a price
total). The return prompt is a card in the panel (B uses a toast). And it is the only option that
touches the Readiness tab.

- **Sheet (the same new component as B, proposed as such).** Group headers in `.eyebrow`: "Basement
  bin", "Hall closet go-bag", "Trunk bag". Rows as in B. Footer: "Once packed: readiness 17 →
  **39**" in `.gain` styling, then "About $225 · 15 things", the "Open Amazon cart (6 items)" link,
  and the no-tag line. The payoff updates as boxes are checked; it's `scoreIfBought` on the checked
  lines. The "Not in this cart (5)" group is the same as in B.
- **The return (frame 7): an in-panel card**, at the top of the list panel, `--brand-tint`
  background: "You opened an Amazon cart with 6 things at 8:42 pm. Did you order them? [Mark all 6
  ordered] [Not yet]", with the 6 product names in a muted line under it. It's held in memory only
  (not saved, as the brief says for the picker). It stays until answered or the page reloads, so
  nothing depends on catching a toast.
- **On the way shelf.** A new `.panel` between "12 to buy" (now "6 to buy") and "Got it", titled "On
  the way (6)", sub "Ordered 6 Nov. Tick each one as you pack it into its kit." Rows are the
  ordinary `.shop-row` with the same tick, gains muted as "+9 once packed", and kit shown. Each row
  has "Not ordered" as a small text button (the one-tap undo), which moves it back.
- **Readiness tab.** One entry in the existing Next steps list (`.act` row, `shop` kind icon): "6
  things on the way · Tick each as you pack it" with "Open list". It replaces nothing and adds no
  points.
- **Frames on the page, in order:** frame 4/5 (the key moment: the grouped sheet with the payoff,
  and on desktop the Amazon wireframe beside it) · frame 7 (the in-panel card, then the list split
  into "6 to buy" and "On the way (6)", score 17) · frame 8/9 (Readiness tab next step "6 things on
  the way", then the shelf with radio and extinguisher ticked, score 26) · frame 2 (the full list
  with per-line links, as in A).
- **Phone (390).** Group headers stay sticky inside the scrolling sheet. The payoff line sits above
  the link in the pinned footer. The card's two buttons stack full-width.

**Cost.** About 7 days. Everything in B, plus kit grouping and payoff in the sheet (half a day), the
shelf replacing the row mark (about the same cost as B's chip, but `edge`/`examples` tests render
a new panel), the in-panel card (half a day) and the Readiness next step (a day, with tests that
it adds 0 points). It uses the whole week with no slack. The Readiness step is the first thing to
cut, then the brief's own cuts.

---

## Recommendation: B

B delivers the brief's one cart, with a return prompt that actually survives a checkout. It fits the
week with two days spare for an Amazon interface nobody here controls. C's shelf and payoff are the
better journey. They're worth adding once the founder has shown, through the `orderedAt` counts at
check-back, that ordering this way gets used. A is what B falls back to anyway.
