const SUPPORT_EMAIL = 'soporte@michoferparaguay.com'

export default function Support() {
  return (
    <main className="legal-screen">
      <section className="legal-shell">
        <a className="legal-back" href="/">Volver a MiChofer</a>

        <article className="legal-card">
          <header className="legal-header">
            <span>Centro de ayuda</span>
            <h1>Soporte y contacto</h1>
            <p>Estamos para ayudarte con tu cuenta, viajes y seguridad.</p>
          </header>

          <section className="legal-section">
            <h2>Contacto principal</h2>
            <p>
              Escribinos a <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
              Incluí tu correo de cuenta, tipo de usuario y una descripcion clara del problema.
            </p>
          </section>

          <section className="legal-link-grid" aria-label="Opciones de soporte">
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Problema%20con%20cuenta%20MiChofer`}>
              Problemas con cuenta
            </a>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Problema%20con%20viaje%20MiChofer`}>
              Problemas con viaje
            </a>
            <a href="/delete-account">Solicitud de eliminacion de cuenta</a>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=Seguridad%20MiChofer`}>
              Seguridad
            </a>
          </section>

          <section className="legal-actions">
            <a href="/privacy">Politica de privacidad</a>
            <a href="/terms">Terminos</a>
            <a href="/delete-account">Eliminar cuenta</a>
          </section>

          <p className="legal-note">
            Nota: este texto debe ser revisado por un responsable legal antes de publicar oficialmente.
          </p>
        </article>
      </section>
    </main>
  )
}
