const SUPPORT_EMAIL = 'soporte@michoferparaguay.com'

export default function PrivacyPolicy() {
  return (
    <main className="legal-screen">
      <section className="legal-shell">
        <a className="legal-back" href="/">Volver a MiChofer</a>

        <article className="legal-card">
          <header className="legal-header">
            <span>MiChofer Paraguay</span>
            <h1>Politica de Privacidad</h1>
            <p>Ultima actualizacion: 30 de junio de 2026</p>
          </header>

          <section className="legal-section">
            <h2>Descripcion del servicio</h2>
            <p>
              MiChofer es una plataforma de movilidad que conecta pasajeros con choferes disponibles,
              permitiendo solicitar viajes, compartir ubicacion en tiempo real durante el servicio,
              comunicarse por chat del viaje y gestionar perfiles de pasajero y chofer.
            </p>
          </section>

          <section className="legal-section">
            <h2>Datos que recopilamos</h2>
            <ul>
              <li>Nombre, apellido, correo electronico y foto de perfil.</li>
              <li>Rol del usuario: pasajero o chofer.</li>
              <li>Ubicacion aproximada y precisa cuando se usan funciones de viaje.</li>
              <li>Punto de recogida, destino, historial de viajes y mensajes del chat del viaje.</li>
              <li>Datos del chofer: telefono, vehiculo, chapa, marca, modelo, color y ano.</li>
              <li>Documentos de verificacion del chofer si aplica y estado de disponibilidad.</li>
              <li>Datos tecnicos basicos del dispositivo o navegador necesarios para seguridad y funcionamiento.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>Finalidades</h2>
            <p>
              Usamos estos datos para crear y administrar cuentas, conectar pasajeros con choferes,
              mostrar choferes cercanos, calcular rutas, distancias, tarifas estimadas y tiempos,
              permitir seguimiento del viaje en tiempo real, verificar seguridad de choferes,
              habilitar el chat del viaje, prevenir fraude o abuso, cumplir obligaciones legales
              cuando corresponda y mejorar la estabilidad del servicio.
            </p>
          </section>

          <section className="legal-section">
            <h2>Uso de ubicacion</h2>
            <p>
              La ubicacion precisa se usa para mostrar el punto de recogida, calcular rutas, mostrar
              la ubicacion del chofer al pasajero durante un viaje activo, permitir navegacion del
              chofer y mejorar la seguridad del servicio. MiChofer no usa la ubicacion para vender
              datos personales.
            </p>
          </section>

          <section className="legal-section">
            <h2>Proveedores y terceros</h2>
            <p>
              Podemos usar Supabase para autenticacion, base de datos y almacenamiento; Google Maps,
              Google Places, Google Routes y Google Roads para mapas, busqueda de destinos, rutas,
              navegacion y ajuste a calles; servicios de hosting de la app; y Google OAuth cuando
              el usuario elige iniciar sesion con Google.
            </p>
          </section>

          <section className="legal-section">
            <h2>Comparticion de datos</h2>
            <p>
              Algunos datos se comparten entre pasajero y chofer solo para prestar el servicio:
              nombre o foto, punto de recogida, destino, ubicacion del chofer durante el viaje y
              mensajes del chat del viaje. No vendemos datos personales.
            </p>
          </section>

          <section className="legal-section">
            <h2>Seguridad y retencion</h2>
            <p>
              Usamos proveedores con medidas de seguridad, transmision por HTTPS y controles de
              acceso. Ningun sistema es 100% infalible. Conservamos datos mientras la cuenta este
              activa o mientras sean necesarios para seguridad, historial, soporte, obligaciones
              legales o resolucion de reclamos.
            </p>
          </section>

          <section className="legal-section">
            <h2>Derechos del usuario</h2>
            <p>
              Podés solicitar acceso, correccion o eliminacion de tus datos, retirar permisos de
              ubicacion desde tu dispositivo y contactar soporte. Para eliminar cuenta y datos,
              visitá <a href="/delete-account">/delete-account</a>.
            </p>
          </section>

          <section className="legal-section">
            <h2>Contacto</h2>
            <p>
              Para consultas de privacidad escribinos a{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
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
