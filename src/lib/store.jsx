import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'
import { getMyId, setMyId, getCaptainPass, setCaptainPass, getCaptainLocked, setCaptainLocked } from './identity'

const Ctx = createContext(null)
export const useTeam = () => useContext(Ctx)
// exposed so pages can be mounted against fixture data without a live backend
export const TeamContext = Ctx

const key = (matchId, playerId) => `${matchId}:${playerId}`

export function TeamProvider({ children }) {
  const [players, setPlayers] = useState([])
  const [matches, setMatches] = useState([])
  const [availability, setAvailability] = useState({}) // "match:player" -> row
  const [lineups, setLineups] = useState([])
  const [practices, setPractices] = useState([])
  const [signups, setSignups] = useState([])
  const [courtReports, setCourtReports] = useState([])
  // null until loaded; a string when the practice tables aren't set up yet, so
  // a missing migration only dims the Practice tab instead of the whole app
  const [practiceError, setPracticeError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [myId, setMyIdState] = useState(getMyId)
  const [captainPass, setPassState] = useState(getCaptainPass)

  const load = useCallback(async () => {
    try {
      const [p, m, a, l] = await Promise.all([
        supabase.from('usta_players').select('*').order('sort_order'),
        supabase.from('usta_matches').select('*').order('match_no'),
        supabase.from('usta_availability').select('*'),
        supabase.from('usta_lineups').select('*'),
      ])
      const err = p.error || m.error || a.error || l.error
      if (err) throw err
      setPlayers(p.data || [])
      setMatches(m.data || [])
      setLineups(l.data || [])
      const map = {}
      for (const row of a.data || []) map[key(row.match_id, row.player_id)] = row
      setAvailability(map)
      setError(null)
    } catch (e) {
      setError(e.message || 'Could not reach the server')
    } finally {
      setLoading(false)
    }
  }, [])

  // Kept out of load(): it must never be able to take the season down with it.
  const loadPractice = useCallback(async () => {
    const [pr, su, cr] = await Promise.all([
      supabase.from('usta_practices').select('*').order('starts_at'),
      supabase.from('usta_practice_signups').select('*'),
      supabase.from('usta_court_reports').select('*').order('reported_at', { ascending: false }).limit(500),
    ])
    const err = pr.error || su.error || cr.error
    if (err) { setPracticeError(err.message || 'Practices are not set up yet'); return }
    setPractices(pr.data || [])
    setSignups(su.data || [])
    setCourtReports(cr.data || [])
    setPracticeError(null)
  }, [])

  useEffect(() => { load(); loadPractice() }, [load, loadPractice])

  // One lineup save writes three rows and so fires three change events; coalesce
  // them into a single refetch.
  const reloadTimer = useRef()
  const scheduleLoad = useCallback(() => {
    clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(load, 250)
  }, [load])

  // Live updates so the captain watches answers land, plus a refetch whenever the
  // phone comes back to the app (realtime sockets die in the background on iOS).
  useEffect(() => {
    const ch = supabase
      .channel('usta-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_availability' }, (p) => {
        const row = p.new
        if (p.eventType === 'DELETE') {
          setAvailability((prev) => {
            const next = { ...prev }
            delete next[key(p.old.match_id, p.old.player_id)]
            return next
          })
        } else if (row) {
          setAvailability((prev) => ({ ...prev, [key(row.match_id, row.player_id)]: row }))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_lineups' }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_matches' }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_practices' }, loadPractice)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_practice_signups' }, loadPractice)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_court_reports' }, loadPractice)
      .subscribe()

    const onVisible = () => { if (!document.hidden) { load(); loadPractice() } }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(reloadTimer.current)
    }
  }, [load, scheduleLoad, loadPractice])

  const me = useMemo(() => players.find((p) => p.id === myId) || null, [players, myId])

  const chooseMe = useCallback((id) => { setMyId(id); setMyIdState(id) }, [])

  const setAvail = useCallback(async (matchId, playerId, status) => {
    const optimistic = { match_id: matchId, player_id: playerId, status, updated_at: new Date().toISOString() }
    setAvailability((prev) => ({ ...prev, [key(matchId, playerId)]: optimistic }))
    const { error: e } = await supabase
      .from('usta_availability')
      .upsert(optimistic, { onConflict: 'match_id,player_id' })
    if (e) { setError('Could not save — check your signal'); load() }
    else setError(null)
  }, [load])

  const availOf = useCallback(
    (matchId, playerId) => availability[key(matchId, playerId)]?.status || null,
    [availability],
  )

  // Re-tapping "I'm in" must not touch updated_at: it's the place in line.
  const setSignup = useCallback(async (practiceId, playerId, status) => {
    const prev = signups.find((r) => r.practice_id === practiceId && r.player_id === playerId)
    if (prev?.status === status) return
    const row = { practice_id: practiceId, player_id: playerId, status, updated_at: new Date().toISOString() }
    setSignups((all) => [...all.filter((r) => r !== prev), row])
    const { error: e } = await supabase.from('usta_practice_signups').upsert(row, { onConflict: 'practice_id,player_id' })
    if (e) { setError('Could not save — check your signal'); loadPractice() }
    else setError(null)
  }, [signups, loadPractice])

  const reportLights = useCallback(async (court, ok, playerId) => {
    const { error: e } = await supabase.from('usta_court_reports').insert({ court, lights_ok: ok, player_id: playerId })
    if (e) throw new Error(e.message)
    await loadPractice()
  }, [loadPractice])

  const lineupFor = useCallback(
    (matchId) => lineups.filter((l) => l.match_id === matchId).sort((a, b) => a.court - b.court),
    [lineups],
  )

  // Players correct their own name and gender on the way in, same trust model as
  // availability. Phone and Venmo changes are refused server-side without the
  // captain passcode, so it rides along whenever this device has one.
  const saveProfile = useCallback(async (id, fields) => {
    const { error: e } = await supabase.rpc('usta_update_profile', {
      p_id: id,
      p_preferred_name: fields.preferredName ?? null,
      p_phone: fields.phone ?? null,
      p_gender: fields.gender ?? null,
      p_venmo: fields.venmo ?? null,
      p_pass: captainPass,
    })
    if (e) throw new Error(e.message)
    await load()
  }, [captainPass, load])

  // ---- captain ----
  const unlockCaptain = useCallback(async (pass) => {
    const { data, error: e } = await supabase.rpc('usta_verify_captain', { p_pass: pass })
    if (e) throw new Error('Could not check the password')
    if (!data) return false
    setCaptainPass(pass); setPassState(pass); setCaptainLocked(false)
    return true
  }, [])

  const lockCaptain = useCallback(() => { setCaptainPass(null); setPassState(null); setCaptainLocked(true) }, [])

  // Roster captains shouldn't have to type the passcode: it comes from the build
  // settings and is still verified server-side, so a stale value just brings the
  // prompt back. A deliberate "Lock" wins until the captain unlocks again.
  const autoPass = import.meta.env.VITE_CAPTAIN_PASS || ''
  const [captainPending, setCaptainPending] = useState(false)
  useEffect(() => {
    if (!me?.is_captain || captainPass || !autoPass || getCaptainLocked()) return
    let cancelled = false
    setCaptainPending(true)
    unlockCaptain(autoPass).catch(() => false).finally(() => { if (!cancelled) setCaptainPending(false) })
    return () => { cancelled = true }
  }, [me, captainPass, autoPass, unlockCaptain])

  // UTR ratings are for captains only. The table is unreadable from the browser;
  // they arrive through a passcode-checked function once captain tools are
  // unlocked, and go away again on lock.
  const [ratings, setRatings] = useState({})
  useEffect(() => {
    if (!captainPass) { setRatings({}); return }
    let cancelled = false
    supabase.rpc('usta_captain_ratings', { p_pass: captainPass }).then(({ data, error: e }) => {
      if (cancelled || e) return
      const map = {}
      for (const r of data || []) map[r.player_id] = r
      setRatings(map)
    })
    return () => { cancelled = true }
  }, [captainPass])
  const ratingOf = useCallback((pid) => ratings[pid] || null, [ratings])

  const rpc = useCallback(async (fn, args) => {
    const { data, error: e } = await supabase.rpc(fn, { p_pass: captainPass, ...args })
    if (e) throw new Error(e.message)
    await Promise.all([load(), loadPractice()])
    return data
  }, [captainPass, load, loadPractice])

  const value = {
    players, matches, availability, lineups, loading, error, reload: load,
    me, myId, chooseMe, setAvail, availOf, lineupFor, saveProfile,
    practices, signups, courtReports, practiceError, setSignup, reportLights,
    isCaptain: !!captainPass, captainPending, unlockCaptain, lockCaptain, ratingOf,
    saveLineup: (matchId, courts) => rpc('usta_save_lineup', { p_match_id: matchId, p_courts: courts }),
    saveResults: (matchId, results) => rpc('usta_save_results', { p_match_id: matchId, p_results: results }),
    publishLineup: (matchId, published) => rpc('usta_publish_lineup', { p_match_id: matchId, p_published: published }),
    updateMatch: (matchId, startsAt, site, notes) =>
      rpc('usta_update_match', { p_match_id: matchId, p_starts_at: startsAt, p_site: site, p_notes: notes }),
    addPlayer: (fields) => rpc('usta_upsert_player', {
      p_id: null, p_name: fields.name, p_gender: fields.gender,
      p_ntrp: fields.ntrp ?? null, p_phone: fields.phone || null, p_active: true,
      p_usta_number: fields.ustaNumber || null,
    }),
    // Anyone can post a practice; the database lets its poster or a captain
    // change it. Resolves to the practice id.
    savePractice: (id, f) => rpc('usta_save_practice', {
      p_player_id: myId, p_id: id, p_starts_at: f.startsAt, p_minutes: f.minutes, p_site: f.site,
      p_courts: f.courts ?? null, p_notes: f.notes || null,
    }),
    cancelPractice: (id, cancelled) => rpc('usta_cancel_practice', { p_player_id: myId, p_id: id, p_cancelled: cancelled }),
    deletePractice: (id) => rpc('usta_delete_practice', { p_player_id: myId, p_id: id }),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useNow = (intervalMs = 60000) => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = setInterval(tick, intervalMs)
    // Timers stall while the phone is asleep or the tab is backgrounded, so a
    // match that finished overnight would still read as upcoming on wake.
    const onWake = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [intervalMs])
  return now
}
