import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTeam, useNow } from '../lib/store'
import { buildStats, recordShort } from '../lib/stats'
import { Avatar, DateChip, NEED_PER_GENDER, Sheet, Toast, availableByGender, copyText, displayName, firstName } from '../components/ui'
import ProfileForm from '../components/ProfileForm'
import { monthDay, isPastMatch } from '../lib/dates'
import { inviteLink } from '../lib/identity'
import { formatPhone, smsLink, whatsappLink } from '../lib/phone'

export default function Captain() {
  const { matches, players, lineups, availOf, lineupFor, addPlayer, rosterAccess, openSignUp, setOpenSignUp } = useTeam()
  const now = useNow()
  const stats = useMemo(() => buildStats({ matches, lineups, now }), [matches, lineups, now])
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(null) // player id
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // who has joined, who's locked out; refreshed after anything changes it
  const [access, setAccess] = useState({})
  const refreshAccess = useCallback(() => {
    rosterAccess()
      .then((rows) => setAccess(Object.fromEntries((rows || []).map((r) => [r.player_id, r]))))
      .catch(() => {})
  }, [rosterAccess])
  useEffect(() => { refreshAccess() }, [refreshAccess])

  // whether a player can set up from the roster phone number without an invite
  const [open, setOpen] = useState(null)
  useEffect(() => { openSignUp().then(setOpen, () => {}) }, [openSignUp])
  const toggleOpen = async (on) => {
    setOpen(on)
    try {
      await setOpenSignUp(on)
      setToast(on ? 'Players can set up with their phone number' : 'Invite links only')
    } catch (e) { setOpen(!on); setToast(e.message) }
  }

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
      </div>

      <div className="section"><h2 className="h2">Roster</h2><span className="tiny">tap to invite or edit</span></div>
      <div className="card" style={{ padding: 6 }}>
        {active.map((p) => {
          const st = accessStatus(p, access[p.id], open)
          return (
            <button key={p.id} className="pickrow" onClick={() => setManaging(p.id)}>
              <Avatar player={p} />
              <div className="grow truncate">
                <div style={{ fontWeight: 700 }}>{displayName(p)}</div>
                {p.is_captain && <div className="tiny">Captain</div>}
              </div>
              <span className={`chip ${st.tone}`}>{st.label}</span>
            </button>
          )
        })}
      </div>
      <button className="btn wide mt" onClick={() => setAdding(true)}>Add player</button>
      {open !== null && (
        <label className="row mt" style={{ gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={open} onChange={(e) => toggleOpen(e.target.checked)} style={{ marginTop: 3 }} />
          <span className="sub" style={{ margin: 0 }}>
            Players on the roster can set up with their phone number, no invite needed.
            Turn this off if the app's link might reach people outside the team.
          </span>
        </label>
      )}

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

      {adding && (
        <AddPlayerSheet
          onClose={() => setAdding(false)}
          addPlayer={addPlayer}
          // straight on to their invite
          onAdded={(id) => { setAdding(false); refreshAccess(); setManaging(id) }}
        />
      )}
      {managing && players.some((p) => p.id === managing) && (
        <PlayerAccessSheet
          player={players.find((p) => p.id === managing)}
          access={access[managing]}
          onChanged={refreshAccess}
          setToast={setToast}
          onClose={() => setManaging(null)}
        />
      )}
      <Toast>{toast}</Toast>
    </div>
  )
}

// One chip per roster row: the thing the captain might need to act on.
// openSignUp: players can set up without an invite, so "not invited" isn't news.
function accessStatus(p, a, openSignUp) {
  if (!p.phone) return { label: 'No phone', tone: 'out' }
  if (!a) return { label: '…', tone: '' }
  if (a.locked) return { label: 'PIN locked', tone: 'out' }
  if (a.devices > 0) return { label: 'Signed in', tone: 'available' }
  if (a.has_pin) return { label: 'Signed out', tone: '' }
  if (a.invite_expires) return { label: 'Invited', tone: 'maybe' }
  return { label: openSignUp ? 'Not set up' : 'Not invited', tone: 'maybe' }
}

function PlayerAccessSheet({ player, access: a, onChanged, setToast, onClose }) {
  const { me, createInvite, unlockPin, signOutPlayer, saveProfile, setCaptain } = useTeam()
  const [invite, setInvite] = useState(null) // the message, once a link is made
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const first = firstName(displayName(player))

  const act = async (fn, done) => {
    setBusy(true); setErr('')
    try { await fn(); onChanged(); if (done) setToast(done) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  const makeInvite = () => act(async () => {
    const token = await createInvite(player.id)
    setInvite(
      `Hi ${first}! Here's your sign-in link for the Volley Llama team app:\n${inviteLink(token)}\n\n` +
      "It signs you in on your phone and asks you to choose an 8-digit PIN for next time. " +
      'The link works once and expires in 7 days.',
    )
  })

  if (editing) {
    return (
      <Sheet title={`Edit ${first}`} onClose={onClose}>
        <ProfileForm
          player={player} greet={false} busy={busy} saveLabel="Save" onBack={() => setEditing(false)}
          onSave={async (fields) => {
            setBusy(true)
            try { await saveProfile(player.id, fields); setEditing(false); setToast('Saved') } finally { setBusy(false) }
          }}
        />
      </Sheet>
    )
  }

  return (
    <Sheet title={displayName(player)} onClose={onClose}>
      <div className="sub" style={{ marginTop: -6 }}>
        {player.is_captain ? 'Captain · ' : ''}{player.phone ? formatPhone(player.phone) : 'No phone number yet'}
        {player.email ? ` · ${player.email}` : ''}
      </div>
      <div className="tiny mt">{describe(a)}</div>

      {invite ? (
        <div className="stack mt">
          <textarea readOnly rows={6} value={invite} onFocus={(e) => e.target.select()} />
          <a className="btn primary wide" href={whatsappLink(player.phone, invite)} target="_blank" rel="noreferrer">
            Send on WhatsApp
          </a>
          <a className="btn wide" href={smsLink(player.phone, invite)}>Send as a text</a>
          <button className="btn wide ghost" onClick={async () => {
            setToast((await copyText(invite)) ? 'Copied' : "Couldn't copy — select the text and copy it by hand")
          }}>Copy</button>
        </div>
      ) : (
        <div className="stack mt">
          {player.phone ? (
            <button className="btn primary wide" disabled={busy} onClick={makeInvite}>
              {a?.has_pin || a?.invite_expires ? 'Send a new sign-in link' : 'Send invite link'}
            </button>
          ) : (
            <div className="notice info">Add their phone number first. It's how they sign in.</div>
          )}
          {a?.locked && (
            <button className="btn wide" disabled={busy} onClick={() => act(() => unlockPin(player.id), 'PIN unlocked')}>
              Unlock PIN
            </button>
          )}
          <button className="btn wide" disabled={busy} onClick={() => setEditing(true)}>Edit details</button>
          <button className="btn wide" disabled={busy} onClick={() => {
            const on = !player.is_captain
            const self = player.id === me.id
            if (!confirm(on
              ? `Make ${first} a captain? They'll be able to set lineups, enter scores, edit anyone's details, and make other captains.`
              : self ? "Stop being a captain? You'll lose the Captain tab right away." : `Remove ${first} as a captain?`)) return
            act(() => setCaptain(player.id, on), on ? `${first} is now a captain` : self ? null : `${first} is no longer a captain`)
          }}>
            {player.is_captain ? (player.id === me.id ? 'Stop being a captain' : 'Remove as captain') : 'Make captain'}
          </button>
          {a?.devices > 0 && (
            <button className="btn wide ghost" disabled={busy} onClick={() => {
              if (!confirm(`Sign ${first} out on every phone? Their PIN still works.`)) return
              act(() => signOutPlayer(player.id), 'Signed out everywhere')
            }}>
              Sign out of all phones
            </button>
          )}
        </div>
      )}
      {err && <div className="notice bad mt">{err}</div>}
    </Sheet>
  )
}

function describe(a) {
  if (!a) return ''
  const parts = []
  if (a.devices > 0) parts.push(`Signed in on ${a.devices} ${a.devices === 1 ? 'phone' : 'phones'}`)
  else if (a.has_pin) parts.push('Has a PIN, not signed in anywhere')
  else parts.push('Hasn\'t joined yet')
  if (a.locked) parts.push('PIN locked after 10 wrong tries')
  if (a.invite_expires) parts.push(`unopened link expires ${monthDay(new Date(a.invite_expires))}`)
  return parts.join(' · ')
}

function AddPlayerSheet({ onClose, addPlayer, onAdded }) {
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
    if (!phone.trim()) { setErr("Add their phone number. It's how they sign in."); return }
    setBusy(true); setErr('')
    try {
      const id = await addPlayer({ name: name.trim(), gender, ntrp: ntrp ? Number(ntrp) : null, phone: phone.trim(), ustaNumber: ustaNumber.trim() })
      onAdded(id)
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
          <input type="tel" inputMode="tel" value={phone} placeholder="206-555-0134"
                 autoComplete="off" onChange={(e) => setPhone(e.target.value)} />
        </div>

        {err && <div className="notice bad">{err}</div>}
        <button className="btn primary wide" disabled={busy || !name.trim() || !phone.trim()}>
          {busy ? 'Adding…' : 'Add to roster'}
        </button>
      </form>
    </Sheet>
  )
}
