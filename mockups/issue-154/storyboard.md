# Issue #154: the header, after Airbnb's

The founder shared Airbnb's desktop header (14 Nov 2026) and asked for Go Bag's to take its ideas, not
its brand: an illustrated icon per tab, a strong underline under the selected tab, account and menu
grouped on the right, calm spacing. Go Bag keeps its Cobalt case logo, its "Go [case] Bag" wordmark
(#49, #50, #92), its three tabs and its colours.

## The journey

1. **Opening the app.** The header says whose app this is (the wordmark) and where you are (the
   selected tab). The moment that matters most: knowing at a glance which of the three places you
   are in, and getting to another with one tap.
2. **Moving between tabs.** On a phone this is a thumb on the bottom bar today. On desktop it is a
   row of plain text tabs under the logo.
3. **Checking the score from another tab.** The readiness pill in the header shows the score on
   Kits and Household (on Readiness it fades in once the big ring scrolls away).
4. **Signing out or checking who is signed in.** On Vercel the runtime adds a "Log out" pill to the
   header today. Nothing says who is signed in except a hover title.

## Stars

- **One star:** today's header with icons added to the desktop tabs.
- **Five stars:** a calm single row on desktop; the tabs read as places, each with its own small
  illustrated object; one account button on the right that says who you are and holds Log out.
- **Seven+ stars:** the Readiness icon is live, its needle and the case fill to the household's
  score; the Kits backpack shows how many kits there are. Not in these options: it ties the icon to
  data and would need its own decision.

## Options

All three are the real page with `tests/household` loaded; only the header differs.

- **Now:** `now.html`.
- **A · One row, same icons in the bottom bar** (`a.html`). Desktop: logo left, the three tabs
  centred with a 40px illustrated icon beside each label, a 3px dark underline under the selected
  one, and the score pill plus a round account button on the right. Phone: the top bar keeps the
  logo, score and account button; the bottom bar stays for thumbs and uses the same illustrated
  icons, with a short dark bar over the selected tab.
- **B · Icons above labels, tabs at the top on phones too** (`b.html`). Desktop: the icons sit
  above the labels, 44px, Airbnb's mobile-web arrangement. Phone: no bottom bar; the three tabs fill
  a row under the logo, and their icons tuck away as the page scrolls, leaving a slim row of labels.

The account button is a new component in both: a round button with the signed-in person's initial
that opens a small menu with their email and Log out. On Vercel the runtime fills it, as it adds
"Log out" today; in the claude.ai runtime there is no sign-out, so it is absent. There is no separate
hamburger menu: Go Bag has nothing else to put in one.
