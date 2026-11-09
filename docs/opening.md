# Opening the Vercel site to strangers

The founder's checklist from #70: follow it top to bottom, and don't skip ahead. The site stays
behind Vercel's Deployment Protection until step 5 comes back all 0s (D7).

Placeholders: `go-bag.example` stands for the founder's domain (D8), `alex@example.com` and
`sam@example.com` for real addresses, and `<household_id>` for a household's id, copied from
the SQL that finds it. Run SQL in the Supabase dashboard's SQL Editor for project `go-bag`. A
session may run it for you only with your yes, since it touches the family's data.

## 1. Apply the migrations

Each migration waits on the step named next to it. Apply one by pasting its file from
`supabase/migrations/` into the SQL Editor.

**Before 0002, close sign-ups.** Once 0002 is applied, any account that signs in can make its own
household. Until 0003, 0004 and 0005 are on too, that account still passes the old photo and
Claude checks (security review on #80). So:

- In Authentication → Sign In / Providers, turn **Allow new users to sign up** off. It stays off
  until step 6.
- Check that every account is on the family's list. This must return no rows:

  ```sql
  select email from auth.users u
  where not exists (select 1 from public.allowed_emails a where a.email = lower(u.email));
  ```

  Any address it lists was typed into today's sign-in form. Delete it in Authentication → Users,
  or add it to `allowed_emails` if it is family.

**Then, in this order:**

1. **`0002_households.sql`**: any time, once sign-ups are off, and before #78 is deployed, since
   #78's app asks for the caller's household. Post the docs counts by `col` on #70, from just
   before and just after. They must match.

   ```sql
   select col, count(*) from public.docs group by col order by col;
   ```

2. **`0005_claude_allowance.sql`**: after 0002, once #75 is merged. Until it is applied,
   `/api/sample` answers `unavailable`. Claude then stays off on Vercel, for the family too,
   until step 4.
3. **`0003_photo_folders.sql`**: once the app-at-`/app` change (#78) is deployed. First post
   this count on #70. It must be 0, or the migration stops itself:

   ```sql
   select count(*) from storage.objects where bucket_id = 'photos' and name not like '%/%';
   ```

4. **`0004_household_broadcast.sql`**: once #78 is deployed.

After 0003 and 0004, check on the site, still behind the Vercel login: a photo added to a kit
shows after a reload, and a change on one of your devices shows on another without a reload.

## 2. Email

Strangers' sign-in links go out through Resend, on your domain (D6, D8).

- In Resend, add the domain `go-bag.example` and add the DNS records it asks for. Wait until it
  shows **Verified**. Make an API key that can only send.
- In Supabase, Authentication → Emails → SMTP Settings, turn on custom SMTP:
  - host `smtp.resend.com`, port `465`, username `resend`, and the Resend key as the password
  - sender address the same as `SENDER_EMAIL` in step 3, such as `sign-in@go-bag.example`
  - sender name **Go Bag**
- In Authentication → Emails → Templates, give both **Magic Link** and **Confirm signup** the
  subject **Your sign-in link for Go Bag**.
- In Authentication → Sign In / Providers → Email, set the email OTP expiry to **3600** seconds,
  so the sign-in card's "one hour" is true. Check that **Confirm email** is on: the family's
  addresses join the family household only once confirmed.

## 3. URLs

- In Vercel, project `go-bag` → Settings → Domains, add `go-bag.example` and set the DNS records
  Vercel shows.
- In Supabase, Authentication → URL Configuration:
  - Site URL: `https://go-bag.example/app`
  - Redirect URLs: add `https://go-bag.example/app`
- In Doppler, project `go-bag`, config `prd`:
  - `CONTACT_EMAIL`: the address the landing gives for deletion requests, such as
    `hello@go-bag.example`
  - `SENDER_EMAIL`: the sender address from step 2

  Vercel gets `prd` through Doppler's integration. Redeploy production so the build picks both
  up. Then `/` shows the landing, and `/app` opens the app. A new visitor's buttons go to
  `/app?start=new` and `/app?start=login`.

## 4. Claude cap

Every household gets a daily number of Claude requests. A hard monthly limit on the key backs it
up (D5). Pick the numbers, set them, and confirm them on #70:

```sql
update public.claude_settings set daily_calls = <n>;
-- Optional: the family's own number.
update public.households set daily_calls = <n> where name = 'family';
```

- In the Anthropic Console, make a workspace (or key) used only by go-bag. Give it a hard
  monthly spend limit.
- Set its key as `ANTHROPIC_API_KEY` in Doppler `go-bag` `prd`, and redeploy production.
- Signed in on the site, a household past its number sees the page's "rate limited" message.

## 5. The two-account check

This is the check on the real project that opening waits on (D10). Use two throwaway addresses
you can read, A (`alex@example.com`) and B (`sam@example.com`). Sign-ups are still off, so make
each with Authentication → Users → Add user → Send invitation.

1. Open each link in its own browser, or one in a private window, so A and B are both signed
   in. Each gets an empty household. As A, add a kit with a photo.
2. Find A's household and one of A's photos:

   ```sql
   select m.household_id from auth.users u
   join public.household_members m on m.user_id = u.id
   where lower(u.email) = lower('alex@example.com');

   select split_part(name, '/', 2) as photo_id from storage.objects
   where bucket_id = 'photos' and name like '<household_id>/%' limit 1;
   ```

3. In B's browser, on `/app`, open the developer console and paste this. A warning about more
   than one GoTrueClient is harmless.

   ```js
   const c = supabase.createClient(GO_BAG_CONFIG.supabaseUrl, GO_BAG_CONFIG.supabaseKey);
   const A = "<household_id>";
   (await c.from("docs").select("*", { count: "exact", head: true }).eq("household_id", A)).count;
   ```

   **Docs: 0.** Then the photo, which should give **401 or 404**:

   ```js
   const r = await fetch("/_blob/<photo_id>", { redirect: "manual" }); r.status || r.type;
   ```

   Then listen on A's live updates:

   ```js
   let got = 0;
   c.channel("household:" + A, { config: { private: true } })
     .on("broadcast", { event: "*" }, () => got++)
     .subscribe(s => console.log(s));
   ```

4. As A, add a kit, rename it, and delete it. Then in B's console, `got`. **Live updates: 0**,
   deletes included. A `CHANNEL_ERROR` from `subscribe` means B was refused, which passes.
5. Run the same three in A's console, with A's own ids, before you trust B's 0s. A should see
   more than 0 docs, `opaqueredirect` for the photo, and `got` of 3 or more. If A sees 0 too,
   the check proves nothing. Stop and ask a session why.

Post B's three results on #70: docs, photo and live updates. Then delete both accounts and their
households with step 7.

## 6. Open

Only when step 5 is all 0s (D7):

- In Vercel, project `go-bag` → Settings → Deployment Protection, set Vercel Authentication to
  **Standard Protection**. That turns it off for production only and keeps previews protected.
  Don't choose Disabled.
- In Supabase, turn **Allow new users to sign up** back on.
- In a private window, `https://go-bag.example/` shows the landing. A preview link still asks for
  a Vercel login.

Bot protection stays Supabase's built-in auth rate limits (D11). Leave Authentication → Rate
Limits as they are, and leave CAPTCHA off.

## 7. Deleting a household on request

When someone asks to have everything deleted, from the address they signed up with:

1. Find their household. If `name` is `family`, stop: that is your own.

   ```sql
   select m.household_id, h.name from auth.users u
   join public.household_members m on m.user_id = u.id
   join public.households h on h.id = m.household_id
   where lower(u.email) = lower('alex@example.com');
   ```

2. In the Storage dashboard, bucket `photos`, delete the folder `photos/<household_id>/`. Then
   this is 0:

   ```sql
   select count(*) from storage.objects
   where bucket_id = 'photos' and name like '<household_id>/%';
   ```

3. Delete the household's accounts and the household. Its docs, member rows and Claude usage go
   with it. The `family` household is refused.

   ```sql
   begin;
   delete from auth.users where id in (
     select m.user_id from public.household_members m
     join public.households h on h.id = m.household_id
     where h.id = '<household_id>' and h.name is distinct from 'family');
   delete from public.households where id = '<household_id>' and name is distinct from 'family';
   commit;
   ```

4. Check that all three are 0, then reply to them:

   ```sql
   select (select count(*) from public.households where id = '<household_id>') as households,
          (select count(*) from public.docs where household_id = '<household_id>') as docs,
          (select count(*) from auth.users where lower(email) = lower('alex@example.com')) as accounts;
   ```

## 8. Check back in 4 weeks

Four weeks after step 6, count the households other than the family's that saved at least one
kit with at least one item in it (the brief's "How we'll know it worked"):

```sql
select count(distinct h.id) as households from public.households h
join public.docs kit on kit.household_id = h.id and kit.col = 'kits'
join public.docs item on item.household_id = h.id and item.col = 'items'
  and item.data ->> 'kitId' = kit.id
where h.name is distinct from 'family';
```

It worked at 3 or more; at 0 it didn't. Post the number on #70, with the month's Anthropic spend
against the cap.
