import { useState } from 'react'
import { Avatar, displayName } from './ui'
import { formatPhone } from '../lib/phone'

// Shown when a player first opens their invite link, from Stats → Edit my
// details, and to a captain editing someone from the roster (greet={false}).
// Everything is pre-filled from the roster. The phone number is required: it's
// how the player signs in, and how the captain reaches them.
export default function ProfileForm({ player, onSave, onBack, saveLabel = "Yep, that's me", busy, greet = true }) {
  const [preferredName, setPreferredName] = useState(displayName(player))
  const [phone, setPhone] = useState(formatPhone(player.phone))
  const [email, setEmail] = useState(player.email || '')
  const [gender, setGender] = useState(player.gender)
  const [venmo, setVenmo] = useState(player.venmo || '')
  const [err, setErr] = useState('')

  const submit = async () => {
    if (!preferredName.trim()) { setErr('Give us something to call you.'); return }
    if (!phone.trim()) { setErr('Add a phone number. It\'s how you sign in.'); return }
    setErr('')
    try {
      await onSave({
        // storing the roster name again would just be noise
        preferredName: preferredName.trim() === player.name ? null : preferredName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        gender,
        venmo: venmo.trim(),
      })
    } catch (e) {
      setErr(e.message || 'Could not save — check your signal.')
    }
  }

  return (
    <>
      {greet && (
        <div className="center">
          <Avatar player={{ ...player, preferred_name: preferredName, gender }} lg />
          <h1 className="h1 mt">Hi, {preferredName.split(' ')[0] || 'there'}</h1>
          <p className="sub">Check these over — you can change any of it now or later.</p>
        </div>
      )}

      <div className={`card fieldset ${greet ? 'mt2' : ''}`}>
        <Field label="Preferred name" hint={`On the USTA roster as ${player.name}`}>
          <input type="text" value={preferredName} autoComplete="name"
                 onChange={(e) => setPreferredName(e.target.value)} />
        </Field>

        <Field label="Phone" hint="Signs you in, and how the captain reaches you about a match">
          <input type="tel" inputMode="tel" value={phone} placeholder="206-555-0134"
                 autoComplete="tel" onChange={(e) => setPhone(e.target.value)} />
        </Field>

        <Field label="Email" hint="Optional">
          <input type="email" inputMode="email" value={email} placeholder="you@example.com"
                 autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck="false"
                 onChange={(e) => setEmail(e.target.value)} />
        </Field>

        <Field label="Plays as" hint="Every court is one man and one woman">
          <div className="seg">
            {[['F', 'Woman'], ['M', 'Man']].map(([g, label]) => (
              <button key={g} type="button"
                      className={`seg-btn ${gender === g ? 'on' : ''}`}
                      aria-pressed={gender === g}
                      onClick={() => setGender(g)}>
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Venmo" hint="For splitting court fees. Optional.">
          <div className="prefixed">
            <span className="prefix">@</span>
            <input type="text" value={venmo} placeholder="your-venmo" autoCapitalize="none"
                   autoCorrect="off" spellCheck="false"
                   onChange={(e) => setVenmo(e.target.value.replace(/^@+/, ''))} />
          </div>
        </Field>
      </div>

      {err && <div className="notice bad mt">{err}</div>}

      <div className="stack mt2">
        <button className="btn primary wide" disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : `${saveLabel}${greet ? ' 🎾' : ''}`}
        </button>
        {onBack && <button className="btn ghost wide" onClick={onBack}>Back</button>}
      </div>
    </>
  )
}

const Field = ({ label, hint, children }) => (
  <div>
    <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
    {children}
    {hint && <div className="tiny" style={{ marginTop: 5 }}>{hint}</div>}
  </div>
)
