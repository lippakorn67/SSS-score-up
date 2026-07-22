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
  is_admin boolean not null default false,
  banned boolean not null default false,
  avatar_url text,
  joined_at timestamptz not null default now()
);

-- for projects created before the admin/moderation update
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.profiles add column if not exists avatar_url text;

-- accounts made with an email address have no school number
alter table public.profiles alter column school_number drop not null;

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by everyone" on public.profiles;
create policy "profiles are readable by everyone"
  on public.profiles for select using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update using (auth.uid() = id);

-- students may only edit their name, grade and profile picture —
-- never their own is_admin or banned flags
revoke update on public.profiles from anon, authenticated;
grant update (name, grade, avatar_url) on public.profiles to authenticated;

-- helpers used by the policies below
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_banned()
returns boolean
language sql
security definer set search_path = public
as $$
  select coalesce((select banned from public.profiles where id = auth.uid()), false);
$$;

-- ---------- private contact details --------------------------
-- Email and phone are PRIVATE: only you, an admin, or someone in
-- an accepted swap with you can read them.

create table if not exists public.contacts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  email text,
  phone text
);

alter table public.contacts enable row level security;
-- (the read rule for this table is created further down, after the
-- requests table it depends on)

-- fill in contacts for accounts created before this update
insert into public.contacts (user_id, email)
select u.id, u.email from auth.users u
join public.profiles p on p.id = u.id
on conflict (user_id) do nothing;

-- Create the profile + contact rows automatically on sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, school_number, name, grade)
  values (
    new.id,
    nullif(new.raw_user_meta_data->>'school_number', ''),
    coalesce(new.raw_user_meta_data->>'name', 'Student'),
    coalesce(new.raw_user_meta_data->>'grade', '')
  );
  insert into public.contacts (user_id, email, phone)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data->>'phone', '')
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
  on public.items for insert with check (
    auth.uid() = owner_id
    and not public.is_banned()
    -- anti-spam cooldown: at most 6 posts/day and 20 posts/week
    and (select count(*) from public.items i
         where i.owner_id = auth.uid() and i.created_at > now() - interval '24 hours') < 6
    and (select count(*) from public.items i
         where i.owner_id = auth.uid() and i.created_at > now() - interval '7 days') < 20
  );

drop policy if exists "owners can update their items" on public.items;
create policy "owners can update their items"
  on public.items for update using (auth.uid() = owner_id);

drop policy if exists "owners can delete their items" on public.items;
create policy "owners can delete their items"
  on public.items for delete using (auth.uid() = owner_id or public.is_admin());

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
    or public.is_admin()
  );

drop policy if exists "logged-in students can send requests" on public.requests;
create policy "logged-in students can send requests"
  on public.requests for insert with check (
    auth.uid() = from_user_id
    and auth.uid() not in (select owner_id from public.items where id = item_id)
    and not public.is_banned()
  );

-- who may read someone's email/phone: themselves, an admin, or
-- their partner in an accepted swap
drop policy if exists "own contact, swap partner, or admin" on public.contacts;
create policy "own contact, swap partner, or admin"
  on public.contacts for select using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1
      from public.requests r
      join public.items i on i.id = r.item_id
      where r.status = 'accepted'
        and ((r.from_user_id = auth.uid() and i.owner_id = contacts.user_id)
          or (i.owner_id = auth.uid() and r.from_user_id = contacts.user_id))
    )
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

-- ---------- wishlist ----------------------------------------
-- "Looking for" posts: students say what they need, so swaps can
-- start from both sides.

create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null,
  status text not null default 'open' check (status in ('open', 'found')),
  created_at timestamptz not null default now()
);

alter table public.wishes enable row level security;

drop policy if exists "wishes are readable by everyone" on public.wishes;
create policy "wishes are readable by everyone"
  on public.wishes for select using (true);

drop policy if exists "logged-in students can post wishes" on public.wishes;
create policy "logged-in students can post wishes"
  on public.wishes for insert with check (user_id = auth.uid() and not public.is_banned());

drop policy if exists "owners can update their wishes" on public.wishes;
create policy "owners can update their wishes"
  on public.wishes for update using (user_id = auth.uid());

drop policy if exists "owners can delete wishes, admins any" on public.wishes;
create policy "owners can delete wishes, admins any"
  on public.wishes for delete using (user_id = auth.uid() or public.is_admin());

-- ---------- swap ratings ------------------------------------
-- After an accepted swap, each side confirms it happened and rates
-- the other (3 = 👍 great, 2 = 😐 okay, 1 = 👎 problem).

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  rater_id uuid not null references public.profiles(id) on delete cascade,
  rated_id uuid not null references public.profiles(id) on delete cascade,
  score int not null check (score between 1 and 3),
  created_at timestamptz not null default now(),
  unique (request_id, rater_id)
);

alter table public.ratings enable row level security;

drop policy if exists "ratings are readable by everyone" on public.ratings;
create policy "ratings are readable by everyone"
  on public.ratings for select using (true);

drop policy if exists "swap partners can rate each other" on public.ratings;
create policy "swap partners can rate each other"
  on public.ratings for insert with check (
    rater_id = auth.uid()
    and exists (
      select 1
      from public.requests r
      join public.items i on i.id = r.item_id
      where r.id = request_id
        and r.status = 'accepted'
        and ((r.from_user_id = auth.uid() and i.owner_id = rated_id)
          or (i.owner_id = auth.uid() and r.from_user_id = rated_id))
    )
  );

-- ---------- scene decorations -------------------------------
-- Pictures the admin places on the website's background from the
-- live scene editor (like Canva). Everyone sees them; only admins
-- can add, move, resize or remove them.

create table if not exists public.decorations (
  id uuid primary key default gen_random_uuid(),
  page text not null,
  src text not null,
  x numeric not null default 50 check (x >= 0 and x <= 100),
  y numeric not null default 300 check (y >= 0),
  w numeric not null default 140 check (w >= 20 and w <= 800),
  created_at timestamptz not null default now()
);

alter table public.decorations enable row level security;

drop policy if exists "decorations are visible to everyone" on public.decorations;
create policy "decorations are visible to everyone"
  on public.decorations for select using (true);

drop policy if exists "admins manage decorations" on public.decorations;
create policy "admins manage decorations"
  on public.decorations for all
  using (public.is_admin()) with check (public.is_admin());

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

-- ---------- chat messages -----------------------------------
-- Each swap request has its own private chat thread between the
-- requester and the item owner, used to plan the exchange.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists messages_thread on public.messages (request_id, created_at);

alter table public.messages enable row level security;

-- helper: is the current user one of the two students on this request?
create or replace function public.is_request_participant(req uuid)
returns boolean
language sql
security definer set search_path = public
as $$
  select exists (
    select 1 from public.requests r
    join public.items i on i.id = r.item_id
    where r.id = req and (r.from_user_id = auth.uid() or i.owner_id = auth.uid())
  );
$$;

drop policy if exists "participants can read their chat" on public.messages;
create policy "participants can read their chat"
  on public.messages for select using (
    public.is_request_participant(request_id) or public.is_admin()
  );

drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages"
  on public.messages for insert with check (
    sender_id = auth.uid()
    and public.is_request_participant(request_id)
    and not public.is_banned()
  );

drop policy if exists "admins can delete messages" on public.messages;
create policy "admins can delete messages"
  on public.messages for delete using (public.is_admin());

-- recipients may only mark messages as read, never edit the text
revoke update on public.messages from anon, authenticated;
grant update (read_at) on public.messages to authenticated;

drop policy if exists "recipients can mark messages read" on public.messages;
create policy "recipients can mark messages read"
  on public.messages for update using (
    sender_id <> auth.uid() and public.is_request_participant(request_id)
  );

-- ---------- moderation: blocked words -----------------------
-- Posts, requests and chat messages containing these words are
-- rejected by the database itself. Admins manage the list from
-- the admin panel.

create table if not exists public.blocked_words (
  word text primary key
);

alter table public.blocked_words enable row level security;

drop policy if exists "admins manage blocked words" on public.blocked_words;
create policy "admins manage blocked words"
  on public.blocked_words for all
  using (public.is_admin()) with check (public.is_admin());

-- starter list (English + Thai); admins can add or remove words
insert into public.blocked_words (word) values
  ('fuck'), ('shit'), ('bitch'), ('asshole'), ('bastard'), ('cunt'),
  ('dick'), ('porn'), ('nazi'), ('murder'), ('stab'), ('shoot'),
  ('gun'), ('rifle'), ('pistol'), ('bomb'), ('grenade'), ('weapon'),
  ('suicide'), ('cocaine'), ('heroin'), ('meth'),
  ('เหี้ย'), ('สัส'), ('ควย'), ('เย็ด'), ('ฆ่า'), ('ปืน'),
  ('ระเบิด'), ('ยาบ้า'), ('โคเคน'), ('ฆ่าตัวตาย')
on conflict (word) do nothing;

-- English words match whole words only (so "class" is fine even
-- though it contains "ass"); Thai has no spaces, so Thai words
-- match anywhere in the text.
create or replace function public.reject_blocked_words()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  txt text;
  bad text;
begin
  if tg_table_name = 'items' then
    txt := new.title || ' ' || coalesce(new.description, '');
  elsif tg_table_name = 'messages' then
    txt := new.body;
  elsif tg_table_name = 'wishes' then
    txt := new.title;
  else
    txt := coalesce(new.message, '');
  end if;

  select w.word into bad
  from public.blocked_words w
  where (w.word ~ '^[a-zA-Z0-9 ]+$' and txt ~* ('\m' || w.word || '\M'))
     or (w.word !~ '^[a-zA-Z0-9 ]+$' and txt ilike '%' || w.word || '%')
  limit 1;

  if bad is not null then
    raise exception 'BLOCKED_CONTENT';
  end if;
  return new;
end;
$$;

drop trigger if exists items_content_check on public.items;
create trigger items_content_check
  before insert or update on public.items
  for each row execute function public.reject_blocked_words();

drop trigger if exists requests_content_check on public.requests;
create trigger requests_content_check
  before insert on public.requests
  for each row execute function public.reject_blocked_words();

drop trigger if exists messages_content_check on public.messages;
create trigger messages_content_check
  before insert on public.messages
  for each row execute function public.reject_blocked_words();

drop trigger if exists wishes_content_check on public.wishes;
create trigger wishes_content_check
  before insert or update on public.wishes
  for each row execute function public.reject_blocked_words();

-- ---------- moderation: reports -----------------------------
-- Students flag bad posts; admins review them in the admin panel.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  unique (item_id, reporter_id)
);

alter table public.reports enable row level security;

drop policy if exists "students can report items" on public.reports;
create policy "students can report items"
  on public.reports for insert with check (
    reporter_id = auth.uid() and not public.is_banned()
  );

drop policy if exists "admins can see reports" on public.reports;
create policy "admins can see reports"
  on public.reports for select using (public.is_admin());

drop policy if exists "admins can dismiss reports" on public.reports;
create policy "admins can dismiss reports"
  on public.reports for delete using (public.is_admin());

-- ---------- moderation: banning -----------------------------
-- Banned students can still log in and browse, but cannot post
-- items, send requests, chat, or report.

create or replace function public.set_banned(target uuid, value boolean)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot ban yourself.';
  end if;
  update public.profiles set banned = value where id = target;
end;
$$;

-- ---------- sticker wall ------------------------------------
-- A shared board on the landing page. Every student gets 5 emoji
-- stickers to place; everyone sees everyone's stickers.

create table if not exists public.stickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  x numeric not null check (x >= 0 and x <= 100),
  y numeric not null check (y >= 0 and y <= 100),
  rot numeric not null default 0 check (rot >= -30 and rot <= 30),
  created_at timestamptz not null default now()
);

alter table public.stickers enable row level security;

drop policy if exists "stickers are visible to everyone" on public.stickers;
create policy "stickers are visible to everyone"
  on public.stickers for select using (true);

-- each student can have at most 5 stickers on the wall
drop policy if exists "students can place up to 5 stickers" on public.stickers;
create policy "students can place up to 5 stickers"
  on public.stickers for insert with check (
    user_id = auth.uid()
    and not public.is_banned()
    and (select count(*) from public.stickers s where s.user_id = auth.uid()) < 5
  );

drop policy if exists "students remove own stickers, admins any" on public.stickers;
create policy "students remove own stickers, admins any"
  on public.stickers for delete using (
    user_id = auth.uid() or public.is_admin()
  );

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

-- ---------- make yourself the admin -------------------------
-- After you create YOUR OWN account on the website, run this one
-- line with your real school number to become the administrator:
--
--   update public.profiles set is_admin = true where school_number = 'YOUR_NUMBER';
