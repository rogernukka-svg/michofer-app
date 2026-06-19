import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CarFront, Send, ShieldCheck, UserRound } from 'lucide-react'
import { supabase } from '../lib/supabase'

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
  const [messages, setMessages] = useState([])
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

    const { data: contactData } = await supabase
      .rpc('get_trip_contact_profile', { p_trip_id: tripId })
      .maybeSingle()

    setOtherProfile(contactData || null)

    await loadMessages(tripId)
  }

  useEffect(() => {
    if (!tripId || !user?.id) return undefined

    const channel = supabase
      .channel(`trip-messages-${tripId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `trip_id=eq.${tripId}` },
        ({ new: nextMessage }) => {
          setMessages((current) =>
            current.some((message) => message.id === nextMessage.id)
              ? current
              : [...current, nextMessage]
          )
        }
      )
      .subscribe()
    const interval = window.setInterval(() => loadMessages(tripId), 5000)

    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [tripId, user?.id])

  async function loadMessages(nextTripId = tripId) {
    if (!nextTripId) return

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('trip_id', nextTripId)
      .order('created_at', { ascending: true })

    if (error) {
      setNotice('No pude cargar mensajes de este viaje.')
      return
    }

    setMessages(data || [])
  }

  async function sendMessage(event) {
    event.preventDefault()
    const clean = text.trim()
    if (!clean || !tripId || !user?.id) return

    setText('')

    const { error } = await supabase.from('messages').insert({
      trip_id: tripId,
      sender_id: user.id,
      body: clean,
    })

    if (error) {
      setNotice('No pude enviar el mensaje.')
      setText(clean)
    }
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
          {messages.length === 0 && (
            <div className="empty-state">Todavía no hay mensajes. Escribí para coordinar el punto.</div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={message.sender_id === user?.id ? 'bubble me' : 'bubble'}>
              {message.body}
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
