import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

import App from './App'
import Admin from './pages/Admin'
import Chat from './pages/Chat'
import Client from './pages/Client'
import Driver from './pages/Driver'
import Login from './pages/Login'
import Register from './pages/Register'
import Trips from './pages/Trips'

const routes = {
  '/': App,
  '/login': Login,
  '/registro': Register,
  '/client': Client,
  '/driver': Driver,
  '/viajes': Trips,
  '/chat': Chat,
  '/admin': Admin,
}

const Component = routes[window.location.pathname] || App

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Component />
  </React.StrictMode>
)
