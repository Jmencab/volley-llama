// Doubles: four players fill a court. Not a limit (everyone who says yes is
// in), just the number that tells you when it's worth booking another court.
export const PER_COURT = 4

export const practiceStart = (p) => new Date(p.starts_at)
export const practiceEnd = (p) => new Date(new Date(p.starts_at).getTime() + p.minutes * 60000)
export const isPastPractice = (p, now = new Date()) => practiceEnd(p) <= now

// Who's in and who's out, in the order they answered.
export function practiceRoster(practice, signups) {
  const rows = signups
    .filter((s) => s.practice_id === practice.id)
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
  return {
    playing: rows.filter((s) => s.status === 'in').map((s) => s.player_id),
    out: rows.filter((s) => s.status === 'out').map((s) => s.player_id),
  }
}

const ordinal = (n) => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`

// "5/4 signed up" plus, once there are more players than booked courts can
// hold, a nudge: "Consider a 2nd court".
export function headcount(practice, n) {
  if (!practice.courts) return { count: `${n} signed up`, suggest: null }
  const need = Math.ceil(n / PER_COURT)
  const suggest = need <= practice.courts ? null
    : need === practice.courts + 1 ? `Consider a ${ordinal(need)} court`
    : `Enough for ${need} courts`
  return { count: `${n}/${practice.courts * PER_COURT} signed up`, suggest }
}
