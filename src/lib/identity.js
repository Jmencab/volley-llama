// Links into the app. Who's signed in lives in the store (a Supabase session
// tied to a player by usta_whoami); this is just the URL side of it.

export const appLink = (path) => `${window.location.origin}${path}`

// An invite is /join#t=<token>. The token rides in the fragment, which browsers
// never send to a server, so it stays out of Netlify's logs and out of the
// link previews WhatsApp and Messages fetch.
export const inviteLink = (token) => `${window.location.origin}/join#t=${token}`

// Read once at startup, then wiped from the address bar: the link works only
// once, and a leftover token would just fail on the next reload.
export function takeInviteToken() {
  try {
    const m = /[#&]t=([A-Za-z0-9_-]+)/.exec(window.location.hash)
    if (!m) return null
    window.history.replaceState({}, '', window.location.pathname)
    return m[1]
  } catch { return null }
}

// Links sent before sign-in existed carry the old team password (?key=...).
// It does nothing now; drop it so it doesn't linger in the address bar.
export function dropOldKey() {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('key')) return
    url.searchParams.delete('key')
    window.history.replaceState({}, '', url.pathname + url.search + url.hash)
  } catch { /* very old browser: harmless to leave */ }
}
