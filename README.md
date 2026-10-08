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
- **Practice**: anyone can post a practice and share it to the team's WhatsApp group with the court, a map link, and a sign-up link. Sign-ups are first come, first served, and extras go on a waitlist. There's also a court finder for Seattle courts, with which ones have lights and whether a teammate says the lights actually worked last time.
- **Stats**: team record, results by court, a player leaderboard, best partnerships, and each player's match log.
- No accounts. Pick your name once; update your details any time from **Stats → Edit my details**.

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
for the team password, which is `TEAM_KEY` in `src/lib/identity.js`.

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with oxlint |

> [!WARNING]
> **Local development uses the live database.** There is no staging environment,
> so anything you do in `npm run dev`, such as setting availability, changes real
> team data. Captain actions still require the password.

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
    ├── practice.js      Practice capacity, sign-up order, waitlist
    ├── courts.js        Seattle's public court list (city GIS) and booking links
    ├── sun.js           Seattle sunset times, for "will we need lights"
    ├── identity.js      Team password, player identity, captain password
    ├── nav.js           Tab order, used for page-slide direction
    └── supabase.js      Supabase client

supabase-setup.sql       Schema, row-level security, captain functions
netlify.toml             Build settings and SPA redirect
.env.example             The Supabase settings needed to run locally (no values)
```

## How it works

### Access

There are no user accounts, just three layers:

| Layer | What it does | Where it lives |
|---|---|---|
| **Team password** | Keeps out anyone who stumbles on the URL. Client-side only, by design. A link ending in `?key=<password>` unlocks the app and then removes the key from the address bar. | `TEAM_KEY` in `src/lib/identity.js` |
| **Player identity** | Each player picks their name once, and the device remembers it. | `localStorage` |
| **Captain password** | Required for every lineup, result, and match edit. Checked inside Postgres against a SHA-256 hash that the browser can never read. | `usta_config` table and the `usta_*` database functions |

Anyone with the link can set availability. That's deliberate, so nobody needs a login.

### Data

Everything lives in Supabase, in tables prefixed `usta_`.

| Table | Contents |
|---|---|
| `usta_players` | Roster: USTA name, preferred name, gender, NTRP, USTA number, phone, Venmo, captain flag |
| `usta_matches` | Each match: time, home/away, opponent, site, team note, whether the lineup is posted |
| `usta_availability` | One row per player per match: `available`, `maybe`, or `out` |
| `usta_lineups` | One row per match per court: the pair, `won`, and `score` |
| `usta_practices` | Practices: time, length, site, courts booked, note, cancelled |
| `usta_practice_signups` | One row per player per practice: `in` or `out`; `updated_at` is their place in line |
| `usta_court_reports` | Teammates' "lights worked / lights out" reports, by city court name |
| `usta_config` | The captain password hash (no browser access) |

- **Every statistic comes from `usta_lineups`**: play counts, records, partnerships,
  and court history. Entering scores after each match is the only upkeep. A lineup
  counts toward play totals once the match starts or the lineup is posted; a draft
  for a future match doesn't.
- **Changes sync live.** Availability, lineups, and match edits update on every open
  phone through Supabase Realtime.
- **Names:** `usta_players.name` is the official USTA roster name. The app shows
  `preferred_name` when one is set, through `displayName()` in `src/components/ui.jsx`.

### Practices and courts

- **Anyone can post; the poster or a captain can change it.** The database
  checks this (`usta_can_edit_practice`), using the name picked on the device,
  the same trust model as availability.
- **Share** opens WhatsApp (`wa.me`) with the message filled in; you pick the
  group. The sign-up link includes the team password and opens that practice.
- **Capacity is four per booked court.** Sign-ups beyond that go on a waitlist in
  the order people tapped *I'm in*.
- **The court list comes straight from Seattle Parks' GIS layer**
  (`Tennis_Courts` on services.arcgis.com, refreshed weekly by the city). Its
  `LIGHTS` field says which sites have lights. Nothing official says whether the
  lights are *working*, so teammates report that from the court finder.
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
lives in `usta_player_ratings`, a table the browser cannot read at all. Once
captain tools are unlocked, the app fetches it through the password-checked
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

**Captain tools.** Players marked as captains on the roster see the Captain tab
and are unlocked automatically: the captain password comes from
`VITE_CAPTAIN_PASS` in `.env.local` and is still verified server-side, so if
the password ever changes without updating that file, the app simply asks for
it. **Lock captain tools** on the Stats tab turns that off for a device until
you unlock again. Anyone else can unlock from Stats → **Captain tools** by
entering the password.

**Reschedule a match.** Captain → the match → **Match details → Edit** lets you
change the date, site, and team note. No deploy needed.

**Add a player.** Captain → **Roster → Add player**: name, woman/man, NTRP,
USTA number, phone. Everyone's roster updates immediately (it goes through the
password-checked `usta_upsert_player` function). A name already on the roster
is refused.

**Set up practices (once).** Run section 6 of `supabase-setup.sql` in the
Supabase SQL editor. It's safe to re-run. Until then the Practice tab says the
setup is missing; the court finder still works.

**Change the captain password.** Run this in the Supabase SQL editor, then put
the new value in `.env.local` and redeploy so captains stay auto-unlocked.

```sql
select public.usta_set_captain_pass('current-password', 'new-password');
```

**Change the team password.** Edit `TEAM_KEY` in `src/lib/identity.js` (keep it
lowercase), then deploy.

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
  home screen are exempt). A player who hasn't opened the app in a while may see the
  password and name screens again. Sending the `?key=` link makes that painless.
- **The splash animation plays once per browser session** and waits for data (up to
  4.5 seconds). Open a new tab or run `sessionStorage.clear()` to see it again. Its
  animation steps share one timing, so retime them together.
- **Motion is turned off** for anyone with *Reduce motion* enabled, splash included.
- **Phone and Venmo edits need the captain password.** Players can change their
  preferred name and gender freely; contact details are read-only unless the
  device has captain tools unlocked, and the database refuses the change without
  the password either way (`usta_update_profile`).
