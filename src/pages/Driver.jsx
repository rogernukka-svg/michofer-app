import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CarFront,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  MessageCircle,
  Navigation,
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
  GOOGLE_ROADS_API_ENABLED,
  GpsBuffer,
  snapToRoads,
} from '../lib/googleMaps'
import {
  DRIVER_CATEGORY_ACTIONS,
  categoryStatusLabel,
  getDriverCategoryStatus,
} from '../lib/rideCategories'

const ACTIVE_STATUSES = ['pending', 'accepted', 'arriving', 'in_progress']
const LOCATION_STATUSES = ['accepted', 'arriving', 'in_progress']
const DEFAULT_DRIVER_LOCATION = { lat: -25.5167, lng: -54.6167 }

const ARRIVED_PICKUP_METERS = 18
const ARRIVED_DESTINATION_METERS = 22
const VERY_CLOSE_METERS = 45
const ROADS_MIN_POINTS = 3
const ROADS_SYNC_INTERVAL_MS = 5200

const SAFETY_ZONES_CDE = [
  {
    name: 'San Rafael',
    lat: -25.5168,
    lng: -54.6258,
    radius: 700,
    level: 'precaución',
  },
  {
    name: 'San Agustín',
    lat: -25.5306,
    lng: -54.6504,
    radius: 650,
    level: 'precaución',
  },
]

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

function bearingBetween(a, b) {
  if (!a?.lat || !a?.lng || !b?.lat || !b?.lng) return 0

  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180

  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function normalizeRoadSnapResult(result) {
  if (!result) return null
  const last = Array.isArray(result) ? result[result.length - 1] : result
  if (!last) return null

  const lat = Number(last.lat)
  const lng = Number(last.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  return {
    lat,
    lng,
    placeId: last.placeId || null,
    originalIndex: Number.isFinite(Number(last.originalIndex)) ? Number(last.originalIndex) : null,
    snappedAt: Number.isFinite(Number(last.snappedAt)) ? Number(last.snappedAt) : Date.now(),
  }
}

function angleDiff(from, to) {
  return ((to - from + 540) % 360) - 180
}

function sideLabelFromHeading(origin, target, heading) {
  if (!origin || !target || !Number.isFinite(Number(heading))) return 'cerca'

  const bearing = bearingBetween(origin, target)
  const diff = angleDiff(Number(heading), bearing)

  if (Math.abs(diff) < 28) return 'adelante'
  if (Math.abs(diff) > 152) return 'detrás'
  return diff > 0 ? 'a la derecha' : 'a la izquierda'
}

function closeArrivalCopy({ status, distanceMeters, side }) {
  if (status === 'accepted' || status === 'arriving') {
    if (distanceMeters <= ARRIVED_PICKUP_METERS) {
      return {
        title: 'Estás en el punto de recogida',
        subtitle: 'El cliente está muy cerca. Verificá el lugar antes de marcar llegada.',
      }
    }

    return {
      title: `Cliente ${side}`,
      subtitle: `Estás a ${Math.max(1, Math.round(distanceMeters))} m del punto de recogida.`,
    }
  }

  if (status === 'in_progress') {
    if (distanceMeters <= ARRIVED_DESTINATION_METERS) {
      return {
        title: 'Llegaste al destino',
        subtitle: 'Confirmá que el pasajero bajó en el punto correcto.',
      }
    }

    return {
      title: `Destino ${side}`,
      subtitle: `Estás a ${Math.max(1, Math.round(distanceMeters))} m del destino.`,
    }
  }

  return null
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

function tripActionLabel(status) {
  if (status === 'accepted') return 'Aceptando viaje y preparando ruta segura...'
  if (status === 'arriving') return 'Marcando llegada al punto...'
  if (status === 'in_progress') return 'Iniciando viaje y recalculando destino...'
  if (status === 'completed') return 'Finalizando viaje...'
  if (status === 'cancelled') return 'Cancelando viaje y avisando al cliente...'
  return 'Actualizando viaje...'
}

function mapsUrl(origin, destination) {
  if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) return ''
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`
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
  const [showSideMenu, setShowSideMenu] = useState(false)
  const [tripAction, setTripAction] = useState('')
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const liveWatchIdRef = useRef(null)
  const liveSyncBusyRef = useRef(false)
  const liveLastSyncAtRef = useRef(0)
  const liveLastStoredPointRef = useRef(null)
  const gpsBufferRef = useRef(new GpsBuffer(20))
  const lastRoadsSnapAtRef = useRef(0)
  const roadsSyncBusyRef = useRef(false)
  useEffect(() => {
    init()
  }, [])

  useEffect(() => {
    if (!user?.id) return undefined

    const channel = supabase
      .channel(`driver-trips-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => loadTrips(user.id))
      .subscribe()

       const interval = window.setInterval(() => loadTrips(user.id), 1800)
    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  const verificationStatus = driverProfile?.verification_status || 'incomplete'
  const approved = driverProfile?.verified === true && verificationStatus === 'approved'
  const [verificationTitle] = verificationCopy(verificationStatus, approved)
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
   const driverPoint = useMemo(() => {
  const lat = Number(driverProfile?.lat)
  const lng = Number(driverProfile?.lng)
  const heading = Number(driverProfile?.heading)
  const speed = Number(driverProfile?.speed)
  const accuracy = Number(driverProfile?.accuracy)

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null
  }

  return {
    lat,
    lng,
    heading: Number.isFinite(heading) ? heading : null,
    speed: Number.isFinite(speed) ? speed : null,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  }
}, [
  driverProfile?.lat,
  driverProfile?.lng,
  driverProfile?.heading,
  driverProfile?.speed,
  driverProfile?.accuracy,
])

  const pickupPoint = focusTrip?.pickup_lat && focusTrip?.pickup_lng
    ? { lat: Number(focusTrip.pickup_lat), lng: Number(focusTrip.pickup_lng) }
    : null

  const destinationPoint = focusTrip?.destination_lat && focusTrip?.destination_lng
    ? { lat: Number(focusTrip.destination_lat), lng: Number(focusTrip.destination_lng) }
    : null

   const navigationTarget = activeTrip?.status === 'in_progress' ? destinationPoint : pickupPoint
  const navigationDistance = useMemo(
    () => (activeTrip && navigationTarget ? distanceKm(driverPoint, navigationTarget) : null),
    [activeTrip, driverPoint, navigationTarget]
  )
  const navigationEta = estimateEta(navigationDistance)
  const guidanceDistance = formatMeters(routeGuidance?.distance) || formatKm(navigationDistance)
  const guidanceEta = formatSeconds(routeGuidance?.duration) || navigationEta

  const navigationMeters = Number.isFinite(Number(routeGuidance?.distance))
    ? Number(routeGuidance.distance)
    : navigationDistance != null
      ? navigationDistance * 1000
      : null

  const destinationSide =
    navigationTarget && navigationMeters != null
      ? sideLabelFromHeading(driverPoint, navigationTarget, routeGuidance?.heading)
      : 'cerca'

  const closeArrival =
    navigationMeters != null && navigationMeters <= VERY_CLOSE_METERS
      ? closeArrivalCopy({
          status: activeTrip?.status,
          distanceMeters: navigationMeters,
          side: destinationSide,
        })
      : null

  const driverAvatar = driverProfile?.avatar_url || profile?.avatar_url || ''
   const focusDistance = useMemo(
    () =>
      focusTrip && driverPoint
        ? distanceKm(driverPoint, { lat: focusTrip.pickup_lat, lng: focusTrip.pickup_lng })
        : null,
    [driverPoint?.lat, driverPoint?.lng, focusTrip]
  )

  const driverDisplayName = profile?.full_name || driverProfile?.full_name || 'MiChofer'
  const currentModeLabel = activeTrip
    ? 'En viaje'
    : isReceivingTrips
      ? 'Disponible'
      : isOnline
        ? 'Conectado'
        : 'Desconectado'

  // Pick the map destination and origin based on active state
  const mapOrigin = driverPoint
  const mapDestination = activeTrip
    ? (activeTrip.status === 'in_progress' ? destinationPoint : pickupPoint)
    : null

     useEffect(() => {
    if (!activeTrip?.id || !hasDriverLocation || !navigator.geolocation) return undefined

    let cancelled = false

    liveLastStoredPointRef.current = getStoredLocation()
    syncStoredTripLocation(activeTrip)

    const handlePosition = (pos) => {
      if (cancelled) return

      pushLiveTripLocation(
        {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
        },
        activeTrip
      )
    }

    const handleError = () => {
      if (!cancelled) {
        syncStoredTripLocation(activeTrip)
      }
    }

    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      handleError,
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 8000,
      }
    )

    liveWatchIdRef.current = watchId

    const fallbackInterval = window.setInterval(() => {
      syncStoredTripLocation(activeTrip)
    }, 7000)

    return () => {
      cancelled = true

      if (liveWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(liveWatchIdRef.current)
        liveWatchIdRef.current = null
      }

      window.clearInterval(fallbackInterval)
    }
  }, [activeTrip?.id, activeTrip?.status, hasDriverLocation, user?.id])
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
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            heading: pos.coords.heading,
          })
        },
        () => resolve(fallback),
        {
          enableHighAccuracy: true,
          timeout: 6000,
          maximumAge: 2500,
        }
      )
    })
  }
  async function pushLiveTripLocation(location, trip = activeTrip) {
    if (!trip?.id || !location || !LOCATION_STATUSES.includes(trip.status) || !user?.id) return null

    const previousLocation = liveLastStoredPointRef.current || getStoredLocation()
    const movedMeters = previousLocation ? (distanceKm(previousLocation, location) || 0) * 1000 : 999
    const accuracy = Number(location.accuracy)
    const speed = Number(location.speed)
    const now = Date.now()

    if (Number.isFinite(accuracy) && accuracy > 55 && previousLocation) {
      return previousLocation
    }

    const moving = Number.isFinite(speed) && speed >= 1.2

    if (previousLocation && !moving && movedMeters < 10) {
      return previousLocation
    }

    if (previousLocation && moving && movedMeters < 3) {
      return previousLocation
    }

    if (now - liveLastSyncAtRef.current < 1200) {
      return previousLocation || location
    }

    if (liveSyncBusyRef.current) {
      return previousLocation || location
    }

    liveLastSyncAtRef.current = now
    liveLastStoredPointRef.current = location

   if (GOOGLE_ROADS_API_ENABLED && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
  gpsBufferRef.current.push({ lat: location.lat, lng: location.lng })

  if (import.meta.env.DEV) {
    console.info('[MiChofer Roads] buffer size:', gpsBufferRef.current.getForRoads().length)
  }
}

setDriverProfile((current) =>
      current
        ? {
            ...current,
            lat: location.lat,
            lng: location.lng,
          }
        : current
    )

    liveSyncBusyRef.current = true

    try {
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
    driver_heading: Number.isFinite(Number(location.heading)) ? Number(location.heading) : null,
    driver_speed: Number.isFinite(Number(location.speed)) ? Number(location.speed) : null,
    driver_accuracy: Number.isFinite(Number(location.accuracy)) ? Number(location.accuracy) : null,
    updated_at: new Date().toISOString(),
  })
  .eq('id', trip.id)
  .eq('driver_id', user.id)

await supabase
  .from('driver_profiles')
  .update({
    heading: Number.isFinite(Number(location.heading)) ? Number(location.heading) : null,
    speed: Number.isFinite(Number(location.speed)) ? Number(location.speed) : null,
    accuracy: Number.isFinite(Number(location.accuracy)) ? Number(location.accuracy) : null,
  })
  .eq('user_id', user.id)

      let snappedPoint = null
      if (GOOGLE_ROADS_API_ENABLED && gpsBufferRef.current.getForRoads().length >= ROADS_MIN_POINTS) {
        const enoughTime = Date.now() - lastRoadsSnapAtRef.current >= ROADS_SYNC_INTERVAL_MS
        if (enoughTime && !roadsSyncBusyRef.current) {
          roadsSyncBusyRef.current = true
          try {
            const rawRoadSnapped = await snapToRoads(gpsBufferRef.current.getForRoads())
            snappedPoint = normalizeRoadSnapResult(rawRoadSnapped)
            if (snappedPoint) {
              lastRoadsSnapAtRef.current = Date.now()
            }
          } catch (error) {
            snappedPoint = null
            if (import.meta.env.DEV) {
              console.warn('[MiChofer Roads] snapToRoads failed:', error)
            }
          } finally {
            roadsSyncBusyRef.current = false
          }
        }
      }

      if (snappedPoint) {
        try {
          await supabase
            .from('trips')
            .update({
              driver_road_lat: snappedPoint.lat,
              driver_road_lng: snappedPoint.lng,
              driver_road_place_id: snappedPoint.placeId,
              driver_road_snapped_at: new Date(snappedPoint.snappedAt).toISOString(),
            })
            .eq('id', trip.id)
            .eq('driver_id', user.id)
          if (import.meta.env.DEV) {
            console.info('[MiChofer Roads] saved snapped point:', snappedPoint)
          }
        } catch {
          // Keep working if Roads columns do not exist or update fails
        }
      }

      return location
    } finally {
      liveSyncBusyRef.current = false
    }
  }
   async function syncStoredTripLocation(trip = activeTrip) {
    const location = await getCurrentLocation()
    if (!trip?.id || !location || !LOCATION_STATUSES.includes(trip.status) || !user?.id) return null

    const storedLocation = getStoredLocation()
    const movedMeters = storedLocation ? (distanceKm(storedLocation, location) || 0) * 1000 : 999
    const accuracy = Number(location.accuracy)
    const speed = Number(location.speed)

    // Si el GPS viene muy impreciso, no movemos el auto.
    // En interiores esto evita que el mapa cambie dirección estando quieto.
    if (Number.isFinite(accuracy) && accuracy > 45 && storedLocation) {
      return storedLocation
    }

    // Si el chofer parece quieto, ignoramos saltos pequeños/medianos del GPS.
    const looksStationary = !Number.isFinite(speed) || speed < 1

    if (storedLocation && looksStationary && movedMeters < 18) {
      return storedLocation
    }

    // En movimiento real, dejamos pasar cambios más pequeños para curvas y giros.
    if (storedLocation && !looksStationary && movedMeters < 5) {
      return storedLocation
    }

    if (GOOGLE_ROADS_API_ENABLED && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
      gpsBufferRef.current.push({ lat: location.lat, lng: location.lng })
    }

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
        driver_heading: Number.isFinite(Number(location.heading)) ? Number(location.heading) : null,
        driver_speed: Number.isFinite(Number(location.speed)) ? Number(location.speed) : null,
        driver_accuracy: Number.isFinite(Number(location.accuracy)) ? Number(location.accuracy) : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', trip.id)
      .eq('driver_id', user.id)

    await supabase
      .from('driver_profiles')
      .update({
        heading: Number.isFinite(Number(location.heading)) ? Number(location.heading) : null,
        speed: Number.isFinite(Number(location.speed)) ? Number(location.speed) : null,
        accuracy: Number.isFinite(Number(location.accuracy)) ? Number(location.accuracy) : null,
      })
      .eq('user_id', user.id)

    if (GOOGLE_ROADS_API_ENABLED && gpsBufferRef.current.getForRoads().length >= ROADS_MIN_POINTS) {
      const enoughTime = Date.now() - lastRoadsSnapAtRef.current >= ROADS_SYNC_INTERVAL_MS
      if (enoughTime && !roadsSyncBusyRef.current) {
        roadsSyncBusyRef.current = true
        try {
          const rawRoadSnapped = await snapToRoads(gpsBufferRef.current.getForRoads())
          const snappedPoint = normalizeRoadSnapResult(rawRoadSnapped)
          if (snappedPoint) {
            lastRoadsSnapAtRef.current = Date.now()
            try {
              await supabase
                .from('trips')
                .update({
                  driver_road_lat: snappedPoint.lat,
                  driver_road_lng: snappedPoint.lng,
                  driver_road_place_id: snappedPoint.placeId,
                  driver_road_snapped_at: new Date(snappedPoint.snappedAt).toISOString(),
                })
                .eq('id', trip.id)
                .eq('driver_id', user.id)
            } catch {
              // Keep working if Roads columns do not exist or update fails
            }
          }
        } catch {
          // ignore Roads API failures and keep normal GPS position
        } finally {
          roadsSyncBusyRef.current = false
        }
      }
    }

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
    if (!error && updatedDriver) setDriverProfile(updatedDriver)

        if (trip?.id && LOCATION_STATUSES.includes(trip.status) && user?.id) {
      await supabase
        .from('trips')
        .update({
          driver_lat: location.lat,
          driver_lng: location.lng,
          updated_at: new Date().toISOString(),
        })
        .eq('id', trip.id)
        .eq('driver_id', user.id)
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
      setMessage('Desconectado.')
    } else if (nextAvailable) {
      setMessage('Disponible para recibir solicitudes.')
    } else {
      setMessage('Conectado, pero pausado.')
    }
  }

  async function requestCategory(categoryCode) {
    if (!driverProfile?.user_id) {
      setMessage('Primero guarda tu perfil de chofer.')
      return
    }
    if (!approved) {
      setMessage('Primero admin debe aprobar tu perfil base.')
      return
    }
    const { data, error } = await requestDriverCategory(categoryCode)
    if (error) {
      console.error('DRIVER CATEGORY REQUEST ERROR:', error)
      setMessage('No pude solicitar esa categoria.')
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
    setMessage(data?.status === 'approved' ? 'Categoria ya aprobada.' : 'Solicitud enviada.')
  }

   async function updateTrip(trip, status) {
    if (!trip?.id || !user?.id) {
      setMessage('No pude identificar este viaje.')
      return
    }

    if (trip.driver_id !== user.id) {
      setMessage('Este viaje no pertenece a tu cuenta de chofer.')
      return
    }

    const allowedTransitions = {
      pending: ['accepted', 'cancelled'],
      accepted: ['arriving', 'cancelled'],
      arriving: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
    }

    const currentStatus = trip.status || 'pending'
    const validNextStatuses = allowedTransitions[currentStatus] || []

    if (!validNextStatuses.includes(status)) {
      setMessage('Cambio de estado no permitido para este viaje.')
      return
    }

    try {
      setTripAction(status)
      setMessage(tripActionLabel(status))

      const location = await getCurrentLocation()

      setTrips((current) =>
        current.map((item) =>
          item.id === trip.id
            ? {
                ...item,
                status,
                driver_lat: location.lat,
                driver_lng: location.lng,
                updated_at: new Date().toISOString(),
              }
            : item
        )
      )

      const { error } = await supabase
        .from('trips')
        .update({
          status,
          driver_lat: location.lat,
          driver_lng: location.lng,
          updated_at: new Date().toISOString(),
        })
        .eq('id', trip.id)
        .eq('driver_id', user.id)

      if (error) {
        setMessage('No pude actualizar el viaje.')
        await loadTrips()
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

      if (status === 'accepted') setMessage('Ruta lista. Vamos al punto de recogida.')
      else if (status === 'cancelled') setMessage('Viaje cancelado. El cliente será avisado.')
      else if (status === 'completed') setMessage('Viaje finalizado.')
      else setMessage('')

      await loadTrips()
    } finally {
      setTripAction('')
    }
  }

  // ==================== RENDER ====================

  // --- Active navigation (accepted, arriving, in_progress) ---
    if (activeTrip && navigationTarget && driverPoint) {
    return (
      <main className="app-shell">
        <section className="phone driver-phone driver-cockpit">
          {/* Map full screen */}
          <InteractiveRouteMap
            origin={driverPoint}
            destination={navigationTarget}
            destinationText={activeTrip.destination_text || 'Destino'}
            clientAvatar={driverAvatar}
            drivers={[]}
            selectedDriver={null}
            onSelectDriver={() => {}}
            onChooseDriver={() => {}}
            onRefreshLocation={() => syncDriverLocation(activeTrip)}
                        fitPadding={{ top: 150, bottom: 150, left: 28, right: 28 }}
            mapInteractive
            animateCamera
            showRouteSummary={false}
                       navigationMode
            showMapTypeControl={false}
            safetyZones={SAFETY_ZONES_CDE}
            onRouteUpdate={setRouteGuidance}
          />

                              {tripAction && (
            <div className="driver-route-loading">
              <RefreshCw size={17} />
              <span>{tripActionLabel(tripAction)}</span>
            </div>
          )}

          {/* Navigation instruction card */}
          <header className="driver-navigation-instruction">
            <div className="driver-navigation-turn-icon">
              <Navigation size={30} />
            </div>

                        <div className="driver-navigation-copy">
              <span>{guidanceDistance}</span>
              <strong>
                {closeArrival?.title || routeGuidance?.instruction || activeTrip.destination_text || 'Seguimos por la ruta'}
              </strong>
              <small>
                {closeArrival?.subtitle || `${guidanceEta} · ${activeTrip.status === 'in_progress' ? 'al destino' : 'al cliente'}`}
              </small>
            </div>

            <button type="button" className="driver-navigation-refresh" onClick={() => syncDriverLocation(activeTrip)} aria-label="Actualizar ubicación">
              <RefreshCw size={18} />
            </button>
          </header>

                    {/* Compact navigation action bar */}
          <section className="driver-navigation-bottom">
            <div className="driver-navigation-trip">
              <span>{statusLabel(activeTrip.status)}</span>
              <strong>{activeTrip.destination_text || 'Destino'}</strong>
              <small>{formatGs(activeTrip.price)} · {guidanceDistance} · {guidanceEta}</small>
            </div>

            <div className="driver-navigation-actions">
              {activeTrip.status === 'accepted' && (
                <button className="driver-navigation-primary" onClick={() => updateTrip(activeTrip, 'arriving')}>
                  <CheckCircle2 size={20} /> Llegué
                </button>
              )}

              {activeTrip.status === 'arriving' && (
                <button className="driver-navigation-primary" onClick={() => updateTrip(activeTrip, 'in_progress')}>
                  <Play size={20} /> Iniciar
                </button>
              )}

              {activeTrip.status === 'in_progress' && (
                <button className="driver-navigation-primary" onClick={() => updateTrip(activeTrip, 'completed')}>
                  <Square size={20} /> Finalizar
                </button>
              )}

                            <a href={`/chat?trip=${activeTrip.id}`} className="driver-navigation-chat" aria-label="Abrir chat">
                <MessageCircle size={20} />
              </a>

                <button
                type="button"
                className="driver-navigation-cancel"
                onClick={() => setShowCancelConfirm(true)}
                aria-label="Cancelar viaje"
              >
                <XCircle size={20} />
              </button>
            </div>
                      {showCancelConfirm && (
            <div
              className="michofer-modal-backdrop"
              onClick={() => setShowCancelConfirm(false)}
              role="presentation"
            >
              <section
                className="michofer-confirm-modal"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="Cancelar viaje"
              >
                <div className="michofer-confirm-icon danger">
                  <XCircle size={28} />
                </div>

                <div className="michofer-confirm-copy">
                  <span>Cancelar viaje</span>
                  <h2>¿Querés cancelar este viaje?</h2>
                  <p>
                    El cliente será avisado y el viaje dejará de estar activo en tu panel.
                  </p>
                </div>

                <div className="michofer-confirm-trip">
                  <span>{statusLabel(activeTrip.status)}</span>
                  <strong>{activeTrip.destination_text || 'Destino del viaje'}</strong>
                  <small>{formatGs(activeTrip.price)} · {guidanceDistance} · {guidanceEta}</small>
                </div>

                <div className="michofer-confirm-actions">
                  <button
                    type="button"
                    className="michofer-confirm-secondary"
                    onClick={() => setShowCancelConfirm(false)}
                    disabled={tripAction === 'cancelled'}
                  >
                    Seguir viaje
                  </button>

                  <button
                    type="button"
                    className="michofer-confirm-danger"
                    onClick={() => {
                      setShowCancelConfirm(false)
                      updateTrip(activeTrip, 'cancelled')
                    }}
                    disabled={tripAction === 'cancelled'}
                  >
                    {tripAction === 'cancelled' ? 'Cancelando...' : 'Sí, cancelar'}
                  </button>
                </div>
              </section>
            </div>
          )}
          </section>
        </section>
      </main>
    )
  }

  // --- Idle / Dashboard state ---
  return (
    <main className="app-shell">
      <section className="phone driver-phone driver-idle">
        {/* Map background */}
                <div className="driver-idle-map">
          {driverPoint ? (
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
              showOriginCar
              showMapTypeControl={false}
              safetyZones={SAFETY_ZONES_CDE}
              onRouteUpdate={() => {}}
            />
          ) : (
            <section className="mobility-map interactive-map">
              <div className="map-empty-state">
                <div className="map-empty-card">
                  <strong>GPS del chofer pendiente</strong>
                  <span>Activá o calibrá tu ubicación para aparecer en el punto real.</span>
                  <button type="button" className="main-btn" onClick={() => syncDriverLocation(null, true, isAvailable)}>
                    Calibrar ubicación
                  </button>
                </div>
              </div>
            </section>
                   )}
        </div>

        {/* Driver status bar */}
        <header className="driver-idle-bar">
          <button
            type="button"
            className="driver-idle-avatar"
            onClick={() => setShowSideMenu(true)}
            aria-label="Abrir menú"
          >
            {driverAvatar ? <img src={driverAvatar} alt={driverDisplayName} /> : <UserRound size={22} />}
          </button>
          <div className="driver-idle-bar-center">
            <span className={`driver-idle-dot ${isReceivingTrips ? 'online' : isOnline ? 'standby' : 'offline'}`} />
            <div>
              <strong>{currentModeLabel}</strong>
              <small>{hasDriverLocation ? 'GPS activo' : 'Sin GPS'}</small>
            </div>
          </div>
          <button type="button" className="driver-idle-refresh" onClick={init} aria-label="Actualizar">
            <RefreshCw size={18} />
          </button>
        </header>

        {/* Message */}
        {message && <div className="driver-idle-notice">{message}</div>}

        {/* Pending trip request */}
        {pendingTrips.length > 0 && (
          <div className="driver-idle-request">
            {pendingTrips.slice(0, 1).map((trip) => (
              <article key={trip.id} className="driver-idle-request-card">
                <div className="driver-idle-request-top">
                  <span>Solicitud de viaje</span>
                  <strong>{formatGs(trip.price)}</strong>
                </div>
                <h2>{trip.destination_text || 'Destino solicitado'}</h2>
                <p>
                  <MapPin size={14} /> {trip.pickup_lat && trip.pickup_lng && driverProfile?.lat && driverProfile?.lng
                    ? formatKm(distanceKm(
                        { lat: driverProfile.lat, lng: driverProfile.lng },
                        { lat: trip.pickup_lat, lng: trip.pickup_lng }
                      ))
                    : ''} · Cliente te eligió
                </p>
                <div className="driver-idle-request-actions">
                  <button className="driver-idle-accept" onClick={() => updateTrip(trip, 'accepted')}>
                    <CheckCircle2 size={18} /> Aceptar
                  </button>
                  <button className="driver-idle-reject" onClick={() => updateTrip(trip, 'cancelled')}>
                    <XCircle size={18} /> Rechazar
                  </button>
                  <a href={`/chat?trip=${trip.id}`} className="driver-idle-chat-link" aria-label="Chat">
                    <MessageCircle size={18} />
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}

        {/* Only show controls when no incoming trip */}
        {pendingTrips.length === 0 && (
          <section className="driver-idle-controls">
            {/* Online/offline toggle */}
            <button
              type="button"
              className={`driver-idle-btn ${isOnline ? 'active' : ''}`}
              onClick={() => updateAvailability(!isOnline, !isOnline)}
              disabled={!approved}
            >
              {isOnline ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
              <span>{isOnline ? 'En línea' : 'Conectarme'}</span>
            </button>

            {/* Receive trips toggle */}
            <button
              type="button"
              className={`driver-idle-btn ${isReceivingTrips ? 'active accent' : ''}`}
              onClick={() => updateAvailability(true, !isAvailable)}
              disabled={!approved || (!isOnline && !isAvailable)}
            >
              <CarFront size={20} />
              <span>{isReceivingTrips ? 'Recibiendo' : 'Recibir viajes'}</span>
            </button>

            {/* Calibrate */}
            <button
              type="button"
              className="driver-idle-btn ghost"
              onClick={() => syncDriverLocation(activeTrip, true, isAvailable)}
            >
              <RefreshCw size={16} />
              <span>Calibrar</span>
            </button>

            {/* Request count badge */}
            <div className="driver-idle-badge">
              <Clock size={16} />
              <span>{pendingTrips.length} solicitudes</span>
            </div>
          </section>
        )}

        {/* Verification warning */}
        {!approved && (
          <div className="driver-idle-verify-warning">
            <ShieldCheck size={14} /> {verificationTitle}
          </div>
        )}

        {/* Side menu */}
        {showSideMenu && (
          <div className="side-backdrop driver-side-backdrop" onClick={() => setShowSideMenu(false)}>
            <aside className="side-menu driver-side-menu" onClick={(e) => e.stopPropagation()}>
              <button className="side-menu-close" type="button" onClick={() => setShowSideMenu(false)} aria-label="Cerrar">
                ✕
              </button>

              <div className="driver-side-head">
                <div className={`driver-side-avatar ${isOnline ? 'online' : 'offline'}`}>
                  {driverAvatar ? <img src={driverAvatar} alt={driverDisplayName} /> : <UserRound size={26} />}
                </div>
                <div>
                  <strong>{driverDisplayName}</strong>
                  <small>{[driverProfile?.car_brand, driverProfile?.car_model].filter(Boolean).join(' ') || 'Vehículo listo'}</small>
                </div>
              </div>

              {!approved && (
                <div className="notice-card driver-side-notice">
                  <ShieldCheck size={14} /> {verificationTitle}
                </div>
              )}

              <div className="driver-side-categories">
                <strong>Categorías</strong>
                {DRIVER_CATEGORY_ACTIONS.map((category) => {
                  const status = getDriverCategoryStatus(driverProfile, category.code)
                  const disabled = !approved || status === 'approved' || status === 'requested'
                  return (
                    <button
                      key={category.code}
                      type="button"
                      className={`driver-side-cat-btn ${status}`}
                      onClick={() => requestCategory(category.code)}
                      disabled={disabled}
                    >
                      <span>{category.title}</span>
                      <small>{categoryStatusLabel(status)}</small>
                    </button>
                  )
                })}
              </div>

              <button className="driver-side-logout" type="button" onClick={async () => {
                await supabase.auth.signOut()
                window.location.href = '/login'
              }}>
                <LogOut size={18} /> Cerrar sesión
              </button>
            </aside>
          </div>
        )}
      </section>
    </main>
  )
}