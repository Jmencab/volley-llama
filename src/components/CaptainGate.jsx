import { Navigate } from 'react-router-dom'
import { useTeam } from '../lib/store'

// Captains are whoever is_captain marks on the roster. This only hides the
// pages; the database checks usta_is_captain() on every captain write.
export default function CaptainGate({ children }) {
  const { isCaptain } = useTeam()
  return isCaptain ? children : <Navigate to="/team" replace />
}
