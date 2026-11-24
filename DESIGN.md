# Design System: Go Bag

The source of truth for how Go Bag looks. Read it before any visual change. It was agreed with the
founder on 24 Nov 2026 as an evolution of the look that shipped then, not a replacement. The page
(`emergency-kit-audit.html`) and the landing page (`web/landing.html`) do not match it yet: the
restyle is its own pull request, and until it merges the tokens below are the target, not the
current state.

## Product context

- **What this is:** photograph what is in your emergency kits and see how ready your household is,
  with a shopping list and a family plan that close the gaps.
- **Who it's for:** the person in a household who does the planning. A parent, not a prepper.
- **Space:** household preparedness. Its neighbours are institutional (Ready.gov, the Red Cross) or
  boutique kit shops (Preppi). None of them looks like a warm, well-made household tool.
- **Project type:** a phone-first web app that also works on a desktop, plus one landing page.
- **The one thing to remember:** calm competence. "This makes a scary subject feel handled."
  Every choice below serves that. When a choice does not, it loses.

## Aesthetic direction

- **Direction:** household fieldbook. Printed, warm and exact, like a well-kept binder. Not a
  dashboard, not a bunker catalogue.
- **Decoration:** minimal. The tab illustrations and the household's own kit photos are the only
  imagery. No stock photos, no storm pictures, no shields, no new ornamental illustration.
- **Mood:** opening a tidy drawer. Relief first, then a short list of what to do. Never fear.
- **Looked at, 24 Nov 2026:** ready.gov/kit (Merriweather and Source Sans, government green, square
  corners), redcross.org (Roboto and Open Sans, alarm red), preppi.com (cream block, heavy
  grotesque). Go Bag avoids all three: no gov serif-and-sans pairing, no alarm red, no luxury gloss.

## Typography

- **Body, labels, buttons, tables:** Figtree, 400 / 500 / 600 / 700. Friendly and clear at 15px.
  It replaces Inter everywhere except the wordmark.
- **Score numerals and display:** Fraunces, weight 600, `font-variation-settings: "SOFT" 60`,
  lining figures. It sets the readiness score in the ring, the header score, each kit's percentage,
  and at most one headline per screen. Nothing else: never labels, list rows, prices or buttons.
- **Data:** Figtree with `font-variant-numeric: tabular-nums` for prices, percentages in rows,
  weights and dates. Small numbers stay sans.
- **Wordmark:** frozen as it shipped on 24 Nov 2026: Inter 700, "Go" in cobalt, the case standing
  in for the space. Changing `--f-display` must not redraw it; load Inter 700 for it alone, or
  convert the two words to outlines.
- **Loading:** Google Fonts, the same late-loading `<link>` the page uses today:
  `family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght,SOFT@9..144,400..700,0..100&family=Inter:wght@700&display=swap`.
  Fallbacks: `system-ui, sans-serif` for Figtree and `Georgia, serif` for Fraunces.
- **Scale (base 15px, line height 1.5):**

  | Role | Size | Face and weight |
  |------|------|-----------------|
  | Score in the ring | 2.6rem | Fraunces 600 |
  | Kit readiness number | 2rem to 3.2rem | Fraunces 600 |
  | Wizard heading | 1.4rem | Figtree 600 |
  | Section heading (h2) | 1.2rem | Figtree 600 |
  | Card heading (h3) | 1.05rem | Figtree 600 |
  | Body | 15px | Figtree 400 |
  | Button, notice | 0.9rem | Figtree 600 |
  | Small, helper text | 0.85rem | Figtree 400 |
  | Eyebrow | 0.8rem | Figtree 500 |
  | Phone tab label | 0.72rem | Figtree 500 |

  Headings keep `letter-spacing: -.01em` to `-.015em` and `text-wrap: balance`.

## Color

- **Approach:** restrained. Ink on warm paper, with cobalt for the brand and persimmon for
  progress. Color is rare, so it means something when it appears.
- **Tokens** (the page's existing variable names):

  | Token | Light | Dark | Use |
  |-------|-------|------|-----|
  | `--paper` | `#F3F0E8` | `#15171A` | Page background. Barely warm, never beige. |
  | `--card` | `#FFFFFF` | `#1E2126` | Cards, header, tab bar. White, so photos keep their true color. |
  | `--ink` | `#1E2126` | `#F1EDE4` | Text, selected tab, focus ring. |
  | `--ink-2` | `#666A70` | `#A19F98` | Secondary text. |
  | `--rule` | `#E3DED3` | `#2E3238` | Hairlines, card borders, the ring's track. |
  | `--rule-2` | `#C4BEB1` | `#4A4F57` | Dashed and stronger borders. |
  | `--accent` / `--accent-ink` | `#1E2126` / `#FFFFFF` | `#F1EDE4` / `#15171A` | Primary pill buttons. |
  | `--brand` | `#2B59D9` | `#8AA8FF` | Wordmark, case mark, "matters more to you" star, counts. |
  | `--brand-deep`, `--brand-tint`, `--brand-track` | `#1E43AE`, `#E8EEFC`, `#CCD8F6` | track `#28385F` | Brand states. Unchanged. |
  | `--meter` | `#DB5A26` | `#F07A45` | Partway progress only: the ring's arc and bars. |
  | `--good` | `#2F7D5B` | `#5BC489` | Ready, covered, points gained. |
  | `--warn` | `#8F6212` | `#E2AE4A` | Expiring soon. |
  | `--bad` | `#B23A2E` | `#F2695C` | Expired, destructive actions, errors. |
  | `--zone-0` to `--zone-7` | unchanged | unchanged | The bag's packing bands. |

- **Red only means expired, destructive or broken.** A gap, a missing essential or a 0% score is
  not an error: it is an unticked line. Show it in ink, with an empty outline where a mark would
  be. Never color a low score red.
- **Persimmon belongs to progress.** Not buttons, headings or decorative rules.
- **Contrast:** body and secondary text meet WCAG AA (4.5:1) on both `--paper` and `--card`.
  Check any new text color against both.
- **Dark mode:** the same roles on redesigned surfaces, as in the table. Follows
  `prefers-color-scheme` unless `data-theme` is set, as today.

## Spacing

- **Base unit:** 4px. **Density:** comfortable.
- **Scale:** 2, 4, 8, 12, 16, 24, 32, 48, 64.
- **In use:** 16px phone gutters, 24px between panels and sections, 20px by 24px panel padding
  (16px on phones), 10px inside a stack, 8px between related facts.
- **Touch targets:** 40px minimum height for buttons, 32px for chips.

## Layout

- **Approach:** grid-disciplined, and unchanged from 24 Nov 2026.
- **Structure:** a sticky header (wordmark left, illustrated tabs centred, score right) over one
  working column. On phones the tabs become a bottom bar. Kits read as photo cards.
- **Max content width:** 1320px. Text blocks stop at 70ch.
- **Breakpoints:** 560, 640, 760 and 1000px, as the page has them.
- **Radius:** 4px for small tags, 12px for notices and menus, 14px for cards on phones and tiles,
  16px for panels, and a full pill for buttons, chips and the header score. Not one radius for
  everything.
- **Elevation:** none. Cards sit on the paper with a 1px `--rule` hairline and no shadow. The
  page reads as printed, not floating.

## Motion

- **Approach:** minimal and functional. Motion explains a change; it never decorates.
- **Durations:** 100 to 150ms for presses and hovers, 250ms for the tab art, 700ms for the ring
  filling.
- **Easing:** `cubic-bezier(.2, .8, .2, 1)` for progress. The tab art's small bounce on hover
  (`cubic-bezier(.3, 1.6, .5, 1)`) is the one playful moment; do not add a second.
- **Reduced motion:** every animation has a `prefers-reduced-motion: reduce` rule that removes it.

## Do not

- Use red, hazard yellow, tactical olive or stencil type to make a point.
- Set Fraunces on anything but score numerals and one headline per screen.
- Tint the cards: photos sit on them.
- Add shadows, gradients, decorative blobs or icon grids.
- Add shame or celebration to the score: no streaks, no confetti. Pair every score with the next
  useful step instead.

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 24 Nov 2026 | Design system written by `/design-consultation`. The founder chose to evolve the shipped look, not replace it. | Layout, wordmark, tab art and ring were already approved; the typeface and grey-on-white palette were what made it look like any other app. |
| 24 Nov 2026 | Memorable thing: calm competence. | The product's job is to turn a frightening subject into a short list. |
| 24 Nov 2026 | Figtree for text, Fraunces for score numerals. | A serif score in a sans app is the one thing people remember. Codex's Source Sans 3 and Newsreader was close to Ready.gov's own pairing. |
| 24 Nov 2026 | Warm paper `#F3F0E8`, white cards, no shadows. | Three independent proposals (this session, Codex, a second Claude) agreed on warm paper and ink. Cards stay white so kit photos are not tinted. |
| 24 Nov 2026 | Red means expired, destructive or broken, never a gap or a low score. | The category shouts; Go Bag writes things down. |
| 24 Nov 2026 | Wordmark frozen in Inter 700. | It was the founder's pick (PR #91) and a font change must not redraw it. |
| 24 Nov 2026 | Approved from a before/after of the real app, all tabs, phone and desktop. | Not shown in that preview, so still unseen by the founder: a Fraunces headline, and dark mode. |
