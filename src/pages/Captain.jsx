import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTeam, useNow } from '../lib/store'
import { buildStats, recordShort } from '../lib/stats'
import { DateChip, NEED_PER_GENDER, Sheet, availableByGender, displayName } from '../components/ui'
import { monthDay, isPastMatch } from '../lib/dates'

export default function Captain() {
  const { matches, players, lineups, availOf, lineupFor, lockCaptain, addPlayer } = useTeam()
  const nav = useNavigate()
  const now = useNow()
  const stats = useMemo(() => buildStats({ matches, lineups, now }), [matches, lineups, now])
  const [adding, setAdding] = useState(false)

  const active = players.filter((p) => p.active)
  const upcoming = matches.filter((m) => !isPastMatch(m, now))
  const past = matches.filter((m) => isPastMatch(m, now)).reverse()

  // "7 available" hides the question that matters: enough of EACH gender?
  const splitFor = (m) => availableByGender(active, (id) => availOf(m.id, id))
  const G = ({ n, label }) => (
    <b style={{ color: n >= NEED_PER_GENDER ? 'var(--ok)' : 'var(--out)' }}>{n}{label}</b>
  )
  // "not enough" = the yeses alone can't fill three courts
  const shortfall = ({ women, men }) => {
    const parts = []
    const w = NEED_PER_GENDER - women
    const m = NEED_PER_GENDER - men
    if (w > 0) parts.push(`${w} ${w === 1 ? 'woman' : 'women'}`)
    if (m > 0) parts.push(`${m} ${m === 1 ? 'man' : 'men'}`)
    return parts.length ? `Short ${parts.join(' and ')}` : null
  }

  const balance = (gender) =>
    active
      .filter((p) => p.gender === gender)
      .map((p) => ({ p, s: stats.forPlayer(p.id) }))
      .sort((a, b) => a.s.count - b.s.count || a.p.name.localeCompare(b.p.name))

  const maxPlayed = Math.max(1, ...active.map((p) => stats.forPlayer(p.id).count))
  const pairs = stats.pairs.slice().sort((a, b) => b.count - a.count)
  const nameOf = (id) => displayName(players.find((p) => p.id === id)) || '—'

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <div className="eyebrow">Captain</div>
          <h1 className="h1">Set lineups</h1>
        </div>
        <button className="btn sm ghost" onClick={() => { lockCaptain(); nav('/') }}>Lock</button>
      </div>

      <div className="section"><h2 className="h2">Roster</h2></div>
      <button className="btn wide" onClick={() => setAdding(true)}>Add player</button>

      <div className="section"><h2 className="h2">Coming up</h2></div>
      <div className="stack stagger">
        {upcoming.map((m) => {
          const courts = lineupFor(m.id)
          const filled = courts.filter((c) => c.player1_id && c.player2_id).length
          const split = splitFor(m)
          const short = shortfall(split)
          // someone in a posted lineup who has since said they can't make it
          const dropouts = courts
            .flatMap((c) => [c.player1_id, c.player2_id])
            .filter((pid) => pid && availOf(m.id, pid) === 'out')
          return (
            <Link key={m.id} to={`/captain/${m.id}`} className="card tap" style={{ padding: 12 }}>
              <div className="mrow">
                <span className="mdate-wrap">
                  <DateChip date={new Date(m.starts_at)} />
                  {short && <span className="alert-dot" role="img" aria-label="Not enough players">!</span>}
                </span>
                <div className="grow">
                  <div className="truncate" style={{ fontWeight: 700 }}>vs {m.opponent}</div>
                  <div className="tiny">
                    <G n={split.women} label="W" /> · <G n={split.men} label="M" /> available · {filled}/3 set
                  </div>
                  {short && (
                    <div className="tiny" style={{ color: 'var(--out)', fontWeight: 700 }}>{short}</div>
                  )}
                  {dropouts.length > 0 && (
                    <div className="tiny" style={{ color: 'var(--out)', fontWeight: 700 }}>
                      {dropouts.length === 1 ? 'A player in this lineup' : `${dropouts.length} players in this lineup`} dropped out
                    </div>
                  )}
                </div>
                {m.lineup_published
                  ? <span className={`chip ${dropouts.length ? 'loss' : 'accent'}`}>{dropouts.length ? 'Needs a sub' : 'Posted'}</span>
                  : filled === 3 ? <span className="chip">Draft</span> : <span className="chip">Open</span>}
              </div>
            </Link>
          )
        })}
      </div>

      <div className="section">
        <h2 className="h2">Playing time</h2>
        <span className="tiny">fewest first</span>
      </div>
      <div className="card">
        <p className="tiny" style={{ marginTop: 0 }}>
          Counted separately: 3 of {active.filter((p) => p.gender === 'M').length} men and
          3 of {active.filter((p) => p.gender === 'F').length} women play each match.
        </p>
        {[['Women', 'F'], ['Men', 'M']].map(([label, g]) => (
          <div key={g} style={{ marginTop: 12 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
            {balance(g).map(({ p, s }) => (
              <div key={p.id} className="row" style={{ gap: 10, padding: '5px 0' }}>
                <div className="grow truncate" style={{ fontSize: 14 }}>{displayName(p)}</div>
                <div style={{ width: 90 }}>
                  <div className="bar">
                    <i style={{ width: `${(s.count / maxPlayed) * 100}%`, background: 'var(--accent-deep)' }} />
                  </div>
                </div>
                <div className="tiny num" style={{ width: 56, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {s.count}× · {recordShort(s.wins, s.losses)}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {pairs.length > 0 && (
        <>
          <div className="section"><h2 className="h2">Pairings used</h2></div>
          <div className="card" style={{ padding: 6 }}>
            {pairs.map((p) => (
              <div key={`${p.a}|${p.b}`} className="pickrow" style={{ paddingTop: 8, paddingBottom: 8 }}>
                <div className="grow" style={{ fontSize: 14 }}>{nameOf(p.a)} + {nameOf(p.b)}</div>
                <span className="tiny num" style={{ whiteSpace: 'nowrap' }}>{p.count}× · {recordShort(p.wins, p.losses)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <div className="section"><h2 className="h2">Enter results</h2></div>
          <div className="stack">
            {past.map((m) => {
              const r = stats.resultFor(m.id)
              return (
                <Link key={m.id} to={`/captain/${m.id}`} className="card tap" style={{ padding: 12 }}>
                  <div className="spread">
                    <div className="grow truncate">
                      <div style={{ fontWeight: 700 }}>vs {m.opponent}</div>
                      <div className="tiny">{monthDay(new Date(m.starts_at))}</div>
                    </div>
                    {r ? (
                      <span className={`chip ${r.teamWon === true ? 'win' : r.teamWon === false ? 'loss' : ''}`}>
                        {r.won}-{r.lost}
                      </span>
                    ) : <span className="chip">Add scores</span>}
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}

      {adding && <AddPlayerSheet onClose={() => setAdding(false)} addPlayer={addPlayer} />}
    </div>
  )
}

function AddPlayerSheet({ onClose, addPlayer }) {
  const [name, setName] = useState('')
  const [gender, setGender] = useState('F')
  const [ntrp, setNtrp] = useState('')
  const [phone, setPhone] = useState('')
  const [ustaNumber, setUstaNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) { setErr('Give them a name.'); return }
    setBusy(true); setErr('')
    try {
      await addPlayer({ name: name.trim(), gender, ntrp: ntrp ? Number(ntrp) : null, phone: phone.trim(), ustaNumber: ustaNumber.trim() })
      onClose()
    } catch (e2) {
      // roster names are unique; Postgres' wording for that isn't for humans
      setErr(/duplicate key|23505/.test(e2.message) ? 'Someone with that name is already on the roster.' : e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Add player" onClose={onClose}>
      <form onSubmit={submit} className="stack mt">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Name</div>
          <input type="text" value={name} autoFocus placeholder="Full name"
                 onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Plays as</div>
          <div className="seg">
            {[['F', 'Woman'], ['M', 'Man']].map(([g, label]) => (
              <button key={g} type="button"
                      className={`seg-btn ${gender === g ? 'on' : ''}`}
                      aria-pressed={gender === g}
                      onClick={() => setGender(g)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>NTRP</div>
          <input type="number" inputMode="decimal" step="0.5" min="1" max="7" value={ntrp}
                 placeholder="Optional, e.g. 3.5" onChange={(e) => setNtrp(e.target.value)} />
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>USTA number</div>
          <input type="text" inputMode="numeric" value={ustaNumber} placeholder="Optional, e.g. 2019123456"
                 autoComplete="off" onChange={(e) => setUstaNumber(e.target.value.replace(/\D/g, ''))} />
        </div>

        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Phone</div>
          <input type="tel" inputMode="tel" value={phone} placeholder="Optional"
                 autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
        </div>

        {err && <div className="notice bad">{err}</div>}
        <button className="btn primary wide" disabled={busy || !name.trim()}>
          {busy ? 'Adding…' : 'Add to roster'}
        </button>
      </form>
    </Sheet>
  )
}
