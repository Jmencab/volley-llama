import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTeam, useNow } from '../lib/store'
import { teamLink } from '../lib/identity'
import { DateChip, NameTip, Sheet, Toast, copyText, displayName, firstName, mapsUrl } from '../components/ui'
import CourtFinder from '../components/CourtFinder'
import { dayName, monthDay, pacificOffset, relativeShort, timeOf, timeRange, toLocalInput } from '../lib/dates'
import { minutesAfterSunset, sunsetOn } from '../lib/sun'
import { loadCourts } from '../lib/courts'
import { PER_COURT, headcount, isPastPractice, practiceEnd, practiceRoster, practiceStart } from '../lib/practice'

export default function Practice() {
  const {
    practices, signups, courtReports, practiceError, players, me, isCaptain,
    setSignup, reportLights, savePractice, cancelPractice, deletePractice,
  } = useTeam()
  const now = useNow()
  const [editing, setEditing] = useState(null) // {} for new, a practice to edit
  const [sharingId, setSharingId] = useState(null)
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

  // A shared link (/practice?p=<id>) lands on that practice, highlighted.
  const [params] = useSearchParams()
  const linked = params.get('p')
  useEffect(() => {
    if (!linked || !practices.some((p) => p.id === linked)) return
    // after the shell's scroll-to-top on navigation
    const t = setTimeout(() => {
      document.getElementById(`practice-${linked}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 350)
    return () => clearTimeout(t)
  }, [linked, practices])

  const upcoming = practices.filter((p) => !isPastPractice(p, now))
  const nameOf = (id) => displayName(players.find((p) => p.id === id)) || '—'
  const courtFor = (p) => courts.find((c) => sameSite(c.name, p.site))
  const sharing = practices.find((p) => p.id === sharingId)

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <div className="eyebrow">Between matches</div>
          <h1 className="h1">Practice</h1>
        </div>
        {!practiceError && (
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
            Tap New practice to put one up and share it on WhatsApp, or find a court below.
          </p>
        </div>
      ) : (
        <div className="stack stagger">
          {upcoming.map((p) => (
            <PracticeCard
              key={p.id} practice={p} now={now} me={me} nameOf={nameOf}
              roster={practiceRoster(p, signups)}
              court={courtFor(p)}
              highlight={p.id === linked}
              canEdit={isCaptain || p.created_by === me.id}
              postedBy={p.created_by && p.created_by !== me.id ? firstName(nameOf(p.created_by)) : null}
              onSignup={(status) => setSignup(p.id, me.id, status)}
              onEdit={() => setEditing(p)}
              onShare={() => setSharingId(p.id)}
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
        onUse={!practiceError ? (c) => setEditing({ site: c.name }) : null}
      />

      {editing && (
        <PracticeSheet
          practice={editing} courts={courts}
          onClose={() => setEditing(null)}
          onSave={async (fields) => {
            const id = await savePractice(editing.id || null, fields)
            setEditing(null)
            // a new practice goes straight to the share step
            if (editing.id) setToast('Practice updated')
            else setSharingId(id)
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

      {sharing && (
        <ShareSheet practice={sharing} court={courtFor(sharing)} roster={practiceRoster(sharing, signups)}
                    nameOf={nameOf} onClose={() => setSharingId(null)} setToast={setToast} />
      )}

      <Toast>{toast}</Toast>
    </div>
  )
}

// People type the site freely, so "Jefferson Park" and "jefferson park courts"
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

function PracticeCard({ practice: p, now, me, roster, court, nameOf, highlight, canEdit, postedBy, onSignup, onEdit, onShare }) {
  const start = practiceStart(p)
  const end = practiceEnd(p)
  const mine = roster.playing.includes(me.id) ? 'in'
    : roster.out.includes(me.id) ? 'out' : null
  const sky = lightsNote(start, end, court)
  const { count, suggest } = headcount(p, roster.playing.length)

  return (
    <div id={`practice-${p.id}`} className={`card mcard ${p.cancelled ? 'done' : ''} ${highlight ? 'linked' : ''}`}>
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
                : null}
            </div>
            <a className="mrow-site truncate" style={{ display: 'block' }} href={mapsUrl(p.site)} target="_blank" rel="noreferrer">
              📍 {p.site}
            </a>
            <div className="mrow-opp">
              {p.courts ? `${p.courts} ${p.courts === 1 ? 'court' : 'courts'} · ` : ''}
              <NameTip names={roster.playing.map(nameOf)}><span>{count}</span></NameTip>
            </div>
            {suggest && !p.cancelled && <div className="tiny" style={{ color: 'var(--maybe)' }}>{suggest}</div>}
          </div>
        </div>

        {!p.cancelled && <div className={`tiny lights-report ${sky.level}`}>{sky.text}</div>}
        {p.notes && <div className="tiny" style={{ marginTop: 6, color: 'var(--text)' }}>{p.notes}</div>}
        {postedBy && <div className="tiny" style={{ marginTop: 6 }}>Posted by {postedBy}</div>}
      </div>

      {!p.cancelled && (
        <div className="quickpick" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button className={`qp available ${mine === 'in' ? 'on' : ''}`}
                  aria-pressed={mine === 'in'} onClick={() => onSignup('in')}>
            <span className="glyph">🎾</span><span>I'm in</span>
          </button>
          <button className={`qp out ${mine === 'out' ? 'on' : ''}`} aria-pressed={mine === 'out'} onClick={() => onSignup('out')}>
            <span className="glyph">🙅</span><span>Can't make it</span>
          </button>
        </div>
      )}

      <div className="row" style={{ gap: 6, padding: '0 10px 10px' }}>
        <button className="btn sm ghost grow" onClick={onShare}>Share</button>
        {canEdit && <button className="btn sm ghost grow" onClick={onEdit}>Edit</button>}
      </div>
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
            Ideal is {PER_COURT} per court ({count * PER_COURT} players). No limit; the app suggests another court if more sign up.
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

// WhatsApp renders *text* as bold. Everything a teammate needs to decide and
// show up: when, where (with a map), whether it'll be dark, and the sign-up link.
function shareText(p, court, roster, nameOf) {
  const start = practiceStart(p)
  const end = practiceEnd(p)
  const when = `${dayName(start)} ${monthDay(start)}, ${timeRange(start, end)}`
  if (p.cancelled) return `\u274C *Practice cancelled*: ${when} at ${p.site}`

  const where = court?.address ? `${p.site}, ${court.address}` : p.site
  const dark = minutesAfterSunset(start, end)
  const lights = !dark ? null
    : court?.lights ? `\u{1F4A1} Lit courts (sunset ${timeOf(sunsetOn(start))})`
    : court ? `\u{1F311} Heads up: no lights here, sunset ${timeOf(sunsetOn(start))}`
    : `\u{1F319} Sunset ${timeOf(sunsetOn(start))}`
  const hc = headcount(p, roster.playing.length)
  const inSoFar = roster.playing.map((id) => firstName(nameOf(id)))

  return [
    `\u{1F3BE} *Practice: ${when}*`,
    `\u{1F4CD} ${where}${p.courts ? ` (${p.courts} ${p.courts === 1 ? 'court' : 'courts'})` : ''}`,
    mapsUrl(where),
    lights,
    p.notes ? `\u{1F4DD} ${p.notes}` : null,
    '',
    inSoFar.length ? `In so far: ${inSoFar.join(', ')}` : null,
    [hc.count, hc.suggest].filter(Boolean).join('. '),
    `Sign up: ${teamLink(`/practice?p=${p.id}`)}`,
  ].filter((line) => line !== null).join('\n')
}

function ShareSheet({ practice, court, roster, nameOf, onClose, setToast }) {
  const text = shareText(practice, court, roster, nameOf)
  const selectAll = (e) => e.target.select()

  return (
    <Sheet title="Share with the team" onClose={onClose}>
      <textarea readOnly rows={8} value={text} onFocus={selectAll} onClick={selectAll} />
      {/* wa.me opens the WhatsApp app (or WhatsApp Web) with the message filled in; you pick the group */}
      <a className="btn primary wide mt" href={`https://wa.me/?text=${encodeURIComponent(text)}`}
         target="_blank" rel="noreferrer" onClick={() => setTimeout(onClose, 300)}>
        Send on WhatsApp
      </a>
      <button className="btn wide ghost mt" onClick={async () => {
        const ok = await copyText(text)
        setToast(ok ? 'Copied' : "Couldn't copy — select the text and copy it by hand")
        if (ok) onClose()
      }}>Copy text instead</button>
    </Sheet>
  )
}
