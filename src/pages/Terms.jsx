import LegalLayout from '../lib/LegalLayout'

export default function Terms() {
  return (
    <LegalLayout>
      <header className="legal-header">
        <span>Términos y Condiciones</span>
        <h1>Reglas de la comunidad</h1>
        <p>
          Al usar MiChofer, aceptás cumplir con estas reglas para mantener una comunidad segura y respetuosa para todos. Actualizado por última vez el 10 de Julio de 2026.
        </p>
      </header>

      <section className="legal-section">
        <h2>1. Respeto mutuo</h2>
        <p>
          Tratá a los demás usuarios (pasajeros y choferes) con amabilidad y respeto. No se tolerará ninguna forma de discriminación, acoso o comportamiento agresivo.
        </p>
      </section>

      <section className="legal-section">
        <h2>2. Seguridad</h2>
        <p>
          Como pasajero, verificá siempre que la foto, el nombre y la matrícula del vehículo coincidan con los datos que muestra la app antes de subir. Como chofer, cumplí con todas las leyes de tránsito y mantené tu vehículo en buenas condiciones.
        </p>
      </section>

      <section className="legal-section">
        <h2>3. Uso de la plataforma</h2>
        <p>
          No utilices la plataforma para actividades ilegales. Los viajes deben solicitarse y realizarse a través de la app para que queden registrados y cubiertos por nuestras medidas de seguridad.
        </p>
      </section>

      <section className="legal-section">
        <h2>4. Pagos</h2>
        <p>
          El pasajero es responsable de pagar la tarifa estimada al final del viaje. Los choferes deben cobrar únicamente el monto que indica la aplicación.
        </p>
      </section>

      <section className="legal-section">
        <h2>5. Cancelaciones</h2>
        <p>
          Entendemos que pueden surgir imprevistos, pero las cancelaciones excesivas pueden afectar negativamente a otros usuarios y a la comunidad. Nos reservamos el derecho de suspender cuentas con un historial problemático de cancelaciones.
        </p>
      </section>

      <div className="legal-actions">
        <a href="/privacy" className="legal-secondary">
          Ver Política de Privacidad
        </a>
      </div>
    </LegalLayout>
  )
}