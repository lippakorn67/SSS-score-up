-- ============================================================
-- Swap, Share, Sustain — database setup
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Safe to run more than once.
-- ============================================================

-- ---------- profiles ----------------------------------------
-- One row per student, created automatically on sign-up.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_number text not null unique,
  name text not null,
  grade text not null,
  joined_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles for select using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update using (auth.uid() = id);

-- Create the profile row automatically when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, school_number, name, grade)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'school_number', ''),
    coalesce(new.raw_user_meta_data->>'name', 'Student'),
    coalesce(new.raw_user_meta_data->>'grade', '')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- items -------------------------------------------

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null,
  condition text not null,
  description text not null default '',
  image_url text,
  status text not null default 'available' check (status in ('available', 'swapped')),
  created_at timestamptz not null default now()
);

alter table public.items enable row level security;

drop policy if exists "items are readable by everyone" on public.items;
create policy "items are readable by everyone"
  on public.items for select using (true);

drop policy if exists "logged-in students can post items" on public.items;
create policy "logged-in students can post items"
  on public.items for insert with check (auth.uid() = owner_id);

drop policy if exists "owners can update their items" on public.items;
create policy "owners can update their items"
  on public.items for update using (auth.uid() = owner_id);

drop policy if exists "owners can delete their items" on public.items;
create policy "owners can delete their items"
  on public.items for delete using (auth.uid() = owner_id);

-- ---------- swap requests -----------------------------------

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id) on delete cascade,
  offered_item_id uuid references public.items(id) on delete set null,
  message text not null default '',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.requests enable row level security;

-- one pending request per student per item
create unique index if not exists one_pending_request
  on public.requests (item_id, from_user_id) where (status = 'pending');

drop policy if exists "participants can see requests" on public.requests;
create policy "participants can see requests"
  on public.requests for select using (
    auth.uid() = from_user_id
    or auth.uid() in (select owner_id from public.items where id = item_id)
  );

drop policy if exists "logged-in students can send requests" on public.requests;
create policy "logged-in students can send requests"
  on public.requests for insert with check (
    auth.uid() = from_user_id
    and auth.uid() not in (select owner_id from public.items where id = item_id)
  );

-- ---------- swap actions ------------------------------------
-- Accepting a swap has to update several rows that belong to two
-- different students, so it runs as a database function.

create or replace function public.accept_request(req_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  req public.requests%rowtype;
begin
  select * into req from public.requests where id = req_id and status = 'pending';
  if not found then
    raise exception 'This request is no longer pending.';
  end if;
  if auth.uid() is null
     or auth.uid() not in (select owner_id from public.items where id = req.item_id) then
    raise exception 'Only the item owner can accept a request.';
  end if;

  update public.items set status = 'swapped' where id = req.item_id;
  update public.items set status = 'swapped' where id = req.offered_item_id;

  update public.requests set status = 'accepted', decided_at = now() where id = req_id;

  -- auto-decline other pending requests touching the swapped items
  update public.requests set status = 'declined', decided_at = now()
  where status = 'pending' and id <> req_id
    and (item_id in (req.item_id, req.offered_item_id)
      or offered_item_id in (req.item_id, req.offered_item_id));
end;
$$;

create or replace function public.decline_request(req_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  req public.requests%rowtype;
  item_owner uuid;
begin
  select * into req from public.requests where id = req_id and status = 'pending';
  if not found then
    raise exception 'This request is no longer pending.';
  end if;
  select owner_id into item_owner from public.items where id = req.item_id;
  if auth.uid() is null or (auth.uid() <> item_owner and auth.uid() <> req.from_user_id) then
    raise exception 'You are not part of this request.';
  end if;

  update public.requests
    set status = case when auth.uid() = req.from_user_id then 'cancelled' else 'declined' end,
        decided_at = now()
  where id = req_id;
end;
$$;

-- ---------- public stats ------------------------------------
-- Lets the landing page show totals without exposing request rows.

create or replace function public.site_stats()
returns json
language sql
security definer set search_path = public
as $$
  select json_build_object(
    'members', (select count(*) from public.profiles),
    'listed',  (select count(*) from public.items),
    'swaps',   (select count(*) from public.requests where status = 'accepted')
  );
$$;

-- ---------- photo storage -----------------------------------
-- If this last section fails on your project, create the bucket by
-- hand instead: Storage → New bucket → name "item-photos" → Public.

insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', true)
on conflict (id) do nothing;

drop policy if exists "anyone can view item photos" on storage.objects;
create policy "anyone can view item photos"
  on storage.objects for select using (bucket_id = 'item-photos');

drop policy if exists "logged-in students can upload item photos" on storage.objects;
create policy "logged-in students can upload item photos"
  on storage.objects for insert with check (
    bucket_id = 'item-photos' and auth.role() = 'authenticated'
  );
