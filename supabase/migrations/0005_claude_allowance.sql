-- The daily Claude allowance (issue #75, part of #70): each household may make so many Claude
-- requests a day, one per /api/sample call, so a stranger can't run up the founder's bill. Decided
-- on #70 (D5): a daily allowance per household here, plus a hard monthly spend limit on a dedicated
-- Anthropic workspace or key, which bounds the cost even if this counter has a bug.
-- Apply after 0002, which makes public.households and public.my_household_id().
--
-- The founder sets the numbers in SQL. Until then the default is 0 and every claim is refused:
--   update public.claude_settings set daily_calls = <n>;                     -- every household
--   update public.households set daily_calls = <n> where name = 'family';    -- one household
--   update public.households set daily_calls = null where name = 'family';   -- back to the default
--
-- No API role reads or writes these tables: row level security is on with no policies, and the
-- API roles hold no privileges on them. claim_claude_call() is the only way in.

-- ---------- How many calls a day ----------
-- One row, ever: its id can only be true.
create table public.claude_settings (
  id boolean primary key default true check (id),
  daily_calls int not null default 0
);
insert into public.claude_settings default values;
alter table public.claude_settings enable row level security;
revoke all on table public.claude_settings from anon, authenticated;

-- A number here is that household's own allowance and overrides the default; null uses the default.
alter table public.households add column daily_calls int;

-- ---------- How many calls each household has made, per UTC day ----------
create table public.claude_usage (
  household_id uuid references public.households on delete cascade,
  day date,
  calls int not null default 0,
  primary key (household_id, day)
);
alter table public.claude_usage enable row level security;
revoke all on table public.claude_usage from anon, authenticated;

-- ---------- Taking one call ----------
-- True when the caller's household had a call left today and this took it. False when today's
-- allowance is used up, the allowance is 0, or the caller has no household. Atomic: two claims at
-- once can't both take the last call, because the upsert locks the day's row and checks the count
-- on the row it locked.
create function public.claim_claude_call() returns boolean
language plpgsql volatile security definer set search_path = ''
as $$
declare
  hid uuid := public.my_household_id();
  allowance int;
  taken int;
begin
  if hid is null then return false; end if;

  select coalesce(h.daily_calls, (select s.daily_calls from public.claude_settings s), 0)
  into allowance
  from public.households h where h.id = hid;
  -- The upsert's first row of the day never checks the allowance, so none means none here.
  if coalesce(allowance, 0) < 1 then return false; end if;

  insert into public.claude_usage as u (household_id, day, calls)
  values (hid, (now() at time zone 'utc')::date, 1)
  on conflict (household_id, day) do update set calls = u.calls + 1
  where u.calls < allowance
  returning u.calls into taken;

  return taken is not null;
end;
$$;
revoke all on function public.claim_claude_call() from public, anon, service_role;
grant execute on function public.claim_claude_call() to authenticated;
