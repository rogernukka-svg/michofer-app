import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarClock, CarFront, ChevronRight, MapPin, ReceiptText } from 'lucide-react'
import { isAdminSimulatorTrip, supabase } from '../lib/supabase'

function formatGs(value) {
  return `${Number(value || 0).toLocaleString('es-PY')} Gs.`
}

function formatDate(value) {
  if (!value) return 'Sin fecha'
  return new Intl.DateTimeFormat('es-PY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function labelStatus(status) {
  if (status === 'accepted') return 'Aceptado'
  if (status === 'arriving') return 'Chofer llego'
  if (status === 'in_progress') return 'En curso'
  if (status === 'completed') return 'Finalizado'
  if (status === 'cancelled') return 'Cancelado'
  return 'Pendiente'
}

export default function Trips() {
  const [user, setUser] = useState(null)
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    loadTrips()
  }, [])

  async function loadTrips() {
    setLoading(true)
    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData?.user || null
    setUser(currentUser)

    if (!currentUser) {
      setNotice('Inicia sesion para ver tus viajes.')
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .or(`client_id.eq.${currentUser.id},driver_id.eq.${currentUser.id}`)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) {
      setNotice('No pude cargar viajes. Revisa permisos RLS de trips.')
      setLoading(false)
      return
    }

    setTrips((data || []).filter((trip) => !isAdminSimulatorTrip(trip)))
    setLoading(false)
  }

  return (
    <main className="app-shell">
      <section className="phone trips-phone">
        <header className="simple-page-header">
          <button type="button" onClick={() => window.history.back()} aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="eyebrow">MI CHOFER</p>
            <h1>Mis viajes</h1>
          </div>
        </header>

        {notice && <div className="notice-card">{notice}</div>}

        <section className="trips-summary">
          <div>
            <ReceiptText size={20} />
            <span>Viajes</span>
            <strong>{trips.length}</strong>
          </div>
          <div>
            <CarFront size={20} />
            <span>Activos</span>
            <strong>{trips.filter((trip) => ['pending', 'accepted', 'arriving', 'in_progress'].includes(trip.status)).length}</strong>
          </div>
        </section>

        {loading ? (
          <section className="empty-state">Cargando viajes...</section>
        ) : trips.length === 0 ? (
          <section className="empty-state">
            <CalendarClock size={24} />
            Todavia no tenes viajes. Cuando elijas un chofer, aparecera aca.
          </section>
        ) : (
          <section className="trip-list">
            {trips.map((trip) => (
              <article key={trip.id} className="trip-card">
                <div className={`status-chip ${trip.status}`}>{labelStatus(trip.status)}</div>
                <h2>{trip.destination_text || 'Destino no cargado'}</h2>
                <div className="trip-card-meta">
                  <span><MapPin size={15} /> {formatGs(trip.price)}</span>
                  <span><CalendarClock size={15} /> {formatDate(trip.created_at)}</span>
                </div>
                <a href={trip.status === 'completed' || trip.status === 'cancelled' ? '/client' : `/chat?trip=${trip.id}`}>
                  Ver detalle <ChevronRight size={18} />
                </a>
              </article>
            ))}
          </section>
        )}

        {!user && (
          <a className="main-btn bottom-main" href="/login">
            Entrar a MiChofer
          </a>
        )}
      </section>
    </main>
  )
}
