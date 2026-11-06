-- Households (issue #71, part of #70): every account gets its own private household, and the one
-- household 0001 stored becomes the family household. Decided on #70: members are keyed by
-- Supabase user id, one household per account (D1), and the family's addresses on allowed_emails
-- join the family household on their first sign-in.
-- Realtime, Storage and api/ are left as they are here: #72, #74 and #75 change them.
--
-- DO NOT APPLY THIS TO PROJECT go-bag ON ITS OWN. Apply it only in the same step as #72, #74 and
-- #75. Turning off "Allow new users to sign up" is no substitute: it stops only new accounts, and
-- today's sign-in form (web/runtime.js) has already made an account for every address ever typed
-- into it, listed or not.
-- Why: after this migration is_member() means "has a household", and any account that signs in
-- gets one by calling rpc('my_household'). Until those three land, that account:
--   - passes 0001's photos bucket policies, so it can list and read the family's photos (#74)
--   - passes api/_member.mjs, so api/sample.mjs spends the Anthropic key for it (#75)
--   - receives the family's Realtime DELETE events, which RLS does not filter, and today's
--     runtime then drops its own doc with the same col and id (#72)

-- ---------- Households and who is in them ----------
-- No API role reads or writes these tables: row level security is on with no policies, and the API
-- roles hold no privileges on them. The functions below, and the founder's SQL, are the only way in.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text, -- for the founder's SQL only; the page never shows it
  created_at timestamptz not null default now()
);
alter table public.households enable row level security;
revoke all on table public.households from anon, authenticated;

-- The primary key on user_id is what makes it one household per account.
create table public.household_members (
  user_id uuid primary key references auth.users on delete cascade,
  household_id uuid not null references public.households on delete cascade,
  created_at timestamptz not null default now()
);
create index household_members_household_id on public.household_members (household_id);
alter table public.household_members enable row level security;
revoke all on table public.household_members from anon, authenticated;

-- ---------- The family household ----------
insert into public.households (name) values ('family');

-- From now on a row here means "this address joins that household on its first sign-in". The
-- founder still manages it in SQL, now naming the household:
--   insert into public.allowed_emails (email, household_id)
--   select 'someone@example.com', id from public.households where name = 'family';
alter table public.allowed_emails add column household_id uuid references public.households;
update public.allowed_emails set household_id = (select id from public.households where name = 'family');
alter table public.allowed_emails alter column household_id set not null;
revoke all on table public.allowed_emails from anon, authenticated;

-- Every account that already exists with an address on allowed_emails joins now, matched without
-- regard to letter case, so the family keeps working on today's web/runtime.js (which asks
-- is_member() and never calls my_household()). Confirmed or not, as under 0001: an account whose
-- link was requested but not yet clicked holds no session until it is clicked, and then it is a
-- member, as it would have been before. Accounts made from now on join through my_household(),
-- which asks for a confirmed address.
insert into public.household_members (user_id, household_id)
select u.id, a.household_id
from auth.users u
join public.allowed_emails a on a.email = lower(u.email)
on conflict (user_id) do nothing;

-- ---------- Which household the caller is in ----------
-- The caller's household, or null. Never creates anything.
create function public.my_household_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select household_id from public.household_members where user_id = auth.uid();
$$;
revoke all on function public.my_household_id() from public, anon, service_role;
grant execute on function public.my_household_id() to authenticated;

-- The one call the browser makes after a real sign-in: the caller's household, made the first
-- time. A confirmed address on allowed_emails joins that household; any other account gets a new
-- one. Not a trigger on auth.users, because signInWithOtp makes the user when a link is only
-- requested. Safe to call twice at once: one member row wins and the loser's spare household is
-- removed.
create function public.my_household() returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  invited uuid;
  made uuid;
  found uuid;
begin
  if uid is null then return null; end if;

  select household_id into found from public.household_members where user_id = uid;
  if found is not null then return found; end if;

  -- A token for an account that no longer exists gets nothing.
  if not exists (select 1 from auth.users where id = uid) then return null; end if;

  select a.household_id into invited
  from auth.users u
  join public.allowed_emails a on a.email = lower(u.email)
  where u.id = uid and u.email_confirmed_at is not null;

  if invited is null then
    insert into public.households default values returning id into made;
  end if;

  insert into public.household_members (user_id, household_id)
  values (uid, coalesce(invited, made))
  on conflict (user_id) do nothing;

  select household_id into found from public.household_members where user_id = uid;
  if made is not null and found is distinct from made then
    delete from public.households where id = made;
  end if;
  return found;
end;
$$;
revoke all on function public.my_household() from public, anon, service_role;
grant execute on function public.my_household() to authenticated;

-- Same name, signature and grants as 0001, so api/_member.mjs and today's runtime keep working:
-- a member is now anyone with a household.
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.my_household_id() is not null;
$$;

-- ---------- Each household's documents ----------
-- Every existing row is the family's. The column's default is the caller's household, so today's
-- runtime keeps writing {col, id, data, updated_at} without sending it.
alter table public.docs add column household_id uuid references public.households on delete cascade;
update public.docs set household_id = (select id from public.households where name = 'family');
alter table public.docs
  alter column household_id set not null,
  alter column household_id set default public.my_household_id();

-- Two households each keep their own household/profile.
alter table public.docs drop constraint docs_pkey;
alter table public.docs add primary key (household_id, col, id);

-- A row is visible and writable only from its own household, and no update can move it out.
drop policy "members read" on public.docs;
drop policy "members insert" on public.docs;
drop policy "members update" on public.docs;
drop policy "members delete" on public.docs;
create policy "own household read" on public.docs for select to authenticated
  using (household_id = (select public.my_household_id()));
create policy "own household insert" on public.docs for insert to authenticated
  with check (household_id = (select public.my_household_id()));
create policy "own household update" on public.docs for update to authenticated
  using (household_id = (select public.my_household_id()))
  with check (household_id = (select public.my_household_id()));
create policy "own household delete" on public.docs for delete to authenticated
  using (household_id = (select public.my_household_id()));
