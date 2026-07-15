//Driver.jsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import driverRequestTone from '../assets/tonodriver.mp3'
import messageTone from '../assets/toonomensaje.mp3'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BellRing,
  CarFront,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  MessageCircle,
  Navigation,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Square,
  Star,
  ToggleLeft,
  ToggleRight,
  UserRound,
  XCircle,
} from 'lucide-react'
import InteractiveRouteMap from '../components/InteractiveRouteMap'
import TripChatModal from '../components/TripChatModal'
import {
  getOwnDriverTrips,
  isAdminSimulatorTrip,
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
import { MODE_LABELS } from '../lib/performanceProfile'
import { usePerformanceProfile } from '../hooks/usePerformanceProfile'
import {
  DRIVER_CATEGORY_ACTIONS,
  categoryStatusLabel,
  getDriverCategoryStatus,
} from '../lib/rideCategories'

const ACTIVE_STATUSES = ['pending', 'accepted', 'arriving', 'in_progress']
const LOCATION_STATUSES = ['accepted', 'arriving', 'in_progress']

function isEllaTrip(trip) {
  return (
    trip?.ride_category === 'ella' ||
    trip?.women_mode === true ||
    trip?.safety_mode === 'women_verified'
  )
}
const DEFAULT_DRIVER_LOCATION = { lat: -25.5167, lng: -54.6167 }

const ARRIVED_PICKUP_METERS = 18
const ARRIVED_DESTINATION_METERS = 22
const VERY_CLOSE_METERS = 45
const ROADS_MIN_POINTS = 3
const ROADS_SYNC_INTERVAL_MS = 5200
const MAX_DRIVER_GPS_ACCURACY = 100
const POOR_DRIVER_GPS_ACCURACY = 70
const IMPOSSIBLE_DRIVER_SPEED_MPS = 45
const DRIVER_STATIONARY_SPEED_MPS = 0.35

const DRIVER_NAV_FIT_PADDING = { top: 190, bottom: 230, left: 34, right: 34 }
const DRIVER_NAV_UI_SAFE_AREA = { top: 150, bottom: 190, left: 24, right: 24 }

function driverSupabaseErrorText(error) {
  if (!error) return ''
  return [error.message, error.details, error.hint, error.code].filter(Boolean).join(' · ')
}

function driverVehicleLabel(driverProfile = {}) {
  const driverType = String(driverProfile.driver_type || '').toLowerCase()
  const autoTitle = [driverProfile.vehicle_make || driverProfile.car_brand, driverProfile.vehicle_model || driverProfile.car_model]
    .filter(Boolean)
    .join(' ')
    .trim()
  const motoTitle = [driverProfile.moto_brand, driverProfile.moto_model].filter(Boolean).join(' ').trim()

  if (driverType === 'moto') return motoTitle || 'Moto lista'
  if (driverType === 'auto_and_moto') return [autoTitle || 'Auto', motoTitle || 'Moto'].join(' + ')
  return autoTitle || 'Vehículo listo'
}

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

function isValidParaguayCoord(point) {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    lat >= -28 &&
    lat <= -19 &&
    lng >= -63 &&
    lng <= -53
  )
}

function compactInstruction(value) {
  return String(value || '')
    .replace(/Pasa por.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function finiteOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function mergeDriverLiveTelemetry(current, updatedDriver, location) {
  const heading = finiteOrNull(location?.heading)
  const speed = finiteOrNull(location?.speed)
  const accuracy = finiteOrNull(location?.accuracy)

  return {
    ...(current || {}),
    ...(updatedDriver || {}),
    lat: Number(location.lat),
    lng: Number(location.lng),
    heading: heading ?? current?.heading ?? null,
    speed: speed ?? current?.speed ?? null,
    accuracy: accuracy ?? current?.accuracy ?? null,
  }
}

function tripDriverTelemetryPayload(location) {
  return {
    driver_lat: location.lat,
    driver_lng: location.lng,
    driver_heading: finiteOrNull(location.heading),
    driver_speed: finiteOrNull(location.speed),
    driver_accuracy: finiteOrNull(location.accuracy),
    updated_at: new Date().toISOString(),
  }
}

function driverProfileTelemetryPayload(location) {
  return {
    heading: finiteOrNull(location.heading),
    speed: finiteOrNull(location.speed),
    accuracy: finiteOrNull(location.accuracy),
  }
}

function distanceKm(a, b) {
  if (!isValidParaguayCoord(a) || !isValidParaguayCoord(b)) return null
  const R = 6371
  const dLat = ((Number(b.lat) - Number(a.lat)) * Math.PI) / 180
  const dLng = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((Number(a.lat) * Math.PI) / 180) *
      Math.cos((Number(b.lat) * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

function estimateSpeedMps(previousPoint, nextPoint) {
  if (!previousPoint || !nextPoint) return null

  const prevTime = Number(previousPoint._timestamp || previousPoint.timestamp || previousPoint.updated_at || 0)
  const nextTime = Number(nextPoint._timestamp || nextPoint.timestamp || Date.now())
  const seconds = Math.max(0.25, (nextTime - prevTime) / 1000)
  const km = distanceKm(previousPoint, nextPoint)
  const meters = km == null ? null : km * 1000

  if (!Number.isFinite(meters) || !Number.isFinite(seconds) || seconds <= 0) return null

  return meters / seconds
}

function shouldAcceptDriverGpsPoint(location, previousLocation) {
  if (!isValidParaguayCoord(location)) {
    return { accepted: false, reason: 'invalid_coord', movedMeters: 0, estimatedSpeed: null, moving: false }
  }

  const locationWithTs = { ...location, _timestamp: location._timestamp || Date.now() }
  const movedMeters = previousLocation ? (distanceKm(previousLocation, locationWithTs) || 0) * 1000 : 999
  const accuracy = Number(location.accuracy)
  const speed = Number(location.speed)
  const estimatedSpeed = estimateSpeedMps(previousLocation, locationWithTs)
  const effectiveSpeed = Number.isFinite(speed) ? speed : estimatedSpeed
  const moving = Number.isFinite(effectiveSpeed) && effectiveSpeed >= DRIVER_STATIONARY_SPEED_MPS

  if (Number.isFinite(accuracy) && accuracy > MAX_DRIVER_GPS_ACCURACY) {
    return { accepted: false, reason: 'accuracy_gt_100', movedMeters, estimatedSpeed, moving }
  }

  if (previousLocation && Number.isFinite(estimatedSpeed) && estimatedSpeed > IMPOSSIBLE_DRIVER_SPEED_MPS) {
    return { accepted: false, reason: 'impossible_speed', movedMeters, estimatedSpeed, moving }
  }

  if (previousLocation && Number.isFinite(accuracy) && accuracy > POOR_DRIVER_GPS_ACCURACY && movedMeters < 8) {
    return { accepted: false, reason: 'poor_accuracy_micro_move', movedMeters, estimatedSpeed, moving }
  }

  if (previousLocation && !moving && movedMeters < 5) {
    return { accepted: false, reason: 'stationary_micro_move', movedMeters, estimatedSpeed, moving }
  }

  return { accepted: true, reason: 'accepted', movedMeters, estimatedSpeed, moving }
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
function tripPaymentLabel(trip) {
  const method = String(trip?.payment_method || trip?.paymentMethod || 'cash').toLowerCase()

  if (method === 'card') return 'Tarjeta'
  if (method === 'transfer' || method === 'transferencia') return 'Transferencia'
  return 'Efectivo'
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

function isWomanDriverProfile(profile, driverProfile) {
  return (
    profile?.gender_identity === 'woman' ||
    driverProfile?.gender_identity === 'woman' ||
    driverProfile?.gender === 'woman' ||
    driverProfile?.women_mode === true ||
    driverProfile?.women_driver_requested === true ||
    driverProfile?.women_driver_verified === true ||
    driverProfile?.women_driver_status === 'requested' ||
    driverProfile?.women_driver_status === 'verified' ||
    driverProfile?.women_driver_status === 'rejected'
  )
}

function getEllaDriverStatus(driverProfile) {
  if (driverProfile?.women_driver_verified === true || driverProfile?.women_driver_status === 'verified') return 'verified'
  if (driverProfile?.women_driver_status === 'rejected') return 'rejected'
  if (driverProfile?.women_driver_requested === true || driverProfile?.women_driver_status === 'requested') return 'requested'
  return 'not_requested'
}

function ellaDriverStatusCopy(status, baseApproved) {
  if (!baseApproved) {
    return {
      label: 'Preferencia confianza',
      title: 'Perfil base en revision',
      body: 'Cuando admin apruebe tu perfil, vas a poder activar esta preferencia de privacidad.',
      action: '',
    }
  }

  if (status === 'verified') {
    return {
      label: 'Confianza habilitada',
      title: 'Lista para viajes con preferencia',
      body: 'Tu cuenta puede recibir viajes donde el pasajero pide una conductora verificada.',
      action: '',
    }
  }

  if (status === 'requested') {
    return {
      label: 'Confianza en revision',
      title: 'Estamos verificando tu acceso',
      body: 'Admin esta revisando tu solicitud. Te avisamos apenas quede habilitada.',
      action: '',
    }
  }

  if (status === 'rejected') {
    return {
      label: 'Confianza requiere atencion',
      title: 'Necesitamos revisar datos',
      body: 'Tu solicitud de preferencia no fue aprobada. Revisa tus documentos o pedi soporte.',
      action: 'Solicitar nuevamente',
    }
  }

  return {
    label: 'Modo Confianza',
    title: 'Activa viajes con preferencia',
    body: 'Recibi viajes donde el pasajero busca mas privacidad y prefiere una conductora.',
    action: 'Solicitar habilitacion',
  }
}

export default function Driver() {
  const [trips, setTrips] = useState([])
  const [message, setMessage] = useState('')
  const [routeGuidance, setRouteGuidance] = useState(null)
  const [clientRushNotice, setClientRushNotice] = useState(false)
  const [showSideMenu, setShowSideMenu] = useState(false)
  const [tripAction, setTripAction] = useState('')
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  const [driverNotifications, setDriverNotifications] = useState([])
  const [passengerRatingTrip, setPassengerRatingTrip] = useState(null)
  const [passengerRatingStars, setPassengerRatingStars] = useState(5)
  const [passengerRatingComment, setPassengerRatingComment] = useState('')
  const [passengerRatingSubmitting, setPassengerRatingSubmitting] = useState(false)
  const [showTripsHistory, setShowTripsHistory] = useState(false)
  const [tripHistory, setTripHistory] = useState([])
  const [tripHistoryLoading, setTripHistoryLoading] = useState(false)
  const [liveDriverLocation, setLiveDriverLocation] = useState(null)

  const auth = useAuth()
  const performance = usePerformanceProfile()
  const driverProfile = auth.driverProfile
   const pendingTripsAudioRef = useRef(null)
  const messageAudioRef = useRef(null)
  const lastChatUnreadCountRef = useRef(0)
  const lastMessageSoundAtRef = useRef(0)
  const hasLoadedTripsRef = useRef(false)
  const isMountedRef = useRef(true)
  const liveWatchIdRef = useRef(null)
  const liveSyncBusyRef = useRef(false)
  const liveLastSyncAtRef = useRef(0)
  const liveLastStoredPointRef = useRef(null)
  const gpsBufferRef = useRef(new GpsBuffer(20))
  const lastRoadsSnapAtRef = useRef(0)
  const roadsSyncBusyRef = useRef(false)

  const verificationStatus = auth.driverProfile?.verification_status || 'incomplete'
  const approved = auth.driverProfile?.verified === true && verificationStatus === 'approved'
  const verificationTitle = useMemo(() => verificationCopy(verificationStatus, approved)[0], [verificationStatus, approved])
  const isWomanDriver = useMemo(() => isWomanDriverProfile(auth.profile, auth.driverProfile), [auth.profile, auth.driverProfile])
  const ellaDriverStatus = useMemo(() => getEllaDriverStatus(auth.driverProfile), [auth.driverProfile])
  const ellaDriverCopy = useMemo(
    () => ellaDriverStatusCopy(ellaDriverStatus, approved),
    [ellaDriverStatus, approved]
  )
  const showEllaDriverPanel = isWomanDriver || ellaDriverStatus !== 'not_requested'
  const isOnline = auth.driverProfile?.is_online === true
  const isAvailable = auth.driverProfile?.is_available === true
  const hasDriverLocation = isValidParaguayCoord(liveDriverLocation) || isValidParaguayCoord(auth.driverProfile)
  const isReceivingTrips = useMemo(() => isOnline && isAvailable && hasDriverLocation, [isOnline, isAvailable, hasDriverLocation])

  const pushDriverNotification = useCallback((title, body, tone = 'info') => {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      body,
      tone,
      time: new Date().toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' }),
    }

    setDriverNotifications((current) => [item, ...current].slice(0, 8))
  }, [])

  useEffect(() => {
    if (!message) return undefined

    const sticky = /no pude|gps inv|revisi|pertenece|permitido|sesion|sesión/i.test(message)
    if (sticky) return undefined

    const timeout = window.setTimeout(() => setMessage(''), 4200)
    return () => window.clearTimeout(timeout)
  }, [message])

  const driverUserId = useMemo(() => auth.user?.id || auth.driverProfile?.user_id || auth.profile?.id, [auth.user?.id, auth.driverProfile?.user_id, auth.profile?.id])

  const activeTrip = useMemo(() => trips.find((trip) => trip.status !== 'pending') || null, [trips])
  const activeTripId = activeTrip?.id
  useEffect(() => {
    if (!activeTripId || !auth.user?.id) {
      setClientRushNotice(false)
      return undefined
    }

    let cancelled = false
    const rushText = 'El cliente está apurado'

    const readRushNotice = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, body, created_at')
        .eq('trip_id', activeTripId)
        .ilike('body', `${rushText}%`)
        .order('created_at', { ascending: false })
        .limit(1)

      if (!cancelled && !error) {
        setClientRushNotice(Boolean(data?.length))
      }
    }

    readRushNotice()

    const channel = supabase
      .channel(`driver-rush-${activeTripId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `trip_id=eq.${activeTripId}` },
        ({ new: message }) => {
          if (String(message?.body || '').startsWith(rushText)) {
            setClientRushNotice(true)
          }
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId, driverUserId])
  const pendingTrips = useMemo(
    () =>
      trips
        .filter((trip) => trip.status === 'pending')
        .sort((a, b) => {
          const driverPoint = { lat: auth.driverProfile?.lat, lng: auth.driverProfile?.lng }
          const distanceA = distanceKm(driverPoint, { lat: a.pickup_lat, lng: a.pickup_lng }) ?? 999
          const distanceB = distanceKm(driverPoint, { lat: b.pickup_lat, lng: b.pickup_lng }) ?? 999
          return distanceA - distanceB
        }),
    [auth.driverProfile?.lat, auth.driverProfile?.lng, trips]
  )

   function playDriverTripNotificationSound() {
    try {
      if (!pendingTripsAudioRef.current) {
        pendingTripsAudioRef.current = new Audio(driverRequestTone)
        pendingTripsAudioRef.current.preload = 'auto'
        pendingTripsAudioRef.current.volume = 0.95
      }

      pendingTripsAudioRef.current.currentTime = 0
      pendingTripsAudioRef.current.play().catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('Driver trip audio blocked or failed:', error)
        }
      })
    } catch (error) {
      console.warn('Driver trip audio failed:', error)
    }
  }

   function playMessageNotificationSound() {
    const now = Date.now()

    // Evita doble sonido cuando TripChatModal y Realtime avisan casi al mismo tiempo.
    if (now - lastMessageSoundAtRef.current < 900) return

    try {
      lastMessageSoundAtRef.current = now

      if (!messageAudioRef.current) {
        messageAudioRef.current = new Audio(messageTone)
        messageAudioRef.current.preload = 'auto'
        messageAudioRef.current.volume = 0.9
      }

      messageAudioRef.current.pause()
      messageAudioRef.current.currentTime = 0

      messageAudioRef.current.play().catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('MiChofer message tone blocked or failed:', error)
        }
      })
    } catch (error) {
      console.warn('MiChofer message tone failed:', error)
    }
  }

   useEffect(() => {
    // No reproducimos sonido desde chatUnreadCount.
    // Ese contador puede cambiar cuando se abre el modal y causar un beep raro.
    // El sonido real queda controlado solo por el listener Realtime de messages.
    lastChatUnreadCountRef.current = Number(chatUnreadCount) || 0
  }, [chatUnreadCount])

  useEffect(() => {
    if (!activeTripId || !auth.user?.id) return undefined

    const channel = supabase
      .channel(`driver-message-tone-${activeTripId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `trip_id=eq.${activeTripId}`,
        },
        ({ new: newMessage }) => {
          const senderId = String(newMessage?.sender_id || '')
          const currentDriverId = String(auth.user?.id || '')

          // No sonar por mensajes que escribió el mismo chofer.
          if (!senderId || senderId === currentDriverId) return

          // Si el chat está abierto, no notificar con sonido.
          if (chatOpen) return

          playMessageNotificationSound()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTripId, driverUserId, chatOpen])

  const focusTrip = activeTrip || pendingTrips[0] || null
  const driverPoint = useMemo(() => {
  if (isValidParaguayCoord(liveDriverLocation)) {
    const liveHeading = Number(liveDriverLocation.heading)
    const liveSpeed = Number(liveDriverLocation.speed)
    const liveAccuracy = Number(liveDriverLocation.accuracy)

    return {
      lat: Number(liveDriverLocation.lat),
      lng: Number(liveDriverLocation.lng),
      heading: Number.isFinite(liveHeading) ? liveHeading : null,
      speed: Number.isFinite(liveSpeed) ? liveSpeed : null,
      accuracy: Number.isFinite(liveAccuracy) ? liveAccuracy : null,
    }
  }

  const lat = Number(auth.driverProfile?.lat)
  const lng = Number(auth.driverProfile?.lng)
  const heading = Number(auth.driverProfile?.heading)
  const speed = Number(auth.driverProfile?.speed)
  const accuracy = Number(auth.driverProfile?.accuracy)

  if (!isValidParaguayCoord({ lat, lng })) {
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
  liveDriverLocation?.lat,
  liveDriverLocation?.lng,
  liveDriverLocation?.heading,
  liveDriverLocation?.speed,
  liveDriverLocation?.accuracy,
  auth.driverProfile?.lat,
  auth.driverProfile?.lng,
  auth.driverProfile?.heading,
  auth.driverProfile?.speed,
  auth.driverProfile?.accuracy,
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
  const guidanceStepDistance = formatMeters(routeGuidance?.distanceToNextStep) || guidanceDistance
  const guidanceEta = formatSeconds(routeGuidance?.duration) || navigationEta
  const guidanceAlertLevel = routeGuidance?.alertLevel || 'far'
  const guidanceProgress = Math.max(0, Math.min(1, Number(routeGuidance?.progress) || 0))
  const guidanceTrafficText = routeGuidance?.trafficCopy || ''
  const guidanceIsFallbackRoute = Boolean(routeGuidance?.fallbackRoute)
  const driverCameraDistance = Number(routeGuidance?.distanceToNextStep ?? routeGuidance?.remainingMeters ?? routeGuidance?.distance)
  const driverNavigationView = routeGuidance?.cameraPhase === 'panoramic'
    ? 'horizon'
    : routeGuidance?.cameraPhase === 'close'
      ? 'maneuver'
      : guidanceAlertLevel === 'arrived' || (Number.isFinite(driverCameraDistance) && driverCameraDistance <= 55)
    ? 'arrival'
    : Number.isFinite(driverCameraDistance) && driverCameraDistance <= 120
      ? 'maneuver'
      : Number.isFinite(driverCameraDistance) && driverCameraDistance >= 500
        ? 'horizon'
        : 'cruise'

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
  const routeInstructionText = (() => {
    if (routeGuidance?.shortInstruction) return routeGuidance.shortInstruction
    const instruction = String(routeGuidance?.instruction || activeTrip?.destination_text || 'Seguimos por la ruta')
      .replace(/^En\s+\d+\s*m\s+/i, '')
      .replace(/^Ahora\s+/i, '')
      .trim()
    const meters = Number(routeGuidance?.distance)

    if (!Number.isFinite(meters)) return instruction
    if (meters > 250) return `Prepará: ${instruction}`
    if (meters >= 80) return `En ${Math.round(meters)} m: ${instruction}`
    return `Ahora: ${instruction}`
  })()
  const routeInstructionDetail = routeGuidance?.nextInstruction || routeGuidance?.instruction || ''
  const GuidanceTurnIcon = (() => {
    const maneuver = String(routeGuidance?.maneuver || '').toLowerCase()
    if (guidanceAlertLevel === 'arrived') return CheckCircle2
    if (guidanceAlertLevel === 'recalculating') return RotateCcw
    if (maneuver.includes('left')) return ArrowLeft
    if (maneuver.includes('right')) return ArrowRight
    if (maneuver.includes('roundabout') || maneuver.includes('merge')) return Navigation
    return ArrowUp
  })()
  const radarTargetLabel = activeTrip?.status === 'in_progress' ? 'Destino' : 'Cliente'
  const destinationRadarText = activeTrip && navigationTarget
    ? `${radarTargetLabel} ${destinationSide}`
    : ''
  const guidanceSecondaryText = closeArrival?.subtitle ||
    (routeInstructionDetail
      ? `Luego ${routeInstructionDetail} · ${guidanceEta}`
      : `${destinationRadarText} · ${guidanceEta}`)
  const guidanceSecondaryTextPremium = closeArrival?.subtitle ||
    (guidanceIsFallbackRoute
      ? `Ruta provisoria · ${guidanceEta}`
      : guidanceTrafficText
        ? `${guidanceTrafficText} · ${guidanceEta}`
        : routeInstructionDetail
          ? `Luego ${routeInstructionDetail} · ${guidanceEta}`
          : `${destinationRadarText} · ${guidanceEta}`)
  const navTitle = compactInstruction(closeArrival?.title || routeInstructionText) || 'Seguimos por la ruta'
  const navSubtitle = compactInstruction(guidanceSecondaryTextPremium) || guidanceEta
  const cameraHeightLabel = Number.isFinite(Number(routeGuidance?.cameraHeightMeters))
    ? `${Math.round(Number(routeGuidance.cameraHeightMeters))} m`
    : driverNavigationView === 'horizon'
      ? '100 m'
      : driverNavigationView === 'maneuver'
        ? '38 m'
        : '18 m'
  const driverViewLabel = driverNavigationView === 'horizon'
    ? 'Vista horizonte'
    : driverNavigationView === 'maneuver'
      ? 'Maniobra precisa'
      : driverNavigationView === 'arrival'
        ? 'Llegada'
        : 'Crucero suave'
  const gpsAccuracy = Number(driverPoint?.accuracy)
  const navigationHealthStatus = String(routeGuidance?.navigationHealth?.status || '')
  const navigationHealthSignal = String(routeGuidance?.navigationHealth?.signalStatus || '')
  const gpsSignalClass = navigationHealthStatus === 'wrong_way' || navigationHealthStatus === 'off_route'
    ? 'gps-weak'
    : navigationHealthSignal === 'good'
      ? 'gps-precise'
      : navigationHealthSignal === 'adjusting'
        ? 'gps-stable'
        : navigationHealthSignal === 'weak'
          ? 'gps-weak'
          : !Number.isFinite(gpsAccuracy)
    ? 'gps-waiting'
    : gpsAccuracy <= 25
      ? 'gps-precise'
      : gpsAccuracy <= 60
        ? 'gps-stable'
        : 'gps-weak'
  const gpsSignalText = routeGuidance?.navigationHealth?.label || (!Number.isFinite(gpsAccuracy)
    ? 'GPS ajustando'
    : gpsAccuracy <= 25
      ? 'GPS preciso'
      : gpsAccuracy <= 60
        ? 'GPS estable'
        : 'GPS debil')
  const hasClientRushNotice = Boolean(
    clientRushNotice ||
    activeTrip?.client_rush_at ||
    Number(activeTrip?.client_rush_count) > 0
  )

  const driverAvatar = auth.driverProfile?.avatar_url || auth.profile?.avatar_url || ''
   const focusDistance = useMemo(
    () =>
      focusTrip && driverPoint
        ? distanceKm(driverPoint, { lat: focusTrip.pickup_lat, lng: focusTrip.pickup_lng })
        : null,
    [driverPoint?.lat, driverPoint?.lng, focusTrip]
  )

  const driverDisplayName = auth.profile?.full_name || auth.driverProfile?.full_name || 'MiChofer'
  const currentModeLabel = useMemo(() => {
    if (activeTrip) return 'En viaje'
    if (isReceivingTrips) return 'Disponible'
    if (isOnline) return 'Conectado'
    return 'Desconectado'
  }, [activeTrip, isReceivingTrips, isOnline])

  // Pick the map destination and origin based on active state
  const mapOrigin = driverPoint
  const mapDestination = activeTrip
    ? (activeTrip.status === 'in_progress' ? destinationPoint : pickupPoint)
    : null

     useEffect(() => {
    if (!activeTrip?.id || !navigator.geolocation || !driverUserId) return undefined

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
          _timestamp: pos.timestamp || Date.now(),
        },
        activeTrip
      )
    }

    const handleError = (error) => {
      if (!cancelled) {
        if (import.meta.env.DEV) {
          console.warn('[MiChofer GPS watch] error:', error)
        }
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
  }, [activeTrip?.id, activeTrip?.status, driverUserId])

 const loadTrips = useCallback(async (driverId) => {
  /*
    FIX REAL:
    El viaje sí se crea. El problema es que el driver no lo pinta.
    En desarrollo, React StrictMode puede dejar isMountedRef en false
    si no lo reactivamos bien. Por eso acá NO bloqueamos setTrips
    por un false viejo del ref.
  */

  isMountedRef.current = true

  let authUser = null

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser()

    if (authError) {
      console.warn('[MiChofer Driver Trips] auth.getUser error:', authError)
    }

    authUser = authData?.user || null
  } catch (authError) {
    console.warn('[MiChofer Driver Trips] auth.getUser throw:', authError)
  }

  const effectiveDriverId =
    driverId ||
    authUser?.id ||
    auth.user?.id ||
    auth.driverProfile?.user_id ||
    null

  if (!effectiveDriverId) {
    if (import.meta.env.DEV) {
      console.warn('[MiChofer Driver Trips] sin driverId efectivo', {
        driverId,
        authUserId: authUser?.id || null,
        authEmail: authUser?.email || null, // eslint-disable-line
        stateUserId: auth.user?.id || null,
        stateUserEmail: auth.user?.email || null,
        driverProfileUserId: auth.driverProfile?.user_id || null,
        driverProfileEmail: auth.driverProfile?.email || null,
      })
    }
    return
  }

  let nextTrips = []
  let directError = null
  let rpcV2Error = null
  let legacyRpcError = null

  const directResult = await supabase
    .from('trips')
    .select('*')
    .eq('driver_id', effectiveDriverId)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })

  if (directResult.error) {
    directError = directResult.error
  } else if (Array.isArray(directResult.data)) {
    nextTrips = directResult.data
  }

  if (nextTrips.length === 0) {
    try {
      const { data, error } = await getOwnDriverTrips()

      if (error) {
        legacyRpcError = error
      } else if (Array.isArray(data) && data.length > 0) {
        nextTrips = data
      }
    } catch (error) {
      legacyRpcError = error
    }
  }

  nextTrips = (nextTrips || [])
    .filter((trip) => trip?.id)
    .filter((trip) => !isAdminSimulatorTrip(trip))
    .filter((trip) => String(trip.driver_id || '') === String(effectiveDriverId))
    .filter((trip) => ACTIVE_STATUSES.includes(String(trip.status || '').toLowerCase()))
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

  const nextPendingCount = nextTrips.filter((trip) => trip.status === 'pending').length

  if (import.meta.env.DEV) {
    console.info('[MiChofer Driver Trips FINAL]', {
      effectiveDriverId,
      authUserId: authUser?.id || null,
      authEmail: authUser?.email || null,
      stateUserId: auth.user?.id || null,
      stateUserEmail: auth.user?.email || null,
      driverProfileUserId: auth.driverProfile?.user_id || null,
      driverProfileEmail: auth.driverProfile?.email || null,
      directCount: Array.isArray(directResult.data) ? directResult.data.length : 0,
      directError: directError?.message || null,
      rpcV2Error: rpcV2Error?.message || null,
      legacyRpcError: legacyRpcError?.message || null,
      finalCount: nextTrips.length,
      pendingCount: nextPendingCount,
      isMountedRef: isMountedRef.current,
      statuses: nextTrips.map((trip) => ({
        id: trip.id,
        status: trip.status,
        driver_id: trip.driver_id,
        client_id: trip.client_id,
        ride_category: trip.ride_category,
        created_at: trip.created_at,
      })),
    })
  }

  if (directError && rpcV2Error && legacyRpcError && nextTrips.length === 0) {
    setMessage(
      `No pude cargar solicitudes: ${
        driverSupabaseErrorText(directError) ||
        driverSupabaseErrorText(rpcV2Error) ||
        driverSupabaseErrorText(legacyRpcError) ||
        'revisá permisos de trips.'
      }`
    )
    return
  }

  setTrips((currentTrips) => {
    const previousPendingCount = currentTrips.filter((trip) => trip.status === 'pending').length

    if (hasLoadedTripsRef.current && nextPendingCount > previousPendingCount) {
      playDriverTripNotificationSound()
      pushDriverNotification(
        'Nuevo viaje',
        'Tenés una solicitud pendiente esperando confirmación.',
        'success'
      )
    }

    hasLoadedTripsRef.current = true
    return nextTrips
  })
  }, [
    auth.driverProfile?.email,
    auth.driverProfile?.user_id,
    pushDriverNotification,
    auth.user?.email,
    auth.user?.id,
  ])

  useEffect(() => {
    if (auth.loading) return

    if (!auth.user) {
      window.location.href = '/login'
      return
    }
    if (auth.profile?.role === 'passenger') {
      window.location.href = '/client'
      return
    }

    // Espera a que el perfil del chofer esté listo para cargar viajes y suscripciones.
    if (!auth.driverProfile) {
      return
    }

    // Carga inicial, solo una vez.
    if (!hasLoadedTripsRef.current) {
      loadTrips(auth.user.id)
    }

    const refreshTrips = () => {
      loadTrips(auth.user.id)
    }

    const channel = supabase
      .channel(`driver-trips-${auth.user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips', filter: `driver_id=eq.${auth.user.id}` },
        refreshTrips
      )
      .subscribe((status) => {
        if (import.meta.env.DEV) {
          console.info('[MiChofer Driver Realtime]', { status, driverId: auth.user.id })
        }

        if (status === 'SUBSCRIBED') {
          refreshTrips()
        }
      })

    // Polling como fallback, con un intervalo más razonable.
    const interval = window.setInterval(() => {
      loadTrips(auth.user.id)
    }, 5000)

    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [auth.loading, auth.user, auth.profile, auth.driverProfile, loadTrips])

  const refreshDriverState = useCallback(async () => {
    await auth.reloadProfiles()
    const currentDriverId = auth.user?.id || auth.driverProfile?.user_id || auth.profile?.id
    if (currentDriverId) loadTrips(currentDriverId)
  }, [
    auth.driverProfile?.user_id,
    auth.profile?.id,
    auth.reloadProfiles,
    auth.user?.id,
    loadTrips,
  ])

async function loadDriverTripHistory() {
  const driverUserId = auth.user?.id || auth.driverProfile?.user_id || auth.profile?.id
  if (!driverUserId) return

  setTripHistoryLoading(true)

  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('driver_id', driverUserId)
    .in('status', ['completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(30)

  setTripHistoryLoading(false)

  if (error) {
    setMessage('No pude cargar el historial de viajes.')
    return
  }

  setTripHistory((data || []).filter((trip) => !isAdminSimulatorTrip(trip)))
}

const getStoredLocation = useCallback(() => {
  const lat = Number(auth.driverProfile?.lat)
  const lng = Number(auth.driverProfile?.lng)
  const stored = {
    lat,
    lng,
    speed: Number.isFinite(Number(auth.driverProfile?.speed)) ? Number(auth.driverProfile.speed) : null,
    heading: Number.isFinite(Number(auth.driverProfile?.heading)) ? Number(auth.driverProfile.heading) : null,
    accuracy: Number.isFinite(Number(auth.driverProfile?.accuracy)) ? Number(auth.driverProfile.accuracy) : null,
    _timestamp: auth.driverProfile?.updated_at ? new Date(auth.driverProfile.updated_at).getTime() : Date.now(),
  }

  if (!isValidParaguayCoord(stored)) return null

  return stored
}, [auth.driverProfile])

useEffect(() => {
  const storedLocation = getStoredLocation()
  if (storedLocation) {
    setLiveDriverLocation((currentLocation) => {
      if (!currentLocation) return storedLocation
      const currentTs = Number(currentLocation._timestamp) || 0
      const storedTs = Number(storedLocation._timestamp) || 0
      return storedTs >= currentTs ? storedLocation : currentLocation
    })
  }
}, [getStoredLocation])

const getCurrentLocation = useCallback(async () => {
  const storedLocation = getStoredLocation()
  const fallback = storedLocation || DEFAULT_DRIVER_LOCATION

  if (!navigator.geolocation) return fallback

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLocation = {
          lat: Number(pos.coords.latitude),
          lng: Number(pos.coords.longitude),
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          _timestamp: pos.timestamp || Date.now(),
        }

        if (!isValidParaguayCoord(nextLocation)) {
          setMessage('GPS inválido. Activá ubicación precisa para recibir solicitudes.')
          resolve(fallback)
          return
        }

        setLiveDriverLocation(nextLocation)
        resolve(nextLocation)
      },
      () => resolve(fallback),
      {
        enableHighAccuracy: true,
        timeout: 6000,
        maximumAge: 2500,
      }
    )
  })
}, [getStoredLocation])
  // Núcleo compartido de sincronización de ubicación del chofer.
  // Antes esta lógica estaba duplicada casi entera entre pushLiveTripLocation
  // (disparada por watchPosition) y syncStoredTripLocation (polling de
  // respaldo), y se habían desincronizado: la ruta de watchPosition no
  // aplicaba los mismos filtros de ruido (GPS impreciso en quieto, saltos
  // chicos estando parado) que sí aplicaba la de polling. Eso podía hacer que
  // el auto "tiemble" en el mapa del cliente/chofer cuando el GPS es ruidoso
  // en interiores, solo en la ruta de watchPosition. Unificado acá para que
  // ambas rutas se comporten igual.
  const commitDriverLocationUpdate = useCallback(async (location, trip, previousLocation) => {
    if (!driverUserId) return previousLocation

    const locationWithTs = { ...location, _timestamp: location._timestamp || Date.now() }
    const accuracy = Number(location.accuracy)
    const speed = Number(location.speed)
    const gpsDecision = shouldAcceptDriverGpsPoint(locationWithTs, previousLocation)
    const movedMeters = gpsDecision.movedMeters
    const estimatedSpeed = gpsDecision.estimatedSpeed
    const effectiveSpeed = Number.isFinite(speed) ? speed : estimatedSpeed
    const looksStationary = !Number.isFinite(effectiveSpeed) || effectiveSpeed < DRIVER_STATIONARY_SPEED_MPS
    const meaningfulMovement = movedMeters >= 3 || !looksStationary

    const logGps = (goodPoint, reason) => {
      if (!import.meta.env.DEV) return
      console.info('[MiChofer GPS]', {
        rawPoint: locationWithTs,
        goodPoint,
        reason,
        rawSpeed: Number.isFinite(speed) ? speed : null,
        estimatedSpeed,
        accuracy: Number.isFinite(accuracy) ? accuracy : null,
        movedMeters,
        moving: !looksStationary,
      })
    }

    if (!gpsDecision.accepted) {
      logGps(false, gpsDecision.reason)
      return previousLocation
    }

    // Si el GPS viene muy impreciso y no hay movimiento real, no movemos el auto.
    // En interiores esto evita que el mapa cambie dirección estando quieto.
    if (Number.isFinite(accuracy) && accuracy > 45 && previousLocation && !meaningfulMovement) {
      return previousLocation
    }

    // Si el chofer parece quieto, ignoramos saltos pequeños/medianos del GPS.
    if (previousLocation && looksStationary && movedMeters < 5) {
      return previousLocation
    }

    logGps(true, null)
    const acceptedLocation = {
      ...locationWithTs,
      lat: Number(locationWithTs.lat),
      lng: Number(locationWithTs.lng),
      accuracy: Number.isFinite(accuracy) ? accuracy : null,
      speed: Number.isFinite(effectiveSpeed) ? effectiveSpeed : null,
      heading: Number.isFinite(Number(locationWithTs.heading))
        ? Number(locationWithTs.heading)
        : Number.isFinite(Number(previousLocation?.heading))
          ? Number(previousLocation.heading)
          : null,
    }

    liveLastStoredPointRef.current = acceptedLocation
    setLiveDriverLocation(acceptedLocation)

    if (GOOGLE_ROADS_API_ENABLED && Number.isFinite(acceptedLocation.lat) && Number.isFinite(acceptedLocation.lng)) {
      gpsBufferRef.current.push({ lat: acceptedLocation.lat, lng: acceptedLocation.lng })
    }

    const { data: updatedDriver } = await updateOwnDriverStatus({
      isOnline: true,
      isAvailable,
      lat: acceptedLocation.lat,
      lng: acceptedLocation.lng,
    })

    // AuthContext will reload the driver profile automatically.
    // For immediate visual feedback, we can optimistically update the local state if needed,
    // but the context is the source of truth.

    await supabase
      .from('trips')
      .update(tripDriverTelemetryPayload(acceptedLocation))
      .eq('id', trip.id)
      .eq('driver_id', driverUserId)

    await supabase
      .from('driver_profiles')
      .update(driverProfileTelemetryPayload(acceptedLocation))
      .eq('user_id', driverUserId)

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
                .eq('driver_id', driverUserId)
              if (import.meta.env.DEV) {
                console.info('[MiChofer Roads] saved snapped point:', snappedPoint)
              }
            } catch {
              // Keep working if Roads columns do not exist or update fails
            }
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            console.warn('[MiChofer Roads] snapToRoads failed:', error)
          }
        } finally {
          roadsSyncBusyRef.current = false
        }
      }
    }

    return acceptedLocation
  }, [isAvailable, driverUserId, setMessage])

  const pushLiveTripLocation = useCallback(async (location, trip = activeTrip) => {
    if (!trip?.id || !location || !LOCATION_STATUSES.includes(trip.status) || !driverUserId) return null

    if (!isValidParaguayCoord(location)) {
      return getStoredLocation()
    }

    const previousLocation = liveLastStoredPointRef.current || getStoredLocation()
    const now = Date.now()

    if (now - liveLastSyncAtRef.current < 1200) {
      return previousLocation || location
    }

    if (liveSyncBusyRef.current) {
      return previousLocation || location
    }

    liveLastSyncAtRef.current = now
    liveSyncBusyRef.current = true

    try {
      return await commitDriverLocationUpdate(location, trip, previousLocation)
    } finally {
      liveSyncBusyRef.current = false
    }
  }, [activeTrip, commitDriverLocationUpdate, driverUserId, getStoredLocation])

  const syncStoredTripLocation = useCallback(async (trip = activeTrip) => {
    // Si ya hubo una sincronización reciente vía watchPosition, no hace falta
    // pedir otra vez getCurrentPosition y volver a pegarle a Supabase: esto
    // evita que las dos rutas (watch + polling de respaldo) se pisen y manden
    // updates duplicados casi al mismo tiempo.
    if (Date.now() - liveLastSyncAtRef.current < 5000) {
      return liveLastStoredPointRef.current || getStoredLocation()
    }

    const location = await getCurrentLocation()
    if (!trip?.id || !location || !LOCATION_STATUSES.includes(trip.status) || !driverUserId) return null

    if (!isValidParaguayCoord(location)) {
      return getStoredLocation()
    }

    const previousLocation = liveLastStoredPointRef.current || getStoredLocation()
    liveLastSyncAtRef.current = Date.now()

    return commitDriverLocationUpdate(location, trip, previousLocation)
  }, [activeTrip, commitDriverLocationUpdate, getCurrentLocation, getStoredLocation, driverUserId])

  const syncDriverLocation = useCallback(async (trip = activeTrip, nextOnline = isOnline, nextAvailable = isAvailable) => {
  let currentUser = auth.user
  if (!currentUser?.id) {
    const { data: authData } = await supabase.auth.getUser()
    currentUser = authData?.user || null
    // No need to setUser, AuthContext handles it.
  }

  const driverUserId = currentUser?.id || auth.driverProfile?.user_id || auth.profile?.id
  if (!driverUserId) {
    setMessage('Todavía estoy cargando tu sesión de chofer. Esperá un momento y probá otra vez.')
    return null
  }

  const location = nextOnline ? await getCurrentLocation() : getStoredLocation()

  if (!isValidParaguayCoord(location)) {
    setMessage('GPS inválido. Activá ubicación precisa para recibir solicitudes.')
    return null
  }

  setLiveDriverLocation({
    ...location,
    _timestamp: location._timestamp || Date.now(),
  })

  const { data: updatedDriver, error } = await updateOwnDriverStatus({
    isOnline: nextOnline,
    isAvailable: nextAvailable,
    lat: location.lat,
    lng: location.lng,
  })

  if (error) {
    console.error('DRIVER STATUS UPDATE ERROR:', error)
    setMessage('No pude guardar tu ubicación. Revisá el GPS o la sesión de chofer.')
    return null
  }

  // AuthContext will reload the driver profile.

  await supabase
    .from('driver_profiles')
    .update(driverProfileTelemetryPayload(location))
    .eq('user_id', driverUserId)

  if (trip?.id && LOCATION_STATUSES.includes(trip.status) && driverUserId) {
    await supabase
      .from('trips')
      .update(tripDriverTelemetryPayload(location))
      .eq('id', trip.id)
      .eq('driver_id', driverUserId)
  }

  return location
}, [activeTrip, driverUserId, getCurrentLocation, isAvailable, isOnline, setMessage, auth.user, auth.driverProfile, auth.profile])

  const updateAvailability = useCallback(async (nextOnline, nextAvailable) => {
  const driverUserId = auth.user?.id || auth.driverProfile?.user_id || auth.profile?.id
  if (!driverUserId) return

  if (!approved) {
    setMessage('Tu cuenta esta en revision. Te avisaremos cuando puedas recibir viajes.')
    return
  }

  const location = await getCurrentLocation()

  if (nextOnline && !isValidParaguayCoord(location)) {
    setMessage('GPS inválido. Activá ubicación precisa para recibir solicitudes.')
    return
  }

  if (isValidParaguayCoord(location)) {
    setLiveDriverLocation({
      ...location,
      _timestamp: location._timestamp || Date.now(),
    })
  }

  const { data: updatedDriver, error } = await updateOwnDriverStatus({
    isOnline: nextOnline,
    isAvailable: nextOnline ? nextAvailable : false,
    lat: location.lat,
    lng: location.lng,
  })

  if (error) {
    setMessage('No pude actualizar disponibilidad.')
    return
  }

  // AuthContext will reload the driver profile.

  if (!nextOnline) {
    setMessage('Desconectado.')
  } else if (nextAvailable) {
    setMessage('Disponible para recibir solicitudes.')
  } else {
    setMessage('Conectado, pero pausado.')
  }
}, [approved, auth.driverProfile?.user_id, getCurrentLocation, auth.profile?.id, setMessage, auth.user?.id])

  const requestCategory = useCallback(async (categoryCode) => {
    if (!auth.driverProfile?.user_id) {
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
    // AuthContext will reload the driver profile.
    // For optimistic UI, you could update a local state or the context directly,
    // but for simplicity, we'll let the context handle the reload.

    const title = categoryCode === 'ella' ? 'Solicitud con preferencia enviada' : 'Solicitud enviada'
    const body = data?.status === 'approved'
      ? 'Esta categoria ya estaba habilitada.'
      : 'Admin revisara tu habilitacion y te avisaremos.'

    setMessage(data?.status === 'approved' ? 'Categoria ya aprobada.' : 'Solicitud enviada.')
    pushDriverNotification(title, body, data?.status === 'approved' ? 'success' : 'info')
  }, [approved, auth.driverProfile, pushDriverNotification, setMessage])
const submitDriverPassengerRating = useCallback(async () => {
  const driverUserId = auth.user?.id || auth.driverProfile?.user_id || auth.profile?.id

  if (!passengerRatingTrip?.id || !passengerRatingTrip?.client_id || !driverUserId) {
    setMessage('No pude identificar el pasajero para calificar.')
    return
  }

  try {
    setPassengerRatingSubmitting(true)

    const { error } = await supabase
      .from('ratings')
      .upsert(
        {
          trip_id: passengerRatingTrip.id,
          rater_id: driverUserId,
          ratee_id: passengerRatingTrip.client_id,
          type: 'driver_to_client',
          stars: passengerRatingStars,
          comment: passengerRatingComment.trim() || null,
          admin_status: 'new',
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'trip_id,rater_id,ratee_id,type',
        }
      )

    if (error) {
      console.error('DRIVER PASSENGER RATING ERROR:', error)
      setMessage('No pude enviar la calificación del pasajero. Revisá la tabla ratings.')
      return
    }

    setPassengerRatingTrip(null)
    setPassengerRatingStars(5)
    setPassengerRatingComment('')
    setMessage('Calificación enviada. Gracias por cuidar la comunidad MiChofer.')
    await loadTrips()
  } finally {
    setPassengerRatingSubmitting(false)
  }
}, [
  auth.driverProfile?.user_id,
  loadTrips,
  passengerRatingComment,
  passengerRatingStars,
  passengerRatingTrip,
  auth.profile?.id,
  setMessage,
  auth.user?.id,
])
const updateTrip = useCallback(async (trip, status) => {
  const driverUserId = auth.user?.id || auth.driverProfile?.user_id || auth.profile?.id

  if (!trip?.id || !driverUserId) {
    setMessage('No pude identificar este viaje.')
    return
  }

  if (trip.driver_id !== driverUserId) {
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

    const nextTrip = {
      ...trip,
      status,
      ...tripDriverTelemetryPayload(location),
    }

    setTrips((current) =>
      current.map((item) =>
        item.id === trip.id ? nextTrip : item
      )
    )

    const { error } = await supabase
      .from('trips')
      .update({
        status,
        ...tripDriverTelemetryPayload(location),
      })
      .eq('id', trip.id)
      .eq('driver_id', driverUserId)

    if (error) {
      setMessage(`No pude actualizar el viaje: ${driverSupabaseErrorText(error) || 'error desconocido, revisa la consola.'}`)
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

    // AuthContext will reload the driver profile.

    await supabase
      .from('driver_profiles')
      .update(driverProfileTelemetryPayload(location))
      .eq('user_id', driverUserId)

    if (status === 'accepted') {
      setMessage('Ruta lista. Vamos al punto de recogida.')
      pushDriverNotification('Viaje aceptado', trip.destination_text || 'Ruta al punto de recogida lista.', 'success')
      await loadTrips()
      return
    }

    if (status === 'cancelled') {
      setMessage('Viaje cancelado. El cliente será avisado.')
      pushDriverNotification('Viaje cancelado', trip.destination_text || 'Solicitud cancelada.', 'danger')
      await loadTrips()
      return
    }

    if (status === 'completed') {
      setPassengerRatingTrip(nextTrip)
      setPassengerRatingStars(5)
      setPassengerRatingComment('')
      setMessage('Viaje finalizado. Calificá al pasajero para mejorar la seguridad de MiChofer.')
      pushDriverNotification('Viaje finalizado', trip.destination_text || 'Guardado en tu historial de actividad.', 'success')
      return
    }

    setMessage('')
    await loadTrips()
  } finally {
    setTripAction('')
  }
}, [
  auth.driverProfile?.user_id,
  getCurrentLocation,
  loadTrips,
  auth.profile?.id,
  pushDriverNotification,
  setMessage,
  setTrips,
  auth.user?.id,
])
  // ==================== RENDER ====================

  // --- Active navigation (accepted, arriving, in_progress) ---
    if (activeTrip && navigationTarget && driverPoint) {
    return (
      <main className="app-shell">
        <section
          className={`phone driver-phone driver-cockpit driver-nav-layout driver-view-${driverNavigationView} ${showEllaDriverPanel || isEllaTrip(activeTrip) ? 'driver-ella-profile' : ''}`}
          style={{
            '--driver-nav-top-safe': '136px',
            '--driver-nav-bottom-safe': '178px',
          }}
        >
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
            fitPadding={DRIVER_NAV_FIT_PADDING}
            uiSafeArea={DRIVER_NAV_UI_SAFE_AREA}
            mapInteractive
            animateCamera
            showRouteSummary={false}
            navigationMode
            navigationVariant="driver"
            navigationCamera="preview"
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

          {hasClientRushNotice && (
            <article className="driver-rush-notice priority-live-alert" role="status" aria-live="polite">
              <span className="driver-rush-icon" aria-hidden="true">
                <BellRing size={20} />
              </span>

              <div className="driver-rush-copy">
                <span className="driver-rush-badge">PRIORIDAD</span>
                <strong>Cliente con prisa</strong>
                <small>Avanza apenas sea seguro. Seguridad primero.</small>
              </div>
            </article>
          )}

          {/* Navigation instruction card */}
          <header className={`driver-navigation-instruction driver-nav-hud alert-${guidanceAlertLevel}`}>
            <div className="driver-navigation-turn-icon">
              <GuidanceTurnIcon size={30} />
            </div>

            <div className="driver-navigation-copy driver-navigation-main">
              <span>{guidanceStepDistance}</span>
              <strong className="driver-navigation-title">
                {navTitle}
              </strong>
              <small className="driver-navigation-subtitle">
                {navSubtitle}
              </small>
              <div className="driver-navigation-progress route-progress" aria-hidden="true">
                <i style={{ width: `${Math.round(guidanceProgress * 100)}%` }} />
              </div>
              {(guidanceTrafficText || guidanceIsFallbackRoute) && (
                <em className={`driver-navigation-badge driver-traffic-pill traffic-${routeGuidance?.trafficStatus || (guidanceIsFallbackRoute ? 'fallback' : 'normal')}`}>
                  {guidanceIsFallbackRoute ? 'Ruta provisoria' : guidanceTrafficText}
                </em>
              )}
              <div className="driver-cockpit-meta-row" aria-label="Estado de navegacion">
                <span className={`driver-cockpit-chip camera-${driverNavigationView}`}>
                  {driverViewLabel} - {cameraHeightLabel}
                </span>
                <span className={`driver-cockpit-chip ${gpsSignalClass}`}>
                  {gpsSignalText}
                </span>
              </div>
            </div>

            <button type="button" className="driver-navigation-refresh" onClick={() => syncDriverLocation(activeTrip)} aria-label="Actualizar ubicación">
              <RefreshCw size={18} />
            </button>
          </header>

                    {/* Compact navigation action bar */}
          <section className="driver-navigation-bottom driver-trip-panel">
            <div className="driver-navigation-trip">
              {isEllaTrip(activeTrip) && (
                <div className="michofer-ella-trip-badge">
                  <ShieldCheck size={14} />
                  <span>Viaje Confianza</span>
                  <small>Preferencia verificada</small>
                </div>
              )}
              <span>{statusLabel(activeTrip.status)}</span>
              <strong>{activeTrip.destination_text || 'Destino'}</strong>
              <div className="driver-trip-mini-rail" aria-hidden="true">
                <span>{driverViewLabel}</span>
                <i><b style={{ width: `${Math.round(guidanceProgress * 100)}%` }} /></i>
                <span>{gpsSignalText}</span>
              </div>
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

                            <button
                              type="button"
                              className="driver-navigation-chat"
                              onClick={() => setChatOpen(true)}
                              aria-label="Abrir chat"
                            >
                              <MessageCircle size={20} />
                              {chatUnreadCount > 0 && (
                                <span className="chat-unread-badge driver-chat-badge">{chatUnreadCount}</span>
                              )}
                            </button>

                <button
                type="button"
                className="driver-navigation-cancel"
                onClick={() => setShowCancelConfirm(true)}
                aria-label="Cancelar viaje"
              >
                <XCircle size={20} />
              </button>
            </div>
          </section>

          {/*
            IMPORTANTE: el modal de "cancelar viaje" ahora vive AFUERA de
            driver-navigation-bottom (esa barra es chica y position:absolute,
            así que un modal adentro solo podía cubrir ese cuadrito, no toda
            la pantalla). Al ponerlo acá, como hijo directo de .phone
            (que tiene position:relative), el backdrop con inset:0 cubre
            correctamente toda la pantalla.
          */}
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
{passengerRatingTrip && (
  <div className="mc-rating-backdrop" role="presentation">
    <section className="mc-rating-sheet" role="dialog" aria-modal="true" aria-label="Calificar pasajero">
      <div className="mc-rating-handle" />

      <header className="mc-rating-head">
        <span>Viaje finalizado</span>
        <h2>¿Cómo fue el pasajero?</h2>
        <p>
          Esta puntuación queda visible para administración y ayuda a cuidar a los choferes.
        </p>
      </header>

      <div className="mc-rating-profile">
        <div className="mc-rating-avatar">
          <UserRound size={30} />
        </div>

        <div>
          <span>Pasajero</span>
          <strong>Cliente MiChofer</strong>
          <small>{passengerRatingTrip.destination_text || 'Viaje MiChofer'}</small>
        </div>
      </div>

      <div className="mc-rating-stars" aria-label="Puntuación">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={passengerRatingStars >= star ? 'active' : ''}
            onClick={() => setPassengerRatingStars(star)}
            aria-label={`${star} estrellas`}
          >
            <Star size={27} fill="currentColor" />
          </button>
        ))}
      </div>

      <textarea
        className="mc-rating-textarea"
        value={passengerRatingComment}
        onChange={(event) => setPassengerRatingComment(event.target.value)}
        placeholder="Mensaje opcional para admin: trato, espera, ubicación, comportamiento..."
        maxLength={400}
      />

      <div className="mc-rating-actions">
        <button
          type="button"
          className="mc-rating-secondary"
          onClick={async () => {
            setPassengerRatingTrip(null)
            setPassengerRatingStars(5)
            setPassengerRatingComment('')
            await loadTrips()
          }}
          disabled={passengerRatingSubmitting}
        >
          Omitir
        </button>

        <button
          type="button"
          className="mc-rating-primary"
          onClick={submitDriverPassengerRating}
          disabled={passengerRatingSubmitting}
        >
          {passengerRatingSubmitting ? 'Enviando...' : 'Enviar calificación'}
        </button>
      </div>
    </section>
  </div>
)}
          <TripChatModal
            tripId={activeTrip.id}
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            onUnreadCountChange={setChatUnreadCount}
            trip={activeTrip}
          />
        </section>
      </main>
    )
  }

  // --- Idle / Dashboard state ---
 return (
  <main className="app-shell">
    <section className={`phone driver-phone driver-idle ${showEllaDriverPanel ? 'driver-ella-profile' : ''}`}>
      {passengerRatingTrip && (
        <div className="mc-rating-backdrop" role="presentation">
          <section className="mc-rating-sheet" role="dialog" aria-modal="true" aria-label="Calificar pasajero">
            <div className="mc-rating-handle" />

            <header className="mc-rating-head">
              <span>Viaje finalizado</span>
              <h2>¿Cómo fue el pasajero?</h2>
              <p>
                Esta puntuación queda visible para administración y ayuda a cuidar a los choferes.
              </p>
            </header>

            <div className="mc-rating-profile">
              <div className="mc-rating-avatar">
                <UserRound size={30} />
              </div>

              <div>
                <span>Pasajero</span>
                <strong>Cliente MiChofer</strong>
                <small>{passengerRatingTrip.destination_text || 'Viaje MiChofer'}</small>
              </div>
            </div>

            <div className="mc-rating-stars" aria-label="Puntuación">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={passengerRatingStars >= star ? 'active' : ''}
                  onClick={() => setPassengerRatingStars(star)}
                  aria-label={`${star} estrellas`}
                >
                  <Star size={27} fill="currentColor" />
                </button>
              ))}
            </div>

            <textarea
              className="mc-rating-textarea"
              value={passengerRatingComment}
              onChange={(event) => setPassengerRatingComment(event.target.value)}
              placeholder="Mensaje opcional para admin: trato, espera, ubicación, comportamiento..."
              maxLength={400}
            />

            <div className="mc-rating-actions">
              <button
                type="button"
                className="mc-rating-secondary"
                onClick={async () => {
                  setPassengerRatingTrip(null)
                  setPassengerRatingStars(5)
                  setPassengerRatingComment('')
                  await loadTrips()
                }}
                disabled={passengerRatingSubmitting}
              >
                Omitir
              </button>

              <button
                type="button"
                className="mc-rating-primary"
                onClick={submitDriverPassengerRating}
                disabled={passengerRatingSubmitting}
              >
                {passengerRatingSubmitting ? 'Enviando...' : 'Enviar calificación'}
              </button>
            </div>
          </section>
        </div>
      )}

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
                    Mejorar precisión
                  </button>
                </div>
              </div>
            </section>
                   )}
        </div>

     {/* Driver status bar */}
<header className="mc-driver-hud">
  <button
    type="button"
    className="mc-driver-hud-avatar"
    onClick={() => setShowSideMenu(true)}
    aria-label="Abrir perfil del chofer"
  >
    {driverAvatar ? <img src={driverAvatar} alt={driverDisplayName} /> : <UserRound size={22} />}
  </button>

  <div className="mc-driver-hud-main">
    <div className="mc-driver-hud-status">
      <span className={`mc-driver-status-dot ${isReceivingTrips ? 'online' : isOnline ? 'standby' : 'offline'}`} />
      <strong>{currentModeLabel}</strong>
    </div>

    <small>
      {hasDriverLocation
        ? isReceivingTrips
          ? 'GPS preciso · recibiendo viajes'
          : 'GPS preciso · en espera'
        : 'GPS pendiente'}
    </small>
  </div>

  <button
    type="button"
    className="mc-driver-hud-refresh"
    onClick={refreshDriverState}
    aria-label="Actualizar estado"
  >
    <RefreshCw size={18} />
  </button>
</header>

        {/* Message */}
        {message && <div className="driver-idle-notice">{message}</div>}


        {showEllaDriverPanel && pendingTrips.length === 0 && (
          <article className={`driver-ella-status-card ${ellaDriverStatus} ${message ? 'with-message' : ''}`} role="status" aria-live="polite">
            <div className="driver-ella-status-orb">
              <ShieldCheck size={21} />
            </div>

            <div className="driver-ella-status-copy">
              <span>{ellaDriverCopy.label}</span>
              <strong>{ellaDriverCopy.title}</strong>
              <small>{ellaDriverCopy.body}</small>
            </div>

            {ellaDriverCopy.action && (
              <button type="button" onClick={() => requestCategory('ella')} disabled={!approved}>
                {ellaDriverCopy.action}
              </button>
            )}
          </article>
        )}

       {/* Pending trip request */}
{pendingTrips.length > 0 && (
  <div className="mc-driver-request-stack">
    {pendingTrips.slice(0, 1).map((trip) => {
      const pickupDistance =
        trip.pickup_lat && trip.pickup_lng && driverProfile?.lat && driverProfile?.lng
          ? formatKm(
              distanceKm(
                { lat: driverProfile.lat, lng: driverProfile.lng },
                { lat: trip.pickup_lat, lng: trip.pickup_lng }
              )
            )
          : 'Cerca'

      return (
        <article key={trip.id} className="mc-driver-request-card">
          <div className="mc-driver-request-top">
            <span>{isEllaTrip(trip) ? 'Solicitud Confianza' : 'Nueva solicitud'}</span>
            <strong>{formatGs(trip.price)}</strong>
          </div>

          {isEllaTrip(trip) && (
            <div className="mc-driver-ella-pill">
              <ShieldCheck size={14} />
              <strong>Viaje Confianza</strong>
              <span>Preferencia verificada</span>
            </div>
          )}

          <div className="mc-driver-request-copy">
            <h2>{trip.destination_text || 'Destino solicitado'}</h2>
            <p>
              <MapPin size={14} />
              <span>{pickupDistance} · Cliente te eligió</span>
            </p>
          </div>

          <div className="mc-driver-request-proof">
            <span>Ruta segura</span>
            <span>GPS preciso</span>
            <strong className={`mc-driver-payment-pill ${String(trip?.payment_method || 'cash').toLowerCase()}`}>
              {tripPaymentLabel(trip)}
            </strong>
          </div>

          <div className="mc-driver-request-actions">
            <button
              type="button"
              className="mc-driver-accept-btn"
              onClick={() => updateTrip(trip, 'accepted')}
            >
              <CheckCircle2 size={18} />
              <span>Aceptar viaje</span>
            </button>

            <button
              type="button"
              className="mc-driver-reject-btn"
              onClick={() => updateTrip(trip, 'cancelled')}
              aria-label="Rechazar viaje"
            >
              <XCircle size={18} />
            </button>

            <a
              href={`/chat?trip=${trip.id}`}
              className="mc-driver-chat-btn"
              aria-label="Chat"
            >
              <MessageCircle size={18} />
            </a>
          </div>
        </article>
      )
    })}
  </div>
)}

       {/* Only show controls when no incoming trip */}
{pendingTrips.length === 0 && (
  <section className="mc-driver-dock" aria-label="Controles del chofer">
    <div className="mc-driver-dock-primary">
      <button
        type="button"
        className={`mc-driver-dock-btn ${isOnline ? 'active' : ''}`}
        onClick={() => updateAvailability(!isOnline, !isOnline)}
        disabled={!approved}
      >
        {isOnline ? <ToggleRight size={21} /> : <ToggleLeft size={21} />}
        <span>{isOnline ? 'Disponible' : 'Conectarme'}</span>
      </button>

      <button
        type="button"
        className={`mc-driver-dock-btn receive ${isReceivingTrips ? 'active' : ''}`}
        onClick={() => updateAvailability(true, !isAvailable)}
        disabled={!approved || (!isOnline && !isAvailable)}
      >
        <CarFront size={19} />
        <span>{isReceivingTrips ? 'Recibiendo' : 'Recibir viajes'}</span>
      </button>
    </div>

    <div className="mc-driver-dock-secondary">
      <button
        type="button"
        className="mc-driver-calibrate-btn"
        onClick={() => syncDriverLocation(activeTrip, true, isAvailable)}
      >
        <RefreshCw size={15} />
        <span>Mejorar precisión</span>
      </button>

      <div className="mc-driver-request-count">
        <Clock size={15} />
        <span>{pendingTrips.length} solicitudes</span>
      </div>
    </div>
  </section>
)}

        {/* Verification warning */}
        {!approved && (
          <div className="driver-idle-verify-warning">
            <ShieldCheck size={14} /> {verificationTitle}
          </div>
        )}

       {/* Driver profile menu */}
{showSideMenu && (
  <div
    className="mc-driver-profile-backdrop"
    onClick={() => setShowSideMenu(false)}
    role="presentation"
  >
    <aside
      className="mc-driver-profile-panel"
      onClick={(event) => event.stopPropagation()}
      aria-label="Perfil del chofer"
    >
      <header className="mc-driver-profile-top">
        <div className="mc-driver-profile-brand">
          <span />
          <strong>MiChofer Driver</strong>
        </div>

        <button
          className="mc-driver-profile-close"
          type="button"
          onClick={() => setShowSideMenu(false)}
          aria-label="Cerrar perfil"
        >
          ✕
        </button>
      </header>

      <section className="mc-driver-profile-card">
        <div className={`mc-driver-profile-avatar ${isOnline ? 'online' : 'offline'}`}>
          {driverAvatar ? (
            <img src={driverAvatar} alt={driverDisplayName} />
          ) : (
            <UserRound size={30} />
          )}
        </div>

        <div className="mc-driver-profile-copy">
          <span>{approved ? 'Chofer verificado' : 'Perfil pendiente'}</span>
          <h2>{driverDisplayName}</h2>
          <p>{driverVehicleLabel(driverProfile)}</p>
        </div>
      </section>

      <section className="mc-driver-profile-status">
        <div>
          <span>Estado</span>
          <strong>{currentModeLabel}</strong>
        </div>

        <div>
          <span>GPS</span>
          <strong>{hasDriverLocation ? 'Activo' : 'Pendiente'}</strong>
        </div>
      </section>

      {!approved && (
        <section className="mc-driver-profile-warning">
          <ShieldCheck size={16} />
          <div>
            <strong>{verificationTitle}</strong>
            <small>Completá y enviá tus datos para recibir viajes.</small>
          </div>
        </section>
      )}

      <section className="mc-driver-profile-section">
        <div className="mc-driver-profile-section-head">
          <strong>Categorías</strong>
          <small>Admin revisa cada habilitación</small>
        </div>

        <div className="mc-driver-category-list">
          {(DRIVER_CATEGORY_ACTIONS || []).map((category) => {
            const status = getDriverCategoryStatus(driverProfile, category.code)
            const disabled = !approved || status === 'approved' || status === 'requested'

            return (
              <button
                key={category.code}
                type="button"
                className={`mc-driver-category-btn ${status}`}
                onClick={() => requestCategory(category.code)}
                disabled={disabled}
              >
                <span>{category.title}</span>
                <small>{categoryStatusLabel(status)}</small>
              </button>
            )
          })}
        </div>
      </section>

      <section className="mc-driver-profile-section">
        <div className="mc-driver-profile-section-head">
          <strong>Notificaciones</strong>
          <small>{driverNotifications.length} aviso{driverNotifications.length === 1 ? '' : 's'}</small>
        </div>

        <div className="mc-driver-notification-list">
          {driverNotifications.length === 0 ? (
            <div className="mc-driver-empty-note">
              No hay avisos nuevos.
            </div>
          ) : (
            driverNotifications.map((item) => (
              <article key={item.id} className={`mc-driver-notification ${item.tone}`}>
                <span>{item.time}</span>
                <strong>{item.title}</strong>
                <small>{item.body}</small>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="mc-driver-profile-section">
        <div className="mc-driver-profile-section-head">
          <strong>Actividad</strong>
          <small>Viajes finalizados y cancelados</small>
        </div>

        <button
          type="button"
          className="mc-driver-trips-btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '14px',
            padding: '12px 14px',
            cursor: 'pointer',
            color: 'inherit',
            textAlign: 'left',
          }}
          onClick={() => {
            loadDriverTripHistory()
            setShowTripsHistory(true)
          }}
        >
          <Clock size={17} />
          <div style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: '15px', fontWeight: 600 }}>Mis viajes</span>
            <small style={{ display: 'block', fontSize: '12px', opacity: 0.6, marginTop: 2 }}>Ver historial completo</small>
          </div>
        </button>
      </section>

      <section className="mc-driver-profile-section performance-card">
        <div className="mc-driver-profile-section-head">
          <strong>Rendimiento de la aplicación</strong>
          <small>{performance.profileLabel}</small>
        </div>
        <p>MiChofer adapta automáticamente el mapa y las animaciones para funcionar mejor en tu dispositivo.</p>
        {performance.slowNotice && (
          <div className="performance-slow-notice">
            ¿MiChofer está funcionando lento? Probá el test de rendimiento desde Configuración.
          </div>
        )}
        <div className="performance-card-status">
          <div>
            <span>Optimización automática</span>
            <strong>{performance.mode === 'auto' ? 'Activada' : 'Desactivada'}</strong>
          </div>
          <div>
            <span>Perfil actual</span>
            <strong>{performance.profileLabel}</strong>
          </div>
        </div>
        <div className="performance-mode-selector">
          {['auto', 'low', 'medium', 'high'].map((mode) => (
            <button
              key={mode}
              type="button"
              className={performance.mode === mode ? 'active' : ''}
              onClick={() => performance.setManualProfile(mode)}
            >
              <span>{MODE_LABELS[mode]}</span>
            </button>
          ))}
        </div>
        <div className="performance-card-actions">
          <button type="button" onClick={() => performance.runPerformanceTest({ force: true })} disabled={performance.isTesting}>
            <RefreshCw size={17} />
            <span>{performance.isTesting ? 'Analizando...' : 'Optimizar de nuevo'}</span>
          </button>
        </div>
      </section>

      <nav className="mc-driver-profile-links" aria-label="Links legales">
        <a href="/support">Soporte</a>
        <a href="/privacy">Política de privacidad</a>
        <a href="/terms">Términos</a>
        <a href="/delete-account">Eliminar cuenta</a>
      </nav>

      <button
        className="mc-driver-profile-logout"
        type="button"
        onClick={async () => {
          await supabase.auth.signOut()
          window.location.href = '/login'
        }}
      >
        <LogOut size={18} />
        <span>Cerrar sesión</span>
      </button>
    </aside>
  </div>
)}

{/* Trip History Panel */}
{showTripsHistory && (
  <div className="trips-history-backdrop" onClick={() => setShowTripsHistory(false)}>
    <section className="trips-history-panel" onClick={(event) => event.stopPropagation()}>
      <button
        className="panel-close trips-history-close"
        type="button"
        onClick={() => setShowTripsHistory(false)}
        aria-label="Cerrar historial"
      >
        <XCircle size={18} />
      </button>

      <div className="trips-history-head">
        <span>MiChofer Driver</span>
        <h2>Tus viajes</h2>
        <p>Acá guardamos tus últimos viajes completados y cancelados como chofer.</p>
      </div>

      <div className="trips-history-list">
        {tripHistoryLoading ? (
          <div className="trips-history-empty">Cargando tus viajes...</div>
        ) : tripHistory.length === 0 ? (
          <div className="trips-history-empty">
            Todavía no tenés viajes guardados. Cuando completes uno, va a aparecer acá.
          </div>
        ) : (
          tripHistory.map((trip) => {
            const statusCopy = {
              completed: 'Finalizado',
              cancelled: 'Cancelado',
            }[trip.status] || 'Viaje'

            const createdAt = trip.created_at
              ? new Date(trip.created_at).toLocaleDateString('es-PY', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''

            return (
              <article key={trip.id} className={`trips-history-item ${trip.status}`}>
                <div>
                  <span>{statusCopy}</span>
                  <strong>{trip.destination_text || 'Destino guardado'}</strong>
                  <small>
                    {[createdAt, tripPaymentLabel(trip)].filter(Boolean).join(' · ')}
                  </small>
                </div>
                <b>{formatGs(trip.price)}</b>
              </article>
            )
          })
        )}
      </div>
    </section>
  </div>
)}
      </section>
    </main>
  )
}
