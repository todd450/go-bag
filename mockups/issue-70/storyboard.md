# Issue #70: landing page and sign-in that also creates an account

Storyboard and option specs. Three designers build `A.html`, `B.html` and `C.html` from this file at
the same time; each keeps to its own option.

## Bounds from the brief

- **Who:** a stranger who wants to check their own household's kits (none seen yet), and the
  founder's family, who must land back in their own household.
- **Appetite:** two weeks for the whole brief, and most of it goes to household isolation and the
  Claude cost cap, which are never cut. The landing page is the first thing cut: the fallback is
  "one plain screen with the two buttons".
- **Decided:** anyone can sign up; each account starts its own private household; one email
  magic-link flow (`signInWithOtp`) is both sign-up and log-in.
- **No-gos:** no change to `emergency-kit-audit.html` or the Artifact; no passwords, social login or
  second method; no invites, sharing, household switcher or self-serve deletion; no payments, plans
  or bring-your-own-key; no analytics script; no real household data anywhere.
- **Where things live (decision 4a, recommended, not yet decided):** landing at `/`, app at `/app`,
  magic links back to `/app`. The landing is a separate static file in `web/` (decision 9a). The
  sign-in card is the overlay `web/runtime.js` draws on top of the app; it is the only sign-in UI
  that exists today.

## Storyboard

Frames marked *(outside)* happen away from the product.

1. **A nudge (outside).** Evening. A wildfire-smoke alert on the phone, or a friend's text: "we
   finally checked our go-bags with this, ours was at 30%" and a link. The hall-closet bag was
   packed two years ago. *Trust needed:* that the link is worth tapping. Most arrivals are on a
   phone, from a text.
2. **The landing page, `/`.** What is this, what will it ask of me, who sees my family's details?
   *Trust needed:* that it is real and useful (show the product, not adjectives), and that the
   health details it will ask for stay private. *Earned by:* the product shown with a made-up
   family; a plain line on what is stored, who sees it and how to get it deleted.
3. **Choosing.** Two buttons, **Create an account** and **Log in**. Both lead to the same email
   form; only the words differ. *Trust needed:* that picking the "wrong" one does no harm.
4. **The email form. KEY MOMENT, part 1.** The stranger types an email: the one commitment the
   product asks for. *Trust needed:* no password, nothing created until they click the link, and a
   returning person gets their own household back, not a new empty one. *Earned by:* copy that says
   so next to the field.
5. **"Check your inbox." KEY MOMENT, part 2.** The journey leaves the product. *Trust needed:* it
   went to the address they meant, and they know what to look for. *Earned by:* the address shown
   whole with a way to change it; who the email is from and its subject; what to do if it doesn't
   come (spam folder, send again after a wait).
6. **The inbox (outside).** An email from "Emergency Kit Audit", subject "Your sign-in link for
   Emergency Kit Audit". It may land in spam or Promotions until the sending domain is verified
   (decision 8). Work email scanners can open the link first and use it up. *Trust needed:* that it
   is the email they asked for and safe to tap.
7. **Back in the product, `/app`.** First time: the household is created on this real sign-in and
   the app opens empty, on its own first run ("Set up in 4 quick steps": where you live, who lives
   with you, health needs, pets). The app page itself doesn't change. A family member instead lands
   in the family household with everything in it. *Trust needed:* that this is mine and private.
8. **The closet (outside).** They lay the go-bag out on the floor and photograph it. This is the
   moment the product exists for; everything before it is the door.
9. **Next week.** On the same browser, `/` goes straight to `/app`. On a new phone, **Log in**, the
   same email, a new link, and the same household with its kits.

**Failure frames** every option must answer: an address that isn't one ("maria@gmail"); too many
links asked for (Supabase answers 429); the send fails; the email never arrives; the link has
expired or was already used (Supabase sends the person back to `/app` with
`error_code=otp_expired` in the address); the link opened on a different device from the tab that
asked for it.

**The key moment is frames 4 and 5: handing over an email and being told to go to the inbox.** It
is where a stranger commits, the only place sign-up and log-in meet, and the one step where the
product can lose someone without knowing: a typo, a spam folder or a spent link, and they never
come back.

## The key moment at different stars

- **1 star.** Today's card: "Enter your email and we'll send you a link to sign in", then one grey
  line of text. Nothing says whether this makes an account, it uses colours that aren't the app's,
  and an expired link shows the same blank form with no explanation.
- **3 stars.** The same card with honest copy for each button ("Create your household" / "Log in"),
  a sent line that names the address, and the card drawn in the app's own tokens. The landing is
  one plain screen.
- **5 stars.** The sent state is a real step: the address in bold with **Use a different email**;
  who the email is from and its subject; "nothing in a few minutes? check spam, or send it again"
  with a 60-second wait on the resend; a clear screen for an expired link. The landing shows the
  product with a made-up family's real numbers and says plainly what is stored and who sees it.
- **7 stars.** The person never leaves the landing to sign up: the form opens on the page, the
  sent state shows a picture of the email they're about to get, the tab moves itself into the app
  when the link is opened on the same browser, and the first arrival says "Your household is ready.
  Only you can see it" with the first step. The email itself is designed, not Supabase's default.
- **9 stars.** A try-it household on the landing: the real app, in memory, loaded with a made-up
  family, that the visitor can poke before giving an email (Claude features off, so it costs
  nothing).
- **11 stars.** The product reads the town from the visitor's first message and shows "here is what
  a household like yours in Eugene, Oregon usually misses" before they own anything.

9 and 11 are out: 9 loads the whole app on the landing page (against decision 4a's light static
page) and is a week by itself; 11 needs Claude before sign-up, which the cost cap exists to stop.

## Shared rules for every option

- **One design language.** Use the app's tokens exactly as `emergency-kit-audit.html` declares them
  in `:root` (light and the dark block): `--paper #F7F7F7`, `--card #FFF`, `--ink #222`,
  `--ink-2 #6A6A6A`, `--rule #E4E4E4`, `--rule-2 #C8C8C8`, `--accent #222` (black pill buttons),
  `--brand #2B59D9` Cobalt for the brand mark only, `--brand-track #CCD8F6`, `--brand-tint #E8EEFC`,
  `--bad #C1281B`, `--good #1F7A4A`, `--shadow`, Inter (`--f-body`), radius 16 for `.panel`, 999 for
  `.btn`. Components to reuse: `.btn` (black pill), `.btn.ghost`, `.btn.sm`, `.panel`, `.notice`,
  `.eyebrow`, `.muted`, `.seg`, `label.f` + input. Copy these rules from the page; invent no new colours,
  radii or type sizes. The sign-in card today uses its own green `--gb-*` palette; every option
  redraws it in the page's tokens (the card sits in the same document as the page, so it can use
  `var(--ink)` and friends directly).
- **The brand mark** is the supply case drawn by `caseParts()` in the page, at score 75 (the brand
  form), Cobalt on `--brand-track`. Copy its SVG from the page (lines around `caseParts`); don't
  redraw it.
- **Fonts:** the same Inter stylesheet link the app uses is fine (it is a stylesheet, not a script).
  No scripts at all in the mockup.
- **Mockup page layout.** One page that shows the journey's frames top to bottom, each under a small
  label in `.eyebrow` style ("Frame 2 · Landing, `/`", "Frame 5 · Sent", "Frame 6 · Inbox
  (outside)"). Each frame is drawn at the width the page is viewed at, so the phone screenshot (390)
  shows the phone layout and the desktop one (1440) the desktop layout. Put frames 2 to 5 first:
  the screenshots are a tall view of the top of the page, and that is what the founder compares.
  Outside frames are drawn simply (an inbox row, a phone notification), not as illustrations.
- **Real content.** Made-up people only. The standard made-up family is `tests/household.json`:
  Alex 41, Sam 39 (daily medication), Jordan 9, Riley 6 (severe allergy), Casey 2, a dog, one car,
  Springfield, OR. Their app reads: readiness **17 of 100, Low**; kits **Hall closet go-bag 6%**,
  **Basement bin 1%**, **Trunk bag 1%**; next step **CPR & airway: add 1, +14**; "Adding the supply
  below takes readiness from 17 to 31"; "39 more gaps after these". Use those numbers, not nicer
  ones. Email addresses: a short one, `alex@example.com`, and a long one that must not overflow at
  390 px, `maria.delacruz-whitfield@family-mail.example.org`.
- **Placeholders the founder fills:** the public domain (decision 8) is shown as `go-bag.example`
  and the sender as `sign-in@go-bag.example`; the deletion address as `hello@go-bag.example`. Don't
  claim the product is free (no pricing has been decided) and don't promise numbers about Claude
  use.
- **Language:** the product ships in English only. Still design for long strings: the long email,
  "Medication supply cut off", and buttons that wrap at 320 px without clipping.
- **Privacy line, the same words in every option** (the brief's line, made plain): "We store your
  kits, their photos and who lives in your household, including any health needs you add. Only
  people signed in to your household can see it. To have everything deleted, email
  hello@go-bag.example."
- **Signed-in visitors** to `/` go straight to `/app`. No frame needed; note it under frame 2.

## Option A: One plain screen (3 stars)

**At the key moment.** The landing is one screen: the mark, one sentence, two buttons and the
privacy line. Both buttons go to `/app`, where the existing sign-in card shows copy for the button
pressed and a sent line that names the address.

**What sets it apart.** It is the brief's own fallback, built as the design. No product pictures,
no scrolling on a 1440 x 900 desktop or a 390 x 844 phone, and the only sign-in UI is the card that
already exists, with new words and the app's tokens. The founder sees exactly what ships if the
two weeks run out.

**Frames to draw**

- **Frame 2 · Landing, `/`.** Centered column, max width ~560 px, on `--paper`. Case mark at 56 px,
  then "Emergency Kit Audit" (1.1 rem, 600). `h1` (2 rem desktop, 1.6 rem phone): "How ready is your
  household for an emergency?" Paragraph (`--ink-2`): "Photograph what's in your emergency kits. Get
  a readiness score sized to who lives with you and where you live, then a shopping list and a
  family plan that close the gaps." Buttons side by side (stacked full-width on phone): **Create an
  account** (`.btn`), **Log in** (`.btn.ghost`). The privacy line under them in `.small .muted`.
  Nothing else: no header, no footer, no pictures.
- **Frame 4 · Card at `/app?start=new`.** The existing card (one `.panel`, max 380 px, centered on
  `--paper`), redrawn in the app's tokens. Heading "Create your household". Text: "Enter your email
  and we'll send you a link. Opening it creates your household. No password." `label.f` "Email",
  input, `.btn` full width "Email me a link". Under it, `.small .muted`: "Already have an account?
  The same link logs you in."
- **Frame 4b · Card at `/app?start=login`.** Heading "Log in". Text: "Enter the email you signed up
  with and we'll send you a link." Same field and button. Under it: "New here? The same link creates
  your household."
- **Frame 5 · Sent.** The card keeps its heading; the line under the button becomes "Check
  **maria.delacruz-whitfield@family-mail.example.org** for a link. You can close this tab." (wraps,
  never clipped). The button stays, so sending again is just pressing it.
- **Frame 6 · Inbox (outside).** One inbox row: "Emergency Kit Audit" / "Your sign-in link for
  Emergency Kit Audit". Supabase's default email body, with only the subject changed.
- **Frame 7 · Arrival.** A small note-frame: "Opens `/app`: the app's own first run, unchanged."
- **Failure states,** each as a one-line message under the button in `--bad` where it's an error:
  "Enter an email address." / "Too many links sent. Wait a few minutes and try again." /
  "Couldn't send the link. Try again." / for an expired link the card shows the Log in copy with
  "That link has expired or was already used. Send yourself a new one."

**Cost.** About half a day: one static file in `web/`, `tools/build-web.js` copies it, and copy and
token changes in `signInCard()`. No new components.

## Option B: Show the product, then a sign-in that tells you what's next (5 stars)  *(recommended)*

**At the key moment.** The landing shows the made-up family's readiness and next steps, so a
stranger sees what they'd get before giving an email. The sign-in card at `/app` becomes a two-step
card: the form, then a full "Check your inbox" step that names the address, who the email is from
and its subject, and what to do if it doesn't arrive, with a clear screen for an expired link.

**What sets it apart.** The landing scrolls and *shows the product*, using drawn stills of the real
app with `tests/household`'s numbers. The sign-in still happens in the existing card at `/app`
(the landing loads no app code), but the card's sent and failure states are designed as screens,
not lines of text. It does not put the form on the landing and does not change the email.

**Frames to draw**

- **Frame 2 · Landing, `/`.**
  - Top bar like the app's `.top`: case mark 28 px + "Emergency Kit Audit" on the left; **Log in**
    (`.btn.ghost.sm`) on the right.
  - Hero, two columns on desktop (text left, still right), stacked on phone (text, then still).
    `h1`: "See how ready your household is for an emergency." Paragraph: "Photograph what's in your
    kits. Emergency Kit Audit scores them for who lives with you and where you live, then turns the
    gaps into a shopping list and a family plan." Buttons: **Create an account** (`.btn`) and **Log
    in** (`.btn.ghost`). Under them, `.small .muted`: "No password: we email you a link."
  - The hero still: the app's Readiness panel drawn in HTML/CSS with the app's own classes'
    look: the ring at **17 of 100, Low**, and "Your next 3 steps" with "CPR & airway: add 1 · +14"
    and "Pick a meeting place and an out-of-area contact". Caption under it in `.small .muted`: "A
    made-up family of five in Springfield, Oregon. Adding three things takes them from 17 to 31."
    Don't make the family look prepared; the low score is the honest pitch.
  - Three steps, a row of three `.panel`s on desktop, stacked on phone, each with a small drawn
    still and one line: **1 Photograph your kits** (the Kits tab's flat-lay grid: "First-aid kit",
    "Headlamp ×2", an "Emergency radio · Add to list" ghost tile), "Claude reads the photo and lists
    what's there." **2 See your gaps** (three kit rows: Hall closet go-bag 6%, Basement bin 1%,
    Trunk bag 1%), "Scored for your household, your town and the emergencies you care about."
    **3 Close them** (two shopping rows with "+14" and "Add to list"), "A shopping list and a family
    plan, in the order that helps most."
  - "Your household's details" block, a plain `.panel`: heading
    "Private to your household", the shared privacy line, and "Each account gets its own household.
    Nobody else's account can see it."
  - Footer: the two buttons again, then `.small .muted` "Emergency Kit Audit · go-bag.example".
- **Frame 4 · Card at `/app?start=new`.** Same copy as A's frame 4 ("Create your household" ...
  "Already have an account? The same link logs you in."), in the app's tokens, with the case mark
  at 40 px above the heading so the card reads as the same product as the landing.
- **Frame 4b · `/app?start=login`.** As A's 4b.
- **Frame 5 · Sent (the card's second step).** The form is replaced by: heading "Check your inbox";
  "We sent a link to" then the address on its own line in 600 weight (long address wraps by
  character, never overflows); a `.notice`-style box: "From **Emergency Kit Audit**
  (sign-in@go-bag.example) · Subject **Your sign-in link for Emergency Kit Audit** · The link works
  once, for one hour." Then `.small .muted`: "Nothing after a few minutes? Check spam or Promotions."
  Two buttons: **Send it again** (`.btn.ghost`, disabled with "Send again in 0:42" for 60 s after
  sending) and **Use a different email** (text link). Last line: "You can close this tab. The link
  opens the app wherever you tap it."
- **Frame 6 · Inbox (outside).** Inbox row as in A, plus the opened email drawn as a plain card:
  "Here's your link to Emergency Kit Audit." black pill "Open Emergency Kit Audit", "This link works
  once and expires in an hour. If you didn't ask for it, ignore this email." (Supabase's email
  template, edited in the dashboard: no code.)
- **Frame 7 · Arrival.** Note-frame: "Opens `/app`: the app's own first run ('Set up in 4 quick
  steps'), unchanged."
- **Failure frames, each drawn as the card:** invalid address (field border `--bad`, message under
  the field "Enter a full email address, like alex@example.com"); 429 ("You've asked for several
  links in a short time. Wait 5 minutes, then send again." with the resend button disabled); send
  failed ("Couldn't send the link. Check your connection and try again."); **expired link**: its
  own card, heading "That link has expired", text "Links work once, for an hour. A link can also
  be used up if your email app opened it first. Send yourself a new one.", the email field and
  **Email me a new link**.

**Cost.** About two days: the landing file with drawn or cropped stills (taken with
`tools/screenshots.js` from `tests/household`), the card's two steps and four failure states in
`signInCard()`, and the email template text in the Supabase dashboard. No new components beyond the
card's states.

## Option C: Sign up without leaving the landing (7 stars)

**At the key moment.** The email form opens right on the landing page, inline, and the sent state
shows a small picture of the email that's coming. When the link is opened in the same browser, the
waiting tab moves into the app by itself, and the first arrival shows a one-time welcome: "Your
household is ready. Only you can see it."

**What sets it apart.** No hop to `/app` to sign in: the form, the sent state and the waiting live
on the landing. It adds two things the other options don't have, each a proposal of its own: a
**welcome sheet** drawn by `web/runtime.js` over the app on the very first sign-in (a new
component), and a **designed sign-in email** (HTML template with the case mark). The landing is
shorter than B's: one still, not three steps.

**Frames to draw**

- **Frame 2 · Landing, `/`.** Same top bar as B. Hero, two columns on desktop: left, `h1` "See how
  ready your household is for an emergency.", the paragraph from B, then the **email field and
  button already on the page** (`label.f` "Your email", input, `.btn` "Email me a link") with a
  two-way switch above it, using the app's `.seg` toggle (the Space | Weight and Flat-lay | List switch): **Create an account** |
  **Log in** (switching changes only the button text and the line under it). Right: the Readiness
  still from B (17 of 100, Low, next steps) with B's caption. Under the hero: the privacy line in a
  plain `.panel`. No three-step row.
- **Frame 4 · The form, "Create an account" chosen.** Field focused, line under the button: "Opening
  the link creates your household. Already have one? The same link logs you in." With "Log in"
  chosen: "We'll send a link to the email you signed up with. New here? The same link creates your
  household."
- **Frame 5 · Sent, in place of the form on the landing.** Heading "Check your inbox", the address
  on its own line (long one wraps), then a **preview of the email** drawn as a small inbox card:
  sender "Emergency Kit Audit", subject "Your sign-in link for Emergency Kit Audit", first line
  "Tap to open your household. Works once, for an hour." Under it: "Nothing after a few minutes?
  Check spam or Promotions." **Send it again** (60 s wait, as B) and **Use a different email**. Then
  "Waiting for you to open the link. This tab moves on by itself if you open it in this browser.",
  drawn static (no animation, no script). On phone, add: "Opening it in your mail app? That's fine, it signs you in there."
- **Frame 5b · The same tab, after the link was opened in another tab.** The sent panel becomes:
  "You're signed in." and **Open your household** (`.btn`).
- **Frame 6 · The designed email (outside).** Drawn as a 600 px email: case mark at 48 px, "Here's
  your sign-in link." (no name: the product doesn't know it yet). Black pill
  **Open Emergency Kit Audit**. "This link works once and expires in an hour. It was asked for at
  go-bag.example. If that wasn't you, ignore it: no household is made until the link is opened."
- **Frame 7 · First arrival, the welcome sheet (new component).** Over the app's first-run screen
  (drawn faded behind), a centered `.panel` 420 px: case mark, heading "Your household is ready",
  "It's private: only people signed in to it can see it. Right now that's just
  **maria.delacruz-whitfield@family-mail.example.org**." Then "Start with who lives with you and
  where. It takes about two minutes, then photograph your first kit." **Set up my household**
  (`.btn`) and **Look around first** (`.btn.ghost`). Shown once, on the sign-in that created the
  household; a family member joining the family household never sees it.
- **Failure frames:** as B's (invalid, 429, send failed), drawn inline on the landing; the expired
  link lands on `/` with the form open and the message "That link has expired or was already used.
  Send yourself a new one."

**Cost.** About four days, all of it out of the two weeks the isolation work needs: the form on the
landing means the landing talks to Supabase's auth itself (a plain request, or supabase-js, which
undoes "loads no app code"; the architect's call); the cross-tab move-on needs a listener and only
works in the same browser; the welcome sheet is a new runtime overlay that needs to know "this
sign-in created the household" from the database function; the email template is HTML in the
Supabase dashboard and must be tested in Gmail, Outlook and Apple Mail.

## Recommendation: B

B fixes the step where strangers are lost silently (the inbox hand-off) and shows the product
before asking for anything, in about two days, which leaves the rest of the two weeks for isolation
and the cost cap. C's extras mostly help people who open the link in the same browser, which on a
phone (frame 1's likely arrival) they often won't, and its welcome sheet is a new component to
maintain. A is what ships if B runs over; B's card states can land on A's landing without rework.
