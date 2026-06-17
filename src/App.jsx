import {
  ArrowRight,
  CheckCircle2,
  Heart,
  MapPin,
  ShieldCheck,
} from 'lucide-react'
import logo from './assets/logo.png'

export default function App() {
  return (
    <main className="app-shell">
      <section className="phone home-phone">
        <header className="home-header">
          <img src={logo} alt="MiChofer" />
          <a href="/login">Entrar</a>
        </header>

        <section className="home-map" aria-label="Vista de mapa MiChofer">
          <iframe
            className="home-real-map"
            title="Mapa real MiChofer"
            src="https://www.openstreetmap.org/export/embed.html?bbox=-54.6267%2C-25.5267%2C-54.6067%2C-25.5067&layer=mapnik"
          />
          <div className="home-map-tint" />

          <svg className="home-route" viewBox="0 0 320 360" aria-hidden="true">
            <path
              className="route-halo"
              d="M70 296 L108 252 L146 220 L146 174 L164 144 L204 126 L236 104 L258 74"
            />
            <path
              className="route-base"
              d="M70 296 L108 252 L146 220 L146 174 L164 144 L204 126 L236 104 L258 74"
            />
            <path
              className="route-line"
              d="M70 296 L108 252 L146 220 L146 174 L164 144 L204 126 L236 104 L258 74"
            />
            <circle className="route-dot origin-dot" cx="70" cy="296" r="7" />
            <circle className="route-dot destination-dot" cx="258" cy="74" r="7" />
          </svg>

          <div className="map-marker marker-origin">
            <MapPin size={18} />
          </div>

          <div className="map-marker marker-destination">
            <CheckCircle2 size={18} />
          </div>

          <article className="home-driver-card driver-a">
            <div className="avatar-initial">C</div>
            <div>
              <strong>Carlos</strong>
              <span>Verificado · 3 min</span>
            </div>
          </article>

          <div className="home-woman-chip">
            <Heart size={15} />
            Modo Mujer
          </div>
        </section>

        <section className="home-sheet">
          <p className="eyebrow">MI CHOFER</p>
          <h1>Vos elegís quién te lleva.</h1>
          <p className="muted">
            Choferes verificados cerca tuyo. Y si preferís, también podés viajar con una conductora.
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

          <p className="home-note">
            <ShieldCheck size={15} />
            Sin asignación automática: elegís antes de solicitar.
          </p>
        </section>
      </section>
    </main>
  )
}
