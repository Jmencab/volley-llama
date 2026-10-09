import { useState } from 'react'
import { useTeam } from '../lib/store'
import { PinInput } from './SignIn'

// Choosing or changing the PIN. The database has the final say on what's too
// easy to guess; this only checks length and that the two entries agree.
// needCurrent: changing an existing PIN outside the invite flow.
// onKeep: offered when the player already has a PIN and came in on a link.
export default function PinForm({ needCurrent, onKeep, onDone, saveLabel = 'Save PIN' }) {
  const { setPin } = useTeam()
  const [current, setCurrent] = useState('')
  const [pin, setPinValue] = useState('')
  const [again, setAgain] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (pin !== again) { setErr("Those two PINs don't match."); return }
    setBusy(true); setErr('')
    try {
      await setPin(pin, needCurrent ? current : null)
      onDone()
    } catch (e2) {
      setErr(e2.message || 'Could not save. Check your signal.')
    } finally {
      setBusy(false)
    }
  }

  const ready = pin.length === 8 && again.length === 8 && (!needCurrent || current.length === 8)

  return (
    <form onSubmit={submit} className="stack">
      {needCurrent && <PinInput value={current} onChange={setCurrent} placeholder="Current PIN" autoComplete="current-password" autoFocus />}
      <PinInput value={pin} onChange={(v) => { setPinValue(v); setErr('') }} placeholder="New 8-digit PIN" autoFocus={!needCurrent} />
      <PinInput value={again} onChange={(v) => { setAgain(v); setErr('') }} placeholder="Same PIN again" />
      <div className="tiny">Not your phone number or a run like 12345678.</div>
      {err && <div className="notice bad">{err}</div>}
      <button className="btn primary wide" disabled={busy || !ready}>{busy ? 'Saving…' : saveLabel}</button>
      {onKeep && <button type="button" className="btn ghost wide" onClick={onKeep}>Keep my current PIN</button>}
    </form>
  )
}

// Full-screen version, for a player who opened their link but left before
// choosing a PIN. Without one they couldn't get back in on another phone.
export function PinScreen() {
  return (
    <div className="app page" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8vh)' }}>
      <PinIntro />
      <div className="mt2"><PinForm onDone={() => {}} saveLabel="Save PIN 🎾" /></div>
    </div>
  )
}

export const PinIntro = () => (
  <div className="center">
    <div style={{ fontSize: 44, lineHeight: 1 }}>🔐</div>
    <h1 className="h1 mt">Choose a PIN</h1>
    <p className="sub">8 digits. With your phone number, it signs you in on any phone.</p>
  </div>
)
