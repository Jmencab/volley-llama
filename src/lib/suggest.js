// A first-draft lineup the captain can accept or tweak. Three questions, in
// order of how much they matter:
//   legal      — USTA 6.0 mixed: no court may total more than 6.0 NTRP, so an
//                over-cap pair is never seated, even if a court has to stay open;
//   who plays  — yeses before maybes, then whoever has the fewest other chances
//                this season and the fewest matches played (balance);
//   where      — winning pairs stay together, a win moves you up a court and a
//                loss moves you down, and stronger pairs (by doubles UTR) take
//                the lower-numbered courts. NTRP only breaks ties when a player
//                has no UTR.
// Nothing here is saved; the result lands in the draft for the captain to review.

import { MAX_PAIR_NTRP, fmtNtrp, pairNtrp, pairOverCap } from './rules.js'

const COURTS = [1, 2, 3]
const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
const EPS = 1e-9

// Every k-element subset in index order, so the first one is always the top k.
function subsets(arr, k) {
  const out = []
  const walk = (start, acc) => {
    if (acc.length === k) return void out.push(acc)
    for (let i = start; i <= arr.length - (k - acc.length); i++) walk(i + 1, [...acc, arr[i]])
  }
  walk(0, [])
  return out
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
}

// A doubles UTR the suggester can trust: the published number pulled toward the
// team median for that gender in proportion to how unreliable UTR says it is
// (a 24%-reliable 3.07 is mostly guesswork). null when the player has no UTR.
export function utrStrength(rating, genderMedian) {
  const utr = Number(rating?.utr_doubles)
  if (!Number.isFinite(utr) || utr <= 0) return null
  const rel = Math.min(100, Math.max(0, Number(rating?.utr_doubles_rel ?? 100))) / 100
  const anchor = genderMedian ?? utr
  return rel * utr + (1 - rel) * anchor
}

// Where a player's recent results say they belong, most recent weighted most.
// Only decided matches count — a posted-but-unplayed lineup is the captain's
// plan, not form. Nobody with history sits in the middle at 2.
export function courtLevel(plays, matchId) {
  const recent = plays
    .filter((p) => p.matchId !== matchId && p.won != null)
    .sort((a, b) => b.matchNo - a.matchNo)
    .slice(0, 3)
  if (recent.length === 0) return 2
  let sum = 0, wsum = 0
  recent.forEach((p, i) => {
    const w = 3 - i
    const target = p.won === true ? Math.max(1, p.court - 1) : p.won === false ? Math.min(3, p.court + 1) : p.court
    sum += target * w
    wsum += w
  })
  return sum / wsum
}

export function suggestLineup({ matchId, players, statusOf, stats, elsewhere, nameOf, utrOf = () => null }) {
  const first = (p) => nameOf(p.id).split(' ')[0]
  const names = (ps) => ps.map((p) => nameOf(p.id)).join(', ')
  const cap = fmtNtrp(MAX_PAIR_NTRP)

  // lower = plays first
  const priority = (p) =>
    (statusOf(p.id) === 'maybe' ? 100 : 0) +
    stats.playedExcept(p.id, matchId) +
    elsewhere(p.id).available * 0.75

  // Eligible players, best first. A hair of rank rides along in the cost so a
  // tie in priority always breaks the same way this ordering does (by name).
  const pool = (g) =>
    players
      .filter((p) => p.gender === g && (statusOf(p.id) === 'available' || statusOf(p.id) === 'maybe'))
      .map((p) => ({ p, pri: priority(p) }))
      .sort((a, b) => a.pri - b.pri || nameOf(a.p.id).localeCompare(nameOf(b.p.id)))
      .map((x, rank) => ({ p: x.p, cost: x.pri + rank * 1e-6 }))
  const men = pool('M')
  const women = pool('F')

  // The median is taken over the whole roster of that gender, so it doesn't
  // swing with who happens to be available this week.
  const genderMedian = (g) =>
    median(players.filter((p) => p.gender === g).map((p) => Number(utrOf(p.id)?.utr_doubles)).filter((x) => Number.isFinite(x) && x > 0))
  const medians = { M: genderMedian('M'), F: genderMedian('F') }
  const strengths = new Map()
  const strength = (p) => {
    if (!strengths.has(p.id)) strengths.set(p.id, utrStrength(utrOf(p.id), medians[p.gender]))
    return strengths.get(p.id)
  }

  const levels = new Map()
  const level = (p) => {
    if (!levels.has(p.id)) levels.set(p.id, courtLevel(stats.forPlayer(p.id).plays, matchId))
    return levels.get(p.id)
  }
  const rating = (p) => Number(p.ntrp) || 3.0 // unknown rating = neutral
  // A one-point gap in a pair's combined UTR, moved from D1 to D3, costs about as
  // much as one player sitting a court away from their form — UTR is the
  // stronger signal, so it should be able to override a mild form mismatch.
  const UTR_PULL = 0.5
  // small enough that any real result outweighs it (form steps are >= 1/6)
  const RATING_PULL = 0.05
  const pairScores = new Map()
  const pairScore = (m, w) => {
    const key = `${m.id}|${w.id}`
    if (!pairScores.has(key)) {
      const pr = stats.pairOfExcept(m.id, w.id, matchId)
      // net wins keep a pair together; a familiar pair gets a nudge
      pairScores.set(key, pr ? (pr.wins - pr.losses) * 2 + 0.25 : 0)
    }
    return pairScores.get(key)
  }
  // With a UTR for both, the court-order pull comes from it; otherwise fall
  // back to the faint NTRP pull so an unrated player still slots sensibly.
  const courtPull = (court, m, w) => {
    const sm = strength(m), sw = strength(w)
    if (sm != null && sw != null) return UTR_PULL * court * (sm + sw)
    return RATING_PULL * court * (rating(m) + rating(w))
  }

  // Try every choice of up to three men and three women, every way to pair them
  // and every way to seat the pairs. Best means, in order: the most courts filled
  // with legal pairs, then the players who most need to play, then the seating
  // that best fits partnerships, form and strength. A team roster is small
  // enough that brute force is instant.
  const kM = Math.min(3, men.length)
  const kW = Math.min(3, women.length)
  const beats = (a, b) =>
    !b ||
    (a.filled !== b.filled ? a.filled > b.filled
      : Math.abs(a.cost - b.cost) > EPS ? a.cost < b.cost
      : a.score > b.score + EPS)

  let best = null
  for (const ms of subsets(men, kM)) {
    for (const ws of subsets(women, kW)) {
      for (const wp of PERMS) {
        const pairs = ms.map((m, i) => [m, ws[wp[i]]]).filter(([m, w]) => m && w && !pairOverCap(m.p, w.p))
        const cost = pairs.reduce((sum, [m, w]) => sum + m.cost + w.cost, 0)
        if (best && !beats({ filled: pairs.length, cost, score: Infinity }, best)) continue
        for (const cp of PERMS) {
          // a short lineup fills from D1 down, so any open court is at the bottom
          if (pairs.some((_, i) => cp[i] >= pairs.length)) continue
          const seated = pairs.map(([m, w], i) => ({ court: COURTS[cp[i]], m: m.p, w: w.p }))
          let score = 0
          for (const s of seated) {
            score += pairScore(s.m, s.w)
            score -= Math.abs(level(s.m) - s.court) + Math.abs(level(s.w) - s.court)
            score -= courtPull(s.court, s.m, s.w) // stronger pairs drift toward D1
          }
          const cand = { filled: pairs.length, cost, score, seated }
          if (beats(cand, best)) best = cand
        }
      }
    }
  }

  const seated = best?.seated || []
  const seatedPlayers = seated.flatMap((s) => [s.m, s.w])
  const isSeated = new Set(seatedPlayers.map((p) => p.id))
  const byCourt = new Map(seated.map((s) => [s.court, s]))

  const warnings = []
  const maybes = seatedPlayers.filter((p) => statusOf(p.id) === 'maybe')
  if (maybes.length) warnings.push(`Not enough yeses — includes ${names(maybes)} (maybe)`)
  if (men.length < 3) warnings.push(`Only ${men.length} ${men.length === 1 ? 'man' : 'men'} to pick from`)
  if (women.length < 3) warnings.push(`Only ${women.length} ${women.length === 1 ? 'woman' : 'women'} to pick from`)

  // Without the cap the top n on each side would simply play, so anyone who
  // differs from that was moved to keep every court legal.
  const n = Math.min(kM, kW)
  const top = [...men.slice(0, n), ...women.slice(0, n)].map((x) => x.p)
  const benched = top.filter((p) => !isSeated.has(p.id))
  const subbedIn = seatedPlayers.filter((p) => !top.includes(p))
  const verb = (ps, one, many) => (ps.length === 1 ? one : many)
  if (benched.length) {
    warnings.push(
      `To stay at ${cap} or under: ${names(benched)} ${verb(benched, 'sits', 'sit')} out` +
      (subbedIn.length ? `, ${names(subbedIn)} ${verb(subbedIn, 'plays', 'play')} instead` : ''),
    )
  }
  const capOpen = COURTS.slice(seated.length, n)
  if (capOpen.length) {
    warnings.push(`${capOpen.map((c) => `D${c}`).join(', ')} left open — nobody else available pairs up at ${cap} or under`)
  }

  const lastResult = (p) =>
    stats.forPlayer(p.id).plays
      .filter((x) => x.matchId !== matchId && x.won != null)
      .sort((a, b) => b.matchNo - a.matchNo)[0]
  const formNote = (p) => {
    const lp = lastResult(p)
    return lp ? `${first(p)} ${lp.won ? 'won' : 'lost'} at D${lp.court} last time` : null
  }
  const balanceNote = (p) => {
    const e = elsewhere(p.id)
    if (e.available === 0) return `${first(p)} can't make any other match`
    if (e.available === 1) return `${first(p)} can only make 1 other match`
    return null
  }
  const utrNote = (p) => {
    const r = utrOf(p.id)
    const utr = Number(r?.utr_doubles)
    if (!Number.isFinite(utr) || utr <= 0) return null
    const rel = Number(r?.utr_doubles_rel ?? 100)
    return `${first(p)} UTR ${utr.toFixed(2)}${rel < 90 ? ` (${rel}% reliable)` : ''}`
  }

  const courts = COURTS.map((court) => {
    const s = byCourt.get(court)
    return { court, player1_id: s?.m.id || null, player2_id: s?.w.id || null }
  })
  const reasons = COURTS.map((court) => {
    const s = byCourt.get(court)
    if (!s) return `D${court}: open`
    const bits = []
    const pr = stats.pairOfExcept(s.m.id, s.w.id, matchId)
    if (pr && pr.wins + pr.losses > 0) bits.push(`${pr.wins}-${pr.losses} together`)
    else if (pr) bits.push(`played together ${pr.count}×`)
    for (const p of [s.m, s.w]) {
      const f = formNote(p)
      if (f) bits.push(f)
      const u = utrNote(p)
      if (u) bits.push(u)
      else if (p.ntrp) bits.push(`${first(p)} is a ${fmtNtrp(p.ntrp)}`)
      const b = balanceNote(p)
      if (b) bits.push(b)
    }
    const total = pairNtrp(s.m, s.w)
    const sm = strength(s.m), sw = strength(s.w)
    const utrSum = sm != null && sw != null ? ` · UTR ${(sm + sw).toFixed(1)}` : ''
    return `D${court}: ${nameOf(s.m.id)} + ${nameOf(s.w.id)}` +
      (total != null ? ` (${fmtNtrp(total)}${utrSum})` : '') +
      (bits.length ? ' — ' + bits.join('; ') : '')
  })

  return { courts, reasons, warnings }
}
