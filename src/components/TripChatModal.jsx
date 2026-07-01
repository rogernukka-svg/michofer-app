import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Check,
  ChevronsUpDown,
  Phone,
  Send,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

const QUICK_MESSAGES = [
  'Estoy en el punto',
  'Ya salgo',
  'Confirmame la chapa',
  'Estoy llegando',
]

const FINISHED_STATUSES = ['completed', 'cancelled']

function statusText(status) {
  if (status === 'accepted') return 'Chofer en camino'
  if (status === 'arriving') return 'En el punto'
  if (status === 'in_progress') return 'Viaje en curso'
  if (status === 'completed') return 'Chat finalizado'
  if (status === 'cancelled') return 'Chat finalizado'
  return 'Viaje solicitado'
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '')
}

function isSameMessage(a, b) {
  if (!a || !b) return false
  if (a.id && b.id && a.id === b.id) return true
  return (
    a.trip_id === b.trip_id &&
    a.sender_id === b.sender_id &&
    a.body === b.body &&
    Math.abs(new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()) < 8000
  )
}

export default function TripChatModal({
  tripId,
  open,
  onClose,
  currentUser,
  trip: providedTrip,
  pageMode = false,
}) {
  const [user, setUser] = useState(currentUser || null)
  const [trip, setTrip] = useState(providedTrip || null)
  const [otherProfile, setOtherProfile] = useState(null)
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState(pageMode)
  const [loading, setLoading] = useState(false)
  const [otherTyping, setOtherTyping] = useState(false)
  const messagesRef = useRef(null)
  const typingChannelRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const localTypingRef = useRef(false)
  const activeTripId = tripId || providedTrip?.id || ''
  const visible = pageMode || open
  const isFinished = FINISHED_STATUSES.includes(trip?.status)

  const isParticipant = useMemo(() => {
    if (!trip || !user?.id) return false
    return trip.client_id === user.id || trip.driver_id === user.id
  }, [trip, user?.id])

  useEffect(() => {
    setUser(currentUser || null)
  }, [currentUser?.id])

  useEffect(() => {
    setTrip(providedTrip || null)
  }, [providedTrip?.id, providedTrip?.status, providedTrip?.driver_id, providedTrip?.client_id])

  useEffect(() => {
    if (!visible || !activeTripId) return undefined

    let cancelled = false

    async function init() {
      setLoading(true)
      setNotice('')

      const authResult = currentUser ? { data: { user: currentUser } } : await supabase.auth.getUser()
      const current = authResult.data?.user || null
      if (cancelled) return
      setUser(current)

      if (!current) {
        setNotice('Inicia sesion para usar el chat del viaje.')
        setLoading(false)
        return
      }

      let nextTrip = providedTrip || null
      if (!nextTrip?.id) {
        const { data, error } = await supabase
          .from('trips')
          .select('*')
          .eq('id', activeTripId)
          .maybeSingle()

        if (cancelled) return

        if (error || !data) {
          setNotice('No pude cargar este viaje.')
          setLoading(false)
          return
        }

        nextTrip = data
      }

      const allowed = nextTrip.client_id === current.id || nextTrip.driver_id === current.id
      if (!allowed) {
        setNotice('No tenes acceso a este chat.')
        setLoading(false)
        return
      }

      setTrip(nextTrip)

      const { data: contactData } = await supabase
        .rpc('get_trip_contact_profile', { p_trip_id: activeTripId })
        .maybeSingle()

      if (!cancelled) {
        setOtherProfile(contactData || null)
        await loadMessages(activeTripId)
        setLoading(false)
      }
    }

    init()

    return () => {
      cancelled = true
    }
  }, [visible, activeTripId, currentUser?.id, providedTrip?.id])

  useEffect(() => {
    if (!visible || !activeTripId || !user?.id) return undefined

    const channel = supabase
      .channel(`trip-messages-${activeTripId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `trip_id=eq.${activeTripId}` },
        ({ new: nextMessage }) => {
          setMessages((current) => {
            const withoutOptimistic = current.filter(
              (message) => !(message.optimistic && isSameMessage(message, nextMessage))
            )
            return withoutOptimistic.some((message) => message.id === nextMessage.id)
              ? withoutOptimistic
              : [...withoutOptimistic, nextMessage]
          })
        }
      )
      .subscribe()

    const interval = window.setInterval(() => loadMessages(activeTripId), 5000)

    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [visible, activeTripId, user?.id])

  useEffect(() => {
    if (!visible || !activeTripId || !user?.id) return undefined

    const channel = supabase
      .channel(`trip-typing-${activeTripId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.user_id === user.id) return
        setOtherTyping(Boolean(payload?.is_typing))
      })
      .subscribe()

    typingChannelRef.current = channel

    return () => {
      typingChannelRef.current = null
      setOtherTyping(false)
      supabase.removeChannel(channel)
    }
  }, [visible, activeTripId, user?.id])

  useEffect(() => {
    if (!visible) return
    const node = messagesRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages.length, otherTyping, visible, expanded])

  useEffect(() => {
    return () => {
      window.clearTimeout(typingTimeoutRef.current)
    }
  }, [])

  async function loadMessages(nextTripId = activeTripId) {
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

    setMessages((current) => {
      const optimistic = current.filter((message) => message.optimistic && message.status !== 'sent')
      const saved = data || []
      return [
        ...saved,
        ...optimistic.filter((pending) => !saved.some((item) => isSameMessage(item, pending))),
      ].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    })
  }

  function broadcastTyping(nextValue) {
    if (!typingChannelRef.current || !user?.id) return
    typingChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { user_id: user.id, is_typing: nextValue },
    })
  }

  function updateText(value) {
    setText(value)
    if (!localTypingRef.current && value.trim()) {
      localTypingRef.current = true
      broadcastTyping(true)
    }

    window.clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = window.setTimeout(() => {
      localTypingRef.current = false
      broadcastTyping(false)
    }, 1200)
  }

  async function sendMessage(event, quickText) {
    event?.preventDefault()

    const clean = String(quickText ?? text).trim()
    if (!clean || !activeTripId || !user?.id) return

    if (!isParticipant) {
      setNotice('No tenes permiso para enviar mensajes en este viaje.')
      return
    }

    if (isFinished) {
      setNotice('Chat finalizado.')
      return
    }

    const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`
    const optimisticMessage = {
      id: tempId,
      trip_id: activeTripId,
      sender_id: user.id,
      body: clean,
      created_at: new Date().toISOString(),
      optimistic: true,
      status: 'sending',
    }

    setText('')
    setNotice('')
    localTypingRef.current = false
    broadcastTyping(false)
    setMessages((current) => [...current, optimisticMessage])

    const { error } = await supabase.from('messages').insert({
      trip_id: activeTripId,
      sender_id: user.id,
      body: clean,
    })

    if (error) {
      setMessages((current) =>
        current.map((message) =>
          message.id === tempId ? { ...message, status: 'failed' } : message
        )
      )
      setText(clean)
      setNotice('No pude enviar el mensaje. Revisa tu conexion e intenta de nuevo.')
      return
    }

    setMessages((current) =>
      current.map((message) =>
        message.id === tempId ? { ...message, status: 'sent' } : message
      )
    )
  }

  function callContact() {
    const phone = normalizePhone(otherProfile?.phone || otherProfile?.contact_phone || otherProfile?.emergency_contact_phone)
    if (!phone) {
      setNotice('Este contacto no tiene telefono visible en MiChofer.')
      return
    }
    window.location.href = `tel:${phone}`
  }

  if (!visible) return null

  const panel = (
    <section
      className={`trip-chat-panel ${expanded ? 'is-expanded' : ''} ${pageMode ? 'is-page' : ''}`}
      role="dialog"
      aria-modal={!pageMode}
      aria-label="Chat del viaje"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="trip-chat-handle" aria-hidden="true" />

      <header className="trip-chat-header">
        {pageMode ? (
          <button type="button" className="trip-chat-icon-btn" onClick={() => window.history.back()} aria-label="Volver">
            <ArrowLeft size={18} />
          </button>
        ) : (
          <button type="button" className="trip-chat-icon-btn" onClick={() => setExpanded((current) => !current)} aria-label="Expandir chat">
            <ChevronsUpDown size={18} />
          </button>
        )}

        <div className="trip-chat-person">
          <div className="trip-chat-avatar">
            {otherProfile?.avatar_url ? <img src={otherProfile.avatar_url} alt="Contacto" /> : <UserRound size={18} />}
          </div>

          <div>
            <strong>{otherProfile?.full_name || 'MiChofer'}</strong>
            <span>{otherTyping ? 'Esta escribiendo...' : statusText(trip?.status)}</span>
          </div>
        </div>

        <button type="button" className="trip-chat-call-btn" onClick={callContact} aria-label="Llamar">
          <Phone size={17} />
        </button>

        {!pageMode && (
          <button type="button" className="trip-chat-icon-btn" onClick={onClose} aria-label="Cerrar chat">
            <X size={18} />
          </button>
        )}
      </header>

      {(notice || !activeTripId) && (
        <div className="trip-chat-notice">
          {notice || 'El chat se habilita cuando tenes un viaje activo.'}
        </div>
      )}

      <div className="trip-chat-trip">
        <ShieldCheck size={15} />
        <span>{trip?.destination_text || 'Chat seguro del viaje'}</span>
      </div>

      <section ref={messagesRef} className="trip-chat-messages" aria-label="Mensajes">
        {loading && <div className="trip-chat-empty">Cargando mensajes...</div>}

        {!loading && messages.length === 0 && (
          <div className="trip-chat-empty">
            Coordina el punto, la chapa o la llegada sin salir del mapa.
          </div>
        )}

        {messages.map((message) => {
          const mine = message.sender_id === user?.id
          return (
            <article key={message.id} className={`trip-chat-bubble ${mine ? 'me' : 'them'} ${message.status === 'failed' ? 'failed' : ''}`}>
              <p>{message.body}</p>
              <small>
                {formatTime(message.created_at)}
                {mine && (
                  <span>
                    {message.status === 'failed' ? 'No enviado' : message.status === 'sending' ? 'Enviando' : 'Enviado'}
                    {message.status !== 'failed' && <Check size={12} />}
                  </span>
                )}
              </small>
            </article>
          )
        })}

        {otherTyping && (
          <div className="trip-chat-typing" aria-label="Esta escribiendo">
            <span />
            <span />
            <span />
          </div>
        )}
      </section>

      <div className="trip-chat-quick-row" aria-label="Mensajes rapidos">
        {QUICK_MESSAGES.map((item) => (
          <button key={item} type="button" onClick={() => sendMessage(null, item)} disabled={!isParticipant || isFinished}>
            {item}
          </button>
        ))}
      </div>

      <form className="trip-chat-input" onSubmit={sendMessage}>
        <input
          value={text}
          onChange={(event) => updateText(event.target.value)}
          placeholder={isFinished ? 'Chat finalizado' : 'Escribi un mensaje...'}
          disabled={!isParticipant || isFinished}
        />

        <button type="submit" aria-label="Enviar" disabled={!text.trim() || !isParticipant || isFinished}>
          <Send size={17} />
        </button>
      </form>

      {isFinished && <div className="trip-chat-ended">Chat finalizado</div>}
    </section>
  )

  if (pageMode) return <div className="trip-chat-page-wrap">{panel}</div>

  return (
    <div className="trip-chat-overlay" onClick={onClose} role="presentation">
      {panel}
    </div>
  )
}
