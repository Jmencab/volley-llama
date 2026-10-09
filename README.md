# Volley Llama

The team app for **AYTC-Volley Llama-Mendez**, a USTA 3.0 mixed doubles team
(Fall 2026). Players check the schedule and say whether they can play; captains
build lineups, post them, and enter results.

Built with React + Vite, Supabase, and Netlify.

- [Features](#features)
- [Getting started](#getting-started)
- [Project layout](#project-layout)
- [How it works](#how-it-works)
- [Captain operations](#captain-operations)
- [Deploying](#deploying)
- [Contributing](#contributing)
- [Gotchas](#gotchas)

## Features

**For players**

- **Home**: the next match, whether you're in the lineup, and a one-tap availability picker.
- **Schedule**: every match with time, site, and home/away. Answer *Available / Maybe / Out* right from the list.
- **Practice**: anyone can post a practice and share it to the team's WhatsApp group with the court, a map link, and a sign-up link. There's no sign-up limit: the app shows the count against the ideal of four per court (e.g. *5/4 signed up*) and suggests booking another court when it's over. There's also a court finder for Seattle courts, with which ones have lights and whether a teammate says the lights actually worked last time.
- **Stats**: team record, results by court, a player leaderboard, best partnerships, and each player's match log.
- Sign in once per phone with the invite link your captain sends, then choose an 8-digit PIN. On a new phone, sign in with your phone number and PIN. Update your details any time from **Stats → Edit my details**.

**For captains**

- Availability counts split by gender (every lineup needs three men and three women). Tap a count to see who.
- A red **!** on any upcoming match that doesn't have enough yeses to field a lineup.
- A lineup builder for three courts (one man and one woman each) that flags maybes, no-answers, dropouts, and any pair over the **6.0 combined NTRP** limit.
- **Auto-suggest**, which drafts a legal lineup and explains its choices. See [Lineups](#lineups).
- Edit, cancel, or delete any practice. Players can only change the ones they posted.
- Post the lineup to the team, copy it as a group text, send a nudge to anyone who hasn't answered, enter scores, and edit match details.

## Getting started

```bash
git clone https://github.com/juice-lee/volley-llama.git
cd volley-llama
npm install
cp .env.example .env.local   # then fill in the two Supabase values
npm run dev
```

The Supabase values aren't in the repository; ask Kevin for them. Git ignores
`.env.local`, so they never get committed.

Vite prints the local URL (usually http://localhost:5173). The first screen asks
for your phone number and PIN. Sessions belong to the site's address, so
localhost needs its own sign-in: ask a captain for an invite link and change
its start to `http://localhost:5173`.

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with oxlint |

> [!WARNING]
> **Local development uses the live database.** There is no staging environment,
> so anything you do in `npm run dev`, such as setting availability, changes real
> team data, as whoever you're signed in as.

## Project layout

```
src/
├── App.jsx              Routes, the entry gates, page transitions
├── main.jsx             Entry point
├── styles.css           All styles; design tokens at the top
├── pages/
│   ├── Home.jsx         Next match and your availability
│   ├── Schedule.jsx     Every match, with quick availability picks
│   ├── Practice.jsx     Practice sign-ups and the court finder
│   ├── MatchDetail.jsx  One match: who's in and the posted lineup
│   ├── Team.jsx         Stats tab: records, leaderboard, your profile, captain unlock
│   ├── Captain.jsx      Captain overview: upcoming matches, playing time, pairings
│   └── CaptainMatch.jsx Lineup builder, auto-suggest, posting, results, match editing
├── components/
│   ├── ui.jsx           Shared pieces: chips, sheets, toasts, tooltips, availability picker
│   ├── MatchRow.jsx     A row on the Schedule
│   └── …                TabBar, Splash, and the team / name / captain gates
└── lib/
    ├── store.jsx        Data loading, live updates, and every Supabase write
    ├── stats.js         All statistics, derived from lineups
    ├── rules.js         League rules (the 6.0 combined cap)
    ├── suggest.js       The auto-suggest algorithm
    ├── dates.js         Pacific-time formatting and match phases
    ├── practice.js      Practice sign-ups and the four-per-court headcount
    ├── courts.js        Seattle's public court list (city GIS) and booking links
    ├── sun.js           Seattle sunset times, for "will we need lights"
    ├── identity.js      Invite links and other links into the app
    ├── phone.js         Phone formatting, WhatsApp and text links
    ├── nav.js           Tab order, used for page-slide direction
    └── supabase.js      Supabase client

supabase-setup.sql       Schema, row-level security, and database functions
netlify.toml             Build settings and SPA redirect
.env.example             The Supabase settings needed to run locally (no values)
```

## How it works

### Access

Every player signs in, so nobody can act as a teammate, by accident or on
purpose. There are no passwords or emails to verify, because the captain
already knows everyone on the team:

| Step | What happens | Where it lives |
|---|---|---|
| **Invite link** | A captain sends each player a personal link (`/join#t=…`) from the roster, by WhatsApp or text. Opening it signs that phone in. It works once and expires after 7 days. | `usta_invites` (token hashes only), `usta_create_invite` |
| **PIN** | Right after the link, the player chooses an 8-digit PIN. The database refuses easy ones and the last 8 digits of their own phone number. | `usta_player_secrets` (bcrypt), `usta_set_pin` |
| **Phone + PIN** | Signs in on any other phone, or after iOS clears the site. Ten wrong tries lock the PIN until a captain unlocks it or sends a new link. | `usta_pin_sign_in` |
| **Captain** | Whoever has `is_captain` on the roster. The database checks it on every captain action. | `usta_is_captain()` |

How it works underneath: each phone gets a Supabase *anonymous session*,
which any visitor can get. Being signed in to Supabase therefore proves
nothing on its own. A row in `usta_player_devices` ties a session to a player
once an invite or PIN checks out, and every rule asks `usta_me()`, which reads
that table. Someone who isn't tied to a player can't read anything.

- Players change only their own availability, sign-ups, lights reports, and
  details. Captains can change anyone's, for the "put me down as out" texts.
- Phone numbers are stored as `+12065550134`, are unique, and are required.
  They're how a player signs in and how the app opens a WhatsApp or text to them.
- Links sent before sign-in existed (`?key=…`) still open the app; the old key
  is ignored.

### Data

Everything lives in Supabase, in tables prefixed `usta_`.

| Table | Contents |
|---|---|
| `usta_players` | Roster: USTA name, preferred name, gender, NTRP, USTA number, phone (required, unique), email (optional), Venmo, captain flag |
| `usta_matches` | Each match: time, home/away, opponent, site, team note, whether the lineup is posted |
| `usta_availability` | One row per player per match: `available`, `maybe`, or `out` |
| `usta_lineups` | One row per match per court: the pair, `won`, and `score` |
| `usta_practices` | Practices: time, length, site, courts booked, note, cancelled |
| `usta_practice_signups` | One row per player per practice: `in` or `out`; `updated_at` (set by the database) is when they answered |
| `usta_court_reports` | Teammates' "lights worked / lights out" reports, by city court name |
| `usta_player_devices` | Which sessions (phones) are signed in as which player (no browser access) |
| `usta_player_secrets` | PIN hashes and wrong-try counts (no browser access) |
| `usta_invites` | Hashes of invite tokens, with expiry and when used (no browser access) |

- **Every statistic comes from `usta_lineups`**: play counts, records, partnerships,
  and court history. Entering scores after each match is the only upkeep. A lineup
  counts toward play totals once the match starts or the lineup is posted; a draft
  for a future match doesn't.
- **Changes sync live.** Availability, lineups, match edits, practices, sign-ups, and
  lights reports update on every open phone through Supabase Realtime, which
  applies the same read rules, so only signed-in teammates get them.
- **Names:** `usta_players.name` is the official USTA roster name. The app shows
  `preferred_name` when one is set, through `displayName()` in `src/components/ui.jsx`.

### Practices and courts

- **Anyone can post; the poster or a captain can change it.** The database
  checks this (`usta_can_edit_practice`) against who's signed in.
- **Share** opens WhatsApp (`wa.me`) with the message filled in; you pick the
  group. The sign-up link opens that practice, after signing in if needed.
- **Four per court is a target, not a cap.** Everyone who taps *I'm in* is in.
  The card shows *5/4 signed up* and, when sign-ups outgrow the booked courts,
  *Consider a 2nd court* (`headcount()` in `src/lib/practice.js`). Tapping the
  count shows who's in, who can't make it, and who hasn't answered.
- **Names are listed in the order people answered.** The database stamps that
  time itself (the `usta_signup_stamp` trigger), so a phone with a wrong clock
  can't reorder the list. Tapping the same answer again keeps your place.
- **The court list comes straight from Seattle Parks' GIS layer**
  (`Tennis_Courts` on services.arcgis.com, refreshed weekly by the city). Its
  `LIGHTS` field says which sites have lights. Nothing official says whether the
  lights are *working*, so teammates report that from the court finder.
- **A typed site only counts as a city court when the match is unambiguous.**
  Some parks are split into separately lit sites: Volunteer Park and Woodland Park
  each have lit lower courts and unlit upper courts. So "Volunteer Park" gets a
  general "make sure this court has lights" note, while picking the exact name
  from the suggestions gives the real answer.
- **Court availability isn't in the app.** The city's booking system (ActiveNet)
  and its availability dashboard have no API a browser can call, so each court
  links out to **Book**, and the finder links to the city's availability dashboard.
  Outdoor courts must be booked at least 24 hours ahead.

### Match phases

A single function, `matchPhase()` in `src/lib/dates.js`, decides whether a match is
**upcoming**, **live**, or **past**, so every screen agrees. It re-checks when a
phone wakes up or the tab regains focus. All times are Pacific.

### Lineups

Three courts, each with one man and one woman. Two rules shape every lineup:

- **Each court may total at most 6.0 NTRP.** `pairOverCap()` in `src/lib/rules.js`
  is the single source of truth, used by the court cards, slot picker, problems
  list, and the confirmation before posting. Players without a rating are never
  flagged.
- **Availability counts are split by gender, never totaled.** Seven yeses can still
  mean there aren't three women.

**Auto-suggest** (`src/lib/suggest.js`) tries every combination of available
players and picks the best one by these priorities, in order:

1. **Legal.** It never seats a pair over 6.0. If that means swapping someone in or
   leaving the bottom court open, it says so.
2. **Who most needs to play.** Yeses before maybes, then the fewest other chances
   this season, then the fewest matches played.
3. **Where each pair plays.** Pairs with a winning record stay together, a win moves
   a player up a court and a loss moves them down, and stronger pairs (by doubles
   UTR) take the lower-numbered courts. NTRP only breaks ties for players with no
   UTR.

The suggestion fills the draft so the captain can review it before saving.

### UTR ratings (captains only)

Each player's UTR (singles and doubles, with UTR's own reliability percentage)
lives in `usta_player_ratings`, a table the browser cannot read at all. For a
signed-in captain, the app fetches it through the captain-checked
`usta_captain_ratings` function and shows doubles UTR on the lineup slot cards
and in the player picker, with the reliability figure when it's under 90%. The
auto-suggest uses it too, shrinking an unreliable number toward the team's
median for that gender. Players never see it; the Stats tab doesn't show it.

There's no screen for editing ratings yet. To update them, run this in the
Supabase SQL editor (blank reliability defaults to 100%):

```sql
update public.usta_player_ratings r
   set utr_doubles = 1.78, utr_doubles_rel = 100, updated_at = now()
  from public.usta_players p
 where p.id = r.player_id and p.name = 'First Last';
```

## Captain operations

**Captain tools.** Players with `is_captain` on the roster see the Captain
tab. Any captain can make another player a captain, for example someone to run
a match they'll miss: Captain → Roster → the player → **Make captain**. The same
button removes a captain. The team always keeps at least one captain
(`usta_set_captain` refuses to remove the last).

**Invite a player, or let them back in.** Captain → **Roster** shows where each
player stands: *Not invited*, *Invited*, *Signed in*, *Signed out*, *PIN locked*,
or *No phone*. Tap a player to:

- **Send invite link.** Opens WhatsApp or Messages straight to them with the
  link filled in. The same button sends a new link when someone forgets their
  PIN. Opening it lets them choose a new one without the old one, and clears a lock.
- **Unlock PIN** after ten wrong tries.
- **Edit details**: name, phone, email, Venmo.
- **Sign out of all phones** for a lost phone. Their PIN still works.

**The first captain** on a new project has nobody to invite them. Run this in
the Supabase SQL editor and open `https://<site>/join#t=<the result>`:

```sql
select public.usta_admin_invite('First Last');
```

**Reschedule a match.** Captain → the match → **Match details → Edit** lets you
change the date, site, and team note. No deploy needed.

**Add a player.** Captain → **Roster → Add player**: name, woman/man, NTRP,
USTA number, phone (required). Everyone's roster updates immediately (it goes
through the captain-checked `usta_upsert_player` function). A name or phone
number already on the roster is refused. Saving goes straight to their invite.

**Database setup.** `supabase-setup.sql` is the whole schema and is safe to
re-run: paste all of it into the Supabase SQL editor to set up a new project or
bring the live one up to date. Before the first run, turn on **Authentication →
Sign In / Providers → Allow anonymous sign-ins**. If two players share a phone
number, the script stops and says so; fix that and run it again.

**Switching the live app to sign-in** (once, October 2026). The old app stops
working as soon as the database is updated, so do these together:

1. Turn on anonymous sign-ins (above).
2. Run `supabase-setup.sql`. It converts existing US phone numbers to the new
   format and leaves anything else for a captain to fix.
3. Make Julio and Kevin the only captains. Before the switch, `is_captain`
   only showed the Captain tab; from here on it's real power:
   ```sql
   update public.usta_players set is_captain = name in ('Julio Mendez', 'Kevin Jeyakumar');
   ```
4. Deploy the new build.
5. Run `select public.usta_admin_invite('<your roster name>');` and open your link.
6. From Captain → Roster, give anyone marked *No phone* a number, then send everyone their invite.

## Deploying

The site is hosted on Netlify. Deploys are manual, from a machine that has
`.env.local` filled in and is logged in to the Netlify CLI:

```bash
netlify link          # once per clone
npm run build
netlify deploy --prod --no-build --dir=dist
```

The repository is deliberately not connected to Netlify's automatic deploys, so
pushing doesn't use up build credits. Only code changes need a deploy; roster,
schedule, and availability changes are data and show up immediately.

## Contributing

1. Create a branch: `git switch -c short-description`
2. Before pushing, run `npm run lint` and `npm run build`
3. Open a pull request against `main`
4. Kevin reviews, merges, and deploys

Remember that local development writes to the live database.

## Gotchas

- **Overlays must render into `document.body`.** Page transitions animate `transform`
  on the `.page` wrapper, which breaks `position: fixed` for anything inside it.
  `Sheet` and `Toast` in `src/components/ui.jsx` use a portal for this reason; do the
  same for any new overlay.
- **iPhones clear site data after about a week without a visit** (apps added to the
  home screen are exempt). A player who hasn't opened the app in a while signs in
  again with their phone number and PIN.
- **An invite opened inside WhatsApp's own browser** signs in that browser, not
  Safari or Chrome. That's why the PIN step comes right after: it gets them in anywhere else.
- **The splash animation plays once per browser session** and waits for data (up to
  4.5 seconds). Open a new tab or run `sessionStorage.clear()` to see it again. Its
  animation steps share one timing, so retime them together.
- **Motion is turned off** for anyone with *Reduce motion* enabled, splash included.
- **Captain status is read from the roster on every call.** Unticking
  `is_captain` takes effect at once; there's no password to rotate.
