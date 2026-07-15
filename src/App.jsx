import { useEffect, useMemo } from 'react'
import { ArrowRight, CarFront, LogIn, ShieldCheck, UserRound } from 'lucide-react'
import InstallMiChoferButton from './components/InstallMiChoferButton.jsx'
import InteractiveRouteMap from './components/InteractiveRouteMap.jsx'
import alexAvatar from './assets/roger-nunez-client.jpeg'
import logo from './assets/logo.png'
import rogerAvatar from './assets/alex-gonzalez-driver.jpeg'
import { useAuth } from './pages/AuthContext'

const alexLocation = {
  id: 'alex-gonzalez',
  name: 'Alex Gonzalez',
  lat: -25.5166,
  lng: -54.6262,
  avatar: alexAvatar,
}

const rogerLocation = {
  id: 'roger-nunez',
  name: 'Roger Nunez',
  lat: -25.5098,
  lng: -54.6128,
  avatar: rogerAvatar,
}

function homeRoutePadding() {
  return window.innerWidth >= 900
    ? { top: 110, bottom: 110, left: 500, right: 120 }
    : { top: 112, bottom: 430, left: 34, right: 34 }
}

export default function App() {
  const auth = useAuth()

  const signedInTarget = useMemo(() => {
    if (!auth.user) return ''

    const role =
      auth.profile?.role ||
      auth.user?.user_metadata?.role ||
      localStorage.getItem('michofer_last_role') ||
      'passenger'

    if (role === 'admin') return '/admin'
    if (role === 'driver') return '/driver'
    return '/client'
  }, [auth.profile?.role, auth.user])

  useEffect(() => {
    if (auth.loading || !signedInTarget) return

    const redirectId = window.setTimeout(() => {
      window.location.replace(signedInTarget)
    }, 420)

    return () => window.clearTimeout(redirectId)
  }, [auth.loading, signedInTarget])

  if (auth.loading || signedInTarget) {
    return (
      <main className="app-shell home-shell">
        <section className="phone home-phone home-premium home-session-boot">
          <img src={logo} alt="MiChofer" />
          <div className="home-session-loader" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <strong>Abriendo MiChofer</strong>
          <p>{signedInTarget === '/driver' ? 'Preparando tu panel de chofer.' : signedInTarget === '/admin' ? 'Entrando al panel admin.' : 'Preparando tu viaje.'}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell home-shell">
      <section className="phone home-phone home-premium">
        <header className="home-header">
          <div className="home-header-brand">
            <img src={logo} alt="MiChofer" />
          </div>

          <div className="home-header-actions">
            <InstallMiChoferButton className="home-install-btn" />
            <a className="home-login-link" href="/login">Entrar</a>
          </div>
        </header>

        <section className="home-map" aria-label="Vista de mapa MiChofer">
          <InteractiveRouteMap
            origin={alexLocation}
            destination={rogerLocation}
            destinationText="Roger Nunez"
            drivers={[]}
            selectedDriver={null}
            onSelectDriver={() => {}}
            onChooseDriver={() => {}}
            onRefreshLocation={() => {}}
            fitPadding={homeRoutePadding}
            mapInteractive={false}
            animateCamera={false}
          />

          <article className="home-driver-card driver-a">
            <img className="home-card-avatar" src={alexAvatar} alt="Alex Gonzalez" />
            <div>
              <strong>Alex Gonzalez</strong>
              <span>Chofer - 3 min</span>
            </div>
          </article>

          <article className="home-client-card">
            <img className="home-card-avatar" src={rogerAvatar} alt="Roger Nunez" />
            <div>
              <strong>Roger Nunez</strong>
              <span>Cliente esperando</span>
            </div>
          </article>
        </section>

        <section className="home-sheet home-sheet-compact home-role-gateway">
          <div className="home-sheet-top">
            <h1>¿Vas a viajar o manejar?</h1>
          </div>

          <p className="muted">
            Elegí tu entrada. Después te mostramos solo lo que necesitás.
          </p>

          <div className="home-role-grid" aria-label="Elegir experiencia MiChofer">
            <a className="home-role-card passenger" href="/registro?role=passenger">
              <span className="home-role-icon">
                <UserRound size={20} />
              </span>
              <span>
                <small>Pasajero</small>
                <strong>Viajar ahora</strong>
                <em>Pedir un viaje</em>
              </span>
              <ArrowRight size={18} />
            </a>

            <a className="home-role-card driver" href="/registro?role=driver">
              <span className="home-role-icon">
                <CarFront size={20} />
              </span>
              <span>
                <small>Chofer</small>
                <strong>Manejar con MiChofer</strong>
                <em>Recibir viajes</em>
              </span>
              <ArrowRight size={18} />
            </a>
          </div>

          <div className="home-secondary-actions">
            <a href="/login">
              <LogIn size={16} />
              Ya tengo cuenta
            </a>
            <a className="home-complete-profile-link" href="/registro">
              <ShieldCheck size={16} />
              Crear perfil completo
            </a>
          </div>
        </section>
      </section>
    </main>
  )
}
