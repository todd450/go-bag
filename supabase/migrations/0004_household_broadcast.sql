-- Live updates on each household's private channel (issue #74, part of #70). Decided on #70 (D3):
-- Realtime Broadcast on a private channel per household, guarded by row level security on
-- realtime.messages. Supabase does not apply RLS to postgres_changes delete events, so 0001's
-- docs channel told every signed-in browser about every household's deletes.
--
-- Each change to a doc sends {"col": "<col>", "id": "<id>"} to topic household:<household_id>,
-- event insert, update or delete, and never the document: the browser reads the doc itself
-- through docs's RLS (#78). A mistake in the channel policy could leak only ids such as profile.
--
-- DO NOT APPLY THIS TO PROJECT go-bag BEFORE #78 IS DEPLOYED. Today's web/runtime.js listens on
-- postgres_changes, which this migration turns off for docs, so live updates would stop until then.

-- ---------- Send each change on its household's topic ----------
-- Security definer, so the insert into realtime.messages runs as the owner: no browser role may
-- insert there (see the policy below). A row that moves to another household or is renamed (only
-- the founder's SQL can do that) is a delete for the old one and an insert for the new one.
create function public.broadcast_doc_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (old.household_id, old.col, old.id) is distinct from (new.household_id, new.col, new.id) then
    perform realtime.send(jsonb_build_object('col', old.col, 'id', old.id), 'delete', 'household:' || old.household_id::text, true);
    perform realtime.send(jsonb_build_object('col', new.col, 'id', new.id), 'insert', 'household:' || new.household_id::text, true);
  elsif tg_op = 'DELETE' then
    perform realtime.send(jsonb_build_object('col', old.col, 'id', old.id), 'delete', 'household:' || old.household_id::text, true);
  else
    perform realtime.send(jsonb_build_object('col', new.col, 'id', new.id), lower(tg_op), 'household:' || new.household_id::text, true);
  end if;
  return null;
end;
$$;
revoke all on function public.broadcast_doc_change() from public, anon, authenticated, service_role;

create trigger broadcast_doc_change
after insert or update or delete on public.docs
for each row execute function public.broadcast_doc_change();

-- ---------- Who may receive a household's topic ----------
-- Realtime asks this when a browser joins a private channel, with realtime.topic set to the
-- channel's topic. Select only: with no insert policy, no browser can broadcast into any topic.
create policy "own household receives" on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'household:' || (select public.my_household_id())::text
  );

-- ---------- No postgres_changes on docs ----------
alter publication supabase_realtime drop table public.docs;
