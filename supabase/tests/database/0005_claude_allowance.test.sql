-- The daily Claude allowance (issue #75): claim_claude_call() takes one call from today's
-- allowance for the caller's household, and no API role can read or reset a count.
-- Run on a local stack: `supabase start`, then `supabase test db`. Everything here is rolled back.
-- Made-up people only:
--   alex  00000000-0000-4000-8000-0000000000b1  alex@example.com  household A, made by my_household()
--   sam   00000000-0000-4000-8000-0000000000b2  sam@example.com   household B, made by my_household()
--   pat   00000000-0000-4000-8000-0000000000b3  pat@example.com   has an account, never had a household
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create schema tests;
grant usage on schema tests to anon, authenticated;

-- Act as a signed-in user the way PostgREST does. Call it as postgres (after `reset role`).
create function tests.sign_in(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'email', (select email from auth.users where id = uid))::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function tests.sign_in_claims(claims text) returns void language sql as $$
  select set_config('request.jwt.claims', claims, true);
  select set_config('role', 'authenticated', true);
$$;
create function tests.sign_out() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
  select set_config('role', 'anon', true);
$$;
create function tests.remember(name text, value uuid) returns void language sql as $$
  select set_config('tests.' || name, value::text, true);
$$;
create function tests.id(name text) returns uuid language sql stable as $$
  select nullif(current_setting('tests.' || name, true), '')::uuid
$$;
-- How many of n claims in a row came back true, as whoever is calling.
create function tests.claims(n int) returns int language plpgsql as $$
declare got int := 0;
begin
  for i in 1..n loop
    if public.claim_claude_call() then got := got + 1; end if;
  end loop;
  return got;
end $$;
grant execute on all functions in schema tests to anon, authenticated;
-- Today, the way the allowance counts it.
create function tests.today() returns date language sql stable as $$ select (now() at time zone 'utc')::date $$;

insert into auth.users (id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'alex@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'sam@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated', 'pat@example.com', now());

select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select tests.remember('alex', public.my_household());
reset role;
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select tests.remember('sam', public.my_household());
reset role;

-- ---------- The tables ----------
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.claude_settings'::regclass, 'public.claude_usage'::regclass, 'public.households'::regclass)),
          'claude_settings, claude_usage and households have row level security on');
select is((select count(*) from pg_policies where tablename in ('claude_settings', 'claude_usage') and schemaname = 'public'),
          0::bigint, 'claude_settings and claude_usage have no policies');
select results_eq('select daily_calls from public.claude_settings', 'values (0)',
          'claude_settings holds one row, and its default allowance is 0');
select throws_ok('insert into public.claude_settings (id, daily_calls) values (false, 5)', '23514', null,
          'claude_settings cannot hold a second row');
select is((select daily_calls from public.households where id = tests.id('alex')), null,
          'a household has no allowance of its own until the founder sets one');

-- ---------- With the default 0, nothing is allowed ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select is(public.claim_claude_call(), false, 'with the default 0, the first claim is false');
reset role;
select is((select count(*) from public.claude_usage), 0::bigint, 'a refused claim counts nothing');

-- ---------- A default of 3: each household gets its own 3 ----------
update public.claude_settings set daily_calls = 3;
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select is(public.claim_claude_call(), true, 'A''s 1st claim of the day is true');
select is(public.claim_claude_call(), true, 'A''s 2nd claim is true');
select is(public.claim_claude_call(), true, 'A''s 3rd claim is true');
select is(public.claim_claude_call(), false, 'A''s 4th claim of the day is false');
select is(public.claim_claude_call(), false, 'and so is its 5th');
reset role;
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select is(public.claim_claude_call(), true, 'B''s 1st claim is true after A''s are used up');
reset role;
select results_eq(format($$ select household_id, day, calls from public.claude_usage order by calls desc $$),
          format($$ values (%L::uuid, %L::date, 3), (%L::uuid, %L::date, 1) $$, tests.id('alex'), tests.today(), tests.id('sam'), tests.today()),
          'usage holds 3 for A and 1 for B, both today (UTC): a refused claim never counts');

-- ---------- A household's own number overrides the default ----------
update public.households set daily_calls = 10 where id = tests.id('sam');
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select is(tests.claims(20), 9, 'B, with its own daily_calls = 10, gets 9 more after its 1st: 10 in all');
reset role;
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select is(public.claim_claude_call(), false, 'A, with no number of its own, is still held to the default 3');
reset role;
update public.households set daily_calls = 0 where id = tests.id('sam');
update public.claude_settings set daily_calls = 100;
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select is(public.claim_claude_call(), false, 'a household''s own 0 means none, even when the default is higher');
reset role;
update public.households set daily_calls = null where id = tests.id('sam');
update public.claude_settings set daily_calls = 3;
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select is(public.claim_claude_call(), false, 'lowering the allowance below today''s count allows no more');
reset role;

-- ---------- Days are UTC, and yesterday's claims don't count today ----------
delete from public.claude_usage where household_id = tests.id('alex');
insert into public.claude_usage (household_id, day, calls) values (tests.id('alex'), tests.today() - 1, 3);
set local timezone = 'Pacific/Kiritimati'; -- UTC+14: the local date is a day ahead of UTC's for part of every day
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select is(public.claim_claude_call(), true, 'a household that used its 3 yesterday may claim today');
reset role;
reset timezone;
select results_eq(format($$ select day, calls from public.claude_usage where household_id = %L order by day $$, tests.id('alex')),
          format($$ values (%L::date, 3), (%L::date, 1) $$, tests.today() - 1, tests.today()),
          'yesterday keeps its 3, and today''s claim is counted on today''s UTC date, whatever the session''s time zone');

-- ---------- Callers with no household ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b3');
select is(public.claim_claude_call(), false, 'a user with no household gets false');
reset role;
select is((select count(*) from public.household_members where user_id = '00000000-0000-4000-8000-0000000000b3'), 0::bigint,
          'and claiming gives them no household');
select tests.sign_in_claims('{"role":"authenticated","email":"alex@example.com"}');
select is(public.claim_claude_call(), false, 'a token with no sub gets false');
reset role;
delete from public.claude_settings;
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select is(public.claim_claude_call(), false, 'with the settings row gone, a household with no number of its own gets false');
reset role;
insert into public.claude_settings (daily_calls) values (3);

-- ---------- Signed out ----------
select tests.sign_out();
select throws_ok('select public.claim_claude_call()', '42501', null, 'anon cannot call claim_claude_call');
reset role;

-- ---------- No API role reads or resets a count, or changes an allowance ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select throws_ok('select * from public.claude_settings', '42501', null, 'authenticated cannot read claude_settings');
select throws_ok('insert into public.claude_settings (id, daily_calls) values (true, 1000)', '42501', null, 'authenticated cannot insert into claude_settings');
select throws_ok('update public.claude_settings set daily_calls = 1000', '42501', null, 'authenticated cannot raise the default allowance');
select throws_ok('delete from public.claude_settings', '42501', null, 'authenticated cannot delete claude_settings');
select throws_ok('select * from public.claude_usage', '42501', null, 'authenticated cannot read claude_usage');
select throws_ok(format($$ insert into public.claude_usage (household_id, day, calls) values (%L, current_date + 1, 0) $$, tests.id('alex')),
          '42501', null, 'authenticated cannot insert into claude_usage');
select throws_ok('update public.claude_usage set calls = 0', '42501', null, 'authenticated cannot reset a count');
select throws_ok('delete from public.claude_usage', '42501', null, 'authenticated cannot delete a count');
select throws_ok('select daily_calls from public.households', '42501', null, 'authenticated cannot read households');
select throws_ok($$ insert into public.households (daily_calls) values (1000) $$, '42501', null, 'authenticated cannot insert into households');
select throws_ok('update public.households set daily_calls = 1000', '42501', null, 'authenticated cannot raise its own allowance');
select throws_ok('delete from public.households', '42501', null, 'authenticated cannot delete households');
reset role;
select results_eq(format($$ select calls from public.claude_usage where household_id = %L and day = %L $$, tests.id('alex'), tests.today()),
          'values (1)', 'A''s count is untouched by all of that');

select * from finish();
rollback;
