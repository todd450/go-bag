-- Households (issue #71): every account gets its own private household, family addresses on
-- allowed_emails join the family household, and no account reaches another household's docs.
-- Run on a local stack: `supabase start`, then `supabase test db`. Everything here is rolled back.
-- Made-up people only:
--   alex  00000000-0000-4000-8000-0000000000a1  alex@example.com    not on allowed_emails
--   sam   00000000-0000-4000-8000-0000000000a2  Sam@Example.com     on allowed_emails (as sam@example.com), confirmed
--   robin 00000000-0000-4000-8000-0000000000a3  robin@example.com   on allowed_emails, never confirmed
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Helpers, rolled back with everything else.
create schema tests;
grant usage on schema tests to anon, authenticated;

-- Act as a signed-in user the way PostgREST does: the authenticated role plus the JWT's claims.
-- Call it as postgres (after `reset role`).
create function tests.sign_in(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'email', (select email from auth.users where id = uid))::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function tests.sign_out() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
  select set_config('role', 'anon', true);
$$;
-- Rows a statement changed, run as whoever is calling.
create function tests.rows(statement text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;
-- Act as the authenticated role with a token's raw claims, which may name no real account.
create function tests.sign_in_claims(claims text) returns void language sql as $$
  select set_config('request.jwt.claims', claims, true);
  select set_config('role', 'authenticated', true);
$$;
-- Ids remembered across role switches.
create function tests.remember(name text, value uuid) returns void language sql as $$
  select set_config('tests.' || name, value::text, true);
$$;
create function tests.id(name text) returns uuid language sql stable as $$
  select nullif(current_setting('tests.' || name, true), '')::uuid
$$;

create temp table baseline as select count(*) as households from public.households;
grant select on baseline to authenticated;
select tests.remember('family', (select id from public.households where name = 'family'));

insert into auth.users (id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'alex@example.com', now()),
  ('00000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'Sam@Example.com', now()),
  ('00000000-0000-4000-8000-0000000000a3', 'authenticated', 'authenticated', 'robin@example.com', null);
insert into public.allowed_emails (email, household_id) values
  ('sam@example.com', tests.id('family')),
  ('robin@example.com', tests.id('family'));

-- ---------- The family household and the tables no API role may touch ----------
select isnt(tests.id('family'), null, 'the migration made a household named family');
select ok((select bool_and(relrowsecurity) from pg_class
           where oid in ('public.households'::regclass, 'public.household_members'::regclass, 'public.allowed_emails'::regclass)),
          'households, household_members and allowed_emails have row level security on');

-- ---------- A new account gets its own household on its first my_household() ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000a1');
select is(public.my_household_id(), null, 'a new account has no household before my_household()');
select is(public.is_member(), false, 'a new account is not a member before my_household()');
reset role;
select is((select count(*) from public.households), (select households from baseline),
          'my_household_id() and is_member() create nothing');

select tests.sign_in('00000000-0000-4000-8000-0000000000a1');
select tests.remember('alex', public.my_household());
select isnt(tests.id('alex'), null, 'the first my_household() returns a household');
select isnt(tests.id('alex'), tests.id('family'), 'an account not on allowed_emails does not join the family');
select is(public.my_household(), tests.id('alex'), 'a second my_household() returns the same household');
select is(public.my_household_id(), tests.id('alex'), 'my_household_id() then returns that household');
select is(public.is_member(), true, 'an account with a household is a member');
reset role;
select is((select count(*) from public.households), (select households from baseline) + 1,
          'two calls made exactly one household');

-- ---------- A confirmed address on allowed_emails joins that household, in any letter case ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000a2');
select tests.remember('sam', public.my_household());
select is(tests.id('sam'), tests.id('family'), 'Sam@Example.com, confirmed, joins the household sam@example.com is listed for');
reset role;
select is((select count(*) from public.households), (select households from baseline) + 1,
          'joining a household makes no new one');

-- ---------- The same rule with the address never confirmed ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000a3');
select is(public.is_member(), false, 'an unconfirmed account is not a member before my_household()');
select tests.remember('robin', public.my_household());
select isnt(tests.id('robin'), null, 'an unconfirmed listed account still gets a household');
select isnt(tests.id('robin'), tests.id('family'), 'an unconfirmed address on allowed_emails does not join that household');
reset role;
select is((select household_id from public.household_members where user_id = '00000000-0000-4000-8000-0000000000a3'),
          tests.id('robin'), 'its member row points at its own household');

-- ---------- Calls that name no real account create nothing ----------
select tests.sign_in_claims('{"role":"authenticated","email":"sam@example.com"}');
select is(public.my_household(), null, 'a token with no sub gets no household');
reset role;
select tests.sign_in_claims('{"sub":"00000000-0000-4000-8000-0000000000ff","role":"authenticated","email":"sam@example.com"}');
select is(public.my_household(), null, 'a token for an account that no longer exists gets no household');
reset role;
select is((select count(*) from public.households), (select households from baseline) + 2,
          'neither made a household (only alex''s and robin''s are new)');

-- ---------- Two households: alex (A) and the family, through sam (B) ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000a2');
select lives_ok($$ insert into public.docs (col, id, data) values
  ('household', 'profile', '{"owner":"sam"}'), ('kits', 'k1', '{"owner":"sam"}') $$,
  'B writes its profile and a kit without naming a household');
reset role;
select tests.sign_in('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.docs (col, id, data) values ('household', 'profile', '{"owner":"alex"}') $$,
  'A writes household/profile too');
select is((select count(*) from public.docs where household_id = tests.id('family')), 0::bigint, 'A reads 0 of B''s docs');
select is((select count(*) from public.docs where household_id <> tests.id('alex')), 0::bigint, 'A reads no other household''s docs');
select is((select data ->> 'owner' from public.docs where col = 'household' and id = 'profile'), 'alex',
          'A reads its own household/profile');
select is(tests.rows($$ update public.docs set data = '{"owner":"alex"}' where col = 'kits' $$), 0::bigint,
          'A''s update of B''s kit changes 0 rows');
select is(tests.rows($$ delete from public.docs where household_id = tests.id('family') $$), 0::bigint,
          'A''s delete of B''s docs removes 0 rows');
select throws_ok(format($$ insert into public.docs (household_id, col, id, data) values (%L, 'kits', 'k2', '{}') $$, tests.id('family')),
          '42501', null, 'A''s insert with B''s household_id is refused');
select throws_ok(format($$ update public.docs set household_id = %L where col = 'household' and id = 'profile' $$, tests.id('family')),
          '42501', null, 'A cannot move its own row into B''s household');
reset role;
select tests.sign_in('00000000-0000-4000-8000-0000000000a2');
select is((select data ->> 'owner' from public.docs where col = 'household' and id = 'profile'), 'sam',
          'B''s household/profile is still B''s');
select is((select count(*) from public.docs), 2::bigint, 'B still has both its docs and sees none of A''s');
reset role;
select is((select count(*) from public.docs where col = 'household' and id = 'profile'), 2::bigint,
          'A and B each hold a household/profile');

-- ---------- Today's runtime: an upsert that never sends household_id ----------
-- What supabase-js upsert({col, id, data, updated_at}) asks PostgREST for: on conflict on the primary key.
select tests.sign_in('00000000-0000-4000-8000-0000000000a2');
select lives_ok($$ insert into public.docs (col, id, data, updated_at) values ('household', 'shopping', '{"v":1}', now())
  on conflict (household_id, col, id) do update set col = excluded.col, id = excluded.id, data = excluded.data, updated_at = excluded.updated_at $$,
  'a family member''s upsert without household_id is accepted');
select lives_ok($$ insert into public.docs (col, id, data, updated_at) values ('household', 'shopping', '{"v":2}', now())
  on conflict (household_id, col, id) do update set col = excluded.col, id = excluded.id, data = excluded.data, updated_at = excluded.updated_at $$,
  'the same upsert again updates in place');
reset role;
select tests.sign_in('00000000-0000-4000-8000-0000000000a1');
select lives_ok($$ insert into public.docs (col, id, data, updated_at) values ('household', 'shopping', '{"v":"alex"}', now())
  on conflict (household_id, col, id) do update set col = excluded.col, id = excluded.id, data = excluded.data, updated_at = excluded.updated_at $$,
  'A''s upsert of the same doc lands in A''s household');
reset role;
select results_eq($$ select household_id, data from public.docs where col = 'household' and id = 'shopping' order by data ->> 'v' $$,
  format($$ values (%L::uuid, '{"v":2}'::jsonb), (%L::uuid, '{"v":"alex"}'::jsonb) $$, tests.id('family'), tests.id('alex')),
  'the family''s upsert landed once in the family household, and A''s did not touch it');

-- ---------- Signed out (anon) ----------
select tests.sign_out();
select is((select count(*) from public.docs), 0::bigint, 'anon reads no docs');
select throws_ok('select public.my_household()', '42501', null, 'anon cannot call my_household');
select throws_ok('select public.my_household_id()', '42501', null, 'anon cannot call my_household_id');
select throws_ok('select public.is_member()', '42501', null, 'anon cannot call is_member');
reset role;

-- ---------- No API role reads or writes the membership tables ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000a1');
select throws_ok('select * from public.households', '42501', null, 'authenticated cannot read households');
select throws_ok($$ insert into public.households (name) values ('mine') $$, '42501', null, 'authenticated cannot add a household');
select throws_ok('select * from public.household_members', '42501', null, 'authenticated cannot read household_members');
select throws_ok(format($$ update public.household_members set household_id = %L $$, tests.id('family')), '42501', null,
  'authenticated cannot move itself into another household');
select throws_ok(format($$ insert into public.household_members (user_id, household_id) values ('00000000-0000-4000-8000-0000000000a1', %L) $$, tests.id('family')),
  '42501', null, 'authenticated cannot add a member row');
select throws_ok('select * from public.allowed_emails', '42501', null, 'authenticated cannot read allowed_emails');
select throws_ok(format($$ insert into public.allowed_emails (email, household_id) values ('alex@example.com', %L) $$, tests.id('family')),
  '42501', null, 'authenticated cannot put itself on allowed_emails');
reset role;
select is((select household_id from public.household_members where user_id = '00000000-0000-4000-8000-0000000000a1'),
          tests.id('alex'), 'A is still only in its own household');

select * from finish();
rollback;
