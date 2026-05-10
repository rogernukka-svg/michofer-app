import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles.css'

import App from './App'
import Login from './pages/Login'
import Register from './pages/Register'
import Driver from './pages/Driver'
import Trips from './pages/Trips'
import Chat from './pages/Chat'
import Admin from './pages/Admin'

const path = window.location.pathname

let Component = App

if (path === '/login') Component = Login
if (path === '/registro') Component = Register
if (path === '/driver') Component = Driver
if (path === '/viajes') Component = Trips
if (path === '/chat') Component = Chat
if (path === '/admin') Component = Admin

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Component />
  </React.StrictMode>,
)