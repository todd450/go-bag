-- Live updates on each household's private channel (issue #74): every change to a doc sends
-- {col, id} to Realtime Broadcast topic household:<household_id>, private, and only that
-- household's browsers may receive it. Nobody can subscribe to postgres_changes on docs.
-- Run on a local stack: `supabase start`, then `supabase test db`. Everything here is rolled back.
-- Made-up people only, each in a household of their own:
--   alex   00000000-0000-4000-8000-0000000000b1  alex@example.com    household A
--   blair  00000000-0000-4000-8000-0000000000b2  blair@example.com   household B
--   casey  00000000-0000-4000-8000-0000000000b3  casey@example.com   no household yet
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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
-- The topic Realtime sets when it asks whether a browser may join a channel.
create function tests.topic(topic text) returns void language sql as $$
  select set_config('realtime.topic', coalesce(topic, ''), true);
$$;
-- Rows a statement changed, run as whoever is calling.
create function tests.rows(statement text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute statement;
  get diagnostics n = row_count;
  return n;
end $$;
-- Ids remembered across role switches.
create function tests.remember(name text, value uuid) returns void language sql as $$
  select set_config('tests.' || name, value::text, true);
$$;
create function tests.id(name text) returns uuid language sql stable as $$
  select nullif(current_setting('tests.' || name, true), '')::uuid
$$;
create function tests.topic_of(name text) returns text language sql stable as $$
  select 'household:' || tests.id(name)::text
$$;
-- Broadcast messages on a topic, read as postgres (no row level security).
create function tests.sent(topic text) returns bigint language sql stable as $$
  select count(*) from realtime.messages where messages.topic = sent.topic and extension = 'broadcast'
$$;

insert into auth.users (id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'alex@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'blair@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated', 'casey@example.com', now());

select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select tests.remember('a', public.my_household());
reset role;
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select tests.remember('b', public.my_household());
reset role;
select isnt(tests.id('a'), tests.id('b'), 'alex (A) and blair (B) are in different households');

-- Only messages this test sends are counted.
create temp table before as select count(*) as n from realtime.messages;

-- ---------- A's insert, update and delete each send one message on A's topic ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select lives_ok($$ insert into public.docs (col, id, data) values ('household', 'profile', '{"note":"made-up secret"}') $$,
  'A inserts household/profile');
select lives_ok($$ update public.docs set data = '{"note":"made-up secret, edited"}' where col = 'household' and id = 'profile' $$,
  'A updates it');
select lives_ok($$ delete from public.docs where col = 'household' and id = 'profile' $$, 'A deletes it');
reset role;

select results_eq(
  format($$ select event, payload, private from realtime.messages where topic = %L order by inserted_at $$, tests.topic_of('a')),
  $$ values ('insert', '{"col":"household","id":"profile"}'::jsonb, true),
            ('update', '{"col":"household","id":"profile"}'::jsonb, true),
            ('delete', '{"col":"household","id":"profile"}'::jsonb, true) $$,
  'insert, update and delete each sent one private message to household:<A>, payload exactly {col, id}');
select is((select count(*) from realtime.messages where payload ? 'data'), 0::bigint, 'no message has a data key');
select is((select count(*) from realtime.messages where payload::text like '%secret%'), 0::bigint,
  'no message carries any of the document');
select is((select count(*) from realtime.messages) - (select n from before), 3::bigint,
  'A''s three changes sent nothing to any other topic');

-- ---------- Several rows in one statement, and today's runtime's upsert ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select lives_ok($$ insert into public.docs (col, id, data) values ('kits', 'k1', '{}'), ('items', 'i1', '{}') $$,
  'B inserts a kit and an item in one statement');
-- What supabase-js upsert({col, id, data, updated_at}) asks PostgREST for, twice.
select lives_ok($$ insert into public.docs (col, id, data, updated_at) values ('household', 'plan', '{"v":1}', now())
  on conflict (household_id, col, id) do update set data = excluded.data, updated_at = excluded.updated_at $$,
  'B upserts household/plan, a new doc');
select lives_ok($$ insert into public.docs (col, id, data, updated_at) values ('household', 'plan', '{"v":2}', now())
  on conflict (household_id, col, id) do update set data = excluded.data, updated_at = excluded.updated_at $$,
  'B upserts household/plan again');
reset role;
select results_eq(
  format($$ select event, payload from realtime.messages where topic = %L order by inserted_at $$, tests.topic_of('b')),
  $$ values ('insert', '{"col":"kits","id":"k1"}'::jsonb), ('insert', '{"col":"items","id":"i1"}'::jsonb),
            ('insert', '{"col":"household","id":"plan"}'::jsonb), ('update', '{"col":"household","id":"plan"}'::jsonb) $$,
  'one message per row, and an upsert sends insert the first time and update after');

-- ---------- A change RLS refuses sends nothing ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select is(tests.rows($$ update public.docs set data = '{}' where col = 'kits' $$), 0::bigint, 'A''s update of B''s kit changes 0 rows');
select is(tests.rows($$ delete from public.docs where col = 'items' $$), 0::bigint, 'A''s delete of B''s item removes 0 rows');
reset role;
select is(tests.sent(tests.topic_of('b')), 4::bigint, 'B''s topic got nothing from A''s refused writes');
select is(tests.sent(tests.topic_of('a')), 3::bigint, 'nor did A''s');

-- ---------- A doc moved by the founder's SQL: the old household hears delete, the new one insert ----------
select is(tests.rows(format($$ update public.docs set household_id = %L where col = 'kits' and id = 'k1' $$, tests.id('a'))), 1::bigint,
  'postgres moves B''s kit into A''s household');
select results_eq(
  format($$ select event, payload from realtime.messages where topic = %L order by inserted_at desc limit 1 $$, tests.topic_of('b')),
  $$ values ('delete', '{"col":"kits","id":"k1"}'::jsonb) $$, 'B hears the kit deleted');
select results_eq(
  format($$ select event, payload from realtime.messages where topic = %L order by inserted_at desc limit 1 $$, tests.topic_of('a')),
  $$ values ('insert', '{"col":"kits","id":"k1"}'::jsonb) $$, 'A hears it inserted');

-- ---------- Who may receive a household's topic ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select tests.topic(tests.topic_of('a'));
select is((select count(*) from realtime.messages), 0::bigint, 'B, on topic household:<A>, reads 0 messages');
select tests.topic(tests.topic_of('b'));
select is((select count(*) from realtime.messages where topic = tests.topic_of('b')), 5::bigint,
  'B, on topic household:<B>, reads its own');
select tests.topic(null);
select is((select count(*) from realtime.messages), 0::bigint, 'B, with no topic set, reads 0 messages');
reset role;

select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select tests.topic(tests.topic_of('a'));
select is((select count(*) from realtime.messages where topic = tests.topic_of('a')), 4::bigint,
  'A, on topic household:<A>, reads its own');
reset role;

select tests.sign_in('00000000-0000-4000-8000-0000000000b3');
select tests.topic('household:');
select is((select count(*) from realtime.messages), 0::bigint, 'an account with no household reads 0 messages on topic household:');
reset role;

select tests.sign_out();
select tests.topic(tests.topic_of('a'));
select is((select count(*) from realtime.messages), 0::bigint, 'anon, on topic household:<A>, reads 0 messages');
reset role;

-- ---------- No browser can broadcast into a household's topic ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select tests.topic(tests.topic_of('b'));
select throws_ok(
  format($$ insert into realtime.messages (topic, extension, event, payload, private) values (%L, 'broadcast', 'delete', '{"col":"household","id":"profile"}', true) $$, tests.topic_of('b')),
  '42501', null, 'authenticated cannot insert into realtime.messages, even on its own topic');
select realtime.send('{"col":"household","id":"profile"}', 'delete', tests.topic_of('a'), true);
select is(tests.rows($$ update realtime.messages set payload = '{"col":"household","id":"profile"}' $$), 0::bigint,
  'authenticated cannot change a message');
reset role;
select is(tests.sent(tests.topic_of('a')), 4::bigint, 'B''s realtime.send() into A''s topic wrote nothing');

select tests.sign_out();
select throws_ok(
  format($$ insert into realtime.messages (topic, extension, event, payload, private) values (%L, 'broadcast', 'delete', '{}', true) $$, tests.topic_of('a')),
  '42501', null, 'anon cannot insert into realtime.messages');
reset role;

-- ---------- postgres_changes on docs is gone ----------
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs'),
  0::bigint, 'public.docs is not in the supabase_realtime publication');

-- ---------- The trigger function ----------
select is((select prosecdef from pg_proc where oid = to_regprocedure('public.broadcast_doc_change()')), true,
  'broadcast_doc_change() is security definer');
select is((select proconfig from pg_proc where oid = to_regprocedure('public.broadcast_doc_change()')), array['search_path=""'],
  'broadcast_doc_change() sets an empty search_path');

select * from finish();
rollback;
