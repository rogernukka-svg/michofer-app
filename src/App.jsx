export default function App() {
  return (
    <div className="app-shell">
      <div className="phone">
        <div className="topbar">
          <a href="/login">Login</a>
          <a href="/registro">Registro</a>
          <a href="/driver">Chofer</a>
        </div>

        <div className="hero-map">
          <div className="route"></div>
          <div className="pin red">⌖</div>
          <div className="pin car">🚘</div>
        </div>

        <section className="sheet">
          <p className="eyebrow">MI CHOFER</p>
          <h1>Vos elegís quién te lleva</h1>
          <p className="muted">
            Elegí chofer, activá modo solo mujeres y solicitá tu viaje simple.
          </p>

          <a className="main-btn" href="/login">
            Empezar ahora →
          </a>
        </section>
      </div>
    </div>
  )
}