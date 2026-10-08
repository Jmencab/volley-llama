import { useEffect, useMemo, useState } from 'react'
import { AREAS, AVAILABILITY_DASHBOARD, bookingUrl, latestReports, loadCourts, milesBetween } from '../lib/courts'
import { monthDay } from '../lib/dates'
import { Sheet, displayName, firstName, mapsUrl } from './ui'

// Seattle's public courts, filtered to the ones worth driving to for an evening
// session. "Has lights" is the city's data; "lights worked" is ours — whoever
// played there last says so, because nothing official tracks broken lights.
export default function CourtFinder({ reports, players, onReport, onUse }) {
  const [courts, setCourts] = useState(null)
  const [err, setErr] = useState('')
  const [lightsOnly, setLightsOnly] = useState(true)
  const [area, setArea] = useState('all')
  const [here, setHere] = useState(null)
  const [locating, setLocating] = useState(false)
  const [reporting, setReporting] = useState(null)

  useEffect(() => {
    let live = true
    loadCourts().then((c) => live && setCourts(c)).catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [])

  const latest = useMemo(() => latestReports(reports), [reports])

  const shown = useMemo(() => {
    if (!courts) return []
    const list = courts
      .filter((c) => !lightsOnly || c.lights)
      .filter((c) => area === 'all' || c.area === area)
      .map((c) => ({ ...c, miles: here ? milesBetween(here, c) : null }))
    return here ? list.sort((a, b) => a.miles - b.miles) : list
  }, [courts, lightsOnly, area, here])

  const nearMe = () => {
    if (here) { setHere(null); return }
    if (!navigator.geolocation) { setErr("This browser can't share your location"); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => { setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false) },
      () => { setErr('Location was blocked — sorting by name instead'); setLocating(false) },
      { maximumAge: 600000, timeout: 10000 },
    )
  }

  const nameOf = (id) => firstName(displayName(players.find((p) => p.id === id))) || 'someone'

  return (
    <>
      <div className="row finder-filters">
        <button className={`chip ${lightsOnly ? 'accent' : ''}`} aria-pressed={lightsOnly}
                onClick={() => setLightsOnly((v) => !v)}>
          💡 Lights only
        </button>
        <button className={`chip ${here ? 'accent' : ''}`} aria-pressed={!!here} onClick={nearMe} disabled={locating}>
          {locating ? 'Locating…' : '📍 Near me'}
        </button>
        <select className="finder-area" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
          <option value="all">All of Seattle</option>
          {Object.entries(AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {err && <div className="notice warn mt">{err}</div>}
      {!courts && !err && <p className="tiny mt">Loading the city's court list…</p>}

      {courts && (
        <div className="stack mt">
          {shown.length === 0 && <div className="notice info">No courts match. Try another area.</div>}
          {shown.map((c) => {
            const r = latest[c.name]
            return (
              <div key={c.name} className="card" style={{ padding: 12 }}>
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div style={{ fontWeight: 800 }}>{c.name}</div>
                    <div className="tiny">
                      {AREAS[c.area]} · {c.count} {c.count === 1 ? 'court' : 'courts'}
                      {c.miles != null && ` · ${c.miles.toFixed(1)} mi`}
                    </div>
                  </div>
                  {c.lights ? <span className="chip accent">💡 Lights</span> : <span className="chip">No lights</span>}
                </div>

                {c.lights && (
                  <div className={`tiny lights-report ${r ? (r.lights_ok ? 'ok' : 'bad') : ''}`}>
                    {r
                      ? `${r.lights_ok ? '✓ Lights worked' : '✗ Lights out'} ${monthDay(new Date(r.reported_at))} · ${nameOf(r.player_id)}`
                      : 'No one has reported on the lights yet'}
                  </div>
                )}

                <div className="row finder-actions">
                  <a className="btn sm ghost" href={mapsUrl(`${c.name}, ${c.address}`)} target="_blank" rel="noreferrer">Map</a>
                  <a className="btn sm ghost" href={bookingUrl(c.name)} target="_blank" rel="noreferrer">Book</a>
                  {c.lights && <button className="btn sm ghost" onClick={() => setReporting(c)}>Report lights</button>}
                  {onUse && <button className="btn sm" onClick={() => onUse(c)}>Use</button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="tiny mt">
        Open court times are on the{' '}
        <a href={AVAILABILITY_DASHBOARD} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
          city's availability dashboard
        </a>. Book at least 24 hours ahead (no same-day bookings); drop-in is free on any unreserved court.
      </p>

      {reporting && (
        <Sheet title="How were the lights?" onClose={() => setReporting(null)}>
          <p className="sub" style={{ marginTop: 0 }}>{reporting.name}</p>
          <div className="picker" style={{ gridTemplateColumns: '1fr 1fr' }}>
            {[[true, '💡', 'They worked'], [false, '🌑', 'They were out']].map(([ok, glyph, label]) => (
              <button key={label} className={`pick ${ok ? 'available' : 'out'}`}
                      onClick={async () => {
                        try { await onReport(reporting.name, ok); setReporting(null) }
                        catch (e) { setErr(e.message); setReporting(null) }
                      }}>
                <span className="glyph">{glyph}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}
