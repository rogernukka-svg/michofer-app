//Client.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import messageTone from '../assets/toonomensaje.mp3'
import { useAuth } from './AuthContext'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Banknote,
  BellRing,
  CarFront,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  LifeBuoy,
  LogOut,
  MapPin,
  MessageCircle,
  Navigation,
  Play,
  RefreshCw,
  RotateCcw,
  Share2,
  ShieldCheck,
  Square,
  Star,
  ToggleLeft,
  ToggleRight,
  UserRound,
  X,
  XCircle,
} from 'lucide-react'
import InteractiveRouteMap from '../components/InteractiveRouteMap'
import TripChatModal from '../components/TripChatModal'
import {
  getAvailableDrivers,
  getAvailableDriversViaLocalProxy,
  requestTrip,
  requestWomenMode,
  supabase,
  upsertOwnProfile,
} from '../lib/supabase'
import {
  RIDE_CATEGORY_OPTIONS,
  canUseWomenMode,
  getDriverPreferredRideCategory,
  getRideCategoryDbCode,
  getRideCategoryMeta,
  getWomenModeStatus,
  isWomenDriver,
  matchesRideCategory,
} from '../lib/rideCategories'
import {
  getPlaceSearchText,
  getPlaceSubtitle,
  getPlaceTitle,
  loadLocalPlaces,
  searchLocalPlaces,
} from '../lib/placeSearch'
import { geocodeAddress, loadGoogleMaps, reverseGeocode } from '../lib/googleMaps'
import { calculateFare } from '../lib/fareCalculator'
import { MODE_LABELS } from '../lib/performanceProfile'
import { usePerformanceProfile } from '../hooks/usePerformanceProfile'

const DEFAULT_CENTER = { lat: -25.5167, lng: -54.6167 }
const ACTIVE_STATUSES = ['pending', 'accepted', 'arriving', 'in_progress']
const CAR_PRICE_PER_KM = 4500
const CAR_MIN_PRICE = 12000

const MODE_ICON_LABEL = {
  all: 'T',
  moto: 'M',
  comfort: 'C',
  premium: 'P',
  ella: '♀',
}

const VEHICLE_CATEGORY_OPTIONS = RIDE_CATEGORY_OPTIONS.filter(
  (category) => category.code !== 'ella' && category.code !== 'all'
)

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

function estimatePrice(km) {
  if (!km) return null
  return Math.max(CAR_MIN_PRICE, Math.round((km * CAR_PRICE_PER_KM) / 500) * 500)
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

function getErrorMessage(error) {
  return error?.message || error?.details || error?.hint || 'Error desconocido'
}

function getSupabaseRequestMessage(error) {
  const parts = [
    error?.message,
    error?.details,
    error?.hint,
    error?.code ? `Codigo ${error.code}` : '',
  ].filter(Boolean)

  return parts.join(' - ') || 'Error desconocido'
}

function isNetworkFetchError(error) {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('err_connection') ||
    message.includes('err_name_not_resolved') ||
    message.includes('err_internet_disconnected') ||
    error?.name === 'TypeError'
  )
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function shouldFallbackAvatarToProfile(error) {
  const message = String(error?.message || '').toLowerCase()
  return (
    message.includes('database schema is invalid or incompatible') ||
    message.includes('row-level security') ||
    message.includes('violates row-level security')
  )
}

async function findStoredAvatarUrl(userId) {
  if (!userId) return ''

  const { data, error } = await supabase.storage
    .from('avatars')
    .list(userId, {
      limit: 20,
      sortBy: { column: 'created_at', order: 'desc' },
    })

  if (error || !data?.length) return ''

  const latest = data
    .filter((item) => item.name && !item.name.endsWith('/'))
    .sort((a, b) => {
      const dateA = new Date(a.updated_at || a.created_at || 0).getTime()
      const dateB = new Date(b.updated_at || b.created_at || 0).getTime()
      return dateB - dateA
    })[0]

  if (!latest) return ''

  const { data: publicUrlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(`${userId}/${latest.name}`)

  return publicUrlData?.publicUrl || ''
}

function normalizeDriver(driver, location) {
  const lat = Number(driver?.lat)
  const lng = Number(driver?.lng)
  const hasLocation = isValidParaguayCoord({ lat, lng })
  const km = hasLocation && isValidParaguayCoord(location) ? distanceKm(location, { lat, lng }) : null
  const price = estimatePrice(km)
  const driverType = String(driver?.driver_type || '').toLowerCase()
  const car = [driver?.vehicle_make || driver?.car_brand, driver?.vehicle_model || driver?.car_model].filter(Boolean).join(' ').trim()
  const moto = [driver?.moto_brand, driver?.moto_model].filter(Boolean).join(' ').trim()
  const vehicleTitle = driverType === 'moto'
    ? moto || 'Moto'
    : driverType === 'auto_and_moto'
      ? [car || 'Auto', moto || 'Moto'].join(' + ')
      : car || 'Vehículo'
  const vehiclePlate = driverType === 'moto'
    ? driver?.moto_plate || driver?.plate
    : driverType === 'auto_and_moto'
      ? driver?.vehicle_plate || driver?.plate || driver?.moto_plate
      : driver?.vehicle_plate || driver?.plate
  const vehicleColor = driverType === 'moto' ? '' : driver?.vehicle_color || driver?.car_color
  const vehicle = [vehicleTitle, vehicleColor, maskPlate(vehiclePlate)].filter(Boolean).join(' · ')

  return {
    ...driver,
    id: driver?.id || driver?.user_id,
    user_id: driver?.user_id || driver?.id,
    lat: hasLocation ? lat : null,
    lng: hasLocation ? lng : null,
    name: driver?.full_name || driver?.email || 'Chofer disponible',
    avatar: driver?.avatar_url || '',
    vehicle,
    distanceKm: km,
    distance: km ? `${km.toFixed(1)} km` : '',
    eta: km ? `${Math.max(3, Math.round(km * 3))} min` : '',
    price,
    hasValidLocation: hasLocation,
  }
}

function rideStatusUi(status, driverName, etaText = '') {
  const name = firstName(driverName)
  const eta = etaText || 'breve'

  if (status === 'accepted') {
    return {
      title: `Recogida en ${eta}`,
      subtitle: `${name} aceptó tu viaje y va camino al punto de recogida.`,
      badge: 'Confirmado',
      progress: 58,
      chatEnabled: true,
    }
  }

  if (status === 'arriving') {
    return {
      title: 'Llegada en breve',
      subtitle: `${name} llegó o está muy cerca. Verificá la chapa antes de subir.`,
      badge: 'Llegando',
      progress: 78,
      chatEnabled: true,
    }
  }

  if (status === 'in_progress') {
    return {
      title: 'Viaje en curso',
      subtitle: 'Seguimos tu recorrido en tiempo real hasta el destino.',
      badge: 'En ruta',
      progress: 92,
      chatEnabled: true,
    }
  }

  return {
    title: 'Chofer encontrado',
    subtitle: 'Esperando que confirme tu solicitud. Todavía no está viniendo.',
    badge: 'Solicitud enviada',
    progress: 28,
    chatEnabled: false,
  }
}

function liveDistanceMeters(driver, target) {
  const km = distanceKm(driver, target)
  return km == null ? null : km * 1000
}

function clientLiveStatusUi(status, driverName, etaText, distanceMeters) {
  const name = firstName(driverName)

  if ((status === 'accepted' || status === 'arriving') && distanceMeters != null && distanceMeters <= 22) {
    return {
      title: 'Tu chofer está en el punto',
      subtitle: `${name} ya está muy cerca. Verificá el auto y la chapa.`,
      badge: 'En el punto',
      progress: 82,
      chatEnabled: true,
    }
  }

  if (status === 'in_progress' && distanceMeters != null && distanceMeters <= 25) {
    return {
      title: 'Estás llegando al destino',
      subtitle: 'El destino está a pocos metros. Revisá tus pertenencias.',
      badge: 'Llegando',
      progress: 96,
      chatEnabled: true,
    }
  }

  return rideStatusUi(status, driverName, etaText)
}

function clientTripHumanCopy(status, driverName, etaText, distanceMeters, rushSent = false) {
  const name = firstName(driverName || 'tu chofer')
  const eta = etaText || 'unos minutos'

  if (status === 'pending') {
    return {
      title: 'Estamos esperando confirmación',
      subtitle: 'Tu solicitud ya fue enviada. En breve el chofer responde.',
      mood: 'waiting',
      joke: 'Respirá tranqui. Estamos moviendo los hilos.',
    }
  }

  if (status === 'accepted') {
    return {
      title: `${name} ya aceptó tu viaje`,
      subtitle: `Va camino a buscarte. Llega en ${eta}.`,
      mood: 'accepted',
      joke: rushSent
        ? 'Ya le avisamos que estás apurado. Seguridad primero, siempre.'
        : 'Tu chofer ya viene. Vos prepará la ubicación.',
    }
  }

  if (status === 'arriving') {
    return {
      title: `${name} está llegando`,
      subtitle: 'Ya está muy cerca del punto de recogida. Verificá el auto y la chapa.',
      mood: 'arriving',
      joke: 'Está cerquita. Mirá alrededor y subí solo cuando confirmes el auto.',
    }
  }

  if (status === 'in_progress') {
    return {
      title: 'Viaje en curso',
      subtitle: 'Seguimos tu recorrido en tiempo real hasta el destino.',
      mood: 'in_progress',
      joke: 'Modo copiloto activado.',
    }
  }

  if (status === 'completed') {
    return {
      title: 'Viaje finalizado',
      subtitle: 'Lo guardamos en Mis viajes.',
      mood: 'completed',
      joke: 'Llegamos bien. Gracias por viajar con MiChofer.',
    }
  }

  if (status === 'cancelled') {
    return {
      title: 'Viaje cancelado',
      subtitle: 'Podés pedir otro chofer cuando quieras.',
      mood: 'cancelled',
      joke: 'Tranqui, buscamos otro camino.',
    }
  }

  return {
    title: 'Viaje actualizado',
    subtitle: 'Estamos siguiendo el estado de tu viaje.',
    mood: 'default',
    joke: '',
  }
}

function waitingMicrocopy(status, secondsWaiting, rushSent) {
  if (rushSent) {
    return 'Ya le avisamos al chofer. Seguridad primero, pero con ganas de llegar rápido.'
  }

  if (status === 'pending' && secondsWaiting > 20) {
    return 'Seguimos esperando confirmación. Te acompañamos mientras responde.'
  }

  if (status === 'accepted' && secondsWaiting > 90) {
    return 'Tu chofer sigue en camino. A veces el tráfico se cree protagonista.'
  }

  if (status === 'arriving') {
    return 'Está cerquita. Mirá alrededor y verificá el auto antes de subir.'
  }

  return ''
}
function normalizeCategoryList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim().toLowerCase())
      .filter(Boolean)
  }

  if (!value) return []

  return String(value)
    .replace(/[{}"]/g, '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

function resolveRideCategoryForRequest(driver, selectedVehicleMode) {
  const driverType = String(driver?.driver_type || driver?.vehicle_type || driver?.type || '').trim().toLowerCase()
  const vehicleCategory = String(driver?.vehicle_category || '').trim().toLowerCase()
  const approvedCategories = [
    ...normalizeCategoryList(driver?.approved_categories),
    ...normalizeCategoryList(driver?.available_categories),
    ...normalizeCategoryList(driver?.enabled_categories),
    ...normalizeCategoryList(driver?.ride_categories),
    ...normalizeCategoryList(driver?.categories),
  ]

  const helperCategory = String(
    getDriverPreferredRideCategory(driver, selectedVehicleMode) || ''
  ).toLowerCase()

  if (selectedVehicleMode === 'ella') {
    return 'auto_standard'
  }

  if (selectedVehicleMode && selectedVehicleMode !== 'all') {
    return getRideCategoryDbCode(selectedVehicleMode)
  }

  if (vehicleCategory && vehicleCategory !== 'auto' && vehicleCategory !== 'all') {
    return getRideCategoryDbCode(vehicleCategory)
  }

  if (approvedCategories.includes('premium')) {
    return 'premium'
  }

  if (approvedCategories.includes('comfort')) {
    return 'comfort'
  }

  if (approvedCategories.includes('campus')) {
    return 'campus'
  }

  if (driverType === 'moto' || approvedCategories.includes('moto')) {
    return 'moto'
  }

  if (helperCategory && helperCategory !== 'all') {
    return getRideCategoryDbCode(helperCategory)
  }

  return 'auto_standard'
}
export default function Client() {
  const auth = useAuth()
  const performance = usePerformanceProfile()
  const [destination, setDestination] = useState('')
  const [destinationPoint, setDestinationPoint] = useState(null)
  const [destinationStatus, setDestinationStatus] = useState('idle')
  const [destinationFocused, setDestinationFocused] = useState(false)
  const [localPlaces, setLocalPlaces] = useState([])
  const [googlePlacePredictions, setGooglePlacePredictions] = useState([])
  const [destinationPlace, setDestinationPlace] = useState(null)
  const [googlePlacesReady, setGooglePlacesReady] = useState(false)
  const [mode, setMode] = useState('all')
  const [womenOnly, setWomenOnly] = useState(false)
  const [sort, setSort] = useState('near')
  const [drivers, setDrivers] = useState([])
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [clientLocation, setClientLocation] = useState(null)
  const [locationReady, setLocationReady] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [showPaymentMethods, setShowPaymentMethods] = useState(false)
  const [loading, setLoading] = useState(true)
  const [requesting, setRequesting] = useState(false)
  const [message, setMessage] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showDriverChooser, setShowDriverChooser] = useState(false)
  const [categorySheet, setCategorySheet] = useState(null)
  const [routeGuidance, setRouteGuidance] = useState(null)
  const [womenRequesting, setWomenRequesting] = useState(false)
  const [activeTrip, setActiveTrip] = useState(null)
  const [activeTripDriver, setActiveTripDriver] = useState(null)
  const [liveSheetExpanded, setLiveSheetExpanded] = useState(false)
  const [mapDestinationMarker, setMapDestinationMarker] = useState(null)
  const [mapDestinationAddress, setMapDestinationAddress] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  const [rushSending, setRushSending] = useState(false)
  const [rushSentAt, setRushSentAt] = useState(null)
  const [lastTripStatus, setLastTripStatus] = useState(null)
  const [tripWaitingSeconds, setTripWaitingSeconds] = useState(0)
  const [showTripsHistory, setShowTripsHistory] = useState(false)
  const [tripHistory, setTripHistory] = useState([])
  const [tripHistoryLoading, setTripHistoryLoading] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [showAvatarPreview, setShowAvatarPreview] = useState(false)
  const [googlePlacesError, setGooglePlacesError] = useState(null)
  const [ratingTrip, setRatingTrip] = useState(null)
  const [driverRatingStars, setDriverRatingStars] = useState(5)
  const [driverRatingComment, setDriverRatingComment] = useState('')
  const [ratingSubmitting, setRatingSubmitting] = useState(false)
  const [driversLastLoadedAt, setDriversLastLoadedAt] = useState(0)
  const [driversLoadError, setDriversLoadError] = useState(null)

  const avatarInputRef = useRef(null)
  const messageAudioRef = useRef(null)
  const lastChatUnreadCountRef = useRef(0)
  const lastMessageSoundAtRef = useRef(0)
  const autocompleteServiceRef = useRef(null)
  const placesServiceRef = useRef(null)
  const googleMapsRef = useRef(null)
  const driversInFlightRef = useRef(false)
  const driversFailureCountRef = useRef(0)
  const driversRetryAtRef = useRef(0)
  const driversRef = useRef([])

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
  if (!activeTrip?.id || !auth.user?.id) return undefined

  const channel = supabase
    .channel(`client-message-tone-${activeTrip.id}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `trip_id=eq.${activeTrip.id}`,
      },
      ({ new: newMessage }) => {
        const senderId = String(newMessage?.sender_id || '')
        const currentUserId = String(auth.user?.id || '')

        if (!senderId || senderId === currentUserId) return
        if (chatOpen) return

        playMessageNotificationSound()
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [activeTrip?.id, auth.user?.id, chatOpen])

  const hasDestination = Boolean(destination.trim())
  const canOpenDrivers = Boolean(destinationPoint)
  // Lógica de cálculo de tarifas automáticas por categoría
  const fares = useMemo(() => {
    if (!destinationPoint || !clientLocation) return null

    const distanceMeters = routeGuidance?.distance ?? (distanceKm(clientLocation, destinationPoint) * 1000)
    const durationSeconds = routeGuidance?.duration ?? Math.max(180, (distanceMeters / 1000) * 180)

    const motoFare = calculateFare('moto', distanceMeters, durationSeconds)
    const autoStandardFare = calculateFare('auto_standard', distanceMeters, durationSeconds)
    const comfortFare = calculateFare('comfort', distanceMeters, durationSeconds)
    const premiumFare = calculateFare('premium', distanceMeters, durationSeconds)
    const campusFare = calculateFare('campus', distanceMeters, durationSeconds)

    return {
      moto: motoFare.totalPassengerPays,
      auto_standard: autoStandardFare.totalPassengerPays,
      ella: autoStandardFare.totalPassengerPays,
      comfort: comfortFare.totalPassengerPays,
      premium: premiumFare.totalPassengerPays,
      campus: campusFare.totalPassengerPays,
      details: {
        distanceKm: autoStandardFare.distanceKm,
        durationMin: autoStandardFare.durationMin,
      }
    }
  }, [destinationPoint, clientLocation, routeGuidance])

  const clientCanUseElla = canUseWomenMode(auth.profile)
  const ellaSafetyActive = womenOnly || mode === 'ella'
  const vehicleMode = mode === 'ella' ? 'all' : mode

  const currentFare = useMemo(() => {
    if (!fares) return null
    const catKey = vehicleMode === 'all' ? 'auto_standard' : vehicleMode
    return fares[catKey] ?? fares['auto_standard']
  }, [fares, vehicleMode])

  const routeKm = fares?.details?.distanceKm ?? null

  const getDriverFare = (driver) => {
    if (!fares) return null
    const driverCategory = getDriverPreferredRideCategory(driver, vehicleMode)
    return fares[driverCategory] ?? fares.auto_standard
  }

  const routePrice = selectedDriver ? getDriverFare(selectedDriver) : currentFare

  const accountEmail = auth.user?.email || auth.profile?.email || localStorage.getItem('michofer_last_email') || ''
  const selectedModeMeta = useMemo(() => getRideCategoryMeta(vehicleMode), [vehicleMode])
  const womenModeStatus = getWomenModeStatus(auth.profile)
  const destinationSuggestions = useMemo(
    () => searchLocalPlaces(destination, localPlaces, 6),
    [destination, localPlaces]
  )
  const destinationSuggestionItems = googlePlacePredictions.length > 0 ? googlePlacePredictions : destinationSuggestions
  const bestLocalSuggestion = destinationSuggestions[0] || null
  const showDestinationSuggestions =
    !activeTrip &&
    destinationFocused &&
    destination.trim().length > 0 &&
    destinationSuggestionItems.length > 0

  useEffect(() => {
    if (auth.loading) return

    if (auth.user) {
      if (auth.profile?.role === 'driver') {
        window.location.href = '/driver'
        return
      }
      restoreActiveTrip(auth.user.id)
    }

    // This part runs regardless of session, to get location
    navigator.geolocation.getCurrentPosition(
      (pos) => handleLocationSuccess(pos),
      () => handleLocationError()
    )
  }, [auth.loading, auth.user, auth.profile])

  useEffect(() => {
    let cancelled = false

    loadLocalPlaces()
      .then((places) => {
        if (!cancelled) setLocalPlaces(places)
      })
      .catch(() => {
        if (!cancelled) setLocalPlaces([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    loadGoogleMaps()
      .then((google) => {
        if (cancelled) return

        googleMapsRef.current = google
        setGooglePlacesReady(true)
        setGooglePlacesError(null)

        try {
          if (google?.maps?.places?.AutocompleteService) {
            autocompleteServiceRef.current = new google.maps.places.AutocompleteService()
          }
          if (google?.maps?.places?.PlacesService) {
            placesServiceRef.current = new google.maps.places.PlacesService(document.createElement('div'))
          }
        } catch (error) {
          console.warn('Google Places no disponible:', error)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setGooglePlacesReady(false)
          setGooglePlacesError(error)
          console.warn('Error cargando Google Places:', error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const query = destination.trim()

    if (query.length === 0) {
      setDestinationPoint(null)
      setDestinationStatus('idle')
      setGooglePlacePredictions([])
      return undefined
    }

    // Guard: si el usuario ya seleccionó un lugar de Google Places, no relanzar búsqueda
    if (destinationPlace?.source === 'google_places') {
      return undefined
    }

    let cancelled = false
    const controller = new AbortController()

    // Fallback: solo para cuando Google no devuelve resultados Y no hay sugerencias locales
    const searchFallback = async () => {
      if (cancelled) return

      if (!query) {
        setDestinationPoint(null)
        setDestinationStatus('not_found')
        return
      }

      try {
        // Enriquecer la búsqueda con contexto geográfico de Paraguay si no viene de Google
        const enrichedQuery = query.toLowerCase().includes('paraguay') ||
          query.toLowerCase().includes('ciudad del este') ||
          query.toLowerCase().includes('alto parana')
          ? query
          : `${query}, Paraguay`
        const location = await geocodeAddress(enrichedQuery, controller.signal)

        if (cancelled) return

        if (!location) {
          setDestinationPoint(null)
          setDestinationStatus('not_found')
          return
        }

        setDestinationPoint(location)
        setDestinationStatus('ready')
        setDestinationPlace({
          name: query,
          formatted_address: enrichedQuery,
          lat: location.lat,
          lng: location.lng,
          place_id: null,
          source: 'geocoder_fallback',
        })
      } catch (error) {
        if (error.name === 'AbortError') return
        setDestinationPoint(null)
        setDestinationStatus('not_found')
      }
    }

    // Usar delay más corto siempre (el guard arriba previene ejecuciones innecesarias)
    const timeout = window.setTimeout(() => {
      setDestinationStatus('searching')
      const google = googleMapsRef.current

      console.log('[MiChofer Places] input:', query)

      if (google && autocompleteServiceRef.current) {
        const request = {
          input: query,
          componentRestrictions: { country: 'PY' },
                    ...(clientLocation
            ? {
                location: new google.maps.LatLng(clientLocation.lat, clientLocation.lng),
                radius: 50000,
              }
            : {}),
          // Sin 'types' restrictivo — incluir establecimientos, mercados, POIs y geocodes
        }

        autocompleteServiceRef.current.getPlacePredictions(request, (predictions, status) => {
          if (cancelled) return

          if (status === google.maps.places.PlacesServiceStatus.OK && Array.isArray(predictions) && predictions.length > 0) {
            console.log('[MiChofer Places] Google predictions:', predictions.length, predictions[0]?.description)
            setGooglePlacePredictions(predictions.slice(0, 6))
            setDestinationStatus('idle')
            return
          }

          // Google no devolvió resultados — usar fallback local si existe, si no geocoder
          console.log('[MiChofer Places] Google Places vacío, status:', status)
          setGooglePlacePredictions([])

          if (bestLocalSuggestion) {
            setDestinationStatus('idle')
            return
          }

          searchFallback()
        })
      } else if (!bestLocalSuggestion) {
        searchFallback()
      } else {
        setGooglePlacePredictions([])
        setDestinationStatus('idle')
      }
    }, 400)

    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [bestLocalSuggestion, clientLocation, destination, destinationPlace?.source])

  useEffect(() => {
    let refreshTimeout = 0
    const channel = supabase
      .channel('client-drivers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_profiles' }, () => {
        window.clearTimeout(refreshTimeout)
        refreshTimeout = window.setTimeout(() => loadDrivers(clientLocation), 450)
      })
      .subscribe()

    const interval = window.setInterval(() => loadDrivers(clientLocation), 5000)

    return () => {
      window.clearTimeout(refreshTimeout)
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [clientLocation])
  useEffect(() => {
    if (!activeTrip?.id) return

    if (activeTrip.status === 'pending') {
      setLiveSheetExpanded(true)
      return
    }

    setLiveSheetExpanded(false)
  }, [activeTrip?.id, activeTrip?.status])

  useEffect(() => {
    setTripWaitingSeconds(0)

    if (!activeTrip?.id || !['pending', 'accepted', 'arriving'].includes(activeTrip.status)) {
      return undefined
    }

    const interval = window.setInterval(() => {
      setTripWaitingSeconds((seconds) => seconds + 1)
    }, 1000)

    return () => window.clearInterval(interval)
  }, [activeTrip?.id, activeTrip?.status])
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
      const { data, error } = await supabase.from('trips').select('*').eq('id', activeTrip.id).maybeSingle()

      if (data && data.id) {
        handleTripUpdate(data)
        return
      }

      if (error || !auth.user?.id) return

const { data: liveTrip, error: liveError } = await supabase
  .from('trips')
  .select('*, client:client_id(*), driver:driver_id(*)')
  .eq('client_id', auth.user.id)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (liveTrip?.id) {
        handleTripUpdate(liveTrip)
        return
      }

      if (!liveError) {
        clearLiveTrip('Viaje cancelado o finalizado.')
      }
    }, 1800)

    return () => {
      window.clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [activeTrip?.id, auth.user?.id])

  const isClientWomanProfile = Boolean(
    auth.profile?.gender_identity === 'woman' ||
    auth.profile?.women_mode_verified === true ||
    auth.profile?.women_mode_status === 'verified' ||
    auth.profile?.women_mode_requested === true
  )

  const visibleDrivers = useMemo(() => {
    const filtered = drivers.filter((driver) => {
      if (!matchesRideCategory(driver, vehicleMode)) return false

      const driverIsElla = isWomenDriver(driver)
      if (ellaSafetyActive) return clientCanUseElla && driverIsElla
      if (driverIsElla) return false
      return true
    })

    if (sort === 'rating') {
      filtered.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0))
    } else {
      filtered.sort((a, b) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999))
    }

    return filtered
  }, [clientCanUseElla, drivers, ellaSafetyActive, sort, vehicleMode])

  useEffect(() => {
    if (!selectedDriver) return

    const stillAvailable = visibleDrivers.find((driver) => driver.id === selectedDriver.id)

    if (stillAvailable) {
      setSelectedDriver(stillAvailable)
      return
    }

    setSelectedDriver(null)
    setMessage('Ese chofer ya no está disponible. Elegí otro.')
  }, [selectedDriver, visibleDrivers])

  async function handleLocationSuccess(pos) {
    setLoading(true)
    const nextLocation = {
      lat: Number(pos.coords.latitude),
      lng: Number(pos.coords.longitude),
    }
    if (!isValidParaguayCoord(nextLocation)) {
      setClientLocation(null)
      setLocationReady(false)
      setLoading(false)
      setMessage('Tu GPS devolvió una ubicación inválida. Activá ubicación precisa y probá de nuevo.')
      return
    }
    setClientLocation(nextLocation)
    setLocationReady(true)
    await loadDrivers(nextLocation)
    setLoading(false)
  }

  function handleLocationError() {
    setClientLocation(null)
    setLocationReady(false)
    setLoading(false)
    setMessage('Activá tu ubicación para ver choferes reales cerca de vos.')
  }

  async function handleAvatarUpload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !auth.user?.id) return

    if (!file.type.startsWith('image/')) {
      setMessage('Elegí una imagen válida para tu perfil.')
      return
    }

    try {
      setAvatarUploading(true)
      setMessage('')

      const fileExt = file.name.split('.').pop() || 'jpg'
      const filePath = `${auth.user.id}/avatar-${Date.now()}.${fileExt}`
      let avatarUrl = ''
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: true,
        })

      if (uploadError) {
        console.error('CLIENT AVATAR UPLOAD ERROR:', uploadError)
        if (!shouldFallbackAvatarToProfile(uploadError)) {
          setMessage(`No pude subir tu foto: ${uploadError.message || 'error de Storage'}.`)
          return
        }

        avatarUrl = await readFileAsDataUrl(file)
      }

      if (!avatarUrl) {
        const { data: publicUrlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath)

        avatarUrl = publicUrlData?.publicUrl || ''
      }

      if (!avatarUrl) {
        setMessage('La foto subió, pero no pude obtener la URL pública.')
        return
      }

      const { error: profileError } = await upsertOwnProfile({
        email: auth.user.email,
        fullName: auth.profile?.full_name || auth.user.user_metadata?.full_name || '',
        role: auth.profile?.role || auth.user.user_metadata?.role || 'passenger',
        avatarUrl,
      })
      // AuthContext will automatically reload the profile
      localStorage.setItem('michofer_last_photo', avatarUrl)
      setMessage('Foto de perfil actualizada.')
    } finally {
      setAvatarUploading(false)
    }
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

    if (Number.isFinite(Number(data.destination_lat)) && Number.isFinite(Number(data.destination_lng))) {
      setDestinationPoint({
        lat: Number(data.destination_lat),
        lng: Number(data.destination_lng),
      })
      setDestination(data.destination_text || '')
    }

    if (data.driver_id) {
      await loadActiveTripDriver(data.driver_id)
    }
  }

  async function loadActiveTripDriver(driverId, location = clientLocation) {
    if (!driverId) return null

    const { data: driverData } = await supabase
      .from('driver_profiles')
      .select('*')
      .eq('user_id', driverId)
      .maybeSingle()

    if (!driverData) return null

    const normalized = normalizeDriver(driverData, location)
    setActiveTripDriver(normalized)
    return normalized
  }

  async function loadDrivers(location = clientLocation, options = {}) {
    const force = Boolean(options.force)

    if (driversInFlightRef.current) return driversRef.current

    const now = Date.now()
    if (!force && now < driversRetryAtRef.current) return driversRef.current

    driversInFlightRef.current = true
    let data = null
    let error = null

    try {
      let result = await getAvailableDrivers()

      if (result.error && isNetworkFetchError(result.error)) {
        console.warn('AVAILABLE DRIVERS DIRECT RPC NETWORK ERROR, TRYING LOCAL PROXY:', result.error)
        result = await getAvailableDriversViaLocalProxy()
      }

      data = result.data
      error = result.error
    } catch (driversError) {
      if (isNetworkFetchError(driversError)) {
        console.warn('AVAILABLE DRIVERS DIRECT RPC THROW, TRYING LOCAL PROXY:', driversError)
        const proxyResult = await getAvailableDriversViaLocalProxy()
        data = proxyResult.data
        error = proxyResult.error
      } else {
        error = driversError
      }
    } finally {
      driversInFlightRef.current = false
    }

    if (error) {
      console.warn('AVAILABLE DRIVERS RPC ERROR:', error)
      setDriversLoadError(error)
      const nextFailures = driversFailureCountRef.current + 1
      driversFailureCountRef.current = nextFailures
      driversRetryAtRef.current = Date.now() + Math.min(45000, 2500 * nextFailures)

      if (!driversRef.current.length && nextFailures >= 3) {
        setMessage(`No pude cargar choferes disponibles: ${getErrorMessage(error)}. Reintentando solo.`)
      }
      return driversRef.current
    }

    driversFailureCountRef.current = 0
    driversRetryAtRef.current = 0
    setDriversLoadError(null)
    setDriversLastLoadedAt(Date.now())

    const normalized = (data || [])
      .map((driver) => normalizeDriver(driver, location))
      .filter((driver) => isValidParaguayCoord(driver))

    let normalizedWithRatings = normalized

    if (normalized.length > 0) {
      const driverIds = normalized
        .map((driver) => driver.user_id || driver.id)
        .filter(Boolean)

      const { data: ratingRows, error: ratingError } = await supabase
        .from('driver_rating_summary')
        .select('driver_id, rating, rating_count')
        .in('driver_id', driverIds)

      if (!ratingError && Array.isArray(ratingRows)) {
        const ratingMap = ratingRows.reduce((acc, item) => {
          acc[item.driver_id] = item
          return acc
        }, {})

        normalizedWithRatings = normalized.map((driver) => {
          const summary = ratingMap[driver.user_id || driver.id]

          return {
            ...driver,
            rating: summary?.rating ? Number(summary.rating) : Number(driver.rating || 5),
            ratingCount: summary?.rating_count ? Number(summary.rating_count) : Number(driver.rating_count || 0),
          }
        })
      }
    }

    console.log('[MiChofer Drivers] raw drivers:', data || [])
    console.log('[MiChofer Drivers] valid drivers:', normalizedWithRatings)
    console.log('[MiChofer Drivers] clientLocation:', location)

    driversRef.current = normalizedWithRatings
    setDrivers(normalizedWithRatings)

    if (!normalized.length) {
      setMessage('No hay choferes disponibles cerca. Verificá que el chofer esté aprobado, en línea, recibiendo y con GPS activo.')
    } else if (message.includes('choferes disponibles') || message.includes('No hay choferes')) {
      setMessage('')
    }

    return normalizedWithRatings
  }

  async function handleLogout() {
    await auth.logout()
    window.location.href = '/login'
  }

  function clearLiveTrip(messageText = '') {
    setActiveTrip(null)
    setActiveTripDriver(null)
    setSelectedDriver(null)
    setShowDriverChooser(false)
    setRequesting(false)
    setDestination('')
    setDestinationPoint(null)
    setDestinationStatus('idle')
    if (messageText) setMessage(messageText)
  }

  async function loadClientTripHistory() {
    if (!auth.user?.id) return

    setTripHistoryLoading(true)

    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .eq('client_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(30)

    setTripHistoryLoading(false)

    if (error) {
      setMessage('No pude cargar tus viajes.')
      return
    }

    setTripHistory(data || [])
  }

  async function sendRushSignal() {
    if (!activeTrip?.id || !activeTrip?.driver_id || !auth.user?.id || rushSending) return

    const lastSent = rushSentAt ? new Date(rushSentAt).getTime() : 0
    if (lastSent && Date.now() - lastSent < 60000) {
      setMessage('Ya le avisamos al chofer. Podés reenviar en un minuto.')
      return
    }

    const sentAt = new Date().toISOString()
    const driverName = firstName(activeTripDriver?.name || selectedDriver?.name || 'tu chofer')

    setRushSending(true)
    setRushSentAt(sentAt)
    setMessage(`Le avisamos a ${driverName}. Tu chofer ya sabe que estás apurado.`)
    setActiveTrip((current) =>
      current
        ? {
            ...current,
            client_rush_at: sentAt,
            client_rush_count: (Number(current.client_rush_count) || 0) + 1,
          }
        : current
    )

    try {
      const { error } = await supabase.from('messages').insert({
        trip_id: activeTrip.id,
        sender_id: auth.user.id,
        body: 'El cliente está apurado y pidió avanzar apenas sea seguro. Seguridad primero.',
      })

      if (error) {
        console.warn('MiChofer rush signal was kept local because messages insert failed:', error)
      }
    } finally {
      setRushSending(false)
    }
  }

async function handleTripUpdate(nextTrip) {
  if (!nextTrip?.id) return

  const previousStatus = activeTrip?.status || lastTripStatus
  const statusChanged = previousStatus !== nextTrip.status

  if (nextTrip.status === 'cancelled' || nextTrip.status === 'completed') {
    setLastTripStatus(nextTrip.status)

    if (nextTrip.status === 'completed') {
      loadClientTripHistory()

      setRatingTrip({
        ...nextTrip,
        driver: activeTripDriver || selectedDriver,
      })

      clearLiveTrip('')
      setMessage('Viaje finalizado. Calificá a tu chofer para mejorar la comunidad MiChofer.')
    } else {
      clearLiveTrip('Viaje cancelado. Podés elegir otro chofer.')
    }

    return
  }

  setActiveTrip(nextTrip)

  if (Number.isFinite(Number(nextTrip.destination_lat)) && Number.isFinite(Number(nextTrip.destination_lng))) {
    setDestinationPoint({
      lat: Number(nextTrip.destination_lat),
      lng: Number(nextTrip.destination_lng),
    })

    if (nextTrip.destination_text) {
      setDestination(nextTrip.destination_text)
    }
  }

  let driver = activeTripDriver

  if (!driver && nextTrip.driver_id) {
    driver = await loadActiveTripDriver(nextTrip.driver_id)
  }

  if (statusChanged) {
    const clientName = firstName(auth.profile?.full_name || auth.user?.email || 'Roger')
    const driverName = firstName(driver?.name || activeTripDriver?.name || selectedDriver?.name || 'tu chofer')

    const statusMessages = {
      pending: 'Solicitud enviada. Esperando confirmación.',
      accepted: `${clientName}, ${driverName} ya aceptó tu viaje. Llegará pronto.`,
      arriving: 'Tu chofer está llegando. Verificá el auto y la chapa.',
      in_progress: 'Viaje iniciado. Seguimos tu ruta en tiempo real.',
      completed: 'Viaje finalizado. Gracias por viajar con MiChofer.',
      cancelled: 'Viaje cancelado. Podés elegir otro chofer.',
    }

    setLastTripStatus(nextTrip.status)
    setMessage(statusMessages[nextTrip.status] || 'Viaje actualizado.')
  }

  if (Number.isFinite(Number(nextTrip.driver_lat)) && Number.isFinite(Number(nextTrip.driver_lng))) {
    setActiveTripDriver((current) => ({
      ...(current || driver || {}),
      lat: Number(nextTrip.driver_lat),
      lng: Number(nextTrip.driver_lng),
      heading: Number.isFinite(Number(nextTrip.driver_heading))
        ? Number(nextTrip.driver_heading)
        : current?.heading ?? null,
      speed: Number.isFinite(Number(nextTrip.driver_speed))
        ? Number(nextTrip.driver_speed)
        : current?.speed ?? null,
      accuracy: Number.isFinite(Number(nextTrip.driver_accuracy))
        ? Number(nextTrip.driver_accuracy)
        : current?.accuracy ?? null,
    }))
  }
}

async function requestRide() {
  if (!auth.user) {
    window.location.href = '/login'
    return
  }

  if (!destination.trim()) {
    setMessage('Elegí un destino para ver la ruta.')
    return
  }

  if (!destinationPoint || !isValidParaguayCoord(destinationPoint)) {
    setMessage('Todavía no hay datos suficientes para confirmar ese destino.')
    return
  }

  if (!clientLocation || !isValidParaguayCoord(clientLocation)) {
    setMessage('No tengo tu ubicación actual. Tocá calibrar ubicación y probá de nuevo.')
    return
  }

  if (!selectedDriver) {
    setMessage('Elegí un chofer disponible.')
    return
  }

  const selectedDriverId = selectedDriver.user_id || selectedDriver.id

  if (!selectedDriverId) {
    console.error('[MiChofer requestRide] Chofer sin user_id válido:', selectedDriver)
    setMessage('Este chofer no tiene user_id válido. Revisá driver_profiles.')
    return
  }

  if (selectedDriverId === auth.user.id) {
    setMessage('No podés solicitarte un viaje a tu misma cuenta. Probá cliente y chofer con correos distintos.')
    return
  }

  let freshestDriver = drivers.find((driver) => {
    const driverId = driver.user_id || driver.id
    return String(driverId || '') === String(selectedDriverId || '')
  })
  const driversSnapshotAge = driversLastLoadedAt ? Date.now() - driversLastLoadedAt : Infinity

  if (driversSnapshotAge > 60000 || !freshestDriver) {
    setMessage('Confirmando disponibilidad del chofer...')
    const refreshedDrivers = await loadDrivers(clientLocation, { force: true })

    freshestDriver = (refreshedDrivers || []).find((driver) => {
      const driverId = driver.user_id || driver.id
      return String(driverId || '') === String(selectedDriverId || '')
    })
  }

  if (driversLoadError && !freshestDriver) {
    setMessage(`No pude confirmar choferes disponibles: ${getErrorMessage(driversLoadError)}. Verificá internet y probá otra vez.`)
    return
  }

  if (!freshestDriver) {
    setMessage('Ese chofer ya no aparece disponible. Elegí otro chofer y probá de nuevo.')
    return
  }

  if (freshestDriver !== selectedDriver) {
    setSelectedDriver(freshestDriver)
  }

  if (!isValidParaguayCoord({ lat: freshestDriver.lat, lng: freshestDriver.lng })) {
    console.error('[MiChofer requestRide] Chofer sin GPS válido:', freshestDriver)
    setMessage('Este chofer no tiene GPS válido. Pedile que calibre ubicación en modo chofer.')
    return
  }

  if (!routePrice) {
    setMessage('No pude calcular el precio todavía. Ajustá el destino y probá de nuevo.')
    return
  }

  setRequesting(true)
  setMessage('')

  const destinationTextFinal = destinationPlace?.formatted_address || destinationPlace?.name || destination
  const requestedRideCategory = resolveRideCategoryForRequest(freshestDriver, vehicleMode)
  const safeRouteKm = Number.isFinite(Number(routeKm))
    ? Number(routeKm)
    : distanceKm(clientLocation, destinationPoint)

  const tripPayload = {
    driverId: selectedDriverId,
    destinationText: destinationTextFinal,
    destinationLat: Number(destinationPoint.lat),
    destinationLng: Number(destinationPoint.lng),
    pickupLat: Number(clientLocation.lat),
    pickupLng: Number(clientLocation.lng),
    driverLat: Number(freshestDriver.lat),
    driverLng: Number(freshestDriver.lng),
    routeKm: safeRouteKm,
    price: Number(routePrice),
    paymentMethod,
    womenMode: Boolean(ellaSafetyActive),
    rideCategory: requestedRideCategory,
  }

  console.log('[MiChofer Route] origin:', clientLocation)
  console.log('[MiChofer Route] destination:', destinationPoint, destinationTextFinal)
  console.log('[MiChofer requestTrip category debug]', {
    vehicleMode,
    selectedDriver: freshestDriver,
    driverType: freshestDriver?.driver_type,
    requestedRideCategory,
  })
  console.log('[MiChofer requestTrip payload]', tripPayload)

  const { data, error } = await requestTrip(tripPayload)

  setRequesting(false)

  if (error) {
    console.error('[MiChofer requestTrip RPC ERROR]', {
      error,
      tripPayload,
      selectedDriver: freshestDriver,
      vehicleMode,
      requestedRideCategory,
    })

    setMessage(
      `No se pudo crear el viaje: ${
        getSupabaseRequestMessage(error)
      }`
    )
    return
  }

  const createdTrip = Array.isArray(data) ? data[0] : data

  if (!createdTrip?.id) {
    console.error('[MiChofer requestRide] No se recibió viaje creado.', {
      data,
      tripPayload,
    })
    setMessage('El viaje no se creó correctamente. Revisá la consola.')
    return
  }

  setActiveTrip(createdTrip)
  setActiveTripDriver(freshestDriver)
  setLastTripStatus(createdTrip?.status || 'pending')
  setTripWaitingSeconds(0)
  setRushSentAt(null)
  setShowDriverChooser(false)
  setMessage('Solicitud enviada. Esperando confirmación.')
}

  function handleModeSelect(nextMode) {
    if (nextMode === 'ella') {
      handleEllaSafetyToggle()
      return
    }

    setMode(nextMode)
    setSelectedDriver(null)
    setMessage('')
  }

  function handleEllaSafetyToggle() {
    if (ellaSafetyActive) {
      setWomenOnly(false)
      setSelectedDriver(null)
      setMessage('')
      return
    }

    if (!canUseWomenMode(auth.profile)) {
      setCategorySheet(getRideCategoryMeta('ella'))
      return
    }

    setWomenOnly(true) // This will trigger the filter in visibleDrivers
    setSelectedDriver(null)
    setMessage('')
  }

  async function handleWomenModeRequest() {
    if (!auth.user) {
      window.location.href = '/login'
      return
    }

    if (canUseWomenMode(auth.profile)) {
      setWomenOnly(true)
      setSelectedDriver(null)
      setCategorySheet(null)
      return
    }

    try {
      setWomenRequesting(true)
      const { data, error } = await requestWomenMode('woman')

      // AuthContext will reload the profile automatically
      setCategorySheet(null)
      setMessage('Solicitud enviada. La preferencia de confianza se activa cuando admin verifica tu perfil.')
    } catch (error) {
      console.error('WOMEN MODE REQUEST ERROR:', error)
      setMessage('No pude solicitar la preferencia de confianza. Revisa que hayas corrido la migracion nueva en Supabase.')
    } finally {
      setWomenRequesting(false)
    }
  }

  async function chooseGoogleDestinationPrediction(prediction) {
    if (!prediction) return

    const google = googleMapsRef.current
    // Usar la descripción completa como label visible (incluye ciudad/país)
    const mainText = prediction.structured_formatting?.main_text || prediction.description || ''
    const fullDescription = prediction.description || mainText

    console.log('[MiChofer Places] selected:', prediction.place_id, fullDescription)

    setDestination(mainText)
    setDestinationFocused(false)
    setSelectedDriver(null)
    setMessage('')
    setGooglePlacePredictions([])

    if (placesServiceRef.current && prediction.place_id) {
      return new Promise((resolve) => {
        placesServiceRef.current.getDetails(
          {
            placeId: prediction.place_id,
            fields: ['place_id', 'name', 'formatted_address', 'geometry'],
          },
          (placeResult, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && placeResult?.geometry?.location) {
              const location = {
                lat: Number(placeResult.geometry.location.lat()),
                lng: Number(placeResult.geometry.location.lng()),
              }

              const resolvedPlace = {
                name: placeResult.name || mainText,
                formatted_address: placeResult.formatted_address || fullDescription,
                lat: location.lat,
                lng: location.lng,
                place_id: placeResult.place_id || prediction.place_id,
                source: 'google_places',
              }

              console.log('[MiChofer Places] destination coords:', location.lat, location.lng)
              console.log('[MiChofer Places] formatted_address:', resolvedPlace.formatted_address)

              setDestinationPoint(location)
              setDestinationStatus('ready')
              setDestinationPlace(resolvedPlace)
              resolve(true)
              return
            }

            // Fallback: PlacesService falló — intentar geocodificar con la descripción completa
            // (incluye ciudad, ej: "Mercado de Abasto, Ciudad del Este, Paraguay")
            if (prediction.place_id && google?.maps?.Geocoder) {
              console.log('[MiChofer Places] PlacesService falló, usando geocoder con:', fullDescription)
              geocodeAddress(fullDescription).then((location) => {
                if (location) {
                  const fallbackPlace = {
                    name: mainText,
                    formatted_address: fullDescription,
                    lat: location.lat,
                    lng: location.lng,
                    place_id: prediction.place_id,
                    source: 'google_places',
                  }
                  console.log('[MiChofer Places] destination coords (geocoder):', location.lat, location.lng)
                  setDestinationPoint(location)
                  setDestinationStatus('ready')
                  setDestinationPlace(fallbackPlace)
                } else {
                  setDestinationPoint(null)
                  setDestinationStatus('not_found')
                }
                resolve(true)
              })
              return
            }

            setDestinationPoint(null)
            setDestinationStatus('not_found')
            resolve(true)
          }
        )
      })
    }

    // Sin PlacesService — geocodificar con descripción completa
    setDestinationStatus('searching')
    console.log('[MiChofer Places] sin PlacesService, geocodificando:', fullDescription)
    const location = await geocodeAddress(fullDescription)

    if (location) {
      const noServicePlace = {
        name: mainText,
        formatted_address: fullDescription,
        lat: location.lat,
        lng: location.lng,
        place_id: prediction.place_id || null,
        source: 'google_places',
      }
      console.log('[MiChofer Places] destination coords (sin service):', location.lat, location.lng)
      setDestinationPoint(location)
      setDestinationStatus('ready')
      setDestinationPlace(noServicePlace)
    } else {
      setDestinationPoint(null)
      setDestinationStatus('not_found')
    }
  }

  function chooseDestinationSuggestion(place) {
    const title = getPlaceTitle(place)

    setDestination(title)
    setDestinationFocused(false)
    setSelectedDriver(null)
    setMessage('')
    setGooglePlacePredictions([])

    if (Number.isFinite(place?.lat) && Number.isFinite(place?.lng)) {
      setDestinationPoint({ lat: place.lat, lng: place.lng })
      setDestinationStatus('ready')
      setDestinationPlace({
        name: title,
        formatted_address: getPlaceSubtitle(place) || title,
        lat: place.lat,
        lng: place.lng,
        place_id: place.id || null,
      })
    } else {
      setDestinationStatus('searching')
    }
  }
async function submitClientDriverRating() {
  if (!ratingTrip?.id || !ratingTrip?.driver_id || !auth.user?.id) {
    setMessage('No pude identificar el viaje para calificar.')
    return
  }

  try {
    setRatingSubmitting(true)

    const { error } = await supabase
      .from('ratings')
      .upsert(
        {
          trip_id: ratingTrip.id,
          rater_id: auth.user.id,
          ratee_id: ratingTrip.driver_id,
          type: 'client_to_driver',
          stars: driverRatingStars,
          comment: driverRatingComment.trim() || null,
          admin_status: 'new',
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'trip_id,rater_id,ratee_id,type',
        }
      )

    if (error) {
      console.error('CLIENT DRIVER RATING ERROR:', error)
      setMessage('No pude enviar la calificación. Revisá la tabla ratings y las policies.')
      return
    }

    setRatingTrip(null)
    setDriverRatingStars(5)
    setDriverRatingComment('')
    setMessage('Gracias. Tu calificación ayuda a mejorar MiChofer.')
    loadDrivers(clientLocation)
  } finally {
    setRatingSubmitting(false)
  }
}
async function cancelActiveTrip() {
  if (!activeTrip?.id || !auth.user?.id) return

  if (activeTrip.client_id && activeTrip.client_id !== auth.user.id) {
    setMessage('No podés cancelar un viaje que no pertenece a tu cuenta.')
    return
  }

  setMessage('Cancelando viaje...')

  try {
    const { data, error } = await supabase.rpc('cancel_own_trip_v2', {
      p_trip_id: activeTrip.id,
    })

    if (error) {
      console.error('[MiChofer cancel_own_trip_v2 ERROR]', {
        error,
        activeTrip,
        userId: auth.user.id,
      })

      setMessage(
        `No pude cancelar el viaje: ${
          error.message || error.details || error.hint || 'revisá permisos de trips.'
        }`
      )
      return
    }

    const cancelledTrip = Array.isArray(data) ? data[0] : data

    handleTripUpdate({
      ...(activeTrip || {}),
      ...(cancelledTrip || {}),
      status: 'cancelled',
    })

    clearLiveTrip('Viaje cancelado. Podés elegir otro chofer.')
  } catch (error) {
    console.error('[MiChofer cancelActiveTrip unexpected ERROR]', error)
    setMessage('No pude cancelar el viaje. Revisá la consola.')
  }
}

  async function refreshLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLocation = {
          lat: Number(pos.coords.latitude),
          lng: Number(pos.coords.longitude),
        }

        if (!isValidParaguayCoord(nextLocation)) {
          setLocationReady(false)
          setMessage('Tu GPS devolvió una ubicación inválida. Activá ubicación precisa y probá de nuevo.')
          return
        }

        setClientLocation(nextLocation)
        setLocationReady(true)
        loadDrivers(nextLocation)
        setMessage('')
      },
      () => {
        setLocationReady(false)
        setMessage('No pude leer tu ubicación. Activá el GPS y probá de nuevo.')
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 1000 }
    )
  }

  const liveDriverPoint = useMemo(() => {
    // Priority:
    // 1. activeTrip.driver_road_lat / driver_road_lng (Roads API snapped)
    // 2. activeTrip.driver_lat / driver_lng (raw GPS from driver updates)
    // 3. activeTripDriver.lat / activeTripDriver.lng (driver_profiles fallback)

    // Check Roads snapped coordinates first
    const roadLat = Number(activeTrip?.driver_road_lat)
    const roadLng = Number(activeTrip?.driver_road_lng)
    const hasRoadCoords = isValidParaguayCoord({ lat: roadLat, lng: roadLng })

    // Check trip raw GPS
    const tripLat = Number(activeTrip?.driver_lat)
    const tripLng = Number(activeTrip?.driver_lng)
    const hasTripCoords = isValidParaguayCoord({ lat: tripLat, lng: tripLng })

    // Check driver profile fallback
    const driverLat = Number(activeTripDriver?.lat)
    const driverLng = Number(activeTripDriver?.lng)
    const hasDriverCoords = isValidParaguayCoord({ lat: driverLat, lng: driverLng })

    if (!hasRoadCoords && !hasTripCoords && !hasDriverCoords) {
      return null
    }

    const source = hasRoadCoords
      ? 'roads'
      : hasTripCoords
        ? 'trip'
        : 'profile'

    const bestLat = hasRoadCoords ? roadLat : hasTripCoords ? tripLat : driverLat
    const bestLng = hasRoadCoords ? roadLng : hasTripCoords ? tripLng : driverLng
    const updatedAt = hasRoadCoords
      ? activeTrip.driver_road_snapped_at
      : hasTripCoords
        ? activeTrip.updated_at
        : activeTripDriver?.updated_at || null

    return {
      ...activeTripDriver,
      lat: bestLat,
      lng: bestLng,
      heading: Number.isFinite(Number(activeTrip?.driver_heading))
        ? Number(activeTrip.driver_heading)
        : Number.isFinite(Number(activeTripDriver?.heading))
          ? Number(activeTripDriver.heading)
          : null,
      speed: Number.isFinite(Number(activeTrip?.driver_speed))
        ? Number(activeTrip.driver_speed)
        : Number.isFinite(Number(activeTripDriver?.speed))
          ? Number(activeTripDriver.speed)
          : null,
      accuracy: Number.isFinite(Number(activeTrip?.driver_accuracy))
        ? Number(activeTrip.driver_accuracy)
        : Number.isFinite(Number(activeTripDriver?.accuracy))
          ? Number(activeTripDriver.accuracy)
          : null,
      updated_at: updatedAt,
      source,
    }
   }, [
    activeTrip?.driver_road_lat,
    activeTrip?.driver_road_lng,
    activeTrip?.driver_lat,
    activeTrip?.driver_lng,
    activeTrip?.driver_heading,
    activeTrip?.driver_speed,
    activeTrip?.driver_accuracy,
    activeTrip?.driver_road_snapped_at,
    activeTripDriver?.id,
    activeTripDriver?.user_id,
    activeTripDriver?.lat,
    activeTripDriver?.lng,
    activeTripDriver?.heading,
    activeTripDriver?.speed,
    activeTripDriver?.accuracy,
    activeTripDriver?.avatar,
    activeTripDriver?.name,
  ])

  const activeTripAcceptedByDriver = Boolean(
    activeTrip &&
    ['accepted', 'arriving', 'in_progress'].includes(activeTrip.status)
  )

  const activeTripWaitingForPickup = Boolean(
    activeTripAcceptedByDriver && activeTrip.status !== 'in_progress'
  )

  const shouldTrackDriverOnMap = Boolean(
    activeTripAcceptedByDriver && liveDriverPoint
  )

   const liveEtaText = routeGuidance?.duration
    ? `${Math.max(1, Math.ceil(Number(routeGuidance.duration) / 60))} min`
    : activeTripDriver?.eta || selectedDriver?.eta || ''

  const livePickupPoint =
    activeTrip?.pickup_lat && activeTrip?.pickup_lng
      ? { lat: Number(activeTrip.pickup_lat), lng: Number(activeTrip.pickup_lng) }
      : clientLocation

  const liveDestinationPoint =
    activeTrip?.destination_lat && activeTrip?.destination_lng
      ? { lat: Number(activeTrip.destination_lat), lng: Number(activeTrip.destination_lng) }
      : destinationPoint

  const liveTargetPoint =
    activeTrip?.status === 'in_progress'
      ? liveDestinationPoint
      : livePickupPoint

  const liveDistance =
    liveDriverPoint && liveTargetPoint
      ? liveDistanceMeters(liveDriverPoint, liveTargetPoint)
      : null

  const rideUi = clientLiveStatusUi(
    activeTrip?.status,
    activeTripDriver?.name || selectedDriver?.name,
    liveEtaText,
    liveDistance
  )
  const rushWasSent = Boolean(rushSentAt || activeTrip?.client_rush_at || Number(activeTrip?.client_rush_count) > 0)
  const rushLocked = rushSending || (rushSentAt && Date.now() - new Date(rushSentAt).getTime() < 60000)
  const humanRideCopy = activeTrip
    ? clientTripHumanCopy(
        activeTrip.status,
        activeTripDriver?.name || selectedDriver?.name,
        liveEtaText,
        liveDistance,
        rushWasSent
      )
    : null
  const liveMicrocopy = activeTrip
    ? waitingMicrocopy(activeTrip.status, tripWaitingSeconds, rushWasSent) || humanRideCopy?.joke || ''
    : ''

    const rideProgressWidth = `${rideUi.progress}%`
  const canChatInRide = Boolean(activeTrip?.id && rideUi.chatEnabled)
  const driverVehicleText =
    activeTripDriver?.vehicle ||
    selectedDriver?.vehicle ||
    'Vehículo verificado'

    const driverPlateText =
    activeTripDriver?.plate ||
    selectedDriver?.plate ||
    'Verificado'

  const pickupPointText = activeTrip?.pickup_text || 'Punto de recogida: tu ubicación actual'

   const mapOrigin = useMemo(() => {
    if (shouldTrackDriverOnMap) return liveDriverPoint
    return locationReady ? clientLocation : null
  }, [
    shouldTrackDriverOnMap,
    liveDriverPoint,
    locationReady,
    clientLocation?.lat,
    clientLocation?.lng,
  ])

   const mapDestination = useMemo(() => {
    if (!activeTripAcceptedByDriver) return destinationPoint || mapDestinationMarker
    return activeTripWaitingForPickup && locationReady ? clientLocation : destinationPoint || mapDestinationMarker
  }, [
    activeTripAcceptedByDriver,
    activeTripWaitingForPickup,
    locationReady,
    clientLocation?.lat,
    clientLocation?.lng,
    destinationPoint?.lat,
    destinationPoint?.lng,
    mapDestinationMarker?.lat,
    mapDestinationMarker?.lng,
  ])

  const mapAvatar = shouldTrackDriverOnMap ? liveDriverPoint?.avatar : auth.profile?.avatar_url

  const mapDrivers = useMemo(() => {
    return activeTrip ? [] : visibleDrivers
  }, [Boolean(activeTrip), visibleDrivers])

  const mapSelectedDriver = activeTrip ? null : selectedDriver

  return (
    <main className="app-shell">
      <section className={`phone client-phone client-premium ${ellaSafetyActive ? 'women-client-mode' : ''} ${isClientWomanProfile ? 'client-woman-profile' : ''}`}>
        <header className="client-top premium-map-header">
          <section className="route-search-card map-search-bar" aria-label="Elegir ruta">
            <div className="route-point-stack" aria-hidden="true">
              <span className="route-point-dot route-point-origin" />
              <span className="route-point-line" />
              <span className="route-point-dot route-point-destination" />
            </div>

            <div className="map-search-copy route-search-fields">
              <div className="route-point-row route-origin-row">
                <div className="route-point-copy">
                  <span>Punto de salida</span>
                  <strong>Tu ubicacion actual</strong>
                </div>
              </div>

              <label className="route-point-row route-destination-row route-point-copy" htmlFor="destination">Punto de llegada</label>
              <input
                id="destination"
                className="route-input"
                value={destination}
                onChange={(event) => {
                  setDestination(event.target.value)
                  setSelectedDriver(null)
                  setGooglePlacePredictions([])
                  setDestinationPlace(null)
                  setDestinationPoint(null)
                  setMapDestinationMarker(null)
                  setMapDestinationAddress('')
                  setDestinationStatus('idle')
                  setRouteGuidance(null)
                  setMessage('')
                }}
                onFocus={() => setDestinationFocused(true)}
                onBlur={() => window.setTimeout(() => setDestinationFocused(false), 120)}
                placeholder="¿A dónde vas?"
                autoComplete="off"
              />
            </div>

            {destination && (
              <button
                className="clear-destination-btn"
                type="button"
                onClick={() => {
  setDestination('')
  setDestinationPoint(null)
  setDestinationStatus('idle')
  setDestinationPlace(null)
  setGooglePlacePredictions([])
  setSelectedDriver(null)
  setRouteGuidance(null)
  setMessage('')
}}
                aria-label="Borrar destino"
              >
                <X size={16} />
              </button>
            )}

            <button
              className="avatar-button header-avatar route-account-button"
              type="button"
              onClick={() => setShowMenu(true)}
              aria-label="Abrir cuenta"
            >
              {auth.profile?.avatar_url ? <img src={auth.profile.avatar_url} alt="Perfil" /> : <UserRound size={20} />}
            </button>
          </section>

          {showDestinationSuggestions && (
            <section className="destination-suggestions" role="listbox" aria-label="Sugerencias de destino">
              {destinationSuggestionItems.map((place, index) => {
                const isGooglePlace = googlePlacePredictions.length > 0
                const title = isGooglePlace
                  ? place.structured_formatting?.main_text || place.description || ''
                  : getPlaceTitle(place)
                const subtitle = isGooglePlace
                  // Mostrar ciudad/barrio — secondary_text contiene ciudad + país
                  ? place.structured_formatting?.secondary_text || place.description || 'Paraguay'
                  : getPlaceSubtitle(place)
                const key = isGooglePlace ? `${place.place_id || index}-${title}` : `${place.id}-${place.alias}`
                return (
                  <button
                    key={key}
                    type="button"
                    role="option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => (isGooglePlace ? chooseGoogleDestinationPrediction(place) : chooseDestinationSuggestion(place))}
                  >
                    <MapPin size={15} />
                    <span>
                      <strong>{title}</strong>
                      {subtitle && <small>{subtitle}</small>}
                    </span>
                  </button>
                )
              })}
            </section>
          )}
        </header>

           {activeTrip && activeTripDriver && (
  <section
    className={`mc-ride-live-sheet ${liveSheetExpanded ? 'is-expanded' : 'is-minimized'} status-${activeTrip.status || 'pending'}`}
    aria-label="Estado del viaje"
  >
    <button
      type="button"
      className="mc-ride-handle"
      onClick={() => setLiveSheetExpanded((current) => !current)}
      aria-label={liveSheetExpanded ? 'Minimizar detalles del viaje' : 'Ver detalles del viaje'}
    >
      <span />
    </button>

    <div className="mc-ride-progress" aria-hidden="true">
      <span style={{ width: rideProgressWidth }} />
      <em style={{ left: rideProgressWidth }}>
        <CarFront size={13} />
      </em>
    </div>

    {!liveSheetExpanded ? (
      <div className="mc-ride-compact">
        <div className="mc-ride-compact-avatar">
          {activeTripDriver.avatar ? (
            <img src={activeTripDriver.avatar} alt={activeTripDriver.name} />
          ) : (
            <span>{firstName(activeTripDriver.name).slice(0, 2).toUpperCase()}</span>
          )}
        </div>

        <div className="mc-ride-compact-copy">
          <span>{rideUi.badge}</span>
          <strong>{humanRideCopy?.title || rideUi.title}</strong>
          <small>
            {humanRideCopy?.subtitle ||
              (activeTrip.status === 'in_progress'
                ? 'Viaje en curso'
                : `${firstName(activeTripDriver.name)} viene hacia vos`)}
          </small>
        </div>

        <button type="button" className="mc-ride-compact-action" onClick={() => setLiveSheetExpanded(true)}>
          Ver
          <ChevronRight size={16} />
        </button>
      </div>
    ) : (
      <>
        <header className="mc-ride-status-head">
          <div className="mc-ride-status-copy">
            <span className="mc-ride-status-pill">{rideUi.badge}</span>
            <h2>{humanRideCopy?.title || rideUi.title}</h2>
            <p>{humanRideCopy?.subtitle || rideUi.subtitle}</p>
          </div>
        </header>

        <section className="mc-ride-driver-card" aria-label="Datos del chofer">
          <div className="mc-ride-driver-photo">
            {activeTripDriver.avatar ? (
              <img src={activeTripDriver.avatar} alt={activeTripDriver.name} />
            ) : (
              <span>{firstName(activeTripDriver.name).slice(0, 2).toUpperCase()}</span>
            )}

            <em aria-hidden="true">
              <CheckCircle2 size={13} />
            </em>
          </div>

          <div className="mc-ride-driver-info">
            <div className="mc-ride-driver-name">
              <span>Chofer asignado</span>
              <strong>{firstName(activeTripDriver.name)}</strong>
            </div>

            <div className="mc-ride-driver-meta">
              <div>
                <span>Vehículo</span>
                <strong>{driverVehicleText}</strong>
              </div>

              <div>
                <span>Chapa</span>
                <strong>{driverPlateText}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="mc-ride-pickup-card" aria-label="Punto de recogida">
          <div className="mc-ride-pickup-icon">
            <MapPin size={17} />
          </div>

          <div>
            <span>Punto de recogida</span>
            <strong>{pickupPointText}</strong>
          </div>
        </section>

        {liveMicrocopy && (
          <p className="mc-ride-microcopy">
            {liveMicrocopy}
          </p>
        )}

        <div className="mc-ride-actions">
          <a
            className={canChatInRide ? 'mc-ride-chat-action' : 'mc-ride-chat-action disabled'}
            href={canChatInRide ? `/chat?trip=${activeTrip.id}` : '#'}
            onClick={(event) => {
              event.preventDefault()
              if (!canChatInRide) {
                setMessage('El chat se activa cuando el chofer acepta tu solicitud.')
                return
              }
              setChatOpen(true)
            }}
          >
            <MessageCircle size={18} />
            <span>{canChatInRide ? 'Chatear' : 'Chat al aceptar'}</span>
            {chatUnreadCount > 0 && (
              <strong className="chat-unread-badge">{chatUnreadCount}</strong>
            )}
          </a>

          {activeTrip.status !== 'in_progress' && (
            <button
              type="button"
              className={`mc-ride-rush-action ${rushWasSent ? 'sent' : ''}`}
              onClick={sendRushSignal}
              disabled={rushLocked || !activeTrip.driver_id}
            >
              <span className="mc-ride-rush-icon" aria-hidden="true">
                {rushWasSent ? <CheckCircle2 size={18} /> : <Clock size={18} />}
              </span>

              <span>
                <strong>{rushWasSent ? 'Chofer avisado' : 'Tengo prisa'}</strong>
                <small>{rushWasSent ? 'Ya recibió el aviso' : 'Avisar con respeto'}</small>
              </span>
            </button>
          )}

          {rushWasSent && (
            <div className="mc-ride-rush-note">
              Aviso enviado. La seguridad siempre va primero.
            </div>
          )}

          <button type="button" className="mc-ride-cancel-action" onClick={cancelActiveTrip}>
            <X size={17} />
            <span>Cancelar viaje</span>
          </button>
        </div>
      </>
    )}
  </section>
)}
{locationReady || shouldTrackDriverOnMap ? (
    <InteractiveRouteMap
      origin={mapOrigin}
      destination={mapDestination}
      destinationText={mapDestinationAddress || destination}
      clientAvatar={mapAvatar}
      drivers={mapDrivers}
      selectedDriver={mapSelectedDriver}
      onSelectDriver={setSelectedDriver}
      onChooseDriver={() => setShowDriverChooser(true)}
      onRefreshLocation={refreshLocation}
      onRouteUpdate={setRouteGuidance}
      onMapClick={async (point) => {
        setDestination('Punto marcado en el mapa')
        setMapDestinationMarker(point)
        setDestinationPoint(point)
        setMapDestinationAddress('Punto marcado en el mapa')
        setGooglePlacePredictions([])
        setDestinationPlace({
          name: 'Punto marcado',
          formatted_address: 'Seleccionado en el mapa',
          lat: point.lat,
          lng: point.lng,
          source: 'map_pin',
        })
        setRouteGuidance(null)
        setMessage('Punto seleccionado en el mapa. Pedí chofer o elegí uno cerca.')

        const location = await reverseGeocode(point.lat, point.lng)
        if (location?.formatted_address) {
          setDestination(location.formatted_address)
          setMapDestinationAddress(location.formatted_address)
          setDestinationPlace((current) => ({
            ...current,
            formatted_address: location.formatted_address,
          }))
        }
      }}
      showRouteSummary={false}
      showOriginCar={shouldTrackDriverOnMap}
      showMapTypeControl
      animateCamera={!shouldTrackDriverOnMap}
    />
  ) : (
  <section className="mobility-map interactive-map">
    <div className="map-empty-state">
      <div className="map-empty-card">
        <strong>Activando ubicación</strong>
        <span>Necesitamos tu GPS para mostrar tu punto real, no una ubicación aproximada.</span>
        <button type="button" className="main-btn" onClick={refreshLocation}>
          Activar ubicación
        </button>
      </div>
    </div>
  </section>
)}

     {destination.trim().length > 0 && !destinationPoint && !showDriverChooser && !selectedDriver && !activeTrip && !showDestinationSuggestions && (
          <section className="route-guidance-card warning-guidance apple-route-warning" aria-label="Aviso de destino">
            <p>Elegí una sugerencia para calcular el viaje.</p>
          </section>
        )}

        {routeGuidance && fares && !activeTrip && !showDriverChooser && !selectedDriver && !showDestinationSuggestions && (
          <section className="client-decision-dock" aria-label="Resumen del viaje y elección de chofer">
            <div className="client-decision-summary">
              <div>
                <span>Viaje estimado</span>
                <strong>
                  {fares.details.distanceKm != null ? `${fares.details.distanceKm.toFixed(1)} km` : '---'}
                  {' · '}
                  {fares.details.durationMin != null ? `${Math.ceil(fares.details.durationMin)} min` : '---'}
                </strong>
              </div>

              <div>
                <span>Desde</span>
                <strong>{currentFare ? formatGs(currentFare) : '---'}</strong>
              </div>
            </div>

            <button
              type="button"
              className="client-driver-discovery-btn"
              onClick={() => setShowDriverChooser(true)}
              disabled={!canOpenDrivers}
            >
              <span>
                <MapPin size={17} />
                Choferes cerca
              </span>
              <strong>{canOpenDrivers ? 'Elegir viaje' : 'Elegí destino'}</strong>
              <ChevronRight size={20} />
            </button>
          </section>
        )}

        {destinationPoint && !routeGuidance && !fares && !showMenu && !showDriverChooser && !selectedDriver && !activeTrip && !showDestinationSuggestions && (
          <div className="client-bottom-start-card client-empty-start-card" aria-label="Elegir chofer">
            <button
              type="button"
              className="client-start-ride-btn"
              onClick={() => setShowDriverChooser(true)}
              disabled={!canOpenDrivers}
            >
              <span>{canOpenDrivers ? 'Listo para viajar' : 'Elegí destino'}</span>
              <strong>{canOpenDrivers ? 'Elegir chofer' : 'Buscar chofer'}</strong>
            </button>
          </div>
        )}

      {selectedDriver && !activeTrip && !showDriverChooser && (
  <article className="mc-confirm-ride-card" aria-label="Confirmar viaje">
    <button
      className="mc-confirm-close"
      type="button"
      onClick={() => setSelectedDriver(null)}
      aria-label="Cerrar perfil del chofer"
    >
      <X size={16} />
    </button>

    <section className="mc-confirm-driver">
      <div className="mc-confirm-avatar">
        {selectedDriver.avatar ? (
          <img src={selectedDriver.avatar} alt={selectedDriver.name} />
        ) : (
          <span>{firstName(selectedDriver.name).slice(0, 2).toUpperCase()}</span>
        )}

        <em aria-hidden="true">
          <CheckCircle2 size={13} />
        </em>
      </div>

      <div className="mc-confirm-copy">
        <span>Chofer seleccionado</span>
        <h2>{firstName(selectedDriver.name)}</h2>
        <p>{selectedDriver.vehicle || 'Vehículo verificado'}</p>
      </div>
    </section>

    <section className="mc-confirm-metrics" aria-label="Datos del viaje">
      <div>
        <Star size={13} />
        <strong>{Number(selectedDriver.rating || 5).toFixed(2)}</strong>
        <span>Rating</span>
      </div>

      <div>
        <Clock size={13} />
        <strong>{selectedDriver.eta || '3 min'}</strong>
        <span>Llegada</span>
      </div>

      <div>
        <MapPin size={13} />
        <strong>{selectedDriver.distance || 'Cerca'}</strong>
        <span>Distancia</span>
      </div>
    </section>

    <section className="mc-confirm-payment" aria-label="Método de pago">
      <div className="mc-confirm-payment-head">
        <div>
          <span>Método de pago</span>
          <strong>{paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}</strong>
        </div>

        <small>El chofer verá esta información</small>
      </div>

      <div className="mc-confirm-payment-options">
        <button
          type="button"
          className={paymentMethod === 'cash' ? 'active' : ''}
          onClick={() => setPaymentMethod('cash')}
        >
          <Banknote size={17} />
          <span>Efectivo</span>
        </button>

        <button
          type="button"
          className={paymentMethod === 'card' ? 'active' : ''}
          onClick={() => setPaymentMethod('card')}
        >
          <CreditCard size={17} />
          <span>Tarjeta</span>
        </button>
      </div>
    </section>

    <section className="mc-confirm-price">
      <div>
        <span>Total estimado</span>
        <strong>{routePrice ? formatGs(routePrice) : currentFare ? formatGs(currentFare) : 'Calculando'}</strong>
      </div>

      <small>Precio calculado por distancia y categoría.</small>
    </section>

    <div className="mc-confirm-actions">
      <button
        type="button"
        className="mc-confirm-secondary"
        onClick={() => setShowDriverChooser(true)}
      >
        Cambiar
      </button>

      <button
        type="button"
        className="mc-confirm-primary"
        onClick={requestRide}
        disabled={requesting || !destinationPoint}
      >
        {requesting ? 'Solicitando...' : 'Solicitar viaje'}
      </button>
    </div>
  </article>
)}
{ratingTrip && (
  <div className="mc-rating-backdrop" role="presentation">
    <section className="mc-rating-sheet" role="dialog" aria-modal="true" aria-label="Calificar chofer">
      <div className="mc-rating-handle" />

      <header className="mc-rating-head">
        <span>Viaje finalizado</span>
        <h2>¿Cómo fue tu chofer?</h2>
        <p>
          Tu puntuación ayuda a otros clientes y al equipo admin de MiChofer.
        </p>
      </header>

      <div className="mc-rating-profile">
        <div className="mc-rating-avatar">
          {ratingTrip.driver?.avatar ? (
            <img src={ratingTrip.driver.avatar} alt={ratingTrip.driver.name} />
          ) : (
            <UserRound size={30} />
          )}
        </div>

        <div>
          <span>Chofer</span>
          <strong>{firstName(ratingTrip.driver?.name || 'Chofer')}</strong>
          <small>{ratingTrip.destination_text || 'Viaje MiChofer'}</small>
        </div>
      </div>

      <div className="mc-rating-stars" aria-label="Puntuación">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={driverRatingStars >= star ? 'active' : ''}
            onClick={() => setDriverRatingStars(star)}
            aria-label={`${star} estrellas`}
          >
            <Star size={27} fill="currentColor" />
          </button>
        ))}
      </div>

      <textarea
        className="mc-rating-textarea"
        value={driverRatingComment}
        onChange={(event) => setDriverRatingComment(event.target.value)}
        placeholder="Mensaje opcional para MiChofer: puntualidad, trato, vehículo, seguridad..."
        maxLength={400}
      />

      <div className="mc-rating-actions">
        <button
          type="button"
          className="mc-rating-secondary"
          onClick={() => {
            setRatingTrip(null)
            setDriverRatingStars(5)
            setDriverRatingComment('')
          }}
          disabled={ratingSubmitting}
        >
          Omitir
        </button>

        <button
          type="button"
          className="mc-rating-primary"
          onClick={submitClientDriverRating}
          disabled={ratingSubmitting}
        >
          {ratingSubmitting ? 'Enviando...' : 'Enviar calificación'}
        </button>
      </div>
    </section>
  </div>
)}
   {showDriverChooser && (
  <div className="mc-select-backdrop" onClick={() => setShowDriverChooser(false)}>
    <section className="mc-select-sheet" onClick={(event) => event.stopPropagation()}>
      <div className="mc-select-handle" />

      <header className="mc-select-header">
        <div className="mc-select-title">
          <p>MICHOFER SELECT</p>
          <h1>Elegí tu viaje</h1>
          <span>Choferes verificados cerca de vos.</span>
        </div>

        <button
          className="mc-select-close"
          type="button"
          onClick={() => setShowDriverChooser(false)}
          aria-label="Cerrar"
        >
          <X size={18} />
        </button>
      </header>

      <section className="mc-select-summary" aria-label="Resumen del viaje">
        <div>
          <span>Distancia</span>
          <strong>{fares?.details?.distanceKm != null ? `${fares.details.distanceKm.toFixed(1)} km` : '---'}</strong>
        </div>

        <div>
          <span>Tiempo</span>
          <strong>{fares?.details?.durationMin != null ? `${Math.ceil(fares.details.durationMin)} min` : '---'}</strong>
        </div>

        <div className="price">
          <span>Desde</span>
          <strong>{currentFare ? formatGs(currentFare) : '---'}</strong>
        </div>
      </section>

  <section className="mc-apple-modes" aria-label="Tipo de viaje">
  <div className="mc-apple-modes-head">
    <span>Tipo de viaje</span>
    <small>{ellaSafetyActive ? 'Confianza activa' : selectedModeMeta.title}</small>
  </div>

  <div className="mc-apple-mode-strip">
    {VEHICLE_CATEGORY_OPTIONS.map((category) => {
      const modeCopy = {
        all: {
          title: 'Todos',
          label: 'Opciones',
        },
        moto: {
          title: 'Moto',
          label: 'Rápido',
        },
        comfort: {
          title: 'Comfort',
          label: 'Cómodo',
        },
        premium: {
          title: 'Premium',
          label: 'Alta gama',
        },
        campus: {
          title: 'Campus',
          label: 'Universitario',
        },
      }

      const copy = modeCopy[category.code] || {
        title: category.shortLabel,
        label: 'Disponible',
      }

      const isActive = vehicleMode === category.code
      const iconLabel = MODE_ICON_LABEL[category.code] || category.code.charAt(0).toUpperCase()

      return (
        <button
          key={category.code}
          type="button"
          className={`mc-apple-mode ${category.code} ${isActive ? 'active' : ''}`}
          onClick={() => handleModeSelect(category.code)}
          aria-label={copy.title}
          title={copy.title}
        >
          <span className="mc-apple-mode-icon" aria-hidden="true">
            {iconLabel}
          </span>

          <span className="mc-apple-mode-copy">
            <strong>{copy.title}</strong>
            <small>{copy.label}</small>
          </span>
        </button>
      )
    })}

    <button
      type="button"
      className={`mc-apple-mode confidence ${ellaSafetyActive ? 'active' : ''}`}
      onClick={handleEllaSafetyToggle}
      aria-label={ellaSafetyActive ? 'Modo Confianza activo' : 'Activar Modo Confianza'}
      title={ellaSafetyActive ? 'Modo Confianza activo' : 'Activar Modo Confianza'}
    >
      <span className="mc-apple-mode-icon" aria-hidden="true">
        {MODE_ICON_LABEL.ella}
      </span>

      <span className="mc-apple-mode-copy">
        <strong>Confianza</strong>
        <small>{ellaSafetyActive ? 'Activa' : 'Privado'}</small>
      </span>
    </button>
  </div>
</section>

      {(vehicleMode !== 'all' || ellaSafetyActive) && (
        <div className={`mc-select-note ${ellaSafetyActive ? 'ella' : vehicleMode}`}>
          <ShieldCheck size={15} />
          <span>
            <strong>{ellaSafetyActive ? 'Modo Confianza' : selectedModeMeta.title}</strong>
            {ellaSafetyActive
              ? ` Priorizamos conductoras verificadas${vehicleMode === 'moto' ? ' en moto' : ''}.`
              : ` ${selectedModeMeta.description}`}
          </span>
        </div>
      )}

      <div className="mc-select-content">
        {!hasDestination ? (
          <div className="mc-select-empty">
            <strong>Elegí un destino</strong>
            <span>Después vas a ver choferes cercanos.</span>
          </div>
        ) : destinationStatus === 'searching' ? (
          <div className="mc-select-empty">
            <strong>Buscando destino</strong>
            <span>Estamos calculando la mejor ruta.</span>
          </div>
        ) : !destinationPoint ? (
          <div className="mc-select-empty">
            <strong>Sin ruta todavía</strong>
            <span>Elegí una sugerencia válida o marcá un punto en el mapa.</span>
          </div>
        ) : loading ? (
          <div className="mc-select-empty">
            <strong>Cargando choferes</strong>
            <span>Buscando disponibles cerca de vos.</span>
          </div>
        ) : visibleDrivers.length === 0 ? (
          <div className="mc-select-empty">
            <strong>{ellaSafetyActive ? 'Sin conductoras verificadas ahora' : 'No hay choferes ahora'}</strong>
            <span>{ellaSafetyActive ? 'Desactivá Confianza o esperá una conductora disponible.' : 'Probá otro tipo de viaje.'}</span>
          </div>
        ) : (
          <div className="mc-driver-list">
            {visibleDrivers.map((driver, index) => {
              const driverFare = getDriverFare(driver)

              return (
                <button
                  key={driver.id}
                  type="button"
                  className={`mc-driver-card ${index === 0 ? 'recommended' : ''} ${isWomenDriver(driver) ? 'ella' : ''}`}
                  onClick={() => {
                    setSelectedDriver(driver)
                    setShowDriverChooser(false)
                  }}
                  disabled={!destinationPoint}
                >
                  <div className="mc-driver-main">
                    <div className="mc-driver-avatar">
                      {driver.avatar ? (
                        <img src={driver.avatar} alt={driver.name} />
                      ) : (
                        <span>{firstName(driver.name).slice(0, 2).toUpperCase()}</span>
                      )}
                    </div>

                    <div className="mc-driver-info">
                      <div className="mc-driver-name">
                        <strong>{firstName(driver.name)}</strong>
                        {driver.verified && <CheckCircle2 size={14} />}
                        {isWomenDriver(driver) && <em>Confianza</em>}
                      </div>

                      <small>{driver.vehicle || 'Vehículo verificado'}</small>

                      <div className="mc-driver-meta">
                        <span>
                          <Star size={12} />
                          {Number(driver.rating || 5).toFixed(2)}
                        </span>

                        {driver.eta && (
                          <span>{String(driver.eta).includes('min') ? `Llega en ${driver.eta}` : driver.eta}</span>
                        )}

                        {driver.distance && <span>{driver.distance}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mc-driver-side">
                    {index === 0 && <span className="mc-best">Mejor</span>}
                    <strong>{driverFare ? formatGs(driverFare) : '---'}</strong>
                    <small>Elegir</small>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <p className="mc-select-footer">
        Verificá nombre, foto y vehículo antes de subir.
      </p>
    </section>
  </div>
)}

        

        

        {categorySheet && (
          <div className="category-mode-backdrop" onClick={() => setCategorySheet(null)}>
            <section className="category-mode-sheet" onClick={(event) => event.stopPropagation()}>
              <div className="sheet-handle" />
              <p className="eyebrow">MODO DE VIAJE</p>
              <h2>{categorySheet.title}</h2>
              <p>{categorySheet.description}</p>

              {categorySheet.bullets?.length > 0 && (
                <ul className="category-proof-list">
                  {categorySheet.bullets.map((item) => (
                    <li key={item}>
                      <ShieldCheck size={15} />
                      {item}
                    </li>
                  ))}
                </ul>
              )}

              {categorySheet.code === 'ella' && womenModeStatus === 'requested' && (
                <div className="notice-card ella-trust-note">
                  <ShieldCheck size={16} />
                  <span>Tu preferencia de confianza esta en revision.</span>
                </div>
              )}

              {categorySheet.code === 'ella' && womenModeStatus === 'verified' && (
                <div className="notice-card ella-trust-note verified">
                  <ShieldCheck size={16} />
                  <span>Preferencia verificada. Vas a poder elegir conductoras aprobadas cuando quieras mas privacidad.</span>
                </div>
              )}

              <button
                type="button"
                className="main-btn request-btn"
                onClick={categorySheet.code === 'ella' ? handleWomenModeRequest : () => handleModeSelect(categorySheet.code)}
                disabled={womenRequesting || (categorySheet.code === 'ella' && womenModeStatus === 'requested')}
              >
                {categorySheet.code === 'ella'
                  ? womenModeStatus === 'requested'
                    ? 'En revision'
                    : womenRequesting
                      ? 'Enviando...'
                      : 'Solicitar verificacion'
                  : categorySheet.cta}
                <ChevronRight size={20} />
              </button>

              <button type="button" className="login-text-btn" onClick={() => setCategorySheet(null)}>
                Cerrar
              </button>
            </section>
          </div>
        )}

        {showTripsHistory && (
          <div className="trips-history-backdrop" onClick={() => setShowTripsHistory(false)}>
            <section className="trips-history-panel" onClick={(event) => event.stopPropagation()}>
              <button
                className="panel-close trips-history-close"
                type="button"
                onClick={() => setShowTripsHistory(false)}
                aria-label="Cerrar historial"
              >
                <X size={18} />
              </button>

              <div className="trips-history-head">
                <span>MiChofer te cuida</span>
                <h2>Tus viajes</h2>
                <p>Acá guardamos tus últimos viajes en MiChofer.</p>
              </div>

              <div className="trips-history-list">
                {tripHistoryLoading ? (
                  <div className="trips-history-empty">Cargando tus viajes...</div>
                ) : tripHistory.length === 0 ? (
                  <div className="trips-history-empty">
                    Todavía no tenés viajes guardados. Cuando hagas uno, va a aparecer acá.
                  </div>
                ) : (
                  tripHistory.map((trip) => {
                    const statusCopy = {
                      completed: 'Finalizado',
                      cancelled: 'Cancelado',
                      pending: 'En curso',
                      accepted: 'En curso',
                      arriving: 'En curso',
                      in_progress: 'En curso',
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
                            {[createdAt, trip.payment_method || 'cash'].filter(Boolean).join(' · ')}
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

        <TripChatModal
          tripId={activeTrip?.id}
          open={chatOpen && canChatInRide}
          onClose={() => setChatOpen(false)}
          onUnreadCountChange={setChatUnreadCount} // This can stay, it's UI state
          currentUser={auth.user}
          trip={activeTrip}
        />

                {showMenu && (
          <div className="side-backdrop account-overlay" onClick={() => setShowMenu(false)}>
            <aside className="side-menu account-panel" onClick={(event) => event.stopPropagation()}>
             <div className="mc-account-topbar">
  <div className="mc-account-brand">
    <span />
    <strong>MiChofer ID</strong>
  </div>

  <button
    className="mc-account-close"
    type="button"
    onClick={() => setShowMenu(false)}
    aria-label="Cerrar cuenta"
  >
    <X size={18} />
  </button>
</div>

<input
  ref={avatarInputRef}
  className="register-file-input"
  type="file"
  accept="image/*"
  onChange={handleAvatarUpload}
/>

<section className="mc-account-profile">
  <button
    className="mc-account-avatar"
    type="button"
    onClick={() => setShowAvatarPreview(true)}
    disabled={avatarUploading}
    aria-label="Ver foto de perfil"
  >
    {auth.profile?.avatar_url ? <img src={auth.profile.avatar_url} alt="Perfil" /> : <UserRound size={34} />}
  </button>

  <div className="mc-account-profile-copy">
    <span>Cliente MiChofer</span>
    <h2>{auth.profile?.full_name || 'Hola'}</h2>
    <small>{accountEmail || 'Cuenta verificada'}</small>
  </div>
</section>

<button className="mc-account-edit-btn" type="button">
  <span>Editar perfil</span>
  <ChevronRight size={17} />
</button>

              <div className="account-section">
                <button
                  type="button"
                  className="account-payment-toggle"
                  onClick={() => setShowPaymentMethods((current) => !current)}
                >
                  <CreditCard size={19} />
                  <div className="account-payment-labels">
                    <span>Métodos de pago</span>
                    <small>{paymentMethod === 'cash' ? 'Efectivo' : 'Tarjeta'}</small>
                  </div>
                  <ChevronRight size={17} />
                </button>

                {showPaymentMethods && (
                  <div className="account-payment-options">
                    <button
                      type="button"
                      className={paymentMethod === 'cash' ? 'active' : ''}
                      onClick={() => setPaymentMethod('cash')}
                    >
                      <Banknote size={17} />
                      <span>Efectivo</span>
                    </button>

                    <button
                      type="button"
                      className={paymentMethod === 'card' ? 'active' : ''}
                      onClick={() => setPaymentMethod('card')}
                    >
                      <CreditCard size={17} />
                      <span>Tarjeta</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="account-section">
                <button type="button" onClick={() => { loadClientTripHistory(); setShowTripsHistory(true); }}>
                  <Clock size={19} />
                  <span>Mis viajes</span>
                  <ChevronRight size={17} />
                </button>
              </div>

              <div className="account-section">
                <button type="button" onClick={refreshLocation}>
                  <Share2 size={19} />
                  <span>Mejorar precisión</span>
                  <ChevronRight size={17} />
                </button>
              </div>

              <div className="account-section performance-card">
                <span className="account-section-label">Rendimiento</span>
                <p>Ajustamos mapa y animaciones para que MiChofer se sienta fluido en tu dispositivo.</p>
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
              </div>

              <div className="account-section account-support-section mc-account-legal-card">
  <div className="account-support-header">
    <span className="account-section-label">Ayuda y legal</span>
    <p className="account-support-subtitle">
      Soporte, políticas y seguridad de tu cuenta.
    </p>
  </div>

  <a href="/support">
    <LifeBuoy size={19} />
    <span>Ayuda y soporte</span>
    <ChevronRight size={17} />
  </a>

  <a href="/privacy">
    <ShieldCheck size={19} />
    <span>Política de privacidad</span>
    <ChevronRight size={17} />
  </a>

  <a href="/terms">
    <FileText size={19} />
    <span>Términos</span>
    <ChevronRight size={17} />
  </a>

  <div className="mc-account-logout-zone">
    <button
      className="mc-account-logout-btn"
      type="button"
      onClick={handleLogout}
    >
      <span className="mc-account-logout-icon" aria-hidden="true">
        <LogOut size={18} />
      </span>

      <span className="mc-account-logout-copy">
        <strong>Cerrar sesión</strong>
        <small>Salir de esta cuenta de forma segura</small>
      </span>

      <ChevronRight size={17} />
    </button>
  </div>
</div>
              {showAvatarPreview && (
                <div className="avatar-preview-backdrop" onClick={() => setShowAvatarPreview(false)}>
                  <section className="avatar-preview-card" onClick={(event) => event.stopPropagation()}>
                    <button
                      className="avatar-preview-close"
                      type="button"
                      onClick={() => setShowAvatarPreview(false)}
                      aria-label="Cerrar foto"
                    >
                      <X size={20} />
                    </button>

                    <div className="avatar-preview-photo">
                      {auth.profile?.avatar_url ? <img src={auth.profile.avatar_url} alt="Foto de perfil" /> : <UserRound size={64} />}
                    </div>

                    <div className="avatar-preview-copy">
                      <span>MiChofer ID</span>
                      <h3>{auth.profile?.full_name || 'Cliente MiChofer'}</h3>
                    </div>

                    <button
                      className="avatar-preview-action"
                      type="button"
                      disabled={avatarUploading}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {avatarUploading ? 'Subiendo foto...' : 'Cambiar foto'}
                    </button>
                  </section>
                </div>
              )}
            </aside>
          </div>
        )}
      </section>
    </main>
  )
}
