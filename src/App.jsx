import { ArrowRight, Heart } from 'lucide-react'
import InteractiveRouteMap from './components/InteractiveRouteMap.jsx'
import alexAvatar from './assets/roger-nunez-client.jpeg'
import logo from './assets/logo.png'
import rogerAvatar from './assets/alex-gonzalez-driver.jpeg'

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
    : { top: 112, bottom: 390, left: 34, right: 34 }
}

export default function App() {
  return (
    <main className="app-shell">
      <section className="phone home-phone">
        <header className="home-header">
          <img src={logo} alt="MiChofer" />
          <a href="/login">Entrar</a>
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

        <section className="home-sheet">
          <p className="eyebrow">MI CHOFER</p>
          <h1>Vos elegis quien te lleva.</h1>
          <p className="muted">
            Choferes verificados cerca tuyo. Ves quien conduce antes de confirmar.
          </p>

          <div className="home-actions">
            <a className="main-btn" href="/login">
              Empezar <ArrowRight size={20} />
            </a>
            <a className="secondary-btn woman-mode-link" href="/login">
              <Heart size={16} />
              Modo Mujer
            </a>
          </div>
        </section>
      </section>
    </main>
  )
}
