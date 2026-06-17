import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CarFront,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  MessageCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  ToggleLeft,
  ToggleRight,
  UserRound,
  XCircle,
} from 'lucide-react'
import logo from '../assets/logo.png'
import { supabase } from '../lib/supabase'

const ACTIVE_STATUSES = ['pending', 'accepted', 'arriving', 'in_progress']

function formatGs(value) {
  return `${Number(value || 0).toLocaleString('es-PY')} Gs.`
}

function statusLabel(status) {
  if (status === 'accepted') return 'Aceptado'
  if (status === 'arriving') return 'Llegue al punto'
  if (status === 'in_progress') return 'Viaje en curso'
  if (status === 'completed') return 'Finalizado'
  if (status === 'cancelled') return 'Cancelado'
  return 'Solicitud entrante'
}

export default function Driver() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [driverProfile, setDriverProfile] = useState(null)
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    if (!user?.id) return undefined

    const channel = supabase
      .channel(`driver-trips-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => loadTrips(user.id))
      .subscribe()

    const interval = window.setInterval(() => loadTrips(user.id), 3500)
    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  const approved = driverProfile?.verified === true || driverProfile?.verification_status === 'approved'
  const isOnline = driverProfile?.is_online === true
  const isAvailable = driverProfile?.is_available === true
  const activeTrip = useMemo(() => trips.find((trip) => trip.status !== 'pending') || null, [trips])
  const pendingTrips = useMemo(() => trips.filter((trip) => trip.status === 'pending'), [trips])

  async function init() {
    setLoading(true)
    setMessage('')

    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData?.user || null
    setUser(currentUser)

    if (!currentUser) {
      window.location.href = '/login'
      return
    }

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle()

    setProfile(profileData || null)

    let { data: driverData, error } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('user_id', currentUser.id)
      .maybeSingle()

    if (!driverData && !error) {
      const fallbackName = profileData?.full_name || currentUser.user_metadata?.full_name || 'Chofer MiChofer'
      const { data: created, error: createError } = await supabase
        .from('driver_profiles')
        .insert({
          user_id: currentUser.id,
          full_name: fallbackName,
          avatar_url: profileData?.avatar_url || currentUser.user_metadata?.avatar_url || '',
          email: currentUser.email,
          verification_status: 'incomplete',
          verified: false,
          is_online: false,
          is_available: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (createError) {
        setMessage('No pude crear tu perfil de chofer. Revisa permisos de driver_profiles.')
      } else {
        driverData = created
      }
    }

    setDriverProfile(driverData || null)
    await loadTrips(currentUser.id)
    setLoading(false)
  }

  async function loadTrips(driverId = user?.id) {
    if (!driverId) return

    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .eq('driver_id', driverId)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })

    if (error) {
      setMessage('No pude cargar solicitudes. Revisa permisos RLS de trips.')
      return
    }

    setTrips(data || [])
  }

  async function updateAvailability(nextOnline, nextAvailable) {
    if (!driverProfile?.user_id) return

    if (!approved) {
      setMessage('Tu cuenta esta en revision. Te avisaremos cuando puedas recibir viajes.')
      return
    }

    const location = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({ lat: driverProfile.lat, lng: driverProfile.lng }),
        { enableHighAccuracy: true, timeout: 7000 }
      )
    })

    const { error } = await supabase
      .from('driver_profiles')
      .update({
        is_online: nextOnline,
        is_available: nextAvailable,
        lat: location.lat,
        lng: location.lng,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', driverProfile.user_id)

    if (error) {
      setMessage('No pude actualizar disponibilidad.')
      return
    }

    setDriverProfile((current) => ({
      ...current,
      is_online: nextOnline,
      is_available: nextAvailable,
      lat: location.lat,
      lng: location.lng,
    }))
    setMessage(nextAvailable ? 'Estas disponible para recibir solicitudes.' : 'Quedaste fuera de disponibilidad.')
  }

  async function updateTrip(trip, status) {
    const { error } = await supabase
      .from('trips')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', trip.id)

    if (error) {
      setMessage('No pude actualizar el viaje.')
      return
    }

    if (status === 'accepted') {
      await updateAvailability(true, false)
      setMessage('Aceptaste el viaje. El cliente ya ve que estas en camino.')
    } else if (status === 'cancelled') {
      setMessage('Solicitud rechazada. El cliente podra elegir otro chofer.')
    } else if (status === 'completed') {
      await updateAvailability(true, true)
      setMessage('Viaje finalizado.')
    } else {
      setMessage('')
    }

    await loadTrips()
  }

  return (
    <main className="app-shell">
      <section className="phone driver-phone">
        <header className="driver-top">
          <img src={logo} alt="MiChofer" />
          <button type="button" onClick={init} aria-label="Actualizar">
            <RefreshCw size={20} />
          </button>
        </header>

        <section className="driver-hero">
          <div>
            <p className="eyebrow">PANEL DE CHOFER</p>
            <h1>{profile?.full_name || driverProfile?.full_name || 'MiChofer'}</h1>
            <span>{driverProfile?.car_brand || 'Vehiculo'} {driverProfile?.car_model || ''}</span>
          </div>
          <div className={approved ? 'verify-badge ok' : 'verify-badge'}>
            <ShieldCheck size={18} />
            {approved ? 'Aprobado' : 'En revision'}
          </div>
        </section>

        {message && <div className="notice-card">{message}</div>}

        {!approved && (
          <section className="review-card">
            <AlertCircle size={22} />
            <div>
              <strong>Tu cuenta esta en revision.</strong>
              <p>Te avisaremos cuando puedas recibir viajes.</p>
            </div>
          </section>
        )}

        <section className="driver-status-grid">
          <button
            type="button"
            className={isOnline ? 'status-tile active' : 'status-tile'}
            onClick={() => updateAvailability(!isOnline, !isOnline ? isAvailable : false)}
          >
            {isOnline ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </button>

          <button
            type="button"
            className={isAvailable ? 'status-tile active red' : 'status-tile'}
            onClick={() => updateAvailability(true, !isAvailable)}
          >
            <CarFront size={26} />
            <span>{isAvailable ? 'Disponible' : 'No disponible'}</span>
          </button>
        </section>

        {loading ? (
          <section className="empty-state">Cargando panel...</section>
        ) : activeTrip ? (
          <section className="driver-trip-card featured">
            <div className="trip-status-line">
              <span>{statusLabel(activeTrip.status)}</span>
              <strong>{formatGs(activeTrip.price)}</strong>
            </div>
            <h2>{activeTrip.destination_text || 'Destino solicitado'}</h2>
            <p>
              <MapPin size={16} /> Cliente esperando tu avance
            </p>

            <div className="driver-actions-grid">
              {activeTrip.status === 'accepted' && (
                <button onClick={() => updateTrip(activeTrip, 'arriving')}>
                  <CheckCircle2 size={18} /> Llegue
                </button>
              )}
              {activeTrip.status === 'arriving' && (
                <button onClick={() => updateTrip(activeTrip, 'in_progress')}>
                  <Play size={18} /> Iniciar viaje
                </button>
              )}
              {activeTrip.status === 'in_progress' && (
                <button onClick={() => updateTrip(activeTrip, 'completed')}>
                  <Square size={18} /> Finalizar
                </button>
              )}
              <a href={`/chat?trip=${activeTrip.id}`}>
                <MessageCircle size={18} /> Chat
              </a>
            </div>
          </section>
        ) : (
          <section className="driver-section">
            <div className="section-title">
              <h2>Solicitudes entrantes</h2>
              <span>{pendingTrips.length}</span>
            </div>

            {pendingTrips.length === 0 ? (
              <div className="empty-state">
                <Clock size={22} />
                Cuando un cliente te elija, la solicitud aparecera aca.
              </div>
            ) : (
              <div className="request-list">
                {pendingTrips.map((trip) => (
                  <article key={trip.id} className="driver-trip-card">
                    <div className="trip-status-line">
                      <span>Esperando tu respuesta</span>
                      <strong>{formatGs(trip.price)}</strong>
                    </div>
                    <h2>{trip.destination_text || 'Destino solicitado'}</h2>
                    <p>
                      <UserRound size={16} /> Cliente te eligio manualmente
                    </p>
                    <div className="driver-actions-grid">
                      <button onClick={() => updateTrip(trip, 'accepted')}>
                        <CheckCircle2 size={18} /> Aceptar
                      </button>
                      <button className="danger" onClick={() => updateTrip(trip, 'cancelled')}>
                        <XCircle size={18} /> Rechazar
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <button
          className="logout-button"
          type="button"
          onClick={async () => {
            await supabase.auth.signOut()
            window.location.href = '/login'
          }}
        >
          <LogOut size={18} /> Cerrar sesion
        </button>
      </section>
    </main>
  )
}
