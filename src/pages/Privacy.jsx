import LegalLayout from '../lib/LegalLayout'

export default function Privacy() {
  return (
    <LegalLayout>
      <header className="legal-header">
        <span>Política de Privacidad de MiChofer</span>
        <h1>Tu privacidad es prioridad</h1>
        <p>
          Esta es nuestra política de privacidad, actualizada por última vez el 10 de Julio de 2026.
          Nos tomamos muy en serio la seguridad de tus datos.
        </p>
      </header>

      <section className="legal-section">
        <h2>Datos que recolectamos</h2>
        <p>
          Para que la aplicación funcione, necesitamos algunos datos. Esto es lo que guardamos y por qué:
        </p>
        <ul>
          <li>
            <strong>Nombre, email y foto de perfil:</strong> Para identificarte en la app, administrar tu cuenta y que otros usuarios (pasajeros o choferes) puedan reconocerte durante un viaje.
          </li>
          <li>
            <strong>Ubicación precisa y aproximada:</strong> Es el corazón de MiChofer. La usamos para mostrarte choferes cercanos, calcular rutas, guiar la navegación, permitir el seguimiento del viaje en tiempo real y por seguridad.
          </li>
          <li>
            <strong>Mensajes de chat:</strong> Guardamos los mensajes entre pasajero y chofer para dar soporte en caso de problemas durante un viaje.
          </li>
          <li>
            <strong>Documentos del chofer:</strong> Si sos chofer, te pedimos fotos de tus documentos (licencia, cédula, etc.) para verificar tu identidad y habilitarte a conducir. Estos datos son confidenciales y solo los ve el equipo de administración.
          </li>
          <li>
            <strong>Actividad de la app:</strong> Guardamos tu historial de viajes, su estado (solicitado, completado, cancelado) y la disponibilidad que marcás como chofer para mejorar el servicio y darte soporte.
          </li>
          <li>
            <strong>IDs de usuario:</strong> Usamos el ID de tu cuenta y tu email para administrar tu sesión de forma segura.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>¿Con quién compartimos tus datos?</h2>
        <p>
          No vendemos tus datos personales. Solo los compartimos con proveedores tecnológicos que son esenciales para que la app funcione:
        </p>
        <ul>
          <li>
            <strong>Google:</strong> Usamos Google Maps, Places, Routes y Roads para todo lo relacionado con mapas, búsqueda de direcciones, cálculo de rutas y navegación.
          </li>
          <li>
            <strong>Supabase:</strong> Es nuestro proveedor para autenticación (inicio de sesión), base de datos (guardar perfiles, viajes) y almacenamiento de archivos (fotos de perfil, documentos).
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Seguridad y eliminación de datos</h2>
        <p>
          Toda la comunicación entre la app y nuestros servidores viaja encriptada por HTTPS. El acceso a los datos está protegido por las políticas de seguridad de Supabase.
        </p>
        <p>
          Tenés derecho a solicitar la eliminación de tu cuenta y todos tus datos asociados. Podés hacerlo desde la app o contactando a soporte.
        </p>
      </section>

      <div className="legal-actions">
        <a href="/support" className="legal-secondary">
          Contactar a soporte
        </a>
        <a href="/delete-account" className="legal-secondary">
          Eliminar mi cuenta
        </a>
      </div>
    </LegalLayout>
  )
}