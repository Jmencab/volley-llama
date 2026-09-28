import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTeam, useNow } from '../lib/store'
import { buildStats, recordShort } from '../lib/stats'
import { suggestLineup } from '../lib/suggest'
import { MAX_PAIR_NTRP, fmtNtrp, isRated, maxPartnerNtrp, pairNtrp, pairOverCap } from '../lib/rules'
import { AvailSplit, Avatar, NameTip, Sheet, StatusChip, Toast, availableByGender, copyText, displayName, firstName } from '../components/ui'
import { dayName, monthDay, timeOf, toLocalInput, pacificOffset, isPastMatch } from '../lib/dates'

const AVAIL_RANK = { available: 0, maybe: 1, none: 2, out: 3 }
const EMPTY = [1, 2, 3].map((court) => ({ court, player1_id: null, player2_id: null }))

export default function CaptainMatch() {
  const { id } = useParams()
  const nav = useNavigate()
  const {
    matches, players, lineups, availOf, lineupFor,
    saveLineup, saveResults, publishLineup, updateMatch, ratingOf,
  } = useTeam()
  const now = useNow()
  const stats = useMemo(() => buildStats({ matches, lineups, now }), [matches, lineups, now])

  const match = matches.find((m) => m.id === id)
  const rows = lineupFor(id)

  const server = useMemo(
    () => EMPTY.map(({ court }) => {
      const r = rows.find((x) => x.court === court)
      return { court, player1_id: r?.player1_id || null, player2_id: r?.player2_id || null }
    }),
    [rows],
  )

  // Content-keyed, so a background refetch that changes nothing can't reset the
  // draft, and a ref so the guard always reads the current value rather than the
  // one captured when the effect was scheduled.
  const serverKey = useMemo(() => JSON.stringify(server), [server])
  const [draft, setDraft] = useState(server)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [dirty, setDirtyState] = useState(false)
  const dirtyRef = useRef(false)
  const setDirty = useCallback((v) => { dirtyRef.current = v; setDirtyState(v) }, [])
  const [picking, setPicking] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [editing, setEditing] = useState(false)
  const [suggested, setSuggested] = useState(null)
  const [manual, setManual] = useState(null) // nudge text, shown when the clipboard refused
  const [showText, setShowText] = useState(false) // the group-text sheet

  // Don't let a background refresh stomp on edits in progress.
  useEffect(() => {
    if (dirtyRef.current) return
    setDraft(JSON.parse(serverKey))
  }, [serverKey])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(t)
  }, [toast])

  if (!match) return <div className="app"><div className="topbar" /><p className="sub">Match not found.</p></div>

  const d = new Date(match.starts_at)
  const past = isPastMatch(match, now)
  const active = players.filter((p) => p.active)
  const byId = (pid) => players.find((p) => p.id === pid)
  const statusOf = (pid) => availOf(match.id, pid) || 'none'

  // Doubles UTR, captain-only (the store only has it once captain tools are
  // unlocked). Reliability is shown when UTR itself says the number is shaky.
  const utrText = (p) => {
    const r = ratingOf(p?.id)
    const utr = Number(r?.utr_doubles)
    if (!Number.isFinite(utr) || utr <= 0) return null
    const rel = r.utr_doubles_rel ?? 100
    return `UTR ${utr.toFixed(2)}${rel < 90 ? ` (${rel}%)` : ''}`
  }

  const assigned = draft.flatMap((c) => [c.player1_id, c.player2_id]).filter(Boolean)
  const complete = draft.every((c) => c.player1_id && c.player2_id)

  // USTA 6.0 mixed: partners on a court may total at most 6.0, or it isn't a legal lineup
  const overCap = draft
    .map((c) => ({ court: c.court, m: byId(c.player1_id), w: byId(c.player2_id) }))
    .filter(({ m, w }) => m && w && pairOverCap(m, w))

  const problems = overCap.map(({ court, m, w }) =>
    `D${court}: ${displayName(m)} + ${displayName(w)} total ${fmtNtrp(pairNtrp(m, w))} — over the ${fmtNtrp(MAX_PAIR_NTRP)} limit`)
  const openCourts = draft.filter((c) => !c.player1_id || !c.player2_id).length
  if (openCourts) problems.push(`${openCourts} ${openCourts === 1 ? 'court is' : 'courts are'} still open`)
  for (const pid of assigned) {
    const s = statusOf(pid)
    if (s === 'out') problems.push(`${displayName(byId(pid))} said they're not available`)
    if (s === 'maybe') problems.push(`${displayName(byId(pid))} is only a maybe`)
    if (s === 'none') problems.push(`${displayName(byId(pid))} hasn't answered`)
  }

  const byStatus = (s) => active.filter((p) => statusOf(p.id) === s)
  const silent = byStatus('none')
  const tally = { available: 0, maybe: 0, out: 0, none: 0 }
  for (const p of active) tally[statusOf(p.id)]++

  // every count on this screen can name the players behind it
  const nameList = (ps) => ps.map(displayName).sort((a, b) => a.localeCompare(b))

  const availNames = {
    women: nameList(byStatus('available').filter((p) => p.gender === 'F')),
    men: nameList(byStatus('available').filter((p) => p.gender === 'M')),
  }

  // Early in the season the real lineup question is "who has the fewest other
  // chances to play?" — the slot picker and the auto-suggest both lean on this.
  const others = matches.filter((m) => m.id !== match.id && !isPastMatch(m, now))
  const elsewhere = (pid) => {
    const c = { available: 0, maybe: 0, out: 0, none: 0 }
    for (const m of others) c[availOf(m.id, pid) || 'none']++
    return c
  }
  const constraintLine = (pid) => {
    const c = elsewhere(pid)
    return `${c.available} in, ${c.out} out, ${c.maybe + c.none} maybe or unanswered`
  }

  const setSlot = (court, gender, pid) => {
    setDirty(true)
    setSuggested(null) // a hand edit means the reasons no longer describe the draft
    setDraft((prev) => prev.map((c) => (c.court === court ? { ...c, [gender === 'M' ? 'player1_id' : 'player2_id']: pid } : c)))
  }

  const canSuggest = active.some((p) => statusOf(p.id) === 'available' || statusOf(p.id) === 'maybe')
  const doSuggest = () => {
    const s = suggestLineup({
      matchId: match.id, players: active, statusOf, stats, elsewhere,
      nameOf: (pid) => displayName(byId(pid)), utrOf: ratingOf,
    })
    setDraft(s.courts)
    setDirty(true)
    setSuggested(s)
    setToast('Suggested — look it over, then save')
  }

  const doSave = async () => {
    setBusy(true)
    const snapshot = JSON.stringify(draft)
    try {
      await saveLineup(match.id, draft)
      // only clear dirty if nothing changed while the save was in flight —
      // otherwise the next refetch would stomp the newer edit
      if (JSON.stringify(draftRef.current) === snapshot) setDirty(false)
      setToast('Lineup saved')
    } catch (e) { setToast(e.message) } finally { setBusy(false) }
  }

  const doPublish = async (on) => {
    if (on && overCap.length) {
      const which = overCap.map((x) => `D${x.court}`).join(' and ')
      const verb = overCap.length === 1 ? 'is' : 'are'
      if (!confirm(`${which} ${verb} over the ${fmtNtrp(MAX_PAIR_NTRP)} combined limit — not a legal USTA lineup. Post it anyway?`)) return
    }
    if (on && !complete && !confirm('Some courts are still open. Post it anyway?')) return
    setBusy(true)
    const snapshot = JSON.stringify(draft)
    try {
      if (dirty) {
        await saveLineup(match.id, draft)
        if (JSON.stringify(draftRef.current) === snapshot) setDirty(false)
      }
      await publishLineup(match.id, on)
      setToast(on ? 'Posted to the team' : 'Unposted')
    } catch (e) { setToast(e.message) } finally { setBusy(false) }
  }

  const lineupText = () => {
    // always "vs" — an away game used to read "@ Opponent … @ Site", two @ signs
    const head = `Volley Llama vs ${match.opponent} — ${dayName(d)} ${monthDay(d)}, ${timeOf(d)} @ ${match.site}`
    const lines = draft.map((c) => {
      const a = displayName(byId(c.player1_id)) || 'TBD'
      const b = displayName(byId(c.player2_id)) || 'TBD'
      return `D${c.court}: ${a} + ${b}`
    })
    const balls = match.is_home
      ? 'This is a home game, so please bring a can of balls!'
      : 'This is an away game, so no need to bring balls.'
    return [head, '', ...lines, '', balls].join('\n')
  }

  const nudgeText = () =>
    `Need availability for Match ${match.match_no} — ${dayName(d)} ${monthDay(d)} vs ${match.opponent}: ` +
    silent.map((p) => firstName(displayName(p))).join(', ')

  // Says what happened; callers decide what to show when the clipboard refuses.
  const copy = async (what, text) => {
    const ok = await copyText(text)
    setToast(ok ? `${what} copied` : "Couldn't copy — select the text and copy it by hand")
    return ok
  }
  const selectAll = (e) => e.target.select()

  return (
    <div className="app">
      <div className="topbar">
        <button className="btn sm ghost" onClick={() => nav('/captain')}>‹ Captain</button>
        <span className={`badge ${match.is_home ? 'home' : 'away'}`}>{match.is_home ? 'Home' : 'Away'}</span>
      </div>

      <div className="eyebrow">Match {match.match_no}</div>
      <h1 className={`h1 ${match.opponent.length > 20 ? 'h1-long' : ''}`} style={{ marginTop: 4 }}>
        vs {match.opponent}
      </h1>
      <div className="sub num">{dayName(d)} {monthDay(d)} · {timeOf(d)} · {match.site}</div>

      {!past && (
        <>
          <div className="mt">
            <AvailSplit compact names={availNames} {...availableByGender(active, statusOf)} />
          </div>
          <div className="row mt nametip-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <NameTip names={nameList(byStatus('maybe'))}>
              <span className="chip maybe">{tally.maybe} maybe</span>
            </NameTip>
            <NameTip names={nameList(byStatus('out'))}>
              <span className="chip out">{tally.out} out</span>
            </NameTip>
            <NameTip names={nameList(silent)}>
              <span className="chip">{tally.none} silent</span>
            </NameTip>
          </div>

          {silent.length > 0 && (
            <>
              <button
                className="btn wide sm mt"
                onClick={async () => setManual((await copy('Nudge', nudgeText())) ? null : nudgeText())}
              >
                Copy a nudge for the {silent.length} who haven't answered
              </button>
              {manual && <textarea className="mt" readOnly rows={3} value={manual} onFocus={selectAll} onClick={selectAll} />}
            </>
          )}
        </>
      )}

      <div className="section"><h2 className="h2">Lineup</h2><span className="tiny">one man + one woman</span></div>

      {!past && (
        <button className="btn wide" style={{ marginBottom: 10 }} disabled={busy || !canSuggest} onClick={doSuggest}>
          ✨ Auto-suggest a lineup
        </button>
      )}
      {suggested && (
        <div className="notice info" style={{ marginBottom: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Why this lineup</div>
          {suggested.reasons.map((r, i) => <div key={i}>{r}</div>)}
          {suggested.warnings.map((w, i) => (
            <div key={`w${i}`} style={{ color: 'var(--out)', fontWeight: 700, marginTop: 4 }}>{w}</div>
          ))}
        </div>
      )}

      {draft.map((c) => {
        const man = byId(c.player1_id)
        const woman = byId(c.player2_id)
        const total = man && woman ? pairNtrp(man, woman) : null
        const over = !!man && !!woman && pairOverCap(man, woman)
        return (
          <div key={c.court} className={`court ${over ? 'invalid' : ''}`}>
            <div className="spread">
              <span className="eyebrow">
                Doubles {c.court}
                {total != null && <span className={`ntrp-sum ${over ? 'over' : ''}`}> · {fmtNtrp(total)}</span>}
              </span>
              <PairNote court={c} stats={stats} matchId={match.id} />
            </div>
            <div className="slots">
              {[['M', man], ['F', woman]].map(([g, p]) => (
                <button
                  key={g}
                  className={`slot ${p ? 'filled' : ''}`}
                  onClick={() => setPicking({ court: c.court, gender: g })}
                >
                  {p ? (
                    <>
                      <span className="nm">{displayName(p)}</span>
                      <span className="tiny num">
                        {isRated(p) && `${fmtNtrp(p.ntrp)} · `}
                        {utrText(p) && `${utrText(p)} · `}
                        {stats.playedExcept(p.id, match.id)} played · {statusOf(p.id) === 'none' ? 'no answer' : statusOf(p.id)}
                      </span>
                    </>
                  ) : (
                    <span>+ Add {g === 'M' ? 'a man' : 'a woman'}</span>
                  )}
                </button>
              ))}
            </div>
            {over && (
              <div className="court-flag">
                Invalid pairing: {fmtNtrp(total)} combined is over the {fmtNtrp(MAX_PAIR_NTRP)} limit
              </div>
            )}
          </div>
        )
      })}

      {!past && problems.length > 0 && (
        <div className="notice warn mt">
          {problems.map((p, i) => <div key={i}>{problems.length > 1 ? '· ' : ''}{p}</div>)}
        </div>
      )}

      <div className="stack mt">
        <button className="btn primary wide" disabled={busy || !dirty} onClick={doSave}>
          {dirty ? 'Save lineup' : 'Saved'}
        </button>
        {!past && (
          <>
            <button className="btn wide" disabled={busy} onClick={() => doPublish(!match.lineup_published)}>
              {match.lineup_published ? 'Unpost from the team' : 'Post to the team'}
            </button>
            <button className="btn wide ghost" onClick={() => setShowText(true)}>
              Copy for the group text
            </button>
          </>
        )}
      </div>

      <Balance match={match} active={active} stats={stats} assigned={assigned} />

      {(past || rows.some((r) => r.won !== null)) && (
        <Results match={match} rows={rows} players={players} saveResults={saveResults} setToast={setToast} />
      )}

      <div className="section"><h2 className="h2">Match details</h2>
        <button className="tiny" onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel' : 'Edit'}</button>
      </div>
      {editing && (
        <MatchEditor match={match} onSave={async (startsAt, site, notes) => {
          setBusy(true)
          try { await updateMatch(match.id, startsAt, site, notes); setEditing(false); setToast('Match updated') }
          catch (e) { setToast(e.message) } finally { setBusy(false) }
        }} />
      )}

      {picking && (
        <SlotSheet
          match={match} picking={picking} draft={draft} players={active} stats={stats}
          statusOf={statusOf}
          noteFor={others.length ? constraintLine : null}
          utrText={utrText}
          onClose={() => setPicking(null)}
          onPick={(pid) => { setSlot(picking.court, picking.gender, pid); setPicking(null) }}
        />
      )}

      {showText && (
        <Sheet title="Group text" onClose={() => setShowText(false)}>
          <textarea readOnly rows={6} value={lineupText()} onFocus={selectAll} onClick={selectAll} />
          <button
            className="btn primary wide mt"
            onClick={async () => { if (await copy('Lineup', lineupText())) setShowText(false) }}
          >
            Copy to clipboard
          </button>
          <p className="tiny" style={{ marginTop: 8, textAlign: 'center' }}>Or tap the text to select it and copy by hand.</p>
        </Sheet>
      )}

      <Toast>{toast}</Toast>
    </div>
  )
}

function PairNote({ court, stats, matchId }) {
  const pair = stats.pairOfExcept(court.player1_id, court.player2_id, matchId)
  if (!court.player1_id || !court.player2_id) return null
  if (!pair) return <span className="tiny">new pair</span>
  return <span className="tiny num">played {pair.count}× · {recordShort(pair.wins, pair.losses)}</span>
}

function SlotSheet({ match, picking, draft, players, stats, statusOf, noteFor, utrText, onClose, onPick }) {
  const { court, gender } = picking
  const thisCourt = draft.find((c) => c.court === court)
  const mySlot = gender === 'M' ? 'player1_id' : 'player2_id'
  const partnerId = gender === 'M' ? thisCourt.player2_id : thisCourt.player1_id
  const current = thisCourt[mySlot]

  const takenElsewhere = new Set(
    draft.flatMap((c) => [c.player1_id, c.player2_id]).filter((pid) => pid && pid !== current),
  )

  const pool = players.filter((p) => p.gender === gender && !takenElsewhere.has(p.id))

  // Available players carry their full season log; everyone else is just a name
  // and a status at the bottom — the captain picks from the top group 95% of
  // the time, so that's where the detail lives.
  const ready = pool
    .filter((p) => statusOf(p.id) === 'available')
    .sort((a, b) => stats.playedExcept(a.id, match.id) - stats.playedExcept(b.id, match.id) || a.name.localeCompare(b.name))
  const rest = pool
    .filter((p) => statusOf(p.id) !== 'available')
    .sort((a, b) => AVAIL_RANK[statusOf(a.id)] - AVAIL_RANK[statusOf(b.id)] || a.name.localeCompare(b.name))

  const firstOf = (pid) => firstName(displayName(players.find((x) => x.id === pid))) || '—'
  const logFor = (p) =>
    stats.forPlayer(p.id).plays
      .filter((x) => x.matchId !== match.id)
      .sort((a, b) => b.matchNo - a.matchNo)

  const partner = players.find((p) => p.id === partnerId)
  const partnerName = displayName(partner)
  const partnerMax = partner ? maxPartnerNtrp(partner) : null
  // what a candidate would total with the partner already on this court, when that breaks the cap
  const overWith = (p) => (partner && pairOverCap(p, partner) ? fmtNtrp(pairNtrp(p, partner)) : null)
  const withRating = (p) => (
    <>
      {displayName(p)}{isRated(p) && <span className="tiny num"> {fmtNtrp(p.ntrp)}</span>}
      {utrText?.(p) && <span className="tiny num"> · {utrText(p)}</span>}
    </>
  )
  const overNote = (total) => (
    <div className="tiny" style={{ color: 'var(--out)', fontWeight: 800 }}>
      {total} with {firstName(partnerName)} — over the {fmtNtrp(MAX_PAIR_NTRP)} limit
    </div>
  )

  return (
    <Sheet title={`Doubles ${court} · ${gender === 'M' ? 'man' : 'woman'}`} onClose={onClose}>
      <p className="sub" style={{ marginTop: -6 }}>
        {partnerName ? <>Partnering <b>{partnerName}</b>{partnerMax != null && <> ({fmtNtrp(partner.ntrp)}), so up to a {fmtNtrp(partnerMax)}</>}. </> : null}
        Available players first, fewest matches at the top.
      </p>

      {current && (
        <button className="btn wide ghost mt" onClick={() => onPick(null)}>Clear this slot</button>
      )}

      <div className="eyebrow mt2" style={{ padding: '0 6px 4px' }}>Available · {ready.length}</div>
      {ready.length === 0 && (
        <div className="notice info">Nobody {gender === 'M' ? 'on the men\'s side' : 'on the women\'s side'} has said yes yet.</div>
      )}
      <div>
        {ready.map((p) => {
          const log = logFor(p)
          const over = overWith(p)
          return (
            <button key={p.id} className={`pickrow ${over ? 'dim' : ''}`} onClick={() => onPick(p.id)}>
              <Avatar player={p} />
              <div className="grow">
                <div style={{ fontWeight: 800, fontSize: 15 }}>
                  {withRating(p)} {p.id === current && <span className="tiny">· in this slot</span>}
                </div>
                {over && overNote(over)}
                {noteFor && <div className="tiny">Rest of season availability: {noteFor(p.id)}</div>}
                {log.length === 0 ? (
                  <div className="tiny">No matches yet this season</div>
                ) : log.map((x) => (
                  <div key={x.matchId} className="tiny num logline">
                    {x.won === true && <b className="res win">WIN</b>}
                    {x.won === false && <b className="res loss">LOSS</b>}
                    {x.won == null && <b className="res">—</b>}
                    {' '}D{x.court} with {firstOf(x.partnerId)}{x.score ? ` · ${x.score}` : ''}
                  </div>
                ))}
              </div>
            </button>
          )
        })}
      </div>

      {rest.length > 0 && (
        <>
          <div className="eyebrow mt2" style={{ padding: '0 6px 4px' }}>Everyone else</div>
          <div>
            {rest.map((p) => {
              const over = overWith(p)
              return (
                <button
                  key={p.id}
                  className={`pickrow ${statusOf(p.id) === 'out' || over ? 'dim' : ''}`}
                  onClick={() => onPick(p.id)}
                >
                  <Avatar player={p} />
                  <div className="grow" style={{ fontWeight: 800, fontSize: 15 }}>
                    {withRating(p)} {p.id === current && <span className="tiny">· in this slot</span>}
                    {over && overNote(over)}
                  </div>
                  <StatusChip status={statusOf(p.id) === 'none' ? null : statusOf(p.id)} />
                </button>
              )
            })}
          </div>
        </>
      )}
    </Sheet>
  )
}

function Balance({ match, active, stats, assigned }) {
  const rowsFor = (g) =>
    active
      .filter((p) => p.gender === g)
      .map((p) => ({ p, n: stats.playedExcept(p.id, match.id) }))
      .sort((a, b) => a.n - b.n || a.p.name.localeCompare(b.p.name))

  const max = Math.max(1, ...active.map((p) => stats.playedExcept(p.id, match.id)))

  return (
    <>
      <div className="section"><h2 className="h2">Balance</h2><span className="tiny">not counting this match</span></div>
      <div className="card">
        {[['Women', 'F'], ['Men', 'M']].map(([label, g]) => (
          <div key={g} style={{ marginBottom: 10 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
            {rowsFor(g).map(({ p, n }) => {
              const on = assigned.includes(p.id)
              return (
                <div key={p.id} className="row" style={{ gap: 10, padding: '4px 0', opacity: on ? 1 : 0.72 }}>
                  <div className="grow truncate" style={{ fontSize: 14, fontWeight: on ? 700 : 400 }}>
                    {on ? '● ' : ''}{displayName(p)}
                  </div>
                  <div style={{ width: 80 }}>
                    <div className="bar">
                      <i style={{ width: `${(n / max) * 100}%`, background: on ? 'var(--accent-deep)' : 'var(--line)' }} />
                    </div>
                  </div>
                  <div className="tiny num" style={{ width: 18, textAlign: 'right' }}>{n}</div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

function Results({ match, rows, players, saveResults, setToast }) {
  // `rows` is a fresh array on every render, so key the re-sync on its contents —
  // depending on the array itself is an infinite render loop.
  const rowsKey = useMemo(
    () => JSON.stringify(rows.map((r) => ({ court: r.court, won: r.won, score: r.score || '' }))),
    [rows],
  )
  const [local, setLocal] = useState(() => JSON.parse(rowsKey))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setLocal(JSON.parse(rowsKey)) }, [rowsKey])

  const nameOf = (id) => displayName(players.find((p) => p.id === id)) || 'TBD'
  if (rows.length === 0) return null

  const set = (court, patch) =>
    setLocal((prev) => prev.map((r) => (r.court === court ? { ...r, ...patch } : r)))

  return (
    <>
      <div className="section"><h2 className="h2">Results</h2></div>
      {rows.map((r) => {
        const l = local.find((x) => x.court === r.court) || { won: null, score: '' }
        return (
          <div key={r.court} className="court">
            <div className="eyebrow">Doubles {r.court}</div>
            <div style={{ fontWeight: 600, fontSize: 14, margin: '4px 0 10px' }}>
              {nameOf(r.player1_id)} + {nameOf(r.player2_id)}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className={`btn sm grow ${l.won === true ? 'primary' : ''}`}
                      onClick={() => set(r.court, { won: l.won === true ? null : true })}>Won</button>
              <button className={`btn sm grow ${l.won === false ? 'primary' : ''}`}
                      onClick={() => set(r.court, { won: l.won === false ? null : false })}>Lost</button>
            </div>
            <input className="mt" type="text" inputMode="text" placeholder="Score, e.g. 6-3, 4-6, 10-7"
                   value={l.score} onChange={(e) => set(r.court, { score: e.target.value })} />
          </div>
        )
      })}
      <button
        className="btn primary wide mt"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try { await saveResults(match.id, local); setToast('Results saved') }
          catch (e) { setToast(e.message) } finally { setBusy(false) }
        }}
      >Save results</button>
    </>
  )
}

function MatchEditor({ match, onSave }) {
  const [when, setWhen] = useState(() => toLocalInput(new Date(match.starts_at)))
  const [site, setSite] = useState(match.site)
  const [notes, setNotes] = useState(match.notes || '')

  return (
    <div className="card stack">
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Date & time (Pacific)</div>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Site</div>
        <input type="text" value={site} onChange={(e) => setSite(e.target.value)} />
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Note for the team</div>
        <input type="text" value={notes} placeholder="Parking is tight, arrive 15 min early…"
               onChange={(e) => setNotes(e.target.value)} />
      </div>
      <button
        className="btn primary wide"
        onClick={() => {
          const iso = `${when}:00${pacificOffset(new Date(`${when}:00`))}`
          onSave(iso, site, notes || null)
        }}
      >Save changes</button>
    </div>
  )
}
