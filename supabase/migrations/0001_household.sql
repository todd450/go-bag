-- go-bag on Vercel (issue #48): one household's documents, kit photos, and who may see them.
-- The page's runtime is a document store (collection/id -> JSON), so one table holds every doc.

-- Family emails allowed in. No API role can read or change this table: the founder edits it in
-- the Supabase dashboard (Table editor) or with SQL.
create table public.allowed_emails (
  email text primary key check (email = lower(email))
);
alter table public.allowed_emails enable row level security;

-- True when the signed-in user's email is on the allowlist. Security definer so it can read
-- allowed_emails, which has no policies of its own.
create function public.is_member() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- kits/<id>, items/<id> and household/<profile|hazards|review|shopping|plan>.
create table public.docs (
  col text not null check (col in ('kits', 'items', 'household')),
  id text not null check (length(id) between 1 and 100),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
alter table public.docs enable row level security;
create policy "members read" on public.docs for select to authenticated using ((select public.is_member()));
create policy "members insert" on public.docs for insert to authenticated with check ((select public.is_member()));
create policy "members update" on public.docs for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "members delete" on public.docs for delete to authenticated using ((select public.is_member()));

-- Live updates for the page's onSnapshot listeners. Full replica identity so a delete event
-- carries the row's collection.
alter table public.docs replica identity full;
alter publication supabase_realtime add table public.docs;

-- Kit photos, private. The page shows them through /_blob/<id>, which a Vercel function turns
-- into a short-lived signed URL after checking the session.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
create policy "members read photos" on storage.objects for select to authenticated using (bucket_id = 'photos' and (select public.is_member()));
create policy "members add photos" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and (select public.is_member()));
create policy "members delete photos" on storage.objects for delete to authenticated using (bucket_id = 'photos' and (select public.is_member()));
