import { Route, Routes } from 'react-router'

import Layout from './components/Layout'
import StatusMessage from './components/StatusMessage'
import RequireAuth from './components/RequireAuth'
import Landing from './pages/Landing'
import Login from './pages/Login'
import SharePage from './pages/SharePage'
import Signup from './pages/Signup'
import TripPage from './pages/TripPage'
import Trips from './pages/Trips'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="u/:username/:slug" element={<SharePage />} />
        <Route
          path="trips"
          element={
            <RequireAuth>
              <Trips />
            </RequireAuth>
          }
        />
        <Route
          path="trips/:id"
          element={
            <RequireAuth>
              <TripPage />
            </RequireAuth>
          }
        />
        <Route
          path="*"
          element={<StatusMessage title="Page not found" body="That page doesn't exist." />}
        />
      </Route>
    </Routes>
  )
}
