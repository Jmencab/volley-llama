import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTeam } from '../lib/store'
import { displayName } from './ui'
import ProfileForm from './ProfileForm'
import PinForm, { PinIntro } from './PinForm'

// An invite works once, and StrictMode runs effects twice in development, so
// the redemption is shared rather than repeated.
let redeeming = null

// /join#t=<token>: the link a captain sends. Opening it signs this phone in,
// then the player checks their details and chooses a PIN for next time.
export default function Join({ token }) {
  const { who, me, join, saveProfile, error } = useTeam()
  const nav = useNavigate()
  const [step, setStep] = useState(token ? 'opening' : 'failed')
  const [err, setErr] = useState(token ? '' : "This link is missing its code. Ask a captain to send it again.")
  const [busy, setBusy] = useState(false)
  // whether they had a PIN before this link, so they can keep it
  const [hadPin, setHadPin] = useState(false)

  useEffect(() => {
    // wait for the startup check, or its answer could land after ours
    if (!token || who === undefined) return
    redeeming ??= join(token)
    redeeming
      .then((w) => { setHadPin(!!w?.has_pin); setStep((s) => (s === 'opening' ? 'profile' : s)) })
      .catch((e) => { setErr(e.message); setStep('failed') })
  }, [token, who, join])

  const home = () => nav('/', { replace: true })

  // the startup check itself failed: no signal, most likely
  if (step === 'failed' || (who === undefined && error)) {
    return (
      <div className="app center" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14vh)' }}>
        <div style={{ fontSize: 44, lineHeight: 1 }}>🔗</div>
        <h1 className="h1 mt">That link didn't work</h1>
        <p className="sub">{err || error}</p>
        {who?.player_id && me && <p className="sub">This phone is already signed in as {displayName(me)}.</p>}
        <button className="btn primary wide mt2" onClick={home}>
          {who?.player_id ? 'Open the app' : 'Sign in with your PIN'}
        </button>
      </div>
    )
  }

  if (step === 'opening' || !me) {
    return (
      <div className="app center" style={{ paddingTop: '38vh' }}>
        <div className="loader"><div className="ball">🎾</div><div className="ball-shadow" /></div>
        <p className="sub mt2">Opening your invite…</p>
      </div>
    )
  }

  if (step === 'profile') {
    return (
      <div className="app page" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 6vh)' }}>
        <ProfileForm
          player={me}
          busy={busy}
          saveLabel="Looks right"
          onSave={async (fields) => {
            setBusy(true)
            try { await saveProfile(me.id, fields); setStep('pin') } finally { setBusy(false) }
          }}
        />
      </div>
    )
  }

  return (
    <div className="app page" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8vh)' }}>
      <PinIntro />
      <div className="mt2">
        <PinForm onDone={home} onKeep={hadPin ? home : null} saveLabel="Save PIN 🎾" />
      </div>
    </div>
  )
}
