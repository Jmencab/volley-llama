-- Volley Llama team app — Supabase schema.
-- First applied 2026-08-30 (migrations usta_tennis_team_schema, usta_captain_rpcs,
-- usta_lock_check_pass_and_rotate); practices added 2026-10-08; player login
-- added 2026-10. Kept here as the readable source of truth.
--
-- The whole file is safe to re-run: paste all of it into the Supabase SQL
-- editor to set up a new project or to bring an existing one up to date.
-- Before the first run on a project, turn on Authentication → Sign In /
-- Providers → "Allow anonymous sign-ins" (see section 3).

-- ============================ 1. tables ============================

create table if not exists public.usta_players (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,   -- the official USTA roster name
  preferred_name text,                   -- what the app displays, when set
  gender         text not null check (gender in ('M','F')),
  ntrp           numeric(2,1),
  usta_number    text,
  phone          text,                   -- E.164 (+12065550134); also the sign-in name
  email          text,                   -- optional contact info, not used to sign in
  venmo          text,                   -- stored without the leading @
  is_captain   boolean not null default false,
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.usta_players add column if not exists email text;

create table if not exists public.usta_matches (
  id                uuid primary key default gen_random_uuid(),
  match_no          int not null unique,
  usta_match_id     text,
  starts_at         timestamptz not null,
  is_home           boolean not null,
  opponent          text not null,
  opponent_captain  text,
  site              text not null,
  site_address      text,
  notes             text,
  lineup_published  boolean not null default false
);

create table if not exists public.usta_availability (
  match_id   uuid not null references public.usta_matches(id) on delete cascade,
  player_id  uuid not null references public.usta_players(id) on delete cascade,
  status     text not null check (status in ('available','maybe','out')),
  note       text,
  updated_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create table if not exists public.usta_lineups (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.usta_matches(id) on delete cascade,
  court      smallint not null check (court between 1 and 3),
  player1_id uuid references public.usta_players(id) on delete set null,  -- the man
  player2_id uuid references public.usta_players(id) on delete set null,  -- the woman
  won        boolean,   -- null = not played / not entered yet
  score      text,
  unique (match_id, court)
);

create index if not exists usta_lineups_match_idx on public.usta_lineups(match_id);
create index if not exists usta_avail_match_idx on public.usta_availability(match_id);

-- ============================ 2. phone numbers ============================
-- A phone number is how a player signs in, and how the app will open a
-- WhatsApp or text to them, so every number is stored one way: E.164.

create or replace function public.usta_norm_phone(p text)
returns text language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if btrim(coalesce(p, '')) = '' then return null; end if;
  if btrim(p) like '+%' then
    if length(d) between 8 and 15 then return '+' || d; end if;
  elsif length(d) = 10 then return '+1' || d;
  elsif length(d) = 11 and d like '1%' then return '+' || d;
  end if;
  raise exception 'That doesn''t look like a phone number. Use 10 digits, like 206-555-0134.';
end $$;

-- Numbers typed before October 2026 were stored as typed. Convert the ones
-- that are clearly US numbers; anything else is left for a captain to fix.
update public.usta_players
   set phone = public.usta_norm_phone(phone)
 where phone is not null and phone !~ '^\+'
   and (length(regexp_replace(phone, '\D', '', 'g')) = 10
        or regexp_replace(phone, '\D', '', 'g') ~ '^1\d{10}$');
update public.usta_players set phone = null where btrim(phone) = '';

do $$
begin
  if exists (select 1 from public.usta_players where phone is not null group by phone having count(*) > 1) then
    raise exception 'Two players share a phone number, so it can''t be used to sign in. Fix that, then run this again.';
  end if;
end $$;
create unique index if not exists usta_players_phone_key on public.usta_players(phone) where phone is not null;

-- ============================ 3. who is signed in ============================
-- No passwords to remember beyond an 8-digit PIN. Each phone gets a Supabase
-- anonymous session (that's what "Allow anonymous sign-ins" is for), and a row
-- here ties that session to a player. A session gets tied by entering the
-- player's phone number and PIN, by opening an invite link a captain sent, or,
-- while a team allows it, by setting up a PIN from the roster phone number
-- (usta_sign_up, section 9).
--
-- Anyone can get an anonymous session with the public key, so being signed in
-- to Supabase proves nothing. Every rule below asks usta_me() instead.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.usta_player_devices (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  player_id    uuid not null references public.usta_players(id) on delete cascade,
  how          text not null check (how in ('invite','pin')),
  linked_at    timestamptz not null default now()
);
create index if not exists usta_devices_player_idx on public.usta_player_devices(player_id);

-- PINs are bcrypt hashes. Ten wrong tries lock the PIN until a captain sends
-- a new invite link or unlocks it.
create table if not exists public.usta_player_secrets (
  player_id   uuid primary key references public.usta_players(id) on delete cascade,
  pin_hash    text,
  failed_pins int not null default 0,
  locked_at   timestamptz
);

-- Only a hash of each invite token is kept, so this table can't be turned back
-- into working links. One live link per player; it works once, for 7 days.
create table if not exists public.usta_invites (
  token_hash text primary key,
  player_id  uuid not null references public.usta_players(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

-- None of these three tables is reachable from the browser: RLS on, no
-- policies, no grants. Only the functions below touch them.
alter table public.usta_player_devices enable row level security;
alter table public.usta_player_secrets enable row level security;
alter table public.usta_invites        enable row level security;
revoke all on public.usta_player_devices, public.usta_player_secrets, public.usta_invites
  from public, anon, authenticated;

-- The player this phone is signed in as, or null.
create or replace function public.usta_me()
returns uuid language sql stable security definer set search_path = public as $$
  select d.player_id
    from public.usta_player_devices d
    join public.usta_players p on p.id = d.player_id and p.active
   where d.auth_user_id = auth.uid();
$$;

-- Captain powers come from is_captain on the roster.
create or replace function public.usta_is_captain()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_captain from public.usta_players where id = public.usta_me()), false);
$$;

-- ============================ 4. access ============================
-- Team members (usta_me() set) read everything. Players set their own
-- availability, sign-ups, and lights reports; captains can set anyone's, for
-- the "put me down as out" texts. Everything else is written only through the
-- functions in sections 5 and 8.
-- (select ...) makes Postgres evaluate the check once per query, not per row.

alter table public.usta_players      enable row level security;
alter table public.usta_matches      enable row level security;
alter table public.usta_availability enable row level security;
alter table public.usta_lineups      enable row level security;

revoke all on public.usta_players, public.usta_matches, public.usta_availability,
              public.usta_lineups from anon, authenticated;

grant select on public.usta_players, public.usta_matches, public.usta_lineups to authenticated;
grant select, insert, update on public.usta_availability to authenticated;

drop policy if exists usta_players_read on public.usta_players;
drop policy if exists usta_matches_read on public.usta_matches;
drop policy if exists usta_lineups_read on public.usta_lineups;
drop policy if exists usta_avail_read   on public.usta_availability;
drop policy if exists usta_avail_write  on public.usta_availability;
drop policy if exists usta_avail_update on public.usta_availability;

create policy usta_players_read on public.usta_players for select to authenticated
  using ((select public.usta_me()) is not null);
create policy usta_matches_read on public.usta_matches for select to authenticated
  using ((select public.usta_me()) is not null);
create policy usta_lineups_read on public.usta_lineups for select to authenticated
  using ((select public.usta_me()) is not null);
create policy usta_avail_read   on public.usta_availability for select to authenticated
  using ((select public.usta_me()) is not null);
create policy usta_avail_write  on public.usta_availability for insert to authenticated
  with check (player_id = (select public.usta_me()) or (select public.usta_is_captain()));
create policy usta_avail_update on public.usta_availability for update to authenticated
  using (player_id = (select public.usta_me()) or (select public.usta_is_captain()))
  with check (player_id = (select public.usta_me()) or (select public.usta_is_captain()));

-- ============================ 5. captain and profile functions ============================

-- Retired with the captain password (October 2026). Dropped by exact signature
-- so a re-run of this file cleans up a database set up before then.
drop function if exists public.usta_verify_captain(text);
drop function if exists public.usta_save_lineup(text, uuid, jsonb);
drop function if exists public.usta_save_results(text, uuid, jsonb);
drop function if exists public.usta_publish_lineup(text, uuid, boolean);
drop function if exists public.usta_update_match(text, uuid, timestamptz, text, text);
drop function if exists public.usta_upsert_player(text, uuid, text, text, numeric, text, boolean, text);
drop function if exists public.usta_update_profile(uuid, text, text, text, text, text);
drop function if exists public.usta_set_captain_pass(text, text);
drop function if exists public.usta_captain_ratings(text);
drop function if exists public.usta_check_pass(text);
drop table if exists public.usta_config;

-- p_courts: [{"court":1,"player1_id":"uuid","player2_id":"uuid"}, ...]
-- Upserts, so a result already entered on a court survives a lineup edit.
create or replace function public.usta_save_lineup(p_match_id uuid, p_courts jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;

  insert into public.usta_lineups (match_id, court, player1_id, player2_id)
  select p_match_id, (c->>'court')::smallint,
         nullif(c->>'player1_id','')::uuid, nullif(c->>'player2_id','')::uuid
  from jsonb_array_elements(coalesce(p_courts, '[]'::jsonb)) c
  on conflict (match_id, court) do update
    set player1_id = excluded.player1_id, player2_id = excluded.player2_id;

  delete from public.usta_lineups l
  where l.match_id = p_match_id
    and l.court not in (select (c->>'court')::smallint
                        from jsonb_array_elements(coalesce(p_courts, '[]'::jsonb)) c);
end $$;

-- p_results: [{"court":1,"won":true,"score":"6-3, 6-4"}, ...]
create or replace function public.usta_save_results(p_match_id uuid, p_results jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  update public.usta_lineups l
     set won   = case when r->>'won' is null or r->>'won' = '' then null else (r->>'won')::boolean end,
         score = nullif(r->>'score','')
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
   where l.match_id = p_match_id and l.court = (r->>'court')::smallint;
end $$;

create or replace function public.usta_publish_lineup(p_match_id uuid, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  update public.usta_matches set lineup_published = coalesce(p_published, false) where id = p_match_id;
end $$;

create or replace function public.usta_update_match(
  p_match_id uuid, p_starts_at timestamptz, p_site text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  update public.usta_matches
     set starts_at = coalesce(p_starts_at, starts_at),
         site      = coalesce(nullif(p_site,''), site),
         notes     = p_notes
   where id = p_match_id;
end $$;

-- Captains add players from the app. Every player needs a phone number, since
-- that's how they sign in. Every real player has a USTA number too; blank
-- means "not known yet". Repeats are caught with a human message.
create or replace function public.usta_upsert_player(
  p_id uuid, p_name text, p_gender text, p_ntrp numeric, p_phone text, p_active boolean,
  p_usta_number text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_name  text := btrim(coalesce(p_name, ''));
  v_usta  text := nullif(btrim(coalesce(p_usta_number, '')), '');
  v_phone text := public.usta_norm_phone(p_phone);
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  if v_phone is not null and exists (select 1 from public.usta_players
                                     where phone = v_phone and id is distinct from p_id) then
    raise exception 'Someone on the roster already has that phone number.';
  end if;

  if p_id is null then
    if v_name = '' then raise exception 'Give them a name.'; end if;
    if v_phone is null then raise exception 'Add their phone number. It''s how they sign in.'; end if;
    if exists (select 1 from public.usta_players where lower(name) = lower(v_name)) then
      raise exception 'Someone with that name is already on the roster.';
    end if;
    insert into public.usta_players (name, gender, ntrp, phone, usta_number, active, sort_order)
    values (v_name, p_gender, p_ntrp, v_phone, v_usta, coalesce(p_active, true),
            coalesce((select max(sort_order) + 1 from public.usta_players), 0))
    returning id into v_id;
  else
    update public.usta_players
       set name        = coalesce(nullif(v_name, ''), name),
           gender      = coalesce(nullif(p_gender, ''), gender),
           ntrp        = coalesce(p_ntrp, ntrp),
           phone       = coalesce(v_phone, phone),
           usta_number = coalesce(v_usta, usta_number),
           active      = coalesce(p_active, active)
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- Players edit their own details; captains can edit anyone's. Now that a
-- player is really signed in as themselves, phone and Venmo no longer need a
-- captain. Phone is required, email optional.
create or replace function public.usta_update_profile(
  p_id uuid, p_preferred_name text, p_phone text, p_gender text, p_venmo text, p_email text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.usta_norm_phone(p_phone);
  -- stored bare, without the @ people habitually type
  v_venmo text := nullif(btrim(ltrim(btrim(coalesce(p_venmo, '')), '@')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if p_id is distinct from public.usta_me() and not public.usta_is_captain() then
    raise exception 'You can only change your own details';
  end if;
  if p_gender is not null and p_gender not in ('M', 'F') then
    raise exception 'gender must be M or F';
  end if;
  if v_phone is null then raise exception 'Add a phone number. It''s how you sign in.'; end if;
  if exists (select 1 from public.usta_players where phone = v_phone and id <> p_id) then
    raise exception 'Someone on the roster already has that phone number.';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address doesn''t look right.';
  end if;

  update public.usta_players
     set preferred_name = nullif(btrim(coalesce(p_preferred_name, '')), ''),
         phone          = v_phone,
         gender         = coalesce(p_gender, gender),
         venmo          = v_venmo,
         email          = v_email
   where id = p_id and active;
  if not found then raise exception 'player not found'; end if;
end $$;

-- UTR ratings (usta_player_ratings, migration usta_player_ratings_captain_only)
-- are captain-only: the table has no browser access at all. plpgsql, so this
-- file still runs on a project that doesn't have that table yet.
create or replace function public.usta_captain_ratings()
returns setof jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  return query select to_jsonb(r) from public.usta_player_ratings r;
end $$;

-- ============================ 6. realtime ============================
-- Realtime applies the read rules above, so only signed-in teammates get
-- updates. "add table" fails if the table is already published, so only add
-- what's missing.
do $$
declare t text;
begin
  foreach t in array array['usta_availability', 'usta_lineups', 'usta_matches', 'usta_players'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================ 7. reset helpers ============================
-- Wipe a season back to a clean slate (roster and schedule stay):
--   delete from public.usta_lineups;
--   delete from public.usta_availability;
--   update public.usta_matches set lineup_published = false;

-- ============================ 8. practices ============================
-- Added 2026-10-08 (migration usta_practices_and_court_reports).

create table if not exists public.usta_practices (
  id         uuid primary key default gen_random_uuid(),
  starts_at  timestamptz not null,
  minutes    int not null default 90 check (minutes between 30 and 360),
  site       text not null,
  courts     smallint check (courts between 1 and 20),  -- courts booked; the app aims for 4 players per court
  notes      text,
  cancelled  boolean not null default false,
  created_by uuid references public.usta_players(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.usta_practices add column if not exists created_by uuid references public.usta_players(id) on delete set null;

-- One row per player per practice. No cap: everyone who says "in" is in.
create table if not exists public.usta_practice_signups (
  practice_id uuid not null references public.usta_practices(id) on delete cascade,
  player_id   uuid not null references public.usta_players(id) on delete cascade,
  status      text not null check (status in ('in','out')),
  updated_at  timestamptz not null default now(),
  primary key (practice_id, player_id)
);

-- "Were the lights working?" — the city lists which courts have lights, but not
-- which ones are broken this week. Teammates report after they play.
create table if not exists public.usta_court_reports (
  id          uuid primary key default gen_random_uuid(),
  court       text not null,   -- NAME from the city's Tennis_Courts GIS layer
  lights_ok   boolean not null,
  player_id   uuid references public.usta_players(id) on delete set null,
  reported_at timestamptz not null default now()
);

create index if not exists usta_signups_practice_idx on public.usta_practice_signups(practice_id);
create index if not exists usta_court_reports_court_idx on public.usta_court_reports(court, reported_at desc);

-- Answer order comes from the database clock, not the phone's, so a phone whose
-- clock is off (or a hand-edited request) can't reorder the list. Re-saving the
-- same answer keeps your place; changing it moves you to the end.
create or replace function public.usta_signup_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.updated_at := now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end $$;

drop trigger if exists usta_signup_stamp on public.usta_practice_signups;
create trigger usta_signup_stamp before insert or update on public.usta_practice_signups
  for each row execute function public.usta_signup_stamp();

alter table public.usta_practices        enable row level security;
alter table public.usta_practice_signups enable row level security;
alter table public.usta_court_reports    enable row level security;

revoke all on public.usta_practices, public.usta_practice_signups, public.usta_court_reports from anon, authenticated;

-- Same rules as availability. Practices are written only through the
-- functions below.
grant select on public.usta_practices to authenticated;
grant select, insert, update on public.usta_practice_signups to authenticated;
grant select, insert on public.usta_court_reports to authenticated;

drop policy if exists usta_practices_read on public.usta_practices;
drop policy if exists usta_signups_read   on public.usta_practice_signups;
drop policy if exists usta_signups_write  on public.usta_practice_signups;
drop policy if exists usta_signups_update on public.usta_practice_signups;
drop policy if exists usta_reports_read   on public.usta_court_reports;
drop policy if exists usta_reports_write  on public.usta_court_reports;

create policy usta_practices_read on public.usta_practices for select to authenticated
  using ((select public.usta_me()) is not null);
create policy usta_signups_read   on public.usta_practice_signups for select to authenticated
  using ((select public.usta_me()) is not null);
create policy usta_signups_write  on public.usta_practice_signups for insert to authenticated
  with check (player_id = (select public.usta_me()) or (select public.usta_is_captain()));
create policy usta_signups_update on public.usta_practice_signups for update to authenticated
  using (player_id = (select public.usta_me()) or (select public.usta_is_captain()))
  with check (player_id = (select public.usta_me()) or (select public.usta_is_captain()));
create policy usta_reports_read   on public.usta_court_reports for select to authenticated
  using ((select public.usta_me()) is not null);
create policy usta_reports_write  on public.usta_court_reports for insert to authenticated
  with check (player_id = (select public.usta_me()));

-- Earlier signatures: drafts, then the captain-password versions.
drop function if exists public.usta_save_practice(text, uuid, timestamptz, int, text, int, text);
drop function if exists public.usta_cancel_practice(text, uuid, boolean);
drop function if exists public.usta_delete_practice(text, uuid);
drop function if exists public.usta_save_practice(text, uuid, uuid, timestamptz, int, text, int, text);
drop function if exists public.usta_cancel_practice(text, uuid, uuid, boolean);
drop function if exists public.usta_delete_practice(text, uuid, uuid);
drop function if exists public.usta_can_edit_practice(text, uuid, uuid);

-- Any teammate can post a practice. Whoever posted it, or a captain, can change it.
create or replace function public.usta_can_edit_practice(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.usta_is_captain()
      or exists (select 1 from public.usta_practices
                 where id = p_id and created_by = public.usta_me());
$$;

-- p_id null = create. Returns the practice id.
create or replace function public.usta_save_practice(
  p_id uuid, p_starts_at timestamptz, p_minutes int, p_site text, p_courts int, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if public.usta_me() is null then raise exception 'Sign in first'; end if;
  if nullif(btrim(coalesce(p_site, '')), '') is null then raise exception 'Pick a place to play'; end if;
  if p_id is null then
    insert into public.usta_practices (starts_at, minutes, site, courts, notes, created_by)
    values (p_starts_at, coalesce(p_minutes, 90), btrim(p_site), p_courts,
            nullif(btrim(coalesce(p_notes, '')), ''), public.usta_me())
    returning id into v_id;
  else
    if not public.usta_can_edit_practice(p_id) then
      raise exception 'Only whoever posted this practice, or a captain, can change it';
    end if;
    update public.usta_practices
       set starts_at = coalesce(p_starts_at, starts_at),
           minutes   = coalesce(p_minutes, minutes),
           site      = btrim(p_site),
           courts    = p_courts,
           notes     = nullif(btrim(coalesce(p_notes, '')), '')
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.usta_cancel_practice(p_id uuid, p_cancelled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_can_edit_practice(p_id) then
    raise exception 'Only whoever posted this practice, or a captain, can change it';
  end if;
  update public.usta_practices set cancelled = coalesce(p_cancelled, true) where id = p_id;
end $$;

create or replace function public.usta_delete_practice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_can_edit_practice(p_id) then
    raise exception 'Only whoever posted this practice, or a captain, can change it';
  end if;
  delete from public.usta_practices where id = p_id;
end $$;

do $$
declare t text;
begin
  foreach t in array array['usta_practices', 'usta_practice_signups', 'usta_court_reports'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================ 9. signing in ============================

-- Ties this phone's session to a player. Internal: callers have already
-- checked the invite or PIN.
create or replace function public.usta_link_device(p_player_id uuid, p_how text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'No session'; end if;
  insert into public.usta_player_devices (auth_user_id, player_id, how, linked_at)
  values (auth.uid(), p_player_id, p_how, now())
  on conflict (auth_user_id) do update
    set player_id = excluded.player_id, how = excluded.how, linked_at = now();
end $$;

-- 32 URL-safe characters (192 random bits). Replaces any unused link the
-- player already had. Internal: see the two callers below.
create or replace function public.usta_new_invite(p_player_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');
begin
  if not exists (select 1 from public.usta_players where id = p_player_id and active) then
    raise exception 'player not found';
  end if;
  delete from public.usta_invites where player_id = p_player_id and used_at is null;
  insert into public.usta_invites (token_hash, player_id, expires_at)
  values (encode(sha256(convert_to(v_token, 'utf8')), 'hex'), p_player_id, now() + interval '7 days');
  return v_token;
end $$;

create or replace function public.usta_create_invite(p_player_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  return public.usta_new_invite(p_player_id);
end $$;

-- For the very first captain, who has nobody to send them a link. Run it in
-- the SQL editor and open <site>/join#t=<the result>:
--   select public.usta_admin_invite('First Last');
-- Not callable from the browser.
create or replace function public.usta_admin_invite(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.usta_players where lower(name) = lower(btrim(p_name)) and active;
  if v_id is null then raise exception 'No active player named %', p_name; end if;
  return public.usta_new_invite(v_id);
end $$;

-- Opening an invite link signs this phone in. A captain's link is also the
-- way back from a forgotten or locked PIN, so it clears the lock.
create or replace function public.usta_redeem_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_player uuid;
begin
  update public.usta_invites i
     set used_at = now()
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex')
     and used_at is null and expires_at > now()
     and exists (select 1 from public.usta_players p where p.id = i.player_id and p.active)
  returning player_id into v_player;
  if v_player is null then
    raise exception 'This invite link has expired or was already used. Ask a captain for a new one.';
  end if;

  perform public.usta_link_device(v_player, 'invite');
  insert into public.usta_player_secrets (player_id) values (v_player) on conflict do nothing;
  update public.usta_player_secrets set failed_pins = 0, locked_at = null where player_id = v_player;
  return public.usta_whoami();
end $$;

-- What the app needs at startup: who this phone is signed in as, and whether
-- they still have to choose a PIN.
create or replace function public.usta_whoami()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.usta_me() is null then null else jsonb_build_object(
    'player_id', public.usta_me(),
    'has_pin', exists (select 1 from public.usta_player_secrets
                       where player_id = public.usta_me() and pin_hash is not null)
  ) end;
$$;

-- The rules every PIN has to pass. Internal: usta_set_pin and usta_sign_up.
create or replace function public.usta_check_pin(p_player_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare v_phone text;
begin
  if coalesce(p_pin, '') !~ '^\d{8}$' then raise exception 'Your PIN needs to be exactly 8 digits.'; end if;
  if p_pin ~ '^(\d)\1+$' or '0123456789012' like '%' || p_pin || '%' or '9876543210987' like '%' || p_pin || '%' then
    raise exception 'That PIN is too easy to guess. Pick another.';
  end if;
  select regexp_replace(coalesce(phone, ''), '\D', '', 'g') into v_phone from public.usta_players where id = p_player_id;
  if length(v_phone) >= 8 and right(v_phone, 8) = p_pin then
    raise exception 'Don''t use your phone number. Everyone on the team has it.';
  end if;
end $$;

-- An 8-digit PIN, not obvious, and not the end of the player's phone number
-- (everyone on the team has that). Changing an existing PIN needs the current
-- one, unless this phone came in on an invite link in the last day — that's
-- the forgotten-PIN path.
create or replace function public.usta_set_pin(p_pin text, p_current_pin text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me    uuid := public.usta_me();
  v_hash  text;
  v_fresh boolean;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  perform public.usta_check_pin(v_me, p_pin);

  select pin_hash into v_hash from public.usta_player_secrets where player_id = v_me;
  select how = 'invite' and linked_at > now() - interval '1 day' into v_fresh
    from public.usta_player_devices where auth_user_id = auth.uid();
  if v_hash is not null and not coalesce(v_fresh, false)
     and (p_current_pin is null or extensions.crypt(p_current_pin, v_hash) <> v_hash) then
    raise exception 'Your current PIN isn''t right.';
  end if;

  insert into public.usta_player_secrets (player_id, pin_hash)
  values (v_me, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  on conflict (player_id) do update set pin_hash = excluded.pin_hash, failed_pins = 0, locked_at = null;
end $$;

-- Phone number + PIN. Returns {"ok": true} or {"ok": false, "reason": ...}
-- rather than raising, because raising would roll back the wrong-try count.
-- An unknown number and a wrong PIN get the same answer.
create or replace function public.usta_pin_sign_in(p_phone text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone  text;
  v_id     uuid;
  v_hash   text;
  v_locked boolean;
  v_failed int;
begin
  begin
    v_phone := public.usta_norm_phone(p_phone);
  exception when others then
    return jsonb_build_object('ok', false, 'reason', 'nomatch');
  end;
  select p.id, s.pin_hash, s.locked_at is not null into v_id, v_hash, v_locked
    from public.usta_players p
    join public.usta_player_secrets s on s.player_id = p.id
   where p.phone = v_phone and p.active;

  if v_hash is null then return jsonb_build_object('ok', false, 'reason', 'nomatch'); end if;
  if v_locked then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;

  if extensions.crypt(coalesce(p_pin, ''), v_hash) = v_hash then
    update public.usta_player_secrets set failed_pins = 0 where player_id = v_id;
    perform public.usta_link_device(v_id, 'pin');
    return jsonb_build_object('ok', true) || public.usta_whoami();
  end if;

  update public.usta_player_secrets
     set failed_pins = failed_pins + 1,
         locked_at   = case when failed_pins + 1 >= 10 then now() end
   where player_id = v_id
  returning failed_pins into v_failed;
  return jsonb_build_object('ok', false, 'reason', case when v_failed >= 10 then 'locked' else 'nomatch' end);
end $$;

create or replace function public.usta_sign_out()
returns void language sql security definer set search_path = public as $$
  delete from public.usta_player_devices where auth_user_id = auth.uid();
$$;

-- For the captain's roster: who has joined, who's locked out, whose link is
-- still waiting to be opened.
create or replace function public.usta_roster_access()
returns table (player_id uuid, has_pin boolean, locked boolean, devices int,
               last_signed_in timestamptz, invite_expires timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  return query
  select p.id,
         s.pin_hash is not null,
         s.locked_at is not null,
         (select count(*)::int from public.usta_player_devices d where d.player_id = p.id),
         (select max(d.linked_at) from public.usta_player_devices d where d.player_id = p.id),
         (select max(i.expires_at) from public.usta_invites i
           where i.player_id = p.id and i.used_at is null and i.expires_at > now())
    from public.usta_players p
    left join public.usta_player_secrets s on s.player_id = p.id
   where p.active;
end $$;

create or replace function public.usta_unlock_pin(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  update public.usta_player_secrets set failed_pins = 0, locked_at = null where player_id = p_player_id;
end $$;

-- A lost phone: sign the player out everywhere. Their PIN still works.
create or replace function public.usta_sign_out_player(p_player_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  delete from public.usta_player_devices where player_id = p_player_id;
end $$;

-- Captains name other captains, e.g. someone to run a match they'll miss.
-- The team always keeps at least one: the captain rows are locked first, so
-- two captains removing each other at once can't leave nobody in charge.
create or replace function public.usta_set_captain(p_player_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  perform 1 from public.usta_players where is_captain for update;
  if not coalesce(p_on, false)
     and not exists (select 1 from public.usta_players
                     where is_captain and active and id <> p_player_id) then
    raise exception 'The team needs at least one captain. Make someone else captain first.';
  end if;
  update public.usta_players set is_captain = coalesce(p_on, false) where id = p_player_id and active;
  if not found then raise exception 'player not found'; end if;
end $$;

-- ---------- setting up without an invite ----------
-- While the link to the app stays inside the team, nobody needs an invite: a
-- player enters the phone number a captain put on the roster, chooses a PIN,
-- and is in. That only works for a player who has no PIN yet, so it can't take
-- over anyone already set up. If someone sets up as the wrong person, a
-- captain's invite link lets the real one choose a new PIN, and "Sign out of
-- all phones" removes the other phone. Once the link might travel further
-- (a new team, say), a captain turns this off in the app: invite links only.
create table if not exists public.usta_settings (
  id           int primary key default 1 check (id = 1),
  open_sign_up boolean not null default true
);
insert into public.usta_settings (id) values (1) on conflict do nothing;
alter table public.usta_settings enable row level security;
revoke all on public.usta_settings from public, anon, authenticated;

create or replace function public.usta_open_sign_up()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select open_sign_up from public.usta_settings where id = 1), false);
$$;

create or replace function public.usta_set_open_sign_up(p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_is_captain() then raise exception 'Captains only'; end if;
  insert into public.usta_settings (id, open_sign_up) values (1, coalesce(p_on, false))
  on conflict (id) do update set open_sign_up = excluded.open_sign_up;
end $$;

-- Step one: is this number on the roster, and still without a PIN?
-- {"status": "new", "name": ...}, or "has_pin", "nomatch", "closed".
create or replace function public.usta_sign_up_check(p_phone text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_phone text;
  v_name  text;
  v_has   boolean;
begin
  if not public.usta_open_sign_up() then return jsonb_build_object('status', 'closed'); end if;
  begin
    v_phone := public.usta_norm_phone(p_phone);
  exception when others then
    return jsonb_build_object('status', 'nomatch');
  end;
  select coalesce(nullif(btrim(p.preferred_name), ''), p.name), s.pin_hash is not null
    into v_name, v_has
    from public.usta_players p
    left join public.usta_player_secrets s on s.player_id = p.id
   where p.phone = v_phone and p.active;
  if v_name is null then return jsonb_build_object('status', 'nomatch'); end if;
  if v_has then return jsonb_build_object('status', 'has_pin'); end if;
  return jsonb_build_object('status', 'new', 'name', v_name);
end $$;

-- Step two: choose the PIN and sign this phone in, in one go, so there's never
-- a signed-in phone without a PIN behind it.
create or replace function public.usta_sign_up(p_phone text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text;
  v_id    uuid;
begin
  if not public.usta_open_sign_up() then
    raise exception 'To join, open the invite link your captain sent you.';
  end if;
  begin
    v_phone := public.usta_norm_phone(p_phone);
  exception when others then
    v_phone := null;
  end;
  select id into v_id from public.usta_players where phone = v_phone and active;
  if v_id is null then
    raise exception 'That number isn''t on the team roster. Ask a captain to add it.';
  end if;
  perform public.usta_check_pin(v_id, p_pin);

  -- only while there's no PIN; the row lock settles two phones racing
  insert into public.usta_player_secrets (player_id, pin_hash)
  values (v_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)))
  on conflict (player_id) do update set pin_hash = excluded.pin_hash, failed_pins = 0, locked_at = null
   where public.usta_player_secrets.pin_hash is null;
  if not found then
    raise exception 'You already have a PIN. Sign in with it, or ask a captain for a link if you forgot it.';
  end if;

  perform public.usta_link_device(v_id, 'pin');
  return public.usta_whoami();
end $$;

-- ============================ 10. function permissions ============================
-- Functions are executable by PUBLIC by default, so revoke from PUBLIC, not
-- just anon. Signed-in sessions get the ones the app calls; each function
-- checks usta_me() or usta_is_captain() itself.

revoke all on function
  public.usta_norm_phone(text),
  public.usta_me(),
  public.usta_is_captain(),
  public.usta_save_lineup(uuid, jsonb),
  public.usta_save_results(uuid, jsonb),
  public.usta_publish_lineup(uuid, boolean),
  public.usta_update_match(uuid, timestamptz, text, text),
  public.usta_upsert_player(uuid, text, text, numeric, text, boolean, text),
  public.usta_update_profile(uuid, text, text, text, text, text),
  public.usta_captain_ratings(),
  public.usta_can_edit_practice(uuid),
  public.usta_save_practice(uuid, timestamptz, int, text, int, text),
  public.usta_cancel_practice(uuid, boolean),
  public.usta_delete_practice(uuid),
  public.usta_link_device(uuid, text),
  public.usta_new_invite(uuid),
  public.usta_create_invite(uuid),
  public.usta_admin_invite(text),
  public.usta_redeem_invite(text),
  public.usta_whoami(),
  public.usta_set_pin(text, text),
  public.usta_pin_sign_in(text, text),
  public.usta_sign_out(),
  public.usta_roster_access(),
  public.usta_unlock_pin(uuid),
  public.usta_sign_out_player(uuid),
  public.usta_set_captain(uuid, boolean),
  public.usta_check_pin(uuid, text),
  public.usta_open_sign_up(),
  public.usta_set_open_sign_up(boolean),
  public.usta_sign_up_check(text),
  public.usta_sign_up(text, text)
from public, anon, authenticated;

-- usta_me and usta_is_captain stay executable because the read rules call them
-- as the signed-in user.
grant execute on function
  public.usta_me(),
  public.usta_is_captain(),
  public.usta_save_lineup(uuid, jsonb),
  public.usta_save_results(uuid, jsonb),
  public.usta_publish_lineup(uuid, boolean),
  public.usta_update_match(uuid, timestamptz, text, text),
  public.usta_upsert_player(uuid, text, text, numeric, text, boolean, text),
  public.usta_update_profile(uuid, text, text, text, text, text),
  public.usta_captain_ratings(),
  public.usta_save_practice(uuid, timestamptz, int, text, int, text),
  public.usta_cancel_practice(uuid, boolean),
  public.usta_delete_practice(uuid),
  public.usta_create_invite(uuid),
  public.usta_redeem_invite(text),
  public.usta_whoami(),
  public.usta_set_pin(text, text),
  public.usta_pin_sign_in(text, text),
  public.usta_sign_out(),
  public.usta_roster_access(),
  public.usta_unlock_pin(uuid),
  public.usta_sign_out_player(uuid),
  public.usta_set_captain(uuid, boolean),
  public.usta_open_sign_up(),
  public.usta_set_open_sign_up(boolean),
  public.usta_sign_up_check(text),
  public.usta_sign_up(text, text)
to authenticated;
