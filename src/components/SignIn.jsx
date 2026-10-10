import { useState } from 'react'
import { useTeam } from '../lib/store'
import { firstName } from './ui'

// For a new phone, or one iOS wiped after a week away. The very first time is
// "First time here?" (while the team allows it) or an invite link from a captain.
export default function SignIn() {
  const { signIn } = useTeam()
  const [firstTime, setFirstTime] = useState(false)
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
        : "That phone number and PIN don't match.")
    } catch (e2) {
      setErr(e2.message || "Couldn't reach the server. Check your signal.")
    } finally {
      setBusy(false)
    }
  }

  if (firstTime) return <FirstTime phone={phone} onBack={() => setFirstTime(false)} />

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
      <button className="btn ghost wide mt2" onClick={() => setFirstTime(true)}>First time here? Choose your PIN</button>
    </div>
  )
}

// Setting up without an invite: the phone number on the roster, then a PIN.
// The database decides whether that's allowed (usta_sign_up); a team that has
// turned it off is pointed to the invite link instead.
function FirstTime({ phone: typed, onBack }) {
  const { checkSignUp, signUp } = useTeam()
  const [phone, setPhone] = useState(typed)
  const [found, setFound] = useState(null) // { name } once the number checks out
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const lookUp = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await checkSignUp(phone)
      if (r.status === 'new') setFound({ name: r.name })
      else setErr({
        has_pin: 'This number already has a PIN. Go back and sign in with it. Forgot it? Ask a captain for a link.',
        closed: 'To join, open the invite link your captain sent you.',
      }[r.status] || "That number isn't on the team roster. Check it, or ask a captain to add it.")
    } catch (e2) {
      setErr(e2.message || "Couldn't reach the server. Check your signal.")
    } finally {
      setBusy(false)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    if (pin !== again) { setErr("Those two PINs don't match."); return }
    setBusy(true); setErr('')
    try {
      await signUp(phone, pin)
    } catch (e2) {
      setErr(e2.message || "Couldn't reach the server. Check your signal.")
      setBusy(false)
    }
  }

  return (
    <div className="app center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12vh)' }}>
      <div style={{ fontSize: 52, lineHeight: 1 }}>🦙</div>
      <div className="eyebrow mt">Volley Llama · Fall 2026</div>
      {!found ? (
        <>
          <h1 className="h1" style={{ marginTop: 6 }}>First time here?</h1>
          <p className="sub">Enter your phone number. It has to match the one the captains have for you.</p>
          <form onSubmit={lookUp} className="stack mt2" style={{ textAlign: 'left' }}>
            <input
              type="tel" inputMode="tel" autoComplete="tel username" value={phone}
              placeholder="Phone number" aria-label="Phone number" autoFocus
              onChange={(e) => { setPhone(e.target.value); setErr('') }}
            />
            {err && <div className="notice bad">{err}</div>}
            <button className="btn primary wide" disabled={busy || !phone.trim()}>{busy ? 'Checking…' : 'Next'}</button>
          </form>
        </>
      ) : (
        <>
          <h1 className="h1" style={{ marginTop: 6 }}>Hi {firstName(found.name)}!</h1>
          <p className="sub">Choose an 8-digit PIN. With your phone number, it signs you in on any phone.</p>
          <form onSubmit={save} className="stack mt2" style={{ textAlign: 'left' }}>
            {/* lets a password manager save the number with the PIN */}
            <input type="hidden" autoComplete="username" value={phone} readOnly />
            <PinInput value={pin} onChange={(v) => { setPin(v); setErr('') }} placeholder="New 8-digit PIN" autoFocus />
            <PinInput value={again} onChange={(v) => { setAgain(v); setErr('') }} placeholder="Same PIN again" />
            <div className="tiny">Not your phone number or a run like 12345678.</div>
            {err && <div className="notice bad">{err}</div>}
            <button className="btn primary wide" disabled={busy || pin.length !== 8 || again.length !== 8}>
              {busy ? 'Saving…' : 'Save PIN 🎾'}
            </button>
          </form>
          <p className="tiny mt">Not {firstName(found.name)}? Go back and check the number.</p>
        </>
      )}
      <button className="btn ghost wide mt" onClick={found ? () => { setFound(null); setPin(''); setAgain(''); setErr('') } : onBack}>
        Back
      </button>
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
