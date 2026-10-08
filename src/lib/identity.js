// Who am I on this device, and is captain mode unlocked here.
// No accounts: 13 people, an unlisted URL. The captain passcode is the only
// real gate, and it is verified server-side (usta_verify_captain).

const ME = 'vl_player_id'
const PASS = 'vl_captain_pass'

export const getMyId = () => {
  try { return localStorage.getItem(ME) } catch { return null }
}
export const setMyId = (id) => {
  try { id ? localStorage.setItem(ME, id) : localStorage.removeItem(ME) } catch { /* private mode */ }
}
export const getCaptainPass = () => {
  try { return localStorage.getItem(PASS) } catch { return null }
}
export const setCaptainPass = (pass) => {
  try { pass ? localStorage.setItem(PASS, pass) : localStorage.removeItem(PASS) } catch { /* private mode */ }
}

// Roster captains are unlocked automatically (see the store). Tapping "Lock"
// is a deliberate act, so it has to survive the next auto-unlock and a reload.
const LOCKED = 'vl_captain_locked'
export const getCaptainLocked = () => {
  try { return localStorage.getItem(LOCKED) === '1' } catch { return false }
}
export const setCaptainLocked = (on) => {
  try { on ? localStorage.setItem(LOCKED, '1') : localStorage.removeItem(LOCKED) } catch { /* private mode */ }
}

// ---- team gate ----
// Keeps drive-by visitors out if the URL leaks. Deliberately client-side and
// deliberately not secret-grade: the roster and schedule aren't state secrets,
// the real writes are guarded server-side, and the whole point is that Kevin
// can text a link with the password baked in (?key=TheVolleyLlama).
const TEAM_KEY = 'thevolleyllama' // compared lowercase so typers can't miss
const TEAM_OK = 'vl_team_ok'

// A link teammates can open straight into the app, password and all.
export const teamLink = (path) => `${window.location.origin}${path}${path.includes('?') ? '&' : '?'}key=${TEAM_KEY}`

export const checkTeamKey = (raw) => (raw || '').trim().toLowerCase() === TEAM_KEY

export const getTeamOk = () => {
  try { return localStorage.getItem(TEAM_OK) === '1' } catch { return true } // storage-less: let them in
}
export const setTeamOk = () => {
  try { localStorage.setItem(TEAM_OK, '1') } catch { /* private mode */ }
}

// A link like kgtennis.com/?key=TheVolleyLlama unlocks on open. Runs once at
// startup; strips the key from the address bar so it doesn't hang around.
export const consumeUrlKey = () => {
  try {
    const url = new URL(window.location.href)
    const raw = url.searchParams.get('key')
    if (raw === null) return
    if (checkTeamKey(raw)) setTeamOk()
    url.searchParams.delete('key')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  } catch { /* very old browser: the typed gate still works */ }
}
