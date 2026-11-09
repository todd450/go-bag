-- Photo folders (issue #72): an object in the `photos` bucket is <household_id>/<uuid>.<ext>, and a
-- signed-in account reads, adds and deletes only objects in its own household's folder.
-- Run on a local stack: `supabase start`, then `supabase test db`. Everything here is rolled back.
-- Made-up people only:
--   alex  00000000-0000-4000-8000-0000000000b1  alex@example.com   household A
--   jo    00000000-0000-4000-8000-0000000000b2  jo@example.com     household B
--   casey 00000000-0000-4000-8000-0000000000b3  casey@example.com  no household yet
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Helpers, rolled back with everything else (the same as 0002's test).
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
-- Ids remembered across role switches.
create function tests.remember(name text, value uuid) returns void language sql as $$
  select set_config('tests.' || name, value::text, true);
$$;
create function tests.id(name text) returns uuid language sql stable as $$
  select nullif(current_setting('tests.' || name, true), '')::uuid
$$;
-- Adds a photo the way Storage does: as the caller, with its own id as owner.
create function tests.add_photo(name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id) values ('photos', name, auth.uid()::text);
$$;
grant execute on all functions in schema tests to anon, authenticated;

-- The policies on storage.objects that mention the photos bucket, to compare before and after.
create function tests.photo_policies() returns table (policyname name, cmd text, qual text, with_check text)
language sql stable as $$
  select policyname, cmd, qual, with_check from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%photos%'
$$;
-- Runs a recorded migration the way psql without ON_ERROR_STOP would: each statement on its own,
-- carrying on past a failure. Returns the error of every statement that failed.
create function tests.apply(version text) returns text[] language plpgsql as $$
declare
  s text;
  errors text[] := '{}';
begin
  foreach s in array (select statements from supabase_migrations.schema_migrations m where m.version = apply.version) loop
    begin
      execute s;
    exception when others then
      errors := errors || sqlerrm;
    end;
  end loop;
  return errors;
end $$;

-- Storage deletes objects with this set; without it a trigger refuses every direct delete.
select set_config('storage.allow_delete_query', 'true', true);

insert into auth.users (id, aud, role, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', 'alex@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'jo@example.com', now()),
  ('00000000-0000-4000-8000-0000000000b3', 'authenticated', 'authenticated', 'casey@example.com', now());

select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select tests.remember('a', public.my_household());
reset role;
select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select tests.remember('b', public.my_household());
reset role;
select isnt(tests.id('a'), tests.id('b'), 'alex (A) and jo (B) are in different households');

-- ---------- The bucket ----------
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname in ('members read photos', 'members add photos', 'members delete photos')),
          0::bigint, 'the three members … photos policies are gone');
select is((select count(*) from tests.photo_policies() where cmd in ('UPDATE', 'ALL')), 0::bigint,
          'no policy lets anyone update a photo');
select is((select file_size_limit from storage.buckets where id = 'photos'), 5242880::bigint,
          'the photos bucket takes files up to 5 MB (5242880 bytes)');
select is((select public from storage.buckets where id = 'photos'), false, 'the photos bucket is still private');
select is((select allowed_mime_types from storage.buckets where id = 'photos'),
          array['image/jpeg', 'image/png', 'image/webp', 'image/gif'], 'the photos bucket takes the same image types');

-- ---------- Adding: only into your own household's folder ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select lives_ok(format('select tests.add_photo(%L)', tests.id('a') || '/x.jpg'), 'A adds <A''s household>/x.jpg');
select throws_ok(format('select tests.add_photo(%L)', tests.id('b') || '/x.jpg'), '42501', null, 'A cannot add <B''s household>/x.jpg');
select throws_ok($$ select tests.add_photo('x.jpg') $$, '42501', null, 'A cannot add x.jpg at the bucket root');
select throws_ok(format('select tests.add_photo(%L)', tests.id('a') || 'x/y.jpg'), '42501', null,
                 'A cannot add to a folder that only starts with its household id');
select throws_ok(format('select tests.add_photo(%L)', 'x/' || tests.id('a') || '/y.jpg'), '42501', null,
                 'A cannot add under its household id one folder down');
select throws_ok(format('select tests.add_photo(%L)', upper(tests.id('a')::text) || '/y.jpg'), '42501', null,
                 'A cannot add to its household id in capitals');
select is((select count(*) from storage.objects where bucket_id = 'photos'), 1::bigint, 'A sees its one photo');
reset role;

select tests.sign_in('00000000-0000-4000-8000-0000000000b2');
select lives_ok(format('select tests.add_photo(%L)', tests.id('b') || '/y.jpg'), 'B adds <B''s household>/y.jpg');

-- ---------- Reading, changing and deleting another household's photos ----------
select is((select count(*) from storage.objects where bucket_id = 'photos' and name like tests.id('a') || '/%'), 0::bigint,
          'B selects 0 of A''s objects');
select is((select array_agg(name) from storage.objects where bucket_id = 'photos'), array[tests.id('b') || '/y.jpg'],
          'B selects only its own photo');
select is(tests.rows(format($$ delete from storage.objects where bucket_id = 'photos' and name like %L $$, tests.id('a') || '/%')),
          0::bigint, 'B deletes 0 of A''s objects');
select is(tests.rows(format($$ update storage.objects set name = %L where bucket_id = 'photos' and name like %L $$,
                            tests.id('b') || '/x.jpg', tests.id('a') || '/%')),
          0::bigint, 'B moves 0 of A''s objects into its own folder');
reset role;

select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select is(tests.rows(format($$ update storage.objects set name = %L where bucket_id = 'photos' $$, tests.id('b') || '/x.jpg')),
          0::bigint, 'A cannot move its own photo into B''s folder (there is no update policy)');
reset role;
select is((select count(*) from storage.objects where bucket_id = 'photos' and name = tests.id('a') || '/x.jpg'), 1::bigint,
          'A''s photo is still there, where A put it');

-- ---------- An account with no household, and anon ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b3');
select is((select count(*) from storage.objects where bucket_id = 'photos'), 0::bigint, 'an account with no household selects none');
select throws_ok(format('select tests.add_photo(%L)', tests.id('a') || '/z.jpg'), '42501', null,
                 'an account with no household cannot add to A''s folder');
select throws_ok($$ select tests.add_photo('null/z.jpg') $$, '42501', null, 'an account with no household cannot add to a folder named null');
reset role;

select tests.sign_out();
select is((select count(*) from storage.objects where bucket_id = 'photos'), 0::bigint, 'anon selects none');
select throws_ok(format($$ insert into storage.objects (bucket_id, name) values ('photos', %L) $$, tests.id('a') || '/a.jpg'),
                 '42501', null, 'anon cannot add a photo');
select is(tests.rows($$ delete from storage.objects where bucket_id = 'photos' $$), 0::bigint, 'anon deletes none');
reset role;

-- ---------- A deletes its own ----------
select tests.sign_in('00000000-0000-4000-8000-0000000000b1');
select is(tests.rows(format($$ delete from storage.objects where bucket_id = 'photos' and name = %L $$, tests.id('a') || '/x.jpg')),
          1::bigint, 'A deletes its own photo');
reset role;

-- ---------- The guard: 0003 on a stack with a photo at the bucket root applies nothing ----------
-- Put the bucket back as 0001 left it, add a photo at its root, then run 0003's statements as the
-- CLI recorded them, each on its own as psql without ON_ERROR_STOP would.
select isnt((select statements from supabase_migrations.schema_migrations where version = '0003'), null,
            '0003 is recorded with its statements');
drop policy "own household reads photos" on storage.objects;
drop policy "own household adds photos" on storage.objects;
drop policy "own household deletes photos" on storage.objects;
create policy "members read photos" on storage.objects for select to authenticated using (bucket_id = 'photos' and (select public.is_member()));
create policy "members add photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and (select public.is_member()));
create policy "members delete photos" on storage.objects for delete to authenticated using (bucket_id = 'photos' and (select public.is_member()));
update storage.buckets set file_size_limit = 20971520 where id = 'photos';
create temp table before_0003 as select * from tests.photo_policies();
insert into storage.objects (bucket_id, name) values ('photos', 'stray.jpg');

create temp table run_0003 as select tests.apply('0003') as errors;
select ok((select errors[1] from run_0003) ~ 'no household folder', 'with a photo at the bucket root, 0003 stops at its guard');
select set_eq('select * from tests.photo_policies()', 'select * from before_0003',
              'and its policies are left as they were');
select is((select file_size_limit from storage.buckets where id = 'photos'), 20971520::bigint,
          'and the size limit is left as it was');

-- With the stray photo moved into a folder, the same statements apply cleanly.
update storage.objects set name = tests.id('a') || '/stray.jpg' where bucket_id = 'photos' and name = 'stray.jpg';
select is((select tests.apply('0003')), '{}'::text[], 'with every photo in a folder, 0003 applies with no error');

select * from finish();
rollback;
