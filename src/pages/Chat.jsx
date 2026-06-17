import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CarFront, Send, ShieldCheck, UserRound } from 'lucide-react'
import { supabase } from '../lib/supabase'

const fallbackMessages = [
  { id: 'm1', from: 'other', text: 'Hola, ya vi tu solicitud.' },
  { id: 'm2', from: 'me', text: 'Perfecto, te espero en el punto.' },
]

function statusText(status) {
  if (status === 'accepted') return 'Chofer en camino'
  if (status === 'arriving') return 'Chofer en el punto'
  if (status === 'in_progress') return 'Viaje en curso'
  if (status === 'completed') return 'Viaje finalizado'
  return 'Viaje solicitado'
}

export default function Chat() {
  const [user, setUser] = useState(null)
  const [trip, setTrip] = useState(null)
  const [otherProfile, setOtherProfile] = useState(null)
  const [messages, setMessages] = useState(fallbackMessages)
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')

  const tripId = useMemo(() => new URLSearchParams(window.location.search).get('trip'), [])

  useEffect(() => {
    init()
  }, [])

  async function init() {
    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData?.user || null
    setUser(currentUser)

    if (!tripId || !currentUser) {
      setNotice('El chat se habilita cuando tenes un viaje activo.')
      return
    }

    const { data: tripData, error } = await supabase
      .from('trips')
      .select('*')
      .eq('id', tripId)
      .maybeSingle()

    if (error || !tripData) {
      setNotice('No pude cargar este viaje.')
      return
    }

    setTrip(tripData)

    const otherId = currentUser.id === tripData.client_id ? tripData.driver_id : tripData.client_id
    if (otherId) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', otherId)
        .maybeSingle()

      setOtherProfile(profileData || null)
    }

    // La estructura esta lista para una tabla messages:
    // id, trip_id, sender_id, body, created_at.
    // No se consulta aun para no inventar tablas ni romper RLS existente.
  }

  function sendMessage(event) {
    event.preventDefault()
    const clean = text.trim()
    if (!clean) return

    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, from: 'me', text: clean },
    ])
    setText('')
  }

  return (
    <main className="app-shell">
      <section className="phone chat-phone">
        <header className="chat-header">
          <button type="button" onClick={() => window.history.back()} aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div className="chat-person">
            <div className="avatar-small">
              {otherProfile?.avatar_url ? <img src={otherProfile.avatar_url} alt="Contacto" /> : <UserRound size={18} />}
            </div>
            <div>
              <strong>{otherProfile?.full_name || 'MiChofer'}</strong>
              <span>{statusText(trip?.status)}</span>
            </div>
          </div>
          <CarFront size={22} />
        </header>

        {notice && <div className="notice-card">{notice}</div>}

        <section className="chat-trip-strip">
          <ShieldCheck size={18} />
          <div>
            <strong>{trip?.destination_text || 'Chat de viaje'}</strong>
            <span>{trip?.price ? `${Number(trip.price).toLocaleString('es-PY')} Gs.` : 'Mensajes del viaje'}</span>
          </div>
        </section>

        <section className="chat-messages" aria-label="Mensajes">
          {messages.map((message) => (
            <div key={message.id} className={message.from === 'me' ? 'bubble me' : 'bubble'}>
              {message.text}
            </div>
          ))}
        </section>

        <form className="chat-input-bar" onSubmit={sendMessage}>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Escribi un mensaje..."
          />
          <button type="submit" aria-label="Enviar">
            <Send size={18} />
          </button>
        </form>
      </section>
    </main>
  )
}
