import { useEffect, useMemo, useState } from 'react'
import {
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
import InteractiveRouteMap from '../components/InteractiveRouteMap'
import {
  getOwnDriverTrips,
  getOwnDriverProfile,
  getOwnProfile,
  requestDriverCategory,
  supabase,
  updateOwnDriverStatus,
  upsertOwnDriverProfile,
} from '../lib/supabase'
import {
  DRIVER_CATEGORY_ACTIONS,
  categoryStatusLabel,
  getDriverCategoryStatus,
} from '../lib/rideCategories'

const ACTIVE_STATUSES = ['pending', 'accepted', 'arriving', 'in_progress']
const LOCATION_STATUSES = ['accepted', 'arriving', 'in_progress']
const DEFAULT_DRIVER_LOCATION = { lat: -25.5167, lng: -54.6167 }

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

function formatGs(value) {
  return `${Number(value || 0).toLocaleString('es-PY')} Gs.`
}

function formatKm(value) {
  if (value == null) return 'Sin ubicación'
  if (value < 1) return `${Math.max(1, Math.round(value * 1000))} m`
  return `${value.toFixed(1)} km`
}

function formatMeters(value) {
  const meters = Number(value)
  if (!Number.isFinite(meters)) return null
  if (meters < 1000) return `${Math.max(1, Math.round(meters))} m`
  return `${(meters / 1000).toFixed(1)} km`
}

function formatSeconds(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return null
  return `${Math.max(1, Math.round(seconds / 60))} min`
}

function estimateEta(km) {
  if (km == null) return 'Calculando'
  return `${Math.max(2, Math.round(km * 3))} min`
}

function statusLabel(status) {
  if (status === 'accepted') return 'Aceptado'
  if (status === 'arriving') return 'Llegué al punto'
  if (status === 'in_progress') return 'Viaje en curso'
  if (status === 'completed') return 'Finalizado'
  if (status === 'cancelled') return 'Cancelado'
  return 'Solicitud entrante'
}

function mapsUrl(origin, destination) {
  if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) return ''
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`
}

function navigationCopy(status) {
  if (status === 'accepted') return ['Segui al punto de encuentro', 'En camino al cliente']
  if (status === 'arriving') return ['Confirmá cuando suba', 'Cliente en el punto']
  if (status === 'in_progress') return ['Llevalo al destino', 'Ruta al destino']
  return ['Preparando ruta', 'Viaje activo']
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim())
  if (!value) return []

  return String(value)
    .replace(/[{}"]/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function verificationCopy(status, approved) {
  if (approved) return ['Perfil aprobado', 'Ya podes recibir viajes.']
  if (status === 'rejected') return ['Perfil rechazado', 'Corregi tus datos y volve a enviar la revision.']
  if (status === 'submitted') return ['Perfil en revision', 'Admin revisa tus datos antes de activar viajes.']
  return ['Perfil incompleto', 'Carga tus datos y documentos para empezar.']
}

export default function Driver() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [driverProfile, setDriverProfile] = useState(null)
  const [trips, setTrips] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [routeGuidance, setRouteGuidance] = useState(null)

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

  const verificationStatus = driverProfile?.verification_status || 'incomplete'
  const approved = driverProfile?.verified === true && verificationStatus === 'approved'
  const [verificationTitle, verificationSubtitle] = verificationCopy(verificationStatus, approved)
  const isOnline = driverProfile?.is_online === true
  const isAvailable = driverProfile?.is_available === true
  const hasDriverLocation =
    Number.isFinite(Number(driverProfile?.lat)) && Number.isFinite(Number(driverProfile?.lng))
  const isReceivingTrips = isOnline && isAvailable && hasDriverLocation
  const activeTrip = useMemo(() => trips.find((trip) => trip.status !== 'pending') || null, [trips])
  const pendingTrips = useMemo(
    () =>
      trips
        .filter((trip) => trip.status === 'pending')
        .sort((a, b) => {
          const driverPoint = { lat: driverProfile?.lat, lng: driverProfile?.lng }
          const distanceA = distanceKm(driverPoint, { lat: a.pickup_lat, lng: a.pickup_lng }) ?? 999
          const distanceB = distanceKm(driverPoint, { lat: b.pickup_lat, lng: b.pickup_lng }) ?? 999
          return distanceA - distanceB
        }),
    [driverProfile?.lat, driverProfile?.lng, trips]
  )
  const focusTrip = activeTrip || pendingTrips[0] || null
  const driverPoint = useMemo(
    () => ({
      lat: Number(driverProfile?.lat) || DEFAULT_DRIVER_LOCATION.lat,
      lng: Number(driverProfile?.lng) || DEFAULT_DRIVER_LOCATION.lng,
    }),
    [driverProfile?.lat, driverProfile?.lng]
  )
  const pickupPoint = focusTrip?.pickup_lat && focusTrip?.pickup_lng
    ? { lat: Number(focusTrip.pickup_lat), lng: Number(focusTrip.pickup_lng) }
    : null
  const destinationPoint = focusTrip?.destination_lat && focusTrip?.destination_lng
    ? { lat: Number(focusTrip.destination_lat), lng: Number(focusTrip.destination_lng) }
    : null
  const pickupNavUrl = mapsUrl(driverPoint, pickupPoint)
  const destinationNavUrl = mapsUrl(driverPoint, destinationPoint)
  const navigationTarget = activeTrip?.status === 'in_progress' ? destinationPoint : pickupPoint
  const navigationDistance = useMemo(
    () => (activeTrip && navigationTarget ? distanceKm(driverPoint, navigationTarget) : null),
    [activeTrip, driverPoint, navigationTarget]
  )
  const navigationEta = estimateEta(navigationDistance)
  const [navigationTitle, navigationStage] = navigationCopy(activeTrip?.status)
  const guidanceDistance = formatMeters(routeGuidance?.distance) || formatKm(navigationDistance)
  const guidanceEta = formatSeconds(routeGuidance?.duration) || navigationEta
  const guidanceInstruction = routeGuidance?.instruction || navigationTitle
  const navigationDestinationText = activeTrip?.status === 'in_progress'
    ? activeTrip?.destination_text || 'Destino'
    : 'Punto de encuentro'
  const driverAvatar = driverProfile?.avatar_url || profile?.avatar_url || ''
  const focusDistance = useMemo(
    () =>
      focusTrip
        ? distanceKm(
            { lat: driverProfile?.lat, lng: driverProfile?.lng },
            { lat: focusTrip.pickup_lat, lng: focusTrip.pickup_lng }
          )
        : null,
    [driverProfile?.lat, driverProfile?.lng, focusTrip]
  )

  useEffect(() => {
    if (!activeTrip?.id || !hasDriverLocation) return undefined

    const interval = window.setInterval(() => {
      syncStoredTripLocation(activeTrip)
    }, 8000)

    return () => window.clearInterval(interval)
  }, [activeTrip?.id, activeTrip?.status, driverProfile?.lat, driverProfile?.lng, hasDriverLocation])

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

    const { data: profileData } = await getOwnProfile()

    setProfile(profileData || null)

    const fallbackName = profileData?.full_name || currentUser.user_metadata?.full_name || 'Chofer MiChofer'
    const fallbackAvatar = profileData?.avatar_url || currentUser.user_metadata?.avatar_url || ''

    const { error: ensureError } = await upsertOwnDriverProfile({
      fullName: fallbackName,
      avatarUrl: fallbackAvatar,
      email: currentUser.email,
    })

    if (ensureError) {
      setMessage('No pude preparar tu perfil de chofer. Ejecuta supabase/driver_live_state_rpcs.sql y recarga.')
    }

    let { data: driverData, error } = await getOwnDriverProfile()

    if (error) {
      setMessage('No pude leer tu estado de chofer. Ejecuta supabase/driver_live_state_rpcs.sql.')
    }

    if (driverData?.user_id && (!driverData.avatar_url || !driverData.full_name)) {
      const { data: updatedDriver } = await upsertOwnDriverProfile({
        fullName: driverData.full_name || fallbackName,
        avatarUrl: driverData.avatar_url || fallbackAvatar,
        email: driverData.email || currentUser.email,
      })

      if (updatedDriver) driverData = updatedDriver
    }

    setDriverProfile(driverData || null)
    await loadTrips(currentUser.id)
    setLoading(false)
  }

  async function loadTrips(driverId = user?.id) {
    if (!driverId) return

    const { data, error } = await getOwnDriverTrips()

    if (error) {
      setMessage('No pude cargar solicitudes. Ejecuta supabase/driver_live_state_rpcs.sql y recarga.')
      return
    }

    setTrips(data || [])
  }

  function getStoredLocation() {
    const lat = Number(driverProfile?.lat)
    const lng = Number(driverProfile?.lng)

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

    return { lat, lng }
  }

  async function getCurrentLocation() {
    const fallback = getStoredLocation() || DEFAULT_DRIVER_LOCATION

    if (!navigator.geolocation) return fallback

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(fallback),
        { enableHighAccuracy: true, timeout: 7000 }
      )
    })
  }

  async function syncStoredTripLocation(trip = activeTrip) {
    const location = await getCurrentLocation()

    if (!trip?.id || !location || !LOCATION_STATUSES.includes(trip.status)) return null

    const storedLocation = getStoredLocation()
    const movedMeters = storedLocation ? (distanceKm(storedLocation, location) || 0) * 1000 : 999

    if (movedMeters < 5) return storedLocation || location

    const { data: updatedDriver } = await updateOwnDriverStatus({
      isOnline: true,
      isAvailable,
      lat: location.lat,
      lng: location.lng,
    })

    if (updatedDriver) setDriverProfile(updatedDriver)

    await supabase
      .from('trips')
      .update({
        driver_lat: location.lat,
        driver_lng: location.lng,
        updated_at: new Date().toISOString(),
      })
      .eq('id', trip.id)

    return location
  }

  async function syncDriverLocation(trip = activeTrip, nextOnline = isOnline, nextAvailable = isAvailable) {
    if (!driverProfile?.user_id) return null

    const location = nextOnline ? await getCurrentLocation() : getStoredLocation()

    if (!Number.isFinite(location?.lat) || !Number.isFinite(location?.lng)) return null

    const { data: updatedDriver, error } = await updateOwnDriverStatus({
      isOnline: nextOnline,
      isAvailable: nextAvailable,
      lat: location?.lat,
      lng: location?.lng,
    })

    if (!error && updatedDriver) {
      setDriverProfile(updatedDriver)
    }

    if (trip?.id && LOCATION_STATUSES.includes(trip.status)) {
      await supabase
        .from('trips')
        .update({
          driver_lat: location.lat,
          driver_lng: location.lng,
          updated_at: new Date().toISOString(),
        })
        .eq('id', trip.id)
    }

    return location
  }

  async function updateAvailability(nextOnline, nextAvailable) {
    if (!driverProfile?.user_id) return

    if (!approved) {
      setMessage('Tu cuenta esta en revision. Te avisaremos cuando puedas recibir viajes.')
      return
    }

    const location = await getCurrentLocation()

    const { data: updatedDriver, error } = await updateOwnDriverStatus({
      isOnline: nextOnline,
      isAvailable: nextAvailable,
      lat: location.lat,
      lng: location.lng,
    })

    if (error) {
      setMessage('No pude actualizar disponibilidad.')
      return
    }

    if (updatedDriver) setDriverProfile(updatedDriver)
    if (!nextOnline) {
      setMessage('Desconectado. No vas a aparecer para clientes.')
    } else if (nextAvailable) {
      setMessage('Estas disponible para recibir solicitudes.')
    } else {
      setMessage('Conectado, pero pausado. Activa recibir viajes para aparecer.')
    }
  }

  async function requestCategory(categoryCode) {
    if (!driverProfile?.user_id) {
      setMessage('Primero guarda tu perfil de chofer.')
      return
    }

    if (!approved) {
      setMessage('Primero admin debe aprobar tu perfil base. Despues podes activar mas categorias.')
      return
    }

    const { data, error } = await requestDriverCategory(categoryCode)

    if (error) {
      console.error('DRIVER CATEGORY REQUEST ERROR:', error)
      setMessage('No pude solicitar esa categoria. Ejecuta supabase/michofer_mobility_foundation.sql y recarga.')
      return
    }

    setDriverProfile((current) => {
      const requested = normalizeTextArray(current?.requested_categories)
      const nextRequested = requested.includes(categoryCode) ? requested : [...requested, categoryCode]

      return {
        ...(current || {}),
        requested_categories: nextRequested,
        women_driver_requested: categoryCode === 'ella' ? true : current?.women_driver_requested,
        women_driver_status: categoryCode === 'ella' ? 'requested' : current?.women_driver_status,
        premium_status: categoryCode === 'premium' ? 'requested' : current?.premium_status,
      }
    })

    setMessage(data?.status === 'approved' ? 'Categoria ya aprobada.' : 'Solicitud enviada. Admin la revisa antes de activarla.')
  }

  async function updateTrip(trip, status) {
    const location = await getCurrentLocation()
    const { error } = await supabase
      .from('trips')
      .update({
        status,
        driver_lat: location.lat,
        driver_lng: location.lng,
        updated_at: new Date().toISOString(),
      })
      .eq('id', trip.id)

    if (error) {
      setMessage('No pude actualizar el viaje.')
      return
    }

    const nextAvailable = status === 'completed' || status === 'cancelled'
    const { data: updatedDriver } = await updateOwnDriverStatus({
      isOnline: true,
      isAvailable: nextAvailable,
      lat: location.lat,
      lng: location.lng,
    })

    if (updatedDriver) setDriverProfile(updatedDriver)

    if (status === 'accepted') {
      setMessage('Aceptaste el viaje. El cliente ya ve que estas en camino.')
    } else if (status === 'cancelled') {
      setMessage('Solicitud rechazada. El cliente podrá elegir otro chofer.')
    } else if (status === 'completed') {
      setMessage('Viaje finalizado.')
    } else {
      setMessage('')
    }

    await loadTrips()
  }

  const driverDisplayName = profile?.full_name || driverProfile?.full_name || 'MiChofer'
  const vehicleLabel =
    [driverProfile?.car_brand, driverProfile?.car_model].filter(Boolean).join(' ') || 'Vehículo listo'
  const currentModeLabel = activeTrip
    ? 'En viaje'
    : isReceivingTrips
      ? 'Disponible'
      : isOnline
        ? 'Conectado'
        : 'Desconectado'
  const heroSubtitle = isReceivingTrips
    ? 'Estás visible para pasajeros cercanos.'
    : isOnline
      ? 'Conectado, listo para activar solicitudes.'
      : 'Tu cabina de control para salir a ruta.'
  const routeHeadline = focusTrip
    ? statusLabel(focusTrip.status)
    : !approved
      ? verificationSubtitle
      : isReceivingTrips
        ? 'Esperando una nueva solicitud'
        : isOnline && !hasDriverLocation
          ? 'Calibrá tu punto para aparecer'
          : isOnline
            ? 'Activá recibir viajes'
            : 'Conectate para aparecer'

  return (
    <main className="app-shell">
      <section className={`phone driver-phone driver-v2 ${activeTrip && navigationTarget ? 'active-navigation' : ''}`}>
        <header className="driver-v2-topbar">
          <div className="driver-v2-topbar-left">
            <span className={`driver-v2-dot ${isReceivingTrips ? 'online' : isOnline ? 'standby' : 'offline'}`} />
            <div>
              <strong>{currentModeLabel}</strong>
              <small>{hasDriverLocation ? 'Ubicación lista' : 'Sin GPS'}</small>
            </div>
          </div>
          <button type="button" className="driver-v2-refresh" onClick={init} aria-label="Actualizar">
            <RefreshCw size={18} />
          </button>
        </header>

        {activeTrip && navigationTarget ? (
          <section className="driver-v2-nav-layout">
            <InteractiveRouteMap
              origin={driverPoint}
              destination={navigationTarget}
              destinationText={navigationDestinationText}
              clientAvatar={driverAvatar}
              drivers={[]}
              selectedDriver={null}
              onSelectDriver={() => {}}
              onChooseDriver={() => {}}
              onRefreshLocation={() => syncDriverLocation(activeTrip)}
              fitPadding={{ top: 118, bottom: 180, left: 42, right: 42 }}
              mapInteractive={false}
              animateCamera
              showRouteSummary={false}
              navigationMode
              onRouteUpdate={setRouteGuidance}
            />

            <article className="driver-v2-turn-card">
              <span>{navigationStage}</span>
              <strong>{guidanceInstruction}</strong>
              <div>
                <small>{guidanceDistance}</small>
                <small>{guidanceEta}</small>
              </div>
            </article>

            <article className="driver-v2-live-sheet">
              <div className="driver-v2-live-copy">
                <span>{statusLabel(activeTrip.status)}</span>
                <strong>{activeTrip.destination_text || navigationDestinationText}</strong>
                <p>{guidanceInstruction}</p>
                <small>{formatGs(activeTrip.price)} · {guidanceDistance} · {guidanceEta}</small>
              </div>

              <div className="driver-v2-live-actions">
                {activeTrip.status === 'accepted' && (
                  <button className="driver-v2-primary-btn" onClick={() => updateTrip(activeTrip, 'arriving')}>
                    <CheckCircle2 size={18} /> Llegué
                  </button>
                )}
                {activeTrip.status === 'arriving' && (
                  <button className="driver-v2-primary-btn" onClick={() => updateTrip(activeTrip, 'in_progress')}>
                    <Play size={18} /> Iniciar
                  </button>
                )}
                {activeTrip.status === 'in_progress' && (
                  <button className="driver-v2-primary-btn" onClick={() => updateTrip(activeTrip, 'completed')}>
                    <Square size={18} /> Finalizar
                  </button>
                )}
                <a href={`/chat?trip=${activeTrip.id}`} className="driver-v2-icon-btn" aria-label="Abrir chat">
                  <MessageCircle size={18} />
                </a>
              </div>
            </article>
          </section>
        ) : (
          <>
            {hasDriverLocation && (
              <div className="driver-v2-idle-map">
                <InteractiveRouteMap
                  origin={driverPoint}
                  destination={null}
                  destinationText={null}
                  clientAvatar={driverAvatar}
                  drivers={[]}
                  selectedDriver={null}
                  onSelectDriver={() => {}}
                  onChooseDriver={() => {}}
                  onRefreshLocation={() => syncDriverLocation(null)}
                  mapInteractive={false}
                  animateCamera={false}
                  showRouteSummary={false}
                  navigationMode={false}
                  onRouteUpdate={() => {}}
                />
              </div>
            )}

            <section className="driver-v2-dashboard">
              <section className="driver-v2-hero-card">
                <div className="driver-v2-hero-copy">
                  <p className="driver-v2-eyebrow">Panel de chofer</p>
                  <h1>{driverDisplayName}</h1>
                  <span>{vehicleLabel}</span>
                  <p>{heroSubtitle}</p>
                </div>

                <div className="driver-v2-hero-side">
                  <div className={`driver-v2-avatar ${isOnline ? 'online' : 'offline'}`}>
                    {driverAvatar ? <img src={driverAvatar} alt={driverDisplayName} /> : <UserRound size={28} />}
                  </div>
                  <div className={approved ? 'driver-v2-verify ok' : 'driver-v2-verify'}>
                    <ShieldCheck size={14} /> {verificationTitle}
                  </div>
                </div>
              </section>

              {message && <div className="notice-card driver-v2-notice">{message}</div>}

              <section className="driver-v2-status-grid">
                <button
                  type="button"
                  className={isOnline ? 'driver-v2-status-tile active' : 'driver-v2-status-tile'}
                  onClick={() => updateAvailability(!isOnline, !isOnline)}
                  disabled={!approved}
                >
                  {isOnline ? <ToggleRight size={25} /> : <ToggleLeft size={25} />}
                  <div>
                    <strong>{isOnline ? 'En línea' : 'Conectarme'}</strong>
                    <small>{isOnline ? 'Visible en el sistema' : 'Activar panel'}</small>
                  </div>
                </button>

                <button
                  type="button"
                  className={isReceivingTrips ? 'driver-v2-status-tile active accent' : 'driver-v2-status-tile'}
                  onClick={() => updateAvailability(true, !isAvailable)}
                  disabled={!approved || (!isOnline && !isAvailable)}
                >
                  <CarFront size={24} />
                  <div>
                    <strong>{isReceivingTrips ? 'Recibiendo' : 'Recibir viajes'}</strong>
                    <small>{isReceivingTrips ? 'Modo activo' : !isOnline ? 'Conectate primero' : 'Activar solicitudes'}</small>
                  </div>
                </button>
              </section>

              <section className="driver-v2-intel-card">
                <div className="driver-v2-card-head">
                  <div>
                    <span>Inteligencia de ruta</span>
                    <strong>{routeHeadline}</strong>
                  </div>
                  <em>{hasDriverLocation ? 'GPS OK' : 'Sin GPS'}</em>
                </div>

                <div className="driver-v2-metrics">
                  <small><MapPin size={14} /> {hasDriverLocation ? (focusTrip ? formatKm(focusDistance) : 'Ubicación lista') : 'Sin ubicación'}</small>
                  <small><Clock size={14} /> {focusTrip ? estimateEta(focusDistance) : isReceivingTrips ? 'En vivo' : 'Listo'}</small>
                  <small>{focusTrip?.price ? formatGs(focusTrip.price) : 'Auto normal'}</small>
                </div>

                <div className="driver-v2-command-row">
                  <button type="button" onClick={() => syncDriverLocation(activeTrip, true, isAvailable)}>
                    <RefreshCw size={16} /> Calibrar punto
                  </button>
                  {pickupNavUrl && <a href={pickupNavUrl} target="_blank" rel="noreferrer"><MapPin size={16} /> Ir al cliente</a>}
                  {destinationNavUrl && <a href={destinationNavUrl} target="_blank" rel="noreferrer"><CarFront size={16} /> Ir al destino</a>}
                </div>
              </section>

              <section className="driver-v2-category-panel">
                <div className="driver-v2-section-title">
                  <h2>Tus categorías</h2>
                  <span>{approved ? 'Activas y pendientes' : 'Bloqueadas hasta aprobación'}</span>
                </div>

                <div className="driver-v2-category-grid">
                  {DRIVER_CATEGORY_ACTIONS.map((category) => {
                    const status = getDriverCategoryStatus(driverProfile, category.code)
                    const disabled = !approved || status === 'approved' || status === 'requested'

                    return (
                      <article key={category.code} className={`driver-v2-category-card ${status}`}>
                        <div>
                          <strong>{category.title}</strong>
                          <p>{category.description}</p>
                        </div>
                        <span>{categoryStatusLabel(status)}</span>
                        <button type="button" onClick={() => requestCategory(category.code)} disabled={disabled}>
                          {status === 'approved' ? 'Aprobada' : status === 'requested' ? 'En revisión' : category.button}
                        </button>
                      </article>
                    )
                  })}
                </div>
              </section>

              {loading ? (
                <section className="empty-state driver-v2-empty">Cargando panel...</section>
              ) : (
                <section className="driver-v2-requests">
                  <div className="driver-v2-section-title">
                    <h2>Solicitudes entrantes</h2>
                    <span>{pendingTrips.length}</span>
                  </div>

                  {pendingTrips.length === 0 ? (
                    <div className="empty-state driver-v2-empty">
                      <Clock size={22} />
                      Cuando un cliente te elija, la solicitud aparecerá acá.
                    </div>
                  ) : (
                    <div className="driver-v2-request-list">
                      {pendingTrips.map((trip) => (
                        <article key={trip.id} className="driver-v2-trip-card">
                          <div className="driver-v2-trip-line">
                            <span>Esperando tu respuesta</span>
                            <strong>{formatGs(trip.price)}</strong>
                          </div>
                          <h2>{trip.destination_text || 'Destino solicitado'}</h2>
                          <p>
                            <UserRound size={14} /> Cliente te eligió manualmente
                            {trip.pickup_lat && trip.pickup_lng && driverProfile?.lat && driverProfile?.lng
                              ? ` · ${formatKm(distanceKm(
                                  { lat: driverProfile.lat, lng: driverProfile.lng },
                                  { lat: trip.pickup_lat, lng: trip.pickup_lng }
                                ))}`
                              : ''}
                          </p>
                          <div className="driver-v2-trip-actions">
                            <a href={`/chat?trip=${trip.id}`}><MessageCircle size={16} /> Chat</a>
                            <button onClick={() => updateTrip(trip, 'accepted')}><CheckCircle2 size={16} /> Aceptar</button>
                            <button className="danger" onClick={() => updateTrip(trip, 'cancelled')}><XCircle size={16} /> Rechazar</button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <button
                className="driver-v2-logout"
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut()
                  window.location.href = '/login'
                }}
              >
                <LogOut size={18} /> Cerrar sesión
              </button>
            </section>
          </>
        )}
      </section>
    </main>
  )
}
