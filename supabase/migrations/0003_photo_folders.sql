-- Each household's photos in its own folder (issue #72, part of #70): an object in the `photos`
-- bucket is named <household_id>/<uuid>.<ext>, and a signed-in account can read, add and delete only
-- the objects in its own household's folder. Decided on #70: one bucket, one folder per household,
-- mapped by web/runtime.js (#78) and api/blob.mjs.
--
-- APPLY ONLY ONCE #78 IS DEPLOYED. Before #78, web/runtime.js uploads to the bucket root, which
-- these policies refuse, so no new photo would save.
--
-- Before applying, check that no photo sits at the bucket root (0 expected):
--   select count(*) from storage.objects where bucket_id = 'photos' and name not like '%/%';
-- If any does, this migration stops at its guard and applies nothing: such a photo would be stranded
-- where no household's policy reaches it, so moving those photos is its own issue.
--
-- One DO block, so it is one statement: the guard, the policies and the size limit apply together
-- or not at all, however the file is run (supabase db push, the SQL editor, or psql without
-- ON_ERROR_STOP).
do $migration$
begin
  -- No upload or rename can slip a root object in between the guard and the new policies.
  lock table storage.objects in share row exclusive mode;

  if exists (select 1 from storage.objects where bucket_id = 'photos' and name not like '%/%') then
    raise exception 'photos bucket has objects with no household folder; 0003 applied nothing'
      using hint = 'select name from storage.objects where bucket_id = ''photos'' and name not like ''%/%''; move them into <household_id>/ first (#72).';
  end if;

  drop policy "members read photos" on storage.objects;
  drop policy "members add photos" on storage.objects;
  drop policy "members delete photos" on storage.objects;

  -- The first folder of the object's name is the caller's household. An account with no household
  -- (my_household_id() is null) matches nothing. There is still no update policy, so no object can
  -- be renamed or moved into another folder.
  create policy "own household reads photos" on storage.objects for select to authenticated
    using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select public.my_household_id())::text);
  create policy "own household adds photos" on storage.objects for insert to authenticated
    with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select public.my_household_id())::text);
  create policy "own household deletes photos" on storage.objects for delete to authenticated
    using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select public.my_household_id())::text);

  -- 5 MB. The page uploads 1600 px JPEGs at quality 0.85, well under it.
  update storage.buckets set file_size_limit = 5242880 where id = 'photos';
end
$migration$;
