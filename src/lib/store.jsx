import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase'

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
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  // Who this phone is signed in as: undefined while checking, null when signed
  // out, else { player_id, has_pin } from usta_whoami.
  const [who, setWho] = useState(undefined)
  const myId = who?.player_id || null
  const signedIn = !!myId

  const refreshWho = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setWho(null); return null }
    const { data, error: e } = await supabase.rpc('usta_whoami')
    if (e) throw e
    setWho(data || null)
    return data || null
  }, [])

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
      setLoaded(true)
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

  const clear = useCallback(() => {
    setPlayers([]); setMatches([]); setAvailability({}); setLineups([])
    setPractices([]); setSignups([]); setCourtReports([]); setLoaded(false); setError(null)
  }, [])

  // Signed out, nothing is readable, so there's nothing to load; what an
  // earlier player loaded is cleared rather than left on screen.
  const start = useCallback(async () => {
    try {
      setError(null)
      const w = await refreshWho()
      if (w?.player_id) await Promise.all([load(), loadPractice()])
      else clear()
    } catch (e) {
      setError(e.message || 'Could not reach the server')
    }
  }, [refreshWho, load, loadPractice, clear])

  useEffect(() => { start() }, [start])


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
    if (!signedIn) return
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_players' }, scheduleLoad)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_practices' }, loadPractice)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_practice_signups' }, loadPractice)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usta_court_reports' }, loadPractice)
      .subscribe()

    // a captain may have signed this phone out while it slept
    const onVisible = () => { if (!document.hidden) start() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
      clearTimeout(reloadTimer.current)
    }
  }, [signedIn, start, scheduleLoad, loadPractice])

  const me = useMemo(() => players.find((p) => p.id === myId) || null, [players, myId])
  const isCaptain = !!me?.is_captain

  // ---- signing in ----
  // Every phone gets a Supabase anonymous session; an invite link or the
  // player's phone number and PIN ties that session to them (usta_link_device).
  const ensureSession = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session) return
    const { error: e } = await supabase.auth.signInAnonymously()
    if (e) throw new Error(/disabled/i.test(e.message) ? "Sign-in isn't switched on yet. Tell a captain." : e.message)
  }, [])

  // Resolves to usta_pin_sign_in's answer: { ok } or { ok: false, reason }.
  const signIn = useCallback(async (phone, pin) => {
    await ensureSession()
    const { data, error: e } = await supabase.rpc('usta_pin_sign_in', { p_phone: phone, p_pin: pin })
    if (e) throw new Error(e.message)
    if (data.ok) {
      setWho({ player_id: data.player_id, has_pin: data.has_pin })
      await Promise.all([load(), loadPractice()])
    }
    return data
  }, [ensureSession, load, loadPractice])

  // Setting up without an invite, while the team allows it (usta_sign_up).
  // checkSignUp resolves to { status: 'new', name } | has_pin | nomatch | closed.
  const checkSignUp = useCallback(async (phone) => {
    await ensureSession()
    const { data, error: e } = await supabase.rpc('usta_sign_up_check', { p_phone: phone })
    if (e) throw new Error(e.message)
    return data
  }, [ensureSession])

  const signUp = useCallback(async (phone, pin) => {
    await ensureSession()
    const { data, error: e } = await supabase.rpc('usta_sign_up', { p_phone: phone, p_pin: pin })
    if (e) throw new Error(e.message)
    setWho(data)
    await Promise.all([load(), loadPractice()])
    return data
  }, [ensureSession, load, loadPractice])

  const join = useCallback(async (token) => {
    await ensureSession()
    const { data, error: e } = await supabase.rpc('usta_redeem_invite', { p_token: token })
    if (e) throw new Error(e.message)
    setWho(data)
    await Promise.all([load(), loadPractice()])
    return data
  }, [ensureSession, load, loadPractice])

  const setPin = useCallback(async (pin, current) => {
    const { error: e } = await supabase.rpc('usta_set_pin', { p_pin: pin, p_current_pin: current || null })
    if (e) throw new Error(e.message)
    setWho((w) => w && { ...w, has_pin: true })
  }, [])

  // Unlinks the player but keeps the anonymous session, so signing back in on
  // this phone doesn't leave an orphaned one behind.
  const signOut = useCallback(async () => {
    const { error: e } = await supabase.rpc('usta_sign_out')
    if (e) throw new Error(e.message)
    setWho(null)
    clear()
  }, [clear])

  // Loading until we know who this is, then until their season has arrived.
  // A failed check isn't "signed out": it shows the can't-reach-the-server screen.
  const loading = (who === undefined && !error) || (signedIn && !loaded)

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

  // Re-tapping "I'm in" is a no-op, so names keep the order people answered in.
  const setSignup = useCallback(async (practiceId, playerId, status) => {
    const prev = signups.find((r) => r.practice_id === practiceId && r.player_id === playerId)
    if (prev?.status === status) return
    const row = { practice_id: practiceId, player_id: playerId, status, updated_at: new Date().toISOString() }
    // match on the key, not object identity: a realtime refetch can replace the
    // array between render and tap, and an identity check would keep a stale row
    setSignups((all) => [...all.filter((r) => !(r.practice_id === practiceId && r.player_id === playerId)), row])
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

  // Your own details, or anyone's for a captain; the database enforces which.
  const saveProfile = useCallback(async (id, fields) => {
    const { error: e } = await supabase.rpc('usta_update_profile', {
      p_id: id,
      p_preferred_name: fields.preferredName ?? null,
      p_phone: fields.phone ?? null,
      p_gender: fields.gender ?? null,
      p_venmo: fields.venmo ?? null,
      p_email: fields.email ?? null,
    })
    if (e) throw new Error(e.message)
    await load()
  }, [load])

  // ---- captain ----
  // Captain powers come from is_captain on the roster, checked by the database
  // on every call (usta_is_captain).

  // UTR ratings are for captains only. The table is unreadable from the browser;
  // they arrive through a captain-checked function.
  const [ratings, setRatings] = useState({})
  useEffect(() => {
    if (!isCaptain) { setRatings({}); return }
    let cancelled = false
    supabase.rpc('usta_captain_ratings').then(({ data, error: e }) => {
      if (cancelled || e) return
      const map = {}
      for (const r of data || []) map[r.player_id] = r
      setRatings(map)
    })
    return () => { cancelled = true }
  }, [isCaptain])
  const ratingOf = useCallback((pid) => ratings[pid] || null, [ratings])

  const call = useCallback(async (fn, args) => {
    const { data, error: e } = await supabase.rpc(fn, args)
    if (e) throw new Error(e.message)
    return data
  }, [])

  const openSignUp = useCallback(() => call('usta_open_sign_up'), [call])

  // a write the whole team sees: refetch so this phone shows it right away
  const rpc = useCallback(async (fn, args) => {
    const data = await call(fn, args)
    await Promise.all([load(), loadPractice()])
    return data
  }, [call, load, loadPractice])

  const value = {
    players, matches, availability, lineups, loading, error, reload: start,
    who, me, myId, signIn, checkSignUp, signUp, join, setPin, signOut,
    setAvail, availOf, lineupFor, saveProfile,
    practices, signups, courtReports, practiceError, setSignup, reportLights,
    isCaptain, ratingOf,
    saveLineup: (matchId, courts) => rpc('usta_save_lineup', { p_match_id: matchId, p_courts: courts }),
    saveResults: (matchId, results) => rpc('usta_save_results', { p_match_id: matchId, p_results: results }),
    publishLineup: (matchId, published) => rpc('usta_publish_lineup', { p_match_id: matchId, p_published: published }),
    updateMatch: (matchId, startsAt, site, notes) =>
      rpc('usta_update_match', { p_match_id: matchId, p_starts_at: startsAt, p_site: site, p_notes: notes }),
    // Resolves to the new player's id.
    addPlayer: (fields) => rpc('usta_upsert_player', {
      p_id: null, p_name: fields.name, p_gender: fields.gender,
      p_ntrp: fields.ntrp ?? null, p_phone: fields.phone || null, p_active: true,
      p_usta_number: fields.ustaNumber || null,
    }),
    // Resolves to the token; the link is inviteLink(token).
    createInvite: (playerId) => call('usta_create_invite', { p_player_id: playerId }),
    rosterAccess: () => call('usta_roster_access'),
    unlockPin: (playerId) => call('usta_unlock_pin', { p_player_id: playerId }),
    signOutPlayer: (playerId) => call('usta_sign_out_player', { p_player_id: playerId }),
    setCaptain: (playerId, on) => rpc('usta_set_captain', { p_player_id: playerId, p_on: on }),
    openSignUp,
    setOpenSignUp: (on) => call('usta_set_open_sign_up', { p_on: on }),
    // Anyone can post a practice; the database lets its poster or a captain
    // change it. Resolves to the practice id.
    savePractice: (id, f) => rpc('usta_save_practice', {
      p_id: id, p_starts_at: f.startsAt, p_minutes: f.minutes, p_site: f.site,
      p_courts: f.courts ?? null, p_notes: f.notes || null,
    }),
    cancelPractice: (id, cancelled) => rpc('usta_cancel_practice', { p_id: id, p_cancelled: cancelled }),
    deletePractice: (id) => rpc('usta_delete_practice', { p_id: id }),
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
