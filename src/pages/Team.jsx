import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTeam, useNow } from '../lib/store'
import { buildStats, recordShort, winPctText } from '../lib/stats'
import { Avatar, Sheet, Toast, displayName, venmoUrl } from '../components/ui'
import ProfileForm from '../components/ProfileForm'
import PinForm from '../components/PinForm'
import { isPastMatch } from '../lib/dates'
import { smsLink, whatsappLink } from '../lib/phone'

const SORTS = [
  ['played', 'Most played'],
  ['wins', 'Most wins'],
]

export default function Team() {
  const { players, matches, lineups, me, isCaptain, saveProfile, signOut } = useTeam()
  const nav = useNavigate()
  const now = useNow()
  const stats = useMemo(() => buildStats({ matches, lineups, now }), [matches, lineups, now])
  const [changingPin, setChangingPin] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])
  const [detail, setDetail] = useState(null)
  const [editing, setEditing] = useState(false)
  const [savingMe, setSavingMe] = useState(false)
  const [sort, setSort] = useState('played')

  const season = stats.seasonRecord()
  const courts = stats.courtTotals()
  const courtRec = stats.courtRecord()
  const roster = players.filter((p) => p.active)
  const played = matches.filter((m) => isPastMatch(m, now)).length
  const anyResults = courts.w + courts.l > 0
  const nameOf = (id) => displayName(players.find((p) => p.id === id)) || '—'

  const ranked = roster
    .map((p) => ({ p, s: stats.forPlayer(p.id) }))
    .sort((a, b) => (sort === 'wins'
      ? b.s.wins - a.s.wins || b.s.count - a.s.count
      : b.s.count - a.s.count || b.s.wins - a.s.wins))

  const duos = stats.pairs
    .filter((d) => d.wins + d.losses > 0)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
    .slice(0, 6)

  return (
    <div className="app">
      <div className="topbar">
        <div>
          <div className="eyebrow">Fall 2026 · by the numbers</div>
          <h1 className="h1">Season stats</h1>
        </div>
      </div>

      {/* ---------- scoreboard ---------- */}
      <div className="card">
        <div className="eyebrow">Team record</div>
        <div className="row" style={{ gap: 12, alignItems: 'baseline', marginTop: 2 }}>
          <div className="h1 num" style={{ fontSize: 46 }}>
            {season.w}<span style={{ color: 'var(--dimmer)' }}>–</span>{season.l}
          </div>
          <div className="tiny">
            {anyResults ? `${played} of ${matches.length} matches played` : 'no matches played yet'}
          </div>
        </div>

        <div className="divider" />

        <div className="row" style={{ gap: 9, alignItems: 'stretch' }}>
          <Stat label="Courts won" value={anyResults ? `${courts.w}–${courts.l}` : '–'} />
          <Stat label="Played" value={played} />
          <Stat label="Left to play" value={matches.length - played} />
        </div>
      </div>

      {!anyResults && (
        <div className="notice info mt">🎾 No data yet. Check back after the first match.</div>
      )}

      {/* ---------- per-court ---------- */}
      {anyResults && (
        <>
          <div className="section"><h2 className="h2">Court by court</h2><span className="tiny">team record</span></div>
          <div className="card stack">
            {[1, 2, 3].map((c) => {
              const r = courtRec[c]
              const total = r.w + r.l
              return (
                <div key={c} className="row" style={{ gap: 12 }}>
                  <div className="eyebrow" style={{ width: 84, whiteSpace: 'nowrap' }}>Doubles {c}</div>
                  <div className="grow">
                    <div className="bar">
                      {r.w > 0 && <i style={{ width: `${(r.w / Math.max(total, 1)) * 100}%`, background: 'var(--ok)' }} />}
                      {r.l > 0 && <i style={{ width: `${(r.l / Math.max(total, 1)) * 100}%`, background: 'var(--out)' }} />}
                    </div>
                  </div>
                  <div className="tiny num" style={{ width: 40, textAlign: 'right' }}>{recordShort(r.w, r.l)}</div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ---------- leaderboard ---------- */}
      <div className="section"><h2 className="h2">Players</h2><span className="tiny">tap a player for more info</span></div>
      <div className="row" style={{ gap: 7, marginBottom: 10, flexWrap: 'wrap' }}>
        {SORTS.map(([k, label]) => (
          <button key={k} className={`chip ${sort === k ? 'accent' : ''}`} onClick={() => setSort(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="card" style={{ padding: 6 }}>
        <div className="row tiny lb-head">
          <span className="grow">Player</span>
          <span className="lb-p">G</span>
          <span className="lb-wl">W–L</span>
        </div>
        {ranked.map(({ p, s }) => (
          <button key={p.id} className="pickrow lb" onClick={() => setDetail(p)}>
            <Avatar player={p} />
            <div className="grow">
              <div className="truncate" style={{ fontWeight: 800 }}>{displayName(p)}{p.id === me.id ? ' (you)' : ''}</div>
              <div className="tiny">{p.gender === 'F' ? 'Women' : 'Men'} · {Number(p.ntrp).toFixed(1)}</div>
            </div>
            <span className="num lb-p" style={{ fontWeight: 800 }}>{s.count}</span>
            <span className="num lb-wl" style={{ fontWeight: 800 }}>{recordShort(s.wins, s.losses)}</span>
          </button>
        ))}
      </div>

      {/* ---------- duos ---------- */}
      {duos.length > 0 && (
        <>
          <div className="section"><h2 className="h2">Best partnerships</h2></div>
          <div className="card" style={{ padding: 6 }}>
            {duos.map((d) => (
              <div key={`${d.a}|${d.b}`} className="pickrow" style={{ paddingTop: 9, paddingBottom: 9 }}>
                <div className="grow" style={{ fontWeight: 700, fontSize: 14.5 }}>
                  {nameOf(d.a)} <span style={{ color: 'var(--dimmer)' }}>+</span> {nameOf(d.b)}
                </div>
                <span className="tiny num" style={{ whiteSpace: 'nowrap' }}>
                  {d.count}× · {recordShort(d.wins, d.losses)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------- device ---------- */}
      <div className="section"><h2 className="h2">You</h2></div>
      <div className="stack">
        {isCaptain && <button className="btn wide primary" onClick={() => nav('/captain')}>Open captain tools</button>}
        <button className="btn wide" onClick={() => setEditing(true)}>Edit my details</button>
        <button className="btn wide" onClick={() => setChangingPin(true)}>Change my PIN</button>
        <button className="btn wide ghost" onClick={async () => {
          if (!confirm(`Sign ${displayName(me)} out of this phone? You'll need your phone number and PIN to get back in.`)) return
          try { await signOut() } catch (e) { setToast(e.message) }
        }}>
          Sign out of this phone
        </button>
      </div>

      {editing && (
        <Sheet title="Your details" onClose={() => setEditing(false)}>
          <ProfileForm
            player={me}
            busy={savingMe}
            saveLabel="Save"
            onSave={async (fields) => {
              setSavingMe(true)
              try { await saveProfile(me.id, fields); setEditing(false) }
              finally { setSavingMe(false) }
            }}
          />
        </Sheet>
      )}

      {changingPin && (
        <Sheet title="Change my PIN" onClose={() => setChangingPin(false)}>
          <PinForm needCurrent onDone={() => { setChangingPin(false); setToast('PIN changed') }} />
          <div className="tiny mt">Forgot it? Ask a captain for a new invite link.</div>
        </Sheet>
      )}
      <Toast>{toast}</Toast>
      {detail && <PlayerSheet player={detail} stats={stats} players={players} matches={matches} onClose={() => setDetail(null)} />}
    </div>
  )
}

const Stat = ({ label, value }) => (
  <div className="card flat grow center stat-pop" style={{ padding: '10px 6px' }}>
    <div className="num" style={{ fontWeight: 800, fontSize: 21, lineHeight: 1.2 }}>{value}</div>
    <div className="tiny" style={{ fontSize: 11 }}>{label}</div>
  </div>
)

function PlayerSheet({ player, stats, players, matches, onClose }) {
  const s = stats.forPlayer(player.id)
  const partners = stats.partnersOf(player.id)
  const nameOf = (id) => displayName(players.find((p) => p.id === id)) || '—'
  const matchNo = (id) => matches.find((m) => m.id === id)?.match_no

  return (
    <Sheet title={displayName(player)} onClose={onClose}>
      <div className="row" style={{ gap: 14, marginBottom: 4 }}>
        <Avatar player={player} lg />
        <div className="grow">
          <div className="sub">{player.gender === 'F' ? 'Women' : 'Men'} · NTRP {Number(player.ntrp).toFixed(1)}</div>
          <div className="tiny num">
            {s.lastMatchNo ? `Last played match ${s.lastMatchNo}` : 'Not on court yet this season'}
          </div>
        </div>
      </div>

      {/* always rendered, dashes and all — an empty record is information too */}
      <div className="row mt" style={{ gap: 9, alignItems: 'stretch' }}>
        <Stat label="Matches" value={s.count} />
        <Stat label="Record" value={recordShort(s.wins, s.losses)} />
        <Stat label="Win %" value={winPctText(s.wins, s.losses)} />
      </div>

      {(player.phone || player.venmo) && (
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          {player.phone && <a className="btn sm grow" href={whatsappLink(player.phone)} target="_blank" rel="noreferrer">WhatsApp</a>}
          {player.phone && <a className="btn sm grow" href={smsLink(player.phone)}>Text</a>}
          {player.phone && <a className="btn sm grow" href={`tel:${player.phone}`}>Call</a>}
          {player.venmo && (
            <a className="btn sm grow" href={venmoUrl(player.venmo)} target="_blank" rel="noreferrer">
              @{player.venmo}
            </a>
          )}
        </div>
      )}

      <div className="section"><h2 className="h2">Courts</h2></div>
      <div className="row" style={{ gap: 9, alignItems: 'stretch' }}>
        {[1, 2, 3].map((c) => (
          <Stat key={c} label={`Doubles ${c}`} value={s.courts[c]} />
        ))}
      </div>

      <div className="section"><h2 className="h2">With each partner</h2><span className="tiny">played · W–L · win%</span></div>
      <div className="card flat" style={{ padding: partners.length ? 6 : 16 }}>
        {partners.length === 0 ? (
          <div className="tiny center">No pairings yet — they'll show up here after the first match.</div>
        ) : partners.map((p) => (
          <div key={p.partnerId} className="pickrow" style={{ paddingTop: 9, paddingBottom: 9 }}>
            <div className="grow truncate" style={{ fontWeight: 700, fontSize: 14.5 }}>{nameOf(p.partnerId)}</div>
            <span className="num tiny" style={{ whiteSpace: 'nowrap' }}>
              {p.count}× · {recordShort(p.wins, p.losses)} · {winPctText(p.wins, p.losses)}
            </span>
          </div>
        ))}
      </div>

      <div className="section"><h2 className="h2">Match log</h2></div>
      <div className="card flat" style={{ padding: s.plays.length ? 6 : 16 }}>
        {s.plays.length === 0 ? (
          <div className="tiny center">Nothing played yet this season.</div>
        ) : s.plays.slice().sort((a, b) => b.matchNo - a.matchNo).map((p) => (
          <div key={p.matchId} className="pickrow" style={{ paddingTop: 9, paddingBottom: 9 }}>
            <span className="tiny num" style={{ width: 62 }}>Match {matchNo(p.matchId)}</span>
            <div className="grow truncate" style={{ fontSize: 14 }}>D{p.court} with {nameOf(p.partnerId)}</div>
            {p.won === true && <span className="chip win">W</span>}
            {p.won === false && <span className="chip loss">L</span>}
          </div>
        ))}
      </div>
    </Sheet>
  )
}
