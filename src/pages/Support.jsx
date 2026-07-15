import { useState } from 'react'
import LegalLayout from '../lib/LegalLayout'

export default function Support() {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('idle')

  async function handleSubmit(event) {
    event.preventDefault()
    if (!message.trim()) return

    setStatus('sending')
    await new Promise((resolve) => setTimeout(resolve, 1200)) // Simular envío
    setStatus('sent')
    setMessage('')
  }

  return (
    <LegalLayout>
      <header className="legal-header">
        <span>Soporte MiChofer</span>
        <h1>¿Necesitás ayuda?</h1>
        <p>
          Si tuviste un problema con un viaje, un pago o con la app, dejanos un mensaje y te contactaremos lo antes posible.
        </p>
      </header>

      {status === 'sent' ? (
        <div className="legal-status">
          <strong>¡Mensaje enviado!</strong>
          <p>Gracias por contactarnos. El equipo de soporte revisará tu caso y te responderá al correo de tu cuenta.</p>
          <a href="/client" className="legal-primary">Volver a la app</a>
        </div>
      ) : (
        <form className="legal-form" onSubmit={handleSubmit}>
          <label>
            Tu mensaje
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describí tu problema en detalle. Si se relaciona con un viaje, incluí la fecha y hora."
              rows={6}
              required
            />
          </label>
          <button type="submit" className="legal-primary" disabled={status === 'sending'}>
            {status === 'sending' ? 'Enviando...' : 'Enviar a soporte'}
          </button>
        </form>
      )}
    </LegalLayout>
  )
}