import { useState } from 'react'
import { useTeam } from '../lib/store'

// For a new phone, or one iOS wiped after a week away. The first time on any
// phone is the invite link a captain sends; this is every time after that.
export default function SignIn() {
  const { signIn } = useTeam()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await signIn(phone, pin)
      if (r.ok) return
      setPin('')
      setErr(r.reason === 'locked'
        ? 'Too many wrong tries, so this PIN is locked. Ask a captain to unlock it or send you a new link.'
        : "That phone number and PIN don't match. First time here? Open the invite link your captain sent you.")
    } catch (e2) {
      setErr(e2.message || "Couldn't reach the server. Check your signal.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12vh)' }}>
      <div style={{ fontSize: 52, lineHeight: 1 }}>🦙</div>
      <div className="eyebrow mt">Volley Llama · Fall 2026</div>
      <h1 className="h1" style={{ marginTop: 6 }}>Sign in</h1>
      <p className="sub">Your phone number and the 8-digit PIN you chose.</p>

      <form onSubmit={submit} className="stack mt2" style={{ textAlign: 'left' }}>
        <input
          type="tel" inputMode="tel" autoComplete="tel username" value={phone}
          placeholder="Phone number" aria-label="Phone number" autoFocus
          onChange={(e) => { setPhone(e.target.value); setErr('') }}
        />
        <PinInput value={pin} placeholder="8-digit PIN" autoComplete="current-password"
                  onChange={(v) => { setPin(v); setErr('') }} />
        {err && <div className="notice bad">{err}</div>}
        <button className="btn primary wide" disabled={busy || !phone.trim() || pin.length !== 8}>
          {busy ? 'Checking…' : 'Sign in 🎾'}
        </button>
      </form>
    </div>
  )
}

// Digits only, eight at most, hidden like a password so a password manager
// offers to save it.
export const PinInput = ({ value, onChange, placeholder, autoComplete = 'new-password', autoFocus }) => (
  <input
    type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8}
    autoComplete={autoComplete} autoFocus={autoFocus} value={value}
    placeholder={placeholder} aria-label={placeholder} className="num"
    onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 8))}
  />
)
