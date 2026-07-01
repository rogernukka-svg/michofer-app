import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const SUPPORT_EMAIL = 'soporte@michoferparaguay.com'

function buildDeletionMailto(email, reason) {
  const subject = encodeURIComponent('Solicitud de eliminacion de cuenta MiChofer')
  const body = encodeURIComponent(
    [
      'Hola MiChofer,',
      '',
      'Solicito la eliminacion de mi cuenta y datos asociados.',
      `Correo de la cuenta: ${email || ''}`,
      `Motivo: ${reason || 'No especificado'}`,
      '',
      'Entiendo que algunos registros minimos pueden conservarse temporalmente por seguridad, reclamos, fraude, soporte u obligaciones legales.',
    ].join('\n')
  )

  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`
}

export default function DeleteAccount() {
  const [sessionUser, setSessionUser] = useState(null)
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let alive = true

    async function loadSession() {
      const { data } = await supabase.auth.getSession()
      const user = data?.session?.user || null
      if (!alive) return
      setSessionUser(user)
      setEmail(user?.email || '')
    }

    loadSession()

    return () => {
      alive = false
    }
  }, [])

  const mailto = useMemo(() => buildDeletionMailto(email, reason), [email, reason])

  async function submitDeletionRequest(event) {
    event.preventDefault()
    setMessage('')

    const cleanEmail = String(email || '').trim().toLowerCase()
    if (!cleanEmail) {
      setMessage('Ingresá el correo asociado a tu cuenta.')
      return
    }

    if (sessionUser) {
      const confirmed = window.confirm(
        'Vas a solicitar la eliminacion de tu cuenta MiChofer y datos asociados. No se borrara automaticamente ahora; el equipo revisara la solicitud. ¿Querés continuar?'
      )

      if (!confirmed) return
    }

    setBusy(true)

    try {
      const { error } = await supabase
        .from('account_deletion_requests')
        .insert({
          user_id: sessionUser?.id || null,
          email: cleanEmail,
          reason: reason || null,
          status: 'pending',
          notes: sessionUser ? 'Solicitud enviada desde sesion autenticada.' : 'Solicitud publica no autenticada.',
        })

      if (error) throw error

      setMessage('Recibimos tu solicitud. Responderemos en un plazo razonable.')
    } catch (error) {
      console.warn('ACCOUNT DELETION REQUEST FALLBACK:', error)
      setMessage(
        'No pudimos registrar la solicitud automaticamente. Se abrira tu correo para enviarla a soporte.'
      )
      window.location.href = mailto
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="legal-screen">
      <section className="legal-shell">
        <a className="legal-back" href="/">Volver a MiChofer</a>

        <article className="legal-card">
          <header className="legal-header">
            <span>Privacidad y datos</span>
            <h1>Eliminar cuenta y datos</h1>
            <p>Podés solicitar la eliminacion de tu cuenta de MiChofer y los datos asociados.</p>
          </header>

          <section className="legal-section">
            <h2>Que puede eliminarse</h2>
            <ul>
              <li>Perfil, nombre, correo, foto y rol.</li>
              <li>Datos de pasajero y datos de chofer si corresponde.</li>
              <li>Documentos cargados si corresponde.</li>
              <li>Datos de disponibilidad y configuracion asociada a la cuenta.</li>
            </ul>
          </section>

          <section className="legal-section">
            <h2>Que puede conservarse temporalmente</h2>
            <p>
              Podemos conservar registros minimos necesarios para seguridad, historial operativo,
              soporte, prevencion de fraude, reclamos, cumplimiento legal o resolucion de incidentes.
              Responderemos la solicitud en un plazo razonable.
            </p>
          </section>

          <form className="legal-form" onSubmit={submitDeletionRequest}>
            <label>
              Correo de la cuenta
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="tu correo"
                disabled={Boolean(sessionUser)}
              />
            </label>

            <label>
              Motivo opcional
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Contanos si querés agregar contexto"
                rows={4}
              />
            </label>

            {message && <p className="legal-status">{message}</p>}

            <button className="legal-primary" type="submit" disabled={busy}>
              {busy
                ? 'Enviando...'
                : sessionUser
                  ? 'Solicitar eliminacion de mi cuenta'
                  : 'Enviar solicitud'}
            </button>

            {!sessionUser && (
              <a className="legal-secondary" href={mailto}>
                Enviar por correo
              </a>
            )}
          </form>

          <p className="legal-note">
            Nota: este texto debe ser revisado por un responsable legal antes de publicar oficialmente.
          </p>
        </article>
      </section>
    </main>
  )
}
