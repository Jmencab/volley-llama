import { useEffect, useState } from 'react'
import { useTeam, useNow } from '../lib/store'
import { DateChip, NameTip, Sheet, Toast, copyText, displayName, firstName, mapsUrl } from '../components/ui'
import CourtFinder from '../components/CourtFinder'
import { dayName, monthDay, pacificOffset, relativeShort, timeOf, timeRange, toLocalInput } from '../lib/dates'
import { minutesAfterSunset, sunsetOn } from '../lib/sun'
import { loadCourts } from '../lib/courts'
import { PER_COURT, isPastPractice, practiceEnd, practiceRoster, practiceStart } from '../lib/practice'

export default function Practice() {
  const {
    practices, signups, courtReports, practiceError, players, me, isCaptain,
    setSignup, reportLights, savePractice, cancelPractice, deletePractice,
  } = useTeam()
  const now = useNow()
  const [editing, setEditing] = useState(null) // {} for new, a practice to edit
  const [texting, setTexting] = useState(null)
  const [toast, setToast] = useState('')
  const [courts, setCourts] = useState([])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // The court list tells each card whether its site has lights. A failed load
  // just means no lights warnings; the finder shows the error itself.
  useEffect(() => { loadCourts().then(setCourts).catch(() => {}) }, [])

  const upcoming = practices.filter((p) => !isPastPractice(p, now))
  const nameOf = (id) => displayName(players.find((p) => p.id === id)) || '—'

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <div className="eyebrow">Between matches</div>
          <h1 className="h1">Practice</h1>
        </div>
        {isCaptain && !practiceError && (
          <button className="btn sm primary" onClick={() => setEditing({})}>New practice</button>
        )}
      </div>

      {practiceError ? (
        <div className="notice warn">
          Practice sign-ups need a one-time database setup. A captain should run section 6 of{' '}
          <code>supabase-setup.sql</code> in the Supabase SQL editor.
        </div>
      ) : upcoming.length === 0 ? (
        <div className="card center">
          <div style={{ fontSize: 30 }}>🎾</div>
          <h2 className="h2 mt">Nothing on the calendar</h2>
          <p className="sub">
            {isCaptain ? 'Tap New practice to put one up, or find a court below.' : 'When a captain posts a practice, sign up here.'}
          </p>
        </div>
      ) : (
        <div className="stack stagger">
          {upcoming.map((p) => (
            <PracticeCard
              key={p.id} practice={p} now={now} me={me} nameOf={nameOf}
              roster={practiceRoster(p, signups)}
              court={courts.find((c) => sameSite(c.name, p.site))}
              isCaptain={isCaptain}
              onSignup={(status) => setSignup(p.id, me.id, status)}
              onEdit={() => setEditing(p)}
              onText={() => setTexting(p)}
            />
          ))}
        </div>
      )}

      <div className="section"><h2 className="h2">Find a court</h2></div>
      <CourtFinder
        reports={courtReports}
        players={players}
        onReport={async (court, ok) => {
          if (practiceError) throw new Error('Lights reports need the practice database setup first')
          await reportLights(court, ok, me.id)
          setToast('Thanks — the team will see it')
        }}
        onUse={isCaptain && !practiceError ? (c) => setEditing({ site: c.name }) : null}
      />

      {editing && (
        <PracticeSheet
          practice={editing} courts={courts}
          onClose={() => setEditing(null)}
          onSave={async (fields) => {
            await savePractice(editing.id || null, fields)
            setEditing(null)
            setToast(editing.id ? 'Practice updated' : 'Practice posted — send the group text')
          }}
          onCancel={editing.id ? async () => {
            await cancelPractice(editing.id, !editing.cancelled)
            setEditing(null)
            setToast(editing.cancelled ? 'Practice is back on' : 'Practice cancelled')
          } : null}
          onDelete={editing.id ? async () => {
            await deletePractice(editing.id)
            setEditing(null)
            setToast('Practice deleted')
          } : null}
        />
      )}

      {texting && (
        <TextSheet practice={texting} roster={practiceRoster(texting, signups)} nameOf={nameOf}
                   onClose={() => setTexting(null)} setToast={setToast} />
      )}

      <Toast>{toast}</Toast>
    </div>
  )
}

// Captains type the site freely, so "Jefferson Park" and "jefferson park courts"
// should both find the city's "Jefferson Park".
const norm = (s) => (s || '').toLowerCase().replace(/\(.*?\)|tennis|courts?|[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const sameSite = (cityName, site) => {
  const a = norm(cityName)
  const b = norm(site)
  return !!a && !!b && (a === b || b.startsWith(a) || a.startsWith(b))
}

// What the sky will be doing, and whether the site can handle it.
function lightsNote(start, end, court) {
  const dark = minutesAfterSunset(start, end)
  const set = timeOf(sunsetOn(start))
  if (!dark) return { level: 'ok', text: `☀️ Done before sunset (${set})` }
  if (court && !court.lights) return { level: 'bad', text: `🌑 Sunset is ${set} and ${court.name} has no lights` }
  if (court?.lights) return { level: 'ok', text: `💡 Under lights after sunset (${set})` }
  return { level: 'warn', text: `🌙 Sunset is ${set}; make sure this court has lights` }
}

function PracticeCard({ practice: p, now, me, roster, court, nameOf, isCaptain, onSignup, onEdit, onText }) {
  const start = practiceStart(p)
  const end = practiceEnd(p)
  const mine = roster.playing.includes(me.id) ? 'in'
    : roster.waitlist.includes(me.id) ? 'wait'
    : roster.out.includes(me.id) ? 'out' : null
  const left = roster.cap ? roster.cap - roster.playing.length : null
  const sky = lightsNote(start, end, court)

  const countLine = roster.cap
    ? left > 0 ? `${roster.playing.length} in · ${left} ${left === 1 ? 'spot' : 'spots'} left`
      : `Full${roster.waitlist.length ? ` · ${roster.waitlist.length} waiting` : ''}`
    : `${roster.playing.length} in`

  return (
    <div className={`card mcard ${p.cancelled ? 'done' : ''}`}>
      <div className="mrow-link">
        <div className="mrow">
          <DateChip date={start} />
          <div className="grow">
            <div className="spread" style={{ gap: 8 }}>
              <div className="mrow-when">
                <span className="mrow-time num">{timeRange(start, end)}</span>
                <span className="tiny">{relativeShort(start, now)}</span>
              </div>
              {p.cancelled ? <span className="chip out">Cancelled</span>
                : mine === 'in' ? <span className="chip available">You're in</span>
                : mine === 'wait' ? <span className="chip maybe">Waitlist</span>
                : null}
            </div>
            <a className="mrow-site truncate" style={{ display: 'block' }} href={mapsUrl(p.site)} target="_blank" rel="noreferrer">
              📍 {p.site}
            </a>
            <div className="mrow-opp">
              {p.courts ? `${p.courts} ${p.courts === 1 ? 'court' : 'courts'} · ` : ''}
              <NameTip names={roster.playing.map(nameOf)}><span>{countLine}</span></NameTip>
            </div>
          </div>
        </div>

        {!p.cancelled && <div className={`tiny lights-report ${sky.level}`}>{sky.text}</div>}
        {p.notes && <div className="tiny" style={{ marginTop: 6, color: 'var(--text)' }}>{p.notes}</div>}
        {roster.waitlist.length > 0 && (
          <div className="tiny" style={{ marginTop: 6 }}>Waitlist: {roster.waitlist.map((id) => firstName(nameOf(id))).join(', ')}</div>
        )}
      </div>

      {!p.cancelled && (
        <div className="quickpick" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button className={`qp available ${mine === 'in' || mine === 'wait' ? 'on' : ''}`}
                  aria-pressed={mine === 'in' || mine === 'wait'} onClick={() => onSignup('in')}>
            <span className="glyph">🎾</span><span>{left === 0 && mine !== 'in' && mine !== 'wait' ? 'Join waitlist' : "I'm in"}</span>
          </button>
          <button className={`qp out ${mine === 'out' ? 'on' : ''}`} aria-pressed={mine === 'out'} onClick={() => onSignup('out')}>
            <span className="glyph">🙅</span><span>Can't make it</span>
          </button>
        </div>
      )}

      {isCaptain && (
        <div className="row" style={{ gap: 6, padding: '0 10px 10px' }}>
          <button className="btn sm ghost grow" onClick={onText}>Group text</button>
          <button className="btn sm ghost grow" onClick={onEdit}>Edit</button>
        </div>
      )}
    </div>
  )
}

const LENGTHS = [[60, '1 hr'], [90, '1½ hr'], [120, '2 hr']]
const COURT_COUNTS = [1, 2, 3, 4]

// Default to tomorrow at 6pm, a typical after-work slot.
const defaultWhen = () => {
  const d = new Date(Date.now() + 86400000)
  return `${toLocalInput(d).slice(0, 10)}T18:00`
}

function PracticeSheet({ practice, courts, onClose, onSave, onCancel, onDelete }) {
  const [when, setWhen] = useState(() => practice.starts_at ? toLocalInput(new Date(practice.starts_at)) : defaultWhen())
  const [minutes, setMinutes] = useState(practice.minutes || 90)
  const [site, setSite] = useState(practice.site || '')
  const [count, setCount] = useState(practice.courts ?? 2)
  const [notes, setNotes] = useState(practice.notes || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const startsAt = when ? `${when}:00${pacificOffset(new Date(`${when}:00`))}` : null
  const start = startsAt ? new Date(startsAt) : null
  const court = courts.find((c) => sameSite(c.name, site))
  const sky = start && site.trim() ? lightsNote(start, new Date(start.getTime() + minutes * 60000), court) : null
  const lit = courts.filter((c) => c.lights)

  const run = async (fn) => {
    setBusy(true); setErr('')
    try { await fn() } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <Sheet title={practice.id ? 'Edit practice' : 'New practice'} onClose={onClose}>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault()
        run(() => onSave({ startsAt, minutes, site: site.trim(), courts: count, notes: notes.trim() }))
      }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Date & time (Pacific)</div>
          <input type="datetime-local" value={when} required onChange={(e) => setWhen(e.target.value)} />
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>How long</div>
          <div className="seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {LENGTHS.map(([m, label]) => (
              <button key={m} type="button" className={`seg-btn ${minutes === m ? 'on' : ''}`}
                      aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{label}</button>
            ))}
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Where</div>
          <input type="text" list="lit-courts" value={site} placeholder="Park name, e.g. Jefferson Park"
                 onChange={(e) => setSite(e.target.value)} />
          <datalist id="lit-courts">
            {lit.map((c) => <option key={c.name} value={c.name}>{c.count} lit courts</option>)}
          </datalist>
          {sky && <div className={`tiny lights-report ${sky.level}`}>{sky.text}</div>}
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Courts booked</div>
          <div className="seg" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {COURT_COUNTS.map((n) => (
              <button key={n} type="button" className={`seg-btn ${count === n ? 'on' : ''}`}
                      aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>
            ))}
          </div>
          <div className="tiny" style={{ marginTop: 6 }}>
            Sign-ups cap at {count * PER_COURT}; anyone after that goes on a waitlist.
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Note for the team</div>
          <input type="text" value={notes} placeholder="Drills then match play, bring water…"
                 onChange={(e) => setNotes(e.target.value)} />
        </div>

        {err && <div className="notice bad">{err}</div>}
        <button className="btn primary wide" disabled={busy || !when || !site.trim()}>
          {busy ? 'Saving…' : practice.id ? 'Save changes' : 'Post practice'}
        </button>

        {onCancel && (
          <button type="button" className="btn wide ghost" disabled={busy} onClick={() => run(onCancel)}>
            {practice.cancelled ? 'Un-cancel practice' : 'Cancel practice'}
          </button>
        )}
        {onDelete && (confirmDelete ? (
          <button type="button" className="btn wide" style={{ color: 'var(--out)' }} disabled={busy} onClick={() => run(onDelete)}>
            Really delete? Sign-ups go too
          </button>
        ) : (
          <button type="button" className="tiny" style={{ justifySelf: 'center' }} onClick={() => setConfirmDelete(true)}>
            Delete practice
          </button>
        ))}
      </form>
    </Sheet>
  )
}

function TextSheet({ practice: p, roster, nameOf, onClose, setToast }) {
  const start = practiceStart(p)
  const link = `${window.location.origin}/practice`
  const text = [
    p.cancelled
      ? `Practice ${dayName(start)} ${monthDay(start)} at ${p.site} is cancelled.`
      : `Practice ${dayName(start)} ${monthDay(start)}, ${timeRange(start, practiceEnd(p))} at ${p.site}` +
        (p.courts ? ` (${p.courts} ${p.courts === 1 ? 'court' : 'courts'})` : '') + '.',
    p.notes || null,
    !p.cancelled && roster.playing.length ? `In so far: ${roster.playing.map((id) => firstName(nameOf(id))).join(', ')}` : null,
    !p.cancelled ? `Sign up: ${link}` : null,
  ].filter(Boolean).join('\n')
  const selectAll = (e) => e.target.select()

  return (
    <Sheet title="Group text" onClose={onClose}>
      <textarea readOnly rows={5} value={text} onFocus={selectAll} onClick={selectAll} />
      <button className="btn primary wide mt" onClick={async () => {
        const ok = await copyText(text)
        setToast(ok ? 'Practice copied' : "Couldn't copy — select the text and copy it by hand")
        if (ok) onClose()
      }}>Copy to clipboard</button>
    </Sheet>
  )
}
