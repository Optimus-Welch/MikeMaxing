-- Autopilot cloud sync schema.
--
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New
-- query -> paste -> Run). It is idempotent, so re-running is safe.
--
-- Design: one row per (user, collection), holding the collection's JSON.
-- The app already treats each collection as a single opaque document that it
-- reads and writes whole, so mirroring that shape keeps the client simple and
-- makes the whole sync one upsert per collection. Splitting sessionHistory
-- into a row-per-session table would be a bigger change to db.js than this
-- task calls for, and would not buy anything until there is server-side
-- querying.

create table if not exists public.collections (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  collection  text        not null,
  -- The collection value. jsonb (not json) so Postgres validates and
  -- normalises it, and so it can be indexed later if that ever matters.
  data        jsonb       not null,
  -- Set by the client from its own clock; used for last-write-wins on
  -- whole-document collections. See sync.js for the merge rules.
  updated_at  timestamptz not null default now(),
  primary key (user_id, collection)
);

-- Restrict which collections can be written at all, so a bug (or a poked
-- console) cannot fill the table with arbitrary keys.
--
-- `exerciseLibrary` and `meta` are still permitted but are no longer synced by
-- the app — they describe a device rather than a person (see SYNCED_COLLECTIONS
-- in src/lib/syncEngine.js). The list stays a superset deliberately: tightening
-- it would mean re-running this file against a live project purely to forbid
-- something nothing writes any more, and any rows left behind are inert.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'collections_known_collection'
  ) then
    alter table public.collections
      add constraint collections_known_collection
      check (collection in (
        'profile',
        'equipment',
        'exerciseLibrary',
        'sessionHistory',
        'readinessLog',
        'settings',
        'meta'
      ));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Row-level security: a user can only ever see or touch their own rows.
--
-- RLS is the ONLY thing standing between the publishable anon key and everyone
-- else's data — the key ships in the client bundle of a public repo, so these
-- policies are the actual security boundary, not an extra layer on top of one.
-- ---------------------------------------------------------------------------

alter table public.collections enable row level security;
-- Belt and braces: without FORCE, a future table owner bypasses RLS.
alter table public.collections force row level security;

drop policy if exists "read own collections"   on public.collections;
drop policy if exists "insert own collections" on public.collections;
drop policy if exists "update own collections" on public.collections;
drop policy if exists "delete own collections" on public.collections;

create policy "read own collections"
  on public.collections for select
  to authenticated
  using (auth.uid() = user_id);

create policy "insert own collections"
  on public.collections for insert
  to authenticated
  -- with check applies to the NEW row: you may only create rows owned by you.
  with check (auth.uid() = user_id);

create policy "update own collections"
  on public.collections for update
  to authenticated
  using (auth.uid() = user_id)
  -- Both clauses matter: `using` picks which rows you may update, `with check`
  -- stops you from reassigning one to somebody else's user_id on the way out.
  with check (auth.uid() = user_id);

create policy "delete own collections"
  on public.collections for delete
  to authenticated
  using (auth.uid() = user_id);

-- No policy exists for the `anon` role, so a signed-out client can read
-- nothing. Absence of a policy is a denial under RLS.

-- Keep updated_at honest even if a client forgets to send one.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
-- Empty search_path: a SECURITY DEFINER-adjacent function should never resolve
-- names through a caller-controlled path.
set search_path = ''
as $$
begin
  new.updated_at = greatest(coalesce(new.updated_at, now()), now());
  return new;
end;
$$;

drop trigger if exists collections_touch_updated_at on public.collections;
create trigger collections_touch_updated_at
  before insert or update on public.collections
  for each row execute function public.touch_updated_at();
