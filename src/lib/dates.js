const TZ = 'America/Los_Angeles'

const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts })

export const dayName = (d) => fmt({ weekday: 'short' }).format(d)
export const dayNameLong = (d) => fmt({ weekday: 'long' }).format(d)
export const monthDay = (d) => fmt({ month: 'short', day: 'numeric' }).format(d)
export const timeOf = (d) =>
  fmt({ hour: 'numeric', minute: '2-digit' }).format(d).replace(':00', '').toLowerCase().replace(' ', '')

export const fullDate = (d) => `${dayNameLong(d)}, ${fmt({ month: 'long', day: 'numeric' }).format(d)}`

const DAY = 86400000

// Calendar-day difference in the team's timezone, so "today" flips at midnight
// in Seattle rather than 24h from now.
const localDayStart = (d) => {
  const p = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const g = (t) => p.find((x) => x.type === t).value
  return Date.UTC(+g('year'), +g('month') - 1, +g('day'))
}

export const daysUntil = (d, now = new Date()) =>
  Math.round((localDayStart(d) - localDayStart(now)) / DAY)

// Compact countdown for list rows, where the full phrase gets truncated.
export const relativeShort = (d, now = new Date()) => {
  const n = daysUntil(d, now)
  if (n === 0) return 'today'
  if (n === 1) return 'tmrw'
  if (n < 0) return `${-n}d ago`
  if (n < 14) return `in ${n}d`
  return `in ${Math.round(n / 7)}w`
}

export const relativeDay = (d, now = new Date()) => {
  const n = daysUntil(d, now)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n < 0) return `${-n} days ago`
  if (n < 7) return `In ${n} days`
  if (n < 14) return 'Next week'
  return `In ${Math.round(n / 7)} weeks`
}

// One rule for "has this match happened yet", used by every screen so they can
// never disagree. A match is upcoming until its start time, "live" while it's
// being played, and past once that window closes.
export const MATCH_RUNTIME_MS = 3 * 60 * 60 * 1000

export const matchPhase = (match, now = new Date()) => {
  const start = new Date(match.starts_at).getTime()
  const t = now.getTime()
  if (t < start) return 'upcoming'
  if (t < start + MATCH_RUNTIME_MS) return 'live'
  return 'past'
}

export const isPastMatch = (match, now = new Date()) => matchPhase(match, now) === 'past'
export const isLiveMatch = (match, now = new Date()) => matchPhase(match, now) === 'live'

// Naive local-time string for a datetime-local input, in the team's timezone.
export const toLocalInput = (d) => {
  const p = fmt({
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t) => p.find((x) => x.type === t).value
  return `${g('year')}-${g('month')}-${g('day')}T${(g('hour') === '24' ? '00' : g('hour'))}:${g('minute')}`
}

// Pacific offset for a given date, so a rescheduled match keeps the right wall clock.
export const pacificOffset = (d) => {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
    .formatToParts(d).find((x) => x.type === 'timeZoneName').value
  const m = s.match(/GMT([+-]\d+)/)
  const h = m ? parseInt(m[1], 10) : -8
  return `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`
}

// [year, month (1-12), day] of the Pacific calendar day containing d.
export const pacificYmd = (d) => {
  const p = fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const g = (t) => +p.find((x) => x.type === t).value
  return [g('year'), g('month'), g('day')]
}

// "6–7:30pm", or "11:30am–1pm" when it crosses noon.
export const timeRange = (start, end) => {
  const a = timeOf(start)
  const b = timeOf(end)
  const sameHalf = a.slice(-2) === b.slice(-2)
  return `${sameHalf ? a.slice(0, -2) : a}–${b}`
}
