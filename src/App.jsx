import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { TeamProvider, useTeam } from './lib/store'
import { consumeUrlKey, getTeamOk } from './lib/identity'
import { slideDirection } from './lib/nav'
import NameGate from './components/NameGate'
import TabBar from './components/TabBar'
import TeamGate from './components/TeamGate'
import CaptainGate from './components/CaptainGate'
import Splash, { PLAY_SPLASH } from './components/Splash'
import Home from './pages/Home'
import Schedule from './pages/Schedule'
import Practice from './pages/Practice'
import MatchDetail from './pages/MatchDetail'
import Team from './pages/Team'
import Captain from './pages/Captain'
import CaptainMatch from './pages/CaptainMatch'

// Consume ?key=... before anything renders, so an unlocked link never flashes
// the password screen.
consumeUrlKey()

function Shell() {
  const { loading, error, players, me, reload } = useTeam()
  const location = useLocation()
  const [teamOk, setTeamOkState] = useState(getTeamOk)

  // remember where we came from so the next page can slide in from that side
  const [trail, setTrail] = useState({ path: location.pathname, dir: '' })
  if (trail.path !== location.pathname) {
    setTrail({ path: location.pathname, dir: slideDirection(trail.path, location.pathname) })
  }

  useEffect(() => { window.scrollTo(0, 0) }, [location.pathname])

  if (!teamOk) return <TeamGate onUnlock={() => setTeamOkState(true)} />

  if (loading) {
    return (
      <div className="app center" style={{ paddingTop: '38vh' }}>
        <div className="loader">
          <div className="ball">🎾</div>
          <div className="ball-shadow" />
        </div>
        <p className="sub mt2">Warming up…</p>
      </div>
    )
  }

  if (error && players.length === 0) {
    return (
      <div className="app center" style={{ paddingTop: '33vh' }}>
        <div style={{ fontSize: 40 }}>🎾💨</div>
        <h2 className="h2 mt">Can't reach the server</h2>
        <p className="sub">{error}</p>
        <button className="btn primary mt" onClick={reload}>Try again</button>
      </div>
    )
  }

  if (!me) return <NameGate />

  return (
    <>
      <div className={`page ${trail.dir}`.trim()} key={location.pathname}>
        <Routes location={location}>
          <Route path="/" element={<Home />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/match/:id" element={<MatchDetail />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/team" element={<Team />} />
          <Route path="/captain" element={<CaptainGate><Captain /></CaptainGate>} />
          <Route path="/captain/:id" element={<CaptainGate><CaptainMatch /></CaptainGate>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <TabBar />
    </>
  )
}

// Lives inside the provider so the splash can hold the curtains until the season
// has actually loaded, instead of handing off to a second loading screen.
function Intro({ onOpen, onDone }) {
  const { loading } = useTeam()
  return <Splash ready={!loading} onOpen={onOpen} onDone={onDone} />
}

export default function App() {
  const [phase, setPhase] = useState(PLAY_SPLASH ? 'splash' : 'done')
  const onOpen = useCallback(() => setPhase('opening'), [])
  const onDone = useCallback(() => setPhase('done'), [])

  return (
    <TeamProvider>
      <div className={phase === 'opening' ? 'stage-open' : undefined}>
        <Shell />
      </div>
      {phase !== 'done' && <Intro onOpen={onOpen} onDone={onDone} />}
    </TeamProvider>
  )
}
