import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'
import { AuthProvider } from './pages/AuthContext'
import PerformanceBootstrap from './components/PerformanceBootstrap'
import { PerformanceProvider } from './context/PerformanceContext'

import App from './App'
import Admin from './pages/Admin'
import Chat from './pages/Chat'
import Client from './pages/Client'
import DeleteAccount from './pages/DeleteAccount'
import Driver from './pages/Driver'
import Login from './pages/Login'
import Privacy from './pages/Privacy'
import Register from './pages/Register'
import Support from './pages/Support'
import Terms from './pages/Terms'
import Trips from './pages/Trips'

const routes = {
  '/': App,
  '/login': Login,
  '/registro': Register,
  '/client': Client,
  '/driver': Driver,
  '/viajes': Trips,
  '/chat': Chat,
  '/admin': Admin, // Mantener Admin en pages por su complejidad
  '/privacy': Privacy,
  '/terms': Terms,
  '/delete-account': DeleteAccount,
  '/support': Support,
}

const currentPath = window.location.pathname
const Component = routes[currentPath] || App
const routeName = currentPath === '/' ? 'home' : currentPath.replace('/', '')

document.body.dataset.route = routeName
document.body.classList.add(`route-${routeName}`)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <PerformanceProvider>
        <PerformanceBootstrap>
          <Component />
        </PerformanceBootstrap>
      </PerformanceProvider>
    </AuthProvider>
  </React.StrictMode>
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('SERVICE WORKER REGISTRATION ERROR:', error)
    })
  })
}
