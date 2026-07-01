const SUPPORT_EMAIL = 'soporte@michoferparaguay.com'

export default function Terms() {
  return (
    <main className="legal-screen">
      <section className="legal-shell">
        <a className="legal-back" href="/">Volver a MiChofer</a>

        <article className="legal-card">
          <header className="legal-header">
            <span>MiChofer Paraguay</span>
            <h1>Terminos y Condiciones</h1>
            <p>Ultima actualizacion: 30 de junio de 2026</p>
          </header>

          <section className="legal-section">
            <h2>Que es MiChofer</h2>
            <p>
              MiChofer es una app de movilidad que permite a pasajeros solicitar viajes y a choferes
              ofrecer servicios de traslado mediante herramientas digitales de ubicacion, rutas,
              comunicacion y gestion de perfiles.
            </p>
          </section>

          <section className="legal-section">
            <h2>Uso permitido</h2>
            <p>
              Los usuarios deben usar la app con datos reales y de forma licita. Los pasajeros deben
              indicar puntos de recogida y destino de manera responsable. Los choferes deben cargar
              informacion y documentacion real; la aprobacion puede requerir revision previa.
            </p>
          </section>

          <section className="legal-section">
            <h2>Seguridad y responsabilidad</h2>
            <p>
              El usuario debe respetar normas de transito y seguridad. Antes de iniciar un viaje,
              el pasajero debe verificar chofer, vehiculo, chapa y punto de recogida. El chofer es
              responsable de conducir de forma segura y mantener sus datos actualizados.
            </p>
          </section>

          <section className="legal-section">
            <h2>Precios, viajes y cancelaciones</h2>
            <p>
              Los precios, distancias y tiempos pueden ser estimados y variar por trafico, GPS,
              ruta, disponibilidad u otros factores. Las cancelaciones frecuentes o abusivas pueden
              afectar la experiencia o generar revision de cuenta.
            </p>
          </section>

          <section className="legal-section">
            <h2>Suspension de cuentas</h2>
            <p>
              MiChofer puede suspender o limitar cuentas ante fraude, abuso, documentos falsos,
              conducta peligrosa, incumplimiento de seguridad o uso indebido de la plataforma.
            </p>
          </section>

          <section className="legal-section">
            <h2>Disponibilidad tecnica</h2>
            <p>
              La app depende de GPS, internet, Google Maps, Supabase y otros proveedores tecnicos.
              La ubicacion puede tener margen de error y la disponibilidad del servicio puede variar.
            </p>
          </section>

          <section className="legal-section">
            <h2>Soporte</h2>
            <p>
              Para ayuda o reclamos escribinos a{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> o visitá{' '}
              <a href="/support">/support</a>.
            </p>
          </section>

          <p className="legal-note">
            Nota: este texto debe ser revisado por un responsable legal antes de publicar oficialmente.
          </p>
        </article>
      </section>
    </main>
  )
}
