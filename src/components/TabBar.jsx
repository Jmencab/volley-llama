import { NavLink } from 'react-router-dom'
import { useTeam } from '../lib/store'

const Tab = ({ to, glyph, label, end }) => (
  <NavLink to={to} end={end} className={({ isActive }) => `tab ${isActive ? 'on' : ''}`}>
    <span className="glyph">{glyph}</span>
    <span>{label}</span>
  </NavLink>
)

export default function TabBar() {
  // the tab shows for anyone unlocked OR anyone signed in as a roster captain —
  // the latter still meet the passcode on first tap
  const { isCaptain, me } = useTeam()
  const showCaptain = isCaptain || me?.is_captain
  return (
    <nav className="tabs">
      <div className="tabs-inner">
        <Tab to="/" glyph="🎾" label="HOME" end />
        <Tab to="/schedule" glyph="📅" label="SCHEDULE" />
        <Tab to="/practice" glyph="🏃" label="PRACTICE" />
        <Tab to="/team" glyph="🦙" label="STATS" />
        {showCaptain && <Tab to="/captain" glyph="📋" label="CAPTAIN" />}
      </div>
    </nav>
  )
}
