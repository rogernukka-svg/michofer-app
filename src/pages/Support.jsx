import { useState } from 'react'
import LegalLayout from '../lib/LegalLayout'
import { supabase } from '../lib/supabase'

const SUPPORT_EMAIL = 'soporte@michoferparaguay.com'

function buildSupportMailto(message) {
  const subject = encodeURIComponent('Solicitud de soporte MiChofer')
  const body = encodeURIComponent(message || '')
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
}

export default function Support() {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('idle')

  async function handleSubmit(event) {
    event.preventDefault()

    const cleanMessage = message.trim()
    if (!cleanMessage) return

    setStatus('sending')

    const { data: authData } = await supabase.auth.getUser()
    const user = authData?.user || null
    const { error } = await supabase
      .from('support_requests')
      .insert({
        user_id: user?.id || null,
        email: user?.email || null,
        message: cleanMessage,
        status: 'open',
      })

    if (error) {
      console.warn('SUPPORT REQUEST FALLBACK:', error)
      window.location.href = buildSupportMailto(cleanMessage)
      setStatus('idle')
      return
    }

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
              onChange={(event) => setMessage(event.target.value)}
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
