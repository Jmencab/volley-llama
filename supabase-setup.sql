-- Volley Llama team app — Supabase schema.
-- Applied 2026-08-30 via migrations usta_tennis_team_schema, usta_captain_rpcs,
-- usta_lock_check_pass_and_rotate. Kept here as the readable source of truth.

-- ============================ 1. tables ============================

create table if not exists public.usta_players (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,   -- the official USTA roster name
  preferred_name text,                   -- what the app displays, when set
  gender         text not null check (gender in ('M','F')),
  ntrp           numeric(2,1),
  usta_number    text,
  phone          text,
  venmo          text,                   -- stored without the leading @
  is_captain   boolean not null default false,
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

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

create table if not exists public.usta_config (key text primary key, value text not null);

create index if not exists usta_lineups_match_idx on public.usta_lineups(match_id);
create index if not exists usta_avail_match_idx on public.usta_availability(match_id);

-- ============================ 2. access ============================
-- Players self-serve availability with no login (13 people, unlisted link).
-- Everything else is read-only from the browser and written only through the
-- passcode-checked functions in section 3.

alter table public.usta_players      enable row level security;
alter table public.usta_matches      enable row level security;
alter table public.usta_availability enable row level security;
alter table public.usta_lineups      enable row level security;
alter table public.usta_config       enable row level security;

revoke all on public.usta_players, public.usta_matches, public.usta_availability,
              public.usta_lineups, public.usta_config from anon, authenticated;

grant select on public.usta_players, public.usta_matches, public.usta_lineups to anon, authenticated;
grant select, insert, update on public.usta_availability to anon, authenticated;

create policy usta_players_read on public.usta_players for select to anon, authenticated using (true);
create policy usta_matches_read on public.usta_matches for select to anon, authenticated using (true);
create policy usta_lineups_read on public.usta_lineups for select to anon, authenticated using (true);
create policy usta_avail_read   on public.usta_availability for select to anon, authenticated using (true);
create policy usta_avail_write  on public.usta_availability for insert to anon, authenticated with check (true);
create policy usta_avail_update on public.usta_availability for update to anon, authenticated using (true) with check (true);

-- usta_config has RLS on and NO policies, plus no grants: unreachable from the
-- browser. Only the SECURITY DEFINER functions below can read the passcode hash.

-- ============================ 3. captain RPCs ============================
-- The passcode never leaves the database. The browser sends a candidate and
-- gets true/false, or the write is rejected with 'unauthorized'.

create or replace function public.usta_check_pass(p_pass text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.usta_config
    where key = 'captain_pass_hash'
      and value = encode(sha256(convert_to(coalesce(p_pass,''), 'utf8')), 'hex')
  );
$$;

create or replace function public.usta_verify_captain(p_pass text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.usta_check_pass(p_pass);
$$;

-- p_courts: [{"court":1,"player1_id":"uuid","player2_id":"uuid"}, ...]
-- Upserts, so a result already entered on a court survives a lineup edit.
create or replace function public.usta_save_lineup(p_pass text, p_match_id uuid, p_courts jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_check_pass(p_pass) then raise exception 'unauthorized'; end if;

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
create or replace function public.usta_save_results(p_pass text, p_match_id uuid, p_results jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_check_pass(p_pass) then raise exception 'unauthorized'; end if;
  update public.usta_lineups l
     set won   = case when r->>'won' is null or r->>'won' = '' then null else (r->>'won')::boolean end,
         score = nullif(r->>'score','')
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
   where l.match_id = p_match_id and l.court = (r->>'court')::smallint;
end $$;

create or replace function public.usta_publish_lineup(p_pass text, p_match_id uuid, p_published boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_check_pass(p_pass) then raise exception 'unauthorized'; end if;
  update public.usta_matches set lineup_published = coalesce(p_published, false) where id = p_match_id;
end $$;

create or replace function public.usta_update_match(
  p_pass text, p_match_id uuid, p_starts_at timestamptz, p_site text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_check_pass(p_pass) then raise exception 'unauthorized'; end if;
  update public.usta_matches
     set starts_at = coalesce(p_starts_at, starts_at),
         site      = coalesce(nullif(p_site,''), site),
         notes     = p_notes
   where id = p_match_id;
end $$;

create or replace function public.usta_upsert_player(
  p_pass text, p_id uuid, p_name text, p_gender text, p_ntrp numeric, p_phone text, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.usta_check_pass(p_pass) then raise exception 'unauthorized'; end if;
  if p_id is null then
    insert into public.usta_players (name, gender, ntrp, phone, active, sort_order)
    values (p_name, p_gender, p_ntrp, p_phone, coalesce(p_active, true),
            coalesce((select max(sort_order) + 1 from public.usta_players), 0))
    returning id into v_id;
  else
    update public.usta_players
       set name = coalesce(nullif(p_name,''), name), gender = coalesce(nullif(p_gender,''), gender),
           ntrp = coalesce(p_ntrp, ntrp), phone = p_phone, active = coalesce(p_active, active)
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

-- Players edit their own preferred name and gender freely (same trust model as
-- availability). Phone and Venmo need the captain passcode: anyone holding the
-- public key could otherwise point a teammate's Venmo at themselves.
create or replace function public.usta_update_profile(
  p_id uuid, p_preferred_name text, p_phone text, p_gender text, p_venmo text, p_pass text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  -- stored bare, without the @ people habitually type
  v_venmo text := nullif(btrim(ltrim(btrim(coalesce(p_venmo, '')), '@')), '');
  cur record;
begin
  if p_gender is not null and p_gender not in ('M', 'F') then
    raise exception 'gender must be M or F';
  end if;

  select phone, venmo into cur from public.usta_players where id = p_id and active;
  if not found then raise exception 'player not found'; end if;

  if (v_phone is distinct from cur.phone or v_venmo is distinct from cur.venmo)
     and not public.usta_check_pass(p_pass) then
    raise exception 'Phone and Venmo changes need the captain passcode';
  end if;

  update public.usta_players
     set preferred_name = nullif(btrim(coalesce(p_preferred_name, '')), ''),
         phone          = v_phone,
         gender         = coalesce(p_gender, gender),
         venmo          = v_venmo
   where id = p_id and active;
end $$;

create or replace function public.usta_set_captain_pass(p_old_pass text, p_new_pass text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_check_pass(p_old_pass) then raise exception 'unauthorized'; end if;
  if coalesce(length(p_new_pass), 0) < 6 then raise exception 'passcode must be at least 6 characters'; end if;
  update public.usta_config
     set value = encode(sha256(convert_to(p_new_pass, 'utf8')), 'hex')
   where key = 'captain_pass_hash';
end $$;

-- usta_check_pass must be revoked from PUBLIC too, not just anon: functions are
-- executable by PUBLIC by default, so revoking from anon alone leaves it open.
revoke all on function public.usta_check_pass(text) from public, anon, authenticated;

grant execute on function public.usta_verify_captain(text) to anon, authenticated;
grant execute on function public.usta_save_lineup(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.usta_save_results(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.usta_publish_lineup(text, uuid, boolean) to anon, authenticated;
grant execute on function public.usta_update_match(text, uuid, timestamptz, text, text) to anon, authenticated;
grant execute on function public.usta_upsert_player(text, uuid, text, text, numeric, text, boolean) to anon, authenticated;
grant execute on function public.usta_set_captain_pass(text, text) to anon, authenticated;

-- ============================ 4. realtime ============================
alter publication supabase_realtime add table public.usta_availability;
alter publication supabase_realtime add table public.usta_lineups;
alter publication supabase_realtime add table public.usta_matches;

-- ============================ 5. reset helpers ============================
-- Wipe a season back to a clean slate (roster and schedule stay):
--   delete from public.usta_lineups;
--   delete from public.usta_availability;
--   update public.usta_matches set lineup_published = false;

-- ============================ 6. practices ============================
-- Added 2026-10. Safe to re-run: paste this whole section into the Supabase SQL
-- editor once. Until it runs, the app's Practice tab says the setup is missing
-- and everything else works as before.

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

alter table public.usta_practices        enable row level security;
alter table public.usta_practice_signups enable row level security;
alter table public.usta_court_reports    enable row level security;

revoke all on public.usta_practices, public.usta_practice_signups, public.usta_court_reports from anon, authenticated;

-- Same trust model as availability: anyone with the link signs up and reports
-- lights. Practices are written only through the functions below.
grant select on public.usta_practices to anon, authenticated;
grant select, insert, update on public.usta_practice_signups to anon, authenticated;
grant select, insert on public.usta_court_reports to anon, authenticated;

drop policy if exists usta_practices_read on public.usta_practices;
drop policy if exists usta_signups_read   on public.usta_practice_signups;
drop policy if exists usta_signups_write  on public.usta_practice_signups;
drop policy if exists usta_signups_update on public.usta_practice_signups;
drop policy if exists usta_reports_read   on public.usta_court_reports;
drop policy if exists usta_reports_write  on public.usta_court_reports;

create policy usta_practices_read on public.usta_practices for select to anon, authenticated using (true);
create policy usta_signups_read   on public.usta_practice_signups for select to anon, authenticated using (true);
create policy usta_signups_write  on public.usta_practice_signups for insert to anon, authenticated with check (true);
create policy usta_signups_update on public.usta_practice_signups for update to anon, authenticated using (true) with check (true);
create policy usta_reports_read   on public.usta_court_reports for select to anon, authenticated using (true);
create policy usta_reports_write  on public.usta_court_reports for insert to anon, authenticated with check (true);

-- Anyone on the roster can post a practice (same trust model as availability:
-- p_player_id is whoever picked that name on their phone). The person who
-- posted it, or a captain, can change it.
create or replace function public.usta_can_edit_practice(p_pass text, p_player_id uuid, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.usta_check_pass(p_pass)
      or exists (select 1 from public.usta_practices
                 where id = p_id and p_player_id is not null and created_by = p_player_id);
$$;
revoke all on function public.usta_can_edit_practice(text, uuid, uuid) from public, anon, authenticated;

-- Earlier draft signatures, in case they were ever applied.
drop function if exists public.usta_save_practice(text, uuid, timestamptz, int, text, int, text);
drop function if exists public.usta_cancel_practice(text, uuid, boolean);
drop function if exists public.usta_delete_practice(text, uuid);

-- p_id null = create. Returns the practice id.
create or replace function public.usta_save_practice(
  p_pass text, p_player_id uuid, p_id uuid, p_starts_at timestamptz, p_minutes int,
  p_site text, p_courts int, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if nullif(btrim(coalesce(p_site, '')), '') is null then raise exception 'Pick a place to play'; end if;
  if p_id is null then
    if not exists (select 1 from public.usta_players where id = p_player_id and active)
       and not public.usta_check_pass(p_pass) then
      raise exception 'Pick your name first';
    end if;
    insert into public.usta_practices (starts_at, minutes, site, courts, notes, created_by)
    values (p_starts_at, coalesce(p_minutes, 90), btrim(p_site), p_courts,
            nullif(btrim(coalesce(p_notes, '')), ''), p_player_id)
    returning id into v_id;
  else
    if not public.usta_can_edit_practice(p_pass, p_player_id, p_id) then
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

create or replace function public.usta_cancel_practice(p_pass text, p_player_id uuid, p_id uuid, p_cancelled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_can_edit_practice(p_pass, p_player_id, p_id) then
    raise exception 'Only whoever posted this practice, or a captain, can change it';
  end if;
  update public.usta_practices set cancelled = coalesce(p_cancelled, true) where id = p_id;
end $$;

create or replace function public.usta_delete_practice(p_pass text, p_player_id uuid, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.usta_can_edit_practice(p_pass, p_player_id, p_id) then
    raise exception 'Only whoever posted this practice, or a captain, can change it';
  end if;
  delete from public.usta_practices where id = p_id;
end $$;

grant execute on function public.usta_save_practice(text, uuid, uuid, timestamptz, int, text, int, text) to anon, authenticated;
grant execute on function public.usta_cancel_practice(text, uuid, uuid, boolean) to anon, authenticated;
grant execute on function public.usta_delete_practice(text, uuid, uuid) to anon, authenticated;

-- "add table" fails if the table is already published, so only add what's missing.
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
