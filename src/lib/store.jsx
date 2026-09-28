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

  useEffect(() => { load() }, [load])

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
      .subscribe()

    const onVisible = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(reloadTimer.current)
    }
  }, [load, scheduleLoad])

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

  const rpc = useCallback(async (fn, args) => {
    const { error: e } = await supabase.rpc(fn, { p_pass: captainPass, ...args })
    if (e) throw new Error(e.message)
    await load()
  }, [captainPass, load])

  const value = {
    players, matches, availability, lineups, loading, error, reload: load,
    me, myId, chooseMe, setAvail, availOf, lineupFor, saveProfile,
    isCaptain: !!captainPass, captainPending, unlockCaptain, lockCaptain,
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
