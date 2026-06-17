import { useEffect, useMemo, useState } from 'react'
import {
  Banknote,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  HelpCircle,
  MapPin,
  MessageCircle,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  UserRound,
  X,
} from 'lucide-react'
import InteractiveRouteMap from '../components/InteractiveRouteMap'
import { supabase } from '../lib/supabase'

const DEFAULT_CENTER = { lat: -25.5167, lng: -54.6167 }
const ACTIVE_STATUSES = ['pending', 'accepted', 'arriving', 'in_progress']
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN || ''

function distanceKm(a, b) {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return null
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function estimatePrice(km) {
  if (!km) return null
  return Math.max(12000, Math.round((9000 + km * 4500) / 500) * 500)
}

function formatGs(value) {
  return `${Number(value || 0).toLocaleString('es-PY')} Gs.`
}

function firstName(value) {
  return String(value || 'Chofer').split(' ')[0]
}

function maskPlate(value) {
  if (!value) return ''
  const clean = String(value).replace(/\s+/g, '')
  if (clean.length <= 3) return clean
  return `${clean.slice(0, 3)}***`
}

function normalizeDriver(driver, location) {
  const lat = Number(driver.lat)
  const lng = Number(driver.lng)
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng)
  const km = hasLocation ? distanceKm(location, { lat, lng }) : null
  const price = estimatePrice(km)
  const car = [driver.car_brand, driver.car_model].filter(Boolean).join(' ').trim()
  const vehicle = [car, driver.car_color, maskPlate(driver.plate)].filter(Boolean).join(' · ')

  return {
    ...driver,
    id: driver.id || driver.user_id,
    user_id: driver.user_id || driver.id,
    lat: hasLocation ? lat : null,
    lng: hasLocation ? lng : null,
    name: driver.full_name || driver.email || 'Chofer disponible',
    avatar: driver.avatar_url || '',
    vehicle,
    distanceKm: km,
    distance: km ? `${km.toFixed(1)} km` : '',
    eta: km ? `${Math.max(3, Math.round(km * 3))} min` : '',
    price,
  }
}

function statusCopy(status, driverName) {
  const name = firstName(driverName)
  if (status === 'accepted') return [`${name} acepto tu viaje`, 'Chofer en camino']
  if (status === 'arriving') return [`${name} llego al punto`, 'Listo para iniciar']
  if (status === 'in_progress') return ['Viaje en curso', 'Seguimos tu recorrido']
  return [`Esperando respuesta de ${name}`, 'Solicitud enviada']
}

async function insertTrip(payload, fallbackDriverId) {
  const attempts = [payload]
  if (fallbackDriverId && fallbackDriverId !== payload.driver_id) {
    attempts.push({ ...payload, driver_id: fallbackDriverId })
  }

  let lastError = null
  for (const attempt of attempts) {
    const { data, error } = await supabase.from('trips').insert(attempt).select().single()
    if (!error) return { data, error: null }
    lastError = error
    if (error.code !== '23503') break
  }
  return { data: null, error: lastError }
}

export default function Client() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [destination, setDestination] = useState('')
  const [destinationPoint, setDestinationPoint] = useState(null)
  const [destinationStatus, setDestinationStatus] = useState('idle')
  const [mode, setMode] = useState('all')
  const [sort, setSort] = useState('near')
  const [drivers, setDrivers] = useState([])
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [clientLocation, setClientLocation] = useState(DEFAULT_CENTER)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [message, setMessage] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showDriverChooser, setShowDriverChooser] = useState(false)
  const [activeTrip, setActiveTrip] = useState(null)
  const [activeTripDriver, setActiveTripDriver] = useState(null)

  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    const query = destination.trim()
    if (query.length < 3) {
      setDestinationPoint(null)
      setDestinationStatus('idle')
      return undefined
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setDestinationStatus('searching')
      try {
        const proximity = `${clientLocation.lng},${clientLocation.lat}`
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=1&language=es&proximity=${proximity}&access_token=${MAPBOX_TOKEN}`,
          { signal: controller.signal }
        )
        if (!response.ok) throw new Error('No se pudo resolver el destino')
        const data = await response.json()
        const center = data?.features?.[0]?.center
        if (!center) {
          setDestinationPoint(null)
          setDestinationStatus('not_found')
          return
        }
        setDestinationPoint({ lng: center[0], lat: center[1] })
        setDestinationStatus('ready')
      } catch (error) {
        if (error.name === 'AbortError') return
        setDestinationPoint(null)
        setDestinationStatus('not_found')
      }
    }, 600)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [clientLocation, destination])

  useEffect(() => {
    const channel = supabase
      .channel('client-drivers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_profiles' }, () => {
        loadDrivers(clientLocation)
      })
      .subscribe()

    const interval = window.setInterval(() => loadDrivers(clientLocation), 7000)
    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [clientLocation])

  useEffect(() => {
    if (!activeTrip?.id) return undefined

    const channel = supabase
      .channel(`client-trip-${activeTrip.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${activeTrip.id}` },
        ({ new: nextTrip }) => handleTripUpdate(nextTrip)
      )
      .subscribe()

    const interval = window.setInterval(async () => {
      const { data } = await supabase.from('trips').select('*').eq('id', activeTrip.id).maybeSingle()
      if (data) handleTripUpdate(data)
    }, 3000)

    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [activeTrip?.id])

  const visibleDrivers = useMemo(() => {
    const filtered =
      mode === 'women'
        ? drivers.filter((driver) => driver.women_mode || driver.gender === 'female' || driver.gender === 'mujer')
        : [...drivers]

    if (sort === 'rating') {
      filtered.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
    } else {
      filtered.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
    }

    return filtered
  }, [drivers, mode, sort])

  useEffect(() => {
    if (!selectedDriver) return
    const stillAvailable = visibleDrivers.find((driver) => driver.id === selectedDriver.id)
    if (stillAvailable) {
      setSelectedDriver(stillAvailable)
      return
    }
    setSelectedDriver(null)
    setMessage('Ese chofer ya no esta disponible. Elegi otro.')
  }, [drivers, mode, sort])

  async function init() {
    setLoading(true)
    const { data: authData } = await supabase.auth.getUser()
    const currentUser = authData?.user || null
    setUser(currentUser)

    if (currentUser) {
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', currentUser.id)
        .maybeSingle()

      setProfile(profileData || null)

      const role =
        profileData?.role ||
        currentUser.user_metadata?.role ||
        localStorage.getItem('michofer_last_role') ||
        ''

      const { data: ownDriverProfile } = await supabase
        .from('driver_profiles')
        .select('user_id')
        .eq('user_id', currentUser.id)
        .maybeSingle()

      if (role === 'driver' || ownDriverProfile?.user_id) {
        window.location.href = '/driver'
        return
      }

      await restoreActiveTrip(currentUser.id)
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nextLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        setClientLocation(nextLocation)
        await loadDrivers(nextLocation)
        setLoading(false)
      },
      async () => {
        await loadDrivers(DEFAULT_CENTER)
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 9000 }
    )
  }

  async function restoreActiveTrip(clientId) {
    const { data } = await supabase
      .from('trips')
      .select('*')
      .eq('client_id', clientId)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!data?.id) return
    setActiveTrip(data)

    if (data.driver_id) {
      const { data: driverData } = await supabase
        .from('driver_profiles')
        .select('*')
        .eq('user_id', data.driver_id)
        .maybeSingle()

      if (driverData) setActiveTripDriver(normalizeDriver(driverData, clientLocation))
    }
  }

  async function loadDrivers(location = clientLocation) {
    const { data, error } = await supabase
      .from('driver_profiles')
      .select(
        'id,user_id,full_name,avatar_url,gender,women_mode,is_online,is_available,lat,lng,car_brand,car_model,car_color,plate,rating,total_trips,verified,verification_status,updated_at'
      )
      .eq('is_available', true)
      .eq('is_online', true)

    if (error) {
      setMessage('No pude cargar choferes disponibles en este momento.')
      setDrivers([])
      return
    }

    const normalized = (data || [])
      .filter((driver) => driver.verified !== false)
      .map((driver) => normalizeDriver(driver, location))

    setDrivers(normalized)
  }

  function handleTripUpdate(nextTrip) {
    if (!nextTrip?.id) return
    if (nextTrip.status === 'cancelled' || nextTrip.status === 'completed') {
      setActiveTrip(null)
      setActiveTripDriver(null)
      setSelectedDriver(null)
      setMessage(nextTrip.status === 'completed' ? 'Viaje finalizado. Ya podes pedir otro.' : 'Viaje cancelado.')
      return
    }
    setActiveTrip(nextTrip)
  }

  async function requestRide() {
    if (!user) {
      window.location.href = '/login'
      return
    }
    if (!destination.trim()) {
      setMessage('Elegí un destino para ver la ruta.')
      return
    }
    if (!destinationPoint) {
      setMessage('Todavia no hay datos suficientes para confirmar ese destino.')
      return
    }
    if (!selectedDriver) {
      setMessage('Elegi un chofer disponible.')
      return
    }

    setRequesting(true)
    setMessage('')

    await supabase
      .from('trips')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('client_id', user.id)
      .eq('status', 'pending')

    const payload = {
      client_id: user.id,
      driver_id: selectedDriver.user_id,
      destination_text: destination,
      pickup_lat: clientLocation.lat,
      pickup_lng: clientLocation.lng,
      driver_lat: selectedDriver.lat,
      driver_lng: selectedDriver.lng,
      price: selectedDriver.price,
      payment_method: paymentMethod,
      status: 'pending',
      women_mode: mode === 'women',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await insertTrip(payload, selectedDriver.id)
    setRequesting(false)

    if (error) {
      setMessage('No se pudo crear el viaje. Revisa permisos o la tabla trips.')
      return
    }

    setActiveTrip(data)
    setActiveTripDriver(selectedDriver)
  }

  async function cancelActiveTrip() {
    if (!activeTrip?.id) return
    await supabase
      .from('trips')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', activeTrip.id)

    setActiveTrip(null)
    setActiveTripDriver(null)
    setMessage('Viaje cancelado. Podes elegir otro chofer.')
  }

  async function refreshLocation() {
    navigator.geolocation.getCurrentPosition((pos) => {
      const nextLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setClientLocation(nextLocation)
      loadDrivers(nextLocation)
    })
  }

  const [statusTitle, statusSub] = statusCopy(activeTrip?.status, activeTripDriver?.name || selectedDriver?.name)

  return (
    <main className="app-shell">
      <section className="phone client-phone">
        <header className="client-top">
          <section className="destination-card">
            <label htmlFor="destination">A donde vas</label>
            <div className="destination-input">
              <MapPin size={18} />
              <input
                id="destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="A donde vas?"
              />
            </div>
          </section>
          <button className="avatar-button" type="button" onClick={() => setShowMenu(true)}>
            {profile?.avatar_url ? <img src={profile.avatar_url} alt="Perfil" /> : <UserRound size={20} />}
          </button>
        </header>

        {activeTrip && activeTripDriver && (
          <section className="active-trip-card">
            <div>
              <span>{statusSub}</span>
              <h2>{statusTitle}</h2>
            </div>
            <div className="active-trip-driver">
              <img src={activeTripDriver.avatar} alt={activeTripDriver.name} />
              <strong>{firstName(activeTripDriver.name)}</strong>
            </div>
          </section>
        )}


        <InteractiveRouteMap
          origin={clientLocation}
          destination={destinationPoint}
          destinationText={destination}
          drivers={visibleDrivers}
          selectedDriver={activeTripDriver || selectedDriver}
          onSelectDriver={setSelectedDriver}
          onChooseDriver={() => setShowDriverChooser(true)}
          onRefreshLocation={refreshLocation}
        />

        <div className="map-filter-chips" aria-label="Filtros de choferes">
          <button type="button" className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>
            Todos
          </button>
          <button type="button" className={mode === 'women' ? 'active women' : 'women'} onClick={() => setMode('women')}>
            Solo para ellas
          </button>
          <button type="button" onClick={() => setShowDriverChooser(true)} disabled={!destinationPoint}>
            {destinationPoint ? `${visibleDrivers.length} choferes cerca` : 'Elegí destino'}
          </button>
        </div>

        {selectedDriver && !activeTrip && (
          <article className="selected-map-card">
            <div>
              <span>Chofer elegido</span>
              <strong>{selectedDriver.name}</strong>
              {selectedDriver.vehicle && <small>{selectedDriver.vehicle}</small>}
            </div>
            <button type="button" onClick={requestRide} disabled={requesting || !destinationPoint}>
              {requesting ? 'Solicitando...' : 'Solicitar'}
            </button>
          </article>
        )}

        {showDriverChooser && (
          <div className="driver-panel-backdrop" onClick={() => setShowDriverChooser(false)}>
            <section className="client-sheet floating-driver-panel" onClick={(event) => event.stopPropagation()}>
          <div className="sheet-handle" />

          <div className="sheet-heading">
            <div>
              <p className="eyebrow">CHOFERES DISPONIBLES CERCA</p>
              <h1>Elegi tu chofer</h1>
              <p>Vos decidis con quien viajar.</p>
            </div>
            <span>{destinationPoint ? `${visibleDrivers.length} online` : 'Sin destino'}</span>
            <button className="panel-close" type="button" onClick={() => setShowDriverChooser(false)} aria-label="Cerrar">
              <X size={18} />
            </button>
          </div>

          <div className="filters-row">
            <button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>
              Todos
            </button>
            <button className={mode === 'women' ? 'active' : ''} onClick={() => setMode('women')}>
              Solo para ellas
            </button>
            <button className={sort === 'rating' ? 'active icon-text' : 'icon-text'} onClick={() => setSort('rating')}>
              <SlidersHorizontal size={16} />
              Mejor calificados
            </button>
            <button className={sort === 'near' ? 'active icon-text' : 'icon-text'} onClick={() => setSort('near')}>
              <MapPin size={16} />
              Mas cerca
            </button>
          </div>

          {mode === 'women' && (
            <div className="safety-message">
              <ShieldCheck size={17} />
              Viajes con mas confianza: elegi choferes mujeres disponibles cerca.
            </div>
          )}

          {message && <div className="notice-card">{message}</div>}

          {!destination.trim() ? (
            <div className="empty-state">Elegí un destino para ver la ruta y los choferes disponibles.</div>
          ) : destinationStatus === 'searching' ? (
            <div className="empty-state">Buscando destino...</div>
          ) : !destinationPoint ? (
            <div className="empty-state">Todavia no hay datos suficientes para mostrar una ruta real a ese destino.</div>
          ) : loading ? (
            <div className="empty-state">Cargando choferes verificados...</div>
          ) : visibleDrivers.length === 0 ? (
            <div className="empty-state">
              {mode === 'women'
                ? 'No hay choferes mujeres disponibles cerca en este momento. Podes ampliar el radio o volver a ver todos los choferes.'
                : 'No hay choferes disponibles ahora. Proba otro filtro.'}
            </div>
          ) : (
            <div className="driver-list">
              {visibleDrivers.map((driver) => (
                <article
                  key={driver.id}
                  className={selectedDriver?.id === driver.id ? 'driver-card selected' : 'driver-card'}
                >
                  {driver.avatar ? (
                    <img src={driver.avatar} alt={driver.name} />
                  ) : (
                    <div className="driver-avatar-fallback">{firstName(driver.name).slice(0, 2).toUpperCase()}</div>
                  )}
                  <div className="driver-info">
                    <div className="driver-name-row">
                      <strong>{driver.name}</strong>
                      {driver.verified && <CheckCircle2 size={16} />}
                      {(driver.women_mode || driver.gender === 'female' || driver.gender === 'mujer') && (
                        <em>Solo para ellas</em>
                      )}
                    </div>
                    {driver.vehicle && <span>{driver.vehicle}</span>}
                    <div className="driver-meta">
                      {driver.rating != null && <small><Star size={13} /> {Number(driver.rating).toFixed(2)}</small>}
                      {driver.distance && <small>{driver.distance}</small>}
                      {driver.eta && <small>{driver.eta}</small>}
                    </div>
                  </div>
                  <div className="driver-side">
                    {driver.price && <div className="driver-price">{formatGs(driver.price)}</div>}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDriver(driver)
                        setShowDriverChooser(false)
                      }}
                      disabled={!destinationPoint}
                    >
                      {selectedDriver?.id === driver.id ? 'Elegido' : 'Elegir chofer'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}


          {activeTrip && activeTripDriver ? (
            <div className="action-row">
              {activeTrip.status !== 'pending' && (
                <a className="main-btn compact" href={`/chat?trip=${activeTrip.id}`}>
                  <MessageCircle size={18} /> Chat
                </a>
              )}
              <button className="secondary-btn compact danger" onClick={cancelActiveTrip}>
                Cancelar
              </button>
            </div>
          ) : (
            <button className="main-btn request-btn" disabled={!selectedDriver || requesting} onClick={requestRide}>
              {requesting
                ? `Esperando respuesta de ${firstName(selectedDriver?.name)}`
                : selectedDriver
                  ? 'Solicitar viaje con este chofer'
                  : 'Elegi un chofer'}
              <ChevronRight size={20} />
            </button>
          )}
            </section>
          </div>
        )}

        {showMenu && (
          <div className="side-backdrop" onClick={() => setShowMenu(false)}>
            <aside className="side-menu" onClick={(event) => event.stopPropagation()}>
              <div className="side-head">
                <div className="avatar-large">
                  {profile?.avatar_url ? <img src={profile.avatar_url} alt="Perfil" /> : <UserRound size={28} />}
                </div>
                <div>
                  <h2>{profile?.full_name || 'Mi cuenta'}</h2>
                  <p>{user?.email || 'Cliente MiChofer'}</p>
                  <span>Cliente MiChofer</span>
                </div>
              </div>

              <a href="/client">
                <UserRound size={18} /> Mi cuenta
              </a>
              <a href="/viajes">Mis viajes</a>
              <button type="button" onClick={() => setPaymentMethod('cash')}>
                <Banknote size={18} /> Efectivo {paymentMethod === 'cash' ? 'actual' : ''}
              </button>
              <button type="button" onClick={() => setPaymentMethod('card')}>
                <CreditCard size={18} /> Tarjeta {paymentMethod === 'card' ? 'actual' : ''}
              </button>
              <button type="button">
                <Banknote size={18} /> Bancos y transferencias
              </button>
              <a href="/chat">Mensajes</a>
              <button type="button" onClick={refreshLocation}>
                <Share2 size={18} /> Compartir ubicacion
              </button>
              <button type="button">
                <HelpCircle size={18} /> Ayuda y soporte
              </button>

              <button
                className="danger-link"
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut()
                  localStorage.clear()
                  window.location.href = '/login'
                }}
              >
                Cerrar sesion
              </button>

              <button className="close-menu" type="button" onClick={() => setShowMenu(false)}>
                <X size={18} /> Cerrar
              </button>
            </aside>
          </div>
        )}
      </section>
    </main>
  )
}
