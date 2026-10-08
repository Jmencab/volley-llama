// Doubles: four players fill a court.
export const PER_COURT = 4

export const practiceStart = (p) => new Date(p.starts_at)
export const practiceEnd = (p) => new Date(new Date(p.starts_at).getTime() + p.minutes * 60000)
export const isPastPractice = (p, now = new Date()) => practiceEnd(p) <= now

export const capacity = (p) => (p.courts ? p.courts * PER_COURT : null)

// Who's playing, who's waiting, who's out. First to say "in" gets the spot, so a
// late yes on a full practice lands on the waitlist instead of bumping anyone.
export function practiceRoster(practice, signups) {
  const rows = signups.filter((s) => s.practice_id === practice.id)
  const yes = rows
    .filter((s) => s.status === 'in')
    .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
    .map((s) => s.player_id)
  const cap = capacity(practice)
  return {
    playing: cap ? yes.slice(0, cap) : yes,
    waitlist: cap ? yes.slice(cap) : [],
    out: rows.filter((s) => s.status === 'out').map((s) => s.player_id),
    cap,
  }
}
