import { useEffect, useMemo, useRef, useState } from 'react'
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
import {
  getAvailableDrivers,
  getAvailableDriversViaLocalProxy,
  getOwnProfile,
  getProfilePreviewByEmail,
  requestTrip,
  requestWomenMode,
  supabase,
  upsertOwnProfile,
} from '../lib/supabase'
import {
  RIDE_CATEGORY_OPTIONS,
  canUseWomenMode,
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
import { geocodeAddress, loadGoogleMaps } from '../lib/googleMaps'
import { calculateFare } from '../lib/fareCalculator'

import iconRideAll from '../assets/todos.png'
import iconRideElla from '../assets/ella.png'
import iconRideMoto from '../assets/moto.png'
import iconRideComfort from '../assets/confor.png'
import iconRidePremium from '../assets/premiun.png'

const DEFAULT_CENTER = { lat: -25.5167, lng: -54.6167 }
const ACTIVE_STATUSES = ['pending', 'accepted', 'arriving', 'in_progress']
const CAR_PRICE_PER_KM = 4500
const CAR_MIN_PRICE = 12000

const RIDE_CATEGORY_ICONS = {
  all: iconRideAll,
  ella: iconRideElla,
  moto: iconRideMoto,
  comfort: iconRideComfort,
  premium: iconRidePremium,
}

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

function isNetworkFetchError(error) {
  const message = getErrorMessage(error).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('err_connection') ||
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

export default function Client() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [destination, setDestination] = useState('')
  const [destinationPoint, setDestinationPoint] = useState(null)
  const [destinationStatus, setDestinationStatus] = useState('idle')
  const [destinationFocused, setDestinationFocused] = useState(false)
  const [localPlaces, setLocalPlaces] = useState([])
  const [googlePlacePredictions, setGooglePlacePredictions] = useState([])
  const [destinationPlace, setDestinationPlace] = useState(null)
  const [googlePlacesReady, setGooglePlacesReady] = useState(false)
  const [mode, setMode] = useState('all')
  const [sort, setSort] = useState('near')
  const [drivers, setDrivers] = useState([])
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [clientLocation, setClientLocation] = useState(null)
const [locationReady, setLocationReady] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState('cash')
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
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [showAvatarPreview, setShowAvatarPreview] = useState(false)
  const [googlePlacesError, setGooglePlacesError] = useState(null)
  const avatarInputRef = useRef(null)
  const autocompleteServiceRef = useRef(null)
  const placesServiceRef = useRef(null)
  const googleMapsRef = useRef(null)
  const driversInFlightRef = useRef(false)
  const driversFailureCountRef = useRef(0)
  const driversRetryAtRef = useRef(0)

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

    return {
      moto: motoFare.totalPassengerPays,
      auto_standard: autoStandardFare.totalPassengerPays,
      ella: autoStandardFare.totalPassengerPays,
      comfort: comfortFare.totalPassengerPays,
      premium: premiumFare.totalPassengerPays,
      details: {
        distanceKm: autoStandardFare.distanceKm,
        durationMin: autoStandardFare.durationMin,
      }
    }
  }, [destinationPoint, clientLocation, routeGuidance])

  const currentFare = useMemo(() => {
    if (!fares) return null
    const catKey = mode === 'all' || mode === 'ella' ? 'auto_standard' : mode
    return fares[catKey] ?? fares['auto_standard']
  }, [fares, mode])

  const routeKm = fares?.details?.distanceKm ?? null
  const routePrice = currentFare

  const getDriverFare = (driver) => {
    if (!fares) return null
    
    // Si estamos en un modo específico (no 'all' ni 'ella'), usamos la tarifa de ese modo
    if (mode !== 'all' && mode !== 'ella') {
      return currentFare
    }
    
    // Si el modo es 'all' o 'ella', determinamos la categoría del chofer
    const approvedStr = String(driver.approved_categories || '')
    const availableStr = String(driver.available_categories || '')
    
    const approved = approvedStr.replace(/[{}"]/g, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const available = availableStr.replace(/[{}"]/g, '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

    const categories = [...approved, ...available]

    if (categories.includes('premium')) return fares.premium
    if (categories.includes('comfort')) return fares.comfort
    if (categories.includes('moto') || String(driver.vehicle_type).toLowerCase() === 'moto') return fares.moto
    return fares.auto_standard
  }


  const accountEmail = user?.email || profile?.email || localStorage.getItem('michofer_last_email') || ''
  const selectedModeMeta = useMemo(() => getRideCategoryMeta(mode), [mode])
  const womenModeStatus = getWomenModeStatus(profile)
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
    init()
  }, [])

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

    if (query.length < 2) {
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

      if (data) {
        handleTripUpdate(data)
        return
      }

      if (error || !user?.id) return

      const { data: liveTrip, error: liveError } = await supabase
        .from('trips')
        .select('*')
        .eq('client_id', user.id)
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
  }, [activeTrip?.id, user?.id])

  const visibleDrivers = useMemo(() => {
    const filtered = drivers.filter((driver) => matchesRideCategory(driver, mode))

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
    setMessage('Ese chofer ya no está disponible. Elegí otro.')
  }, [selectedDriver, visibleDrivers])

  async function init() {
    setLoading(true)

    const cachedProfile = {
      full_name: localStorage.getItem('michofer_last_name') || '',
      avatar_url: localStorage.getItem('michofer_last_photo') || '',
      role: localStorage.getItem('michofer_last_role') || 'passenger',
      email: localStorage.getItem('michofer_last_email') || '',
    }

    if (cachedProfile.full_name || cachedProfile.avatar_url || cachedProfile.email) {
      setProfile(cachedProfile)
    }

    let currentUser = null

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) console.warn('CLIENT SESSION ERROR:', sessionError)
      currentUser = sessionData?.session?.user || null
    } catch (sessionError) {
      console.warn('CLIENT SESSION FETCH ERROR:', sessionError)
    }

    setUser(currentUser)

    if (currentUser) {
      let profileData = null

      try {
        const { data, error: profileError } = await getOwnProfile()
        profileData = data

        if (profileError) {
          console.warn('CLIENT PROFILE RPC ERROR:', profileError)
        }
      } catch (profileError) {
        console.warn('CLIENT PROFILE FETCH ERROR:', profileError)
      }

      let preview = null
      const needsProfileFallback = !profileData?.full_name || !profileData?.avatar_url

      if (needsProfileFallback && currentUser.email) {
        try {
          const { data: previewData, error: previewError } = await getProfilePreviewByEmail(currentUser.email)
          if (previewError) {
            console.warn('CLIENT PROFILE PREVIEW RPC ERROR:', previewError)
          }
          preview = Array.isArray(previewData) ? previewData[0] : previewData
        } catch (previewError) {
          console.warn('CLIENT PROFILE PREVIEW FETCH ERROR:', previewError)
        }
      }

      const storedAvatarUrl =
        profileData?.avatar_url ||
        preview?.avatar_url ||
        currentUser.user_metadata?.avatar_url ||
        localStorage.getItem('michofer_last_photo') ||
        await findStoredAvatarUrl(currentUser.id)

      const nextProfile = {
        ...(profileData || {}),
        full_name:
          profileData?.full_name ||
          preview?.full_name ||
          currentUser.user_metadata?.full_name ||
          localStorage.getItem('michofer_last_name') ||
          '',
        avatar_url: storedAvatarUrl,
        role:
          profileData?.role ||
          preview?.role ||
          currentUser.user_metadata?.role ||
          localStorage.getItem('michofer_last_role') ||
          'passenger',
        email: profileData?.email || currentUser.email || localStorage.getItem('michofer_last_email') || '',
      }

      setProfile(nextProfile)

      if (nextProfile.full_name) localStorage.setItem('michofer_last_name', nextProfile.full_name)
      if (nextProfile.avatar_url) localStorage.setItem('michofer_last_photo', nextProfile.avatar_url)
      if (nextProfile.role) localStorage.setItem('michofer_last_role', nextProfile.role)
      if (nextProfile.email) localStorage.setItem('michofer_last_email', nextProfile.email)

      const role =
        nextProfile.role ||
        currentUser.user_metadata?.role ||
        localStorage.getItem('michofer_last_role') ||
        ''

      if (role === 'driver') {
        window.location.href = '/driver'
        return
      }

      await restoreActiveTrip(currentUser.id)
    }

        navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nextLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }

        setClientLocation(nextLocation)
        setLocationReady(true)
        await loadDrivers(nextLocation)
        setLoading(false)
      },
      async () => {
        setClientLocation(null)
        setLocationReady(false)
        setLoading(false)
        setMessage('Activá tu ubicación para ver choferes reales cerca de vos.')
      },
           { enableHighAccuracy: true, timeout: 9000, maximumAge: 1000 }
    )
  }

  async function handleAvatarUpload(event) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !user?.id) return

    if (!file.type.startsWith('image/')) {
      setMessage('Elegí una imagen válida para tu perfil.')
      return
    }

    try {
      setAvatarUploading(true)
      setMessage('')

      const fileExt = file.name.split('.').pop() || 'jpg'
      const filePath = `${user.id}/avatar-${Date.now()}.${fileExt}`
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
        email: user.email,
        fullName: profile?.full_name || user.user_metadata?.full_name || '',
        role: profile?.role || user.user_metadata?.role || 'passenger',
        avatarUrl,
      })

      if (profileError) {
        console.error('CLIENT PROFILE AVATAR UPDATE ERROR:', profileError)
        setMessage(`La foto subió, pero no pude actualizar tu perfil: ${profileError.message}.`)
        return
      }

      setProfile((current) => ({
        ...(current || {}),
        avatar_url: avatarUrl,
      }))
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

  async function loadDrivers(location = clientLocation) {
    if (driversInFlightRef.current) return

    const now = Date.now()
    if (now < driversRetryAtRef.current) return

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
      const nextFailures = driversFailureCountRef.current + 1
      driversFailureCountRef.current = nextFailures
      driversRetryAtRef.current = Date.now() + Math.min(45000, 2500 * nextFailures)

      if (!drivers.length && nextFailures >= 3) {
        setMessage(`No pude cargar choferes disponibles: ${getErrorMessage(error)}. Reintentando solo.`)
      }
      return
    }

    driversFailureCountRef.current = 0
    driversRetryAtRef.current = 0
    const normalized = (data || []).map((driver) => normalizeDriver(driver, location))

    setDrivers(normalized)
    if (message.includes('choferes disponibles')) setMessage('')
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (logoutError) {
      console.warn('CLIENT LOGOUT ERROR:', logoutError)
    } finally {
      setUser(null)
      setProfile(null)
      window.location.href = '/login'
    }
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

  async function handleTripUpdate(nextTrip) {
    if (!nextTrip?.id) return

    if (nextTrip.status === 'cancelled' || nextTrip.status === 'completed') {
      clearLiveTrip(nextTrip.status === 'completed' ? 'Viaje finalizado. Ya podés pedir otro.' : 'Viaje cancelado.')
      return
    }

    setActiveTrip(nextTrip)

    if (Number.isFinite(Number(nextTrip.destination_lat)) && Number.isFinite(Number(nextTrip.destination_lng))) {
      setDestinationPoint({
        lat: Number(nextTrip.destination_lat),
        lng: Number(nextTrip.destination_lng),
      })
      if (nextTrip.destination_text) setDestination(nextTrip.destination_text)
    }

    let driver = activeTripDriver

    if (!driver && nextTrip.driver_id) {
      driver = await loadActiveTripDriver(nextTrip.driver_id)
    }

    if (Number.isFinite(Number(nextTrip.driver_lat)) && Number.isFinite(Number(nextTrip.driver_lng))) {
      setActiveTripDriver((current) => ({
  ...(current || driver || {}),
  lat: Number(nextTrip.driver_lat),
  lng: Number(nextTrip.driver_lng),
  heading: Number.isFinite(Number(nextTrip.driver_heading)) ? Number(nextTrip.driver_heading) : current?.heading ?? null,
  speed: Number.isFinite(Number(nextTrip.driver_speed)) ? Number(nextTrip.driver_speed) : current?.speed ?? null,
  accuracy: Number.isFinite(Number(nextTrip.driver_accuracy)) ? Number(nextTrip.driver_accuracy) : current?.accuracy ?? null,
}))
    }
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
      setMessage('Todavía no hay datos suficientes para confirmar ese destino.')
      return
    }

    if (!selectedDriver) {
      setMessage('Elegí un chofer disponible.')
      return
    }

    if (!routePrice) {
      setMessage('No pude calcular el precio todavía. Ajustá el destino y probá de nuevo.')
      return
    }

    setRequesting(true)
    setMessage('')

    const destinationTextFinal = destinationPlace?.formatted_address || destinationPlace?.name || destination

    console.log('[MiChofer Route] origin:', clientLocation)
    console.log('[MiChofer Route] destination:', destinationPoint, destinationTextFinal)

    const { data, error } = await requestTrip({
      driverId: selectedDriver.user_id,
      destinationText: destinationTextFinal,
      destinationLat: destinationPoint.lat,
      destinationLng: destinationPoint.lng,
      pickupLat: clientLocation.lat,
      pickupLng: clientLocation.lng,
      driverLat: selectedDriver.lat,
      driverLng: selectedDriver.lng,
      routeKm,
      price: routePrice,
      paymentMethod,
      womenMode: mode === 'ella',
      rideCategory: getRideCategoryDbCode(mode),
    })
    setRequesting(false)

    if (error) {
      setMessage('No se pudo crear el viaje. Revisá permisos o la tabla trips.')
      return
    }

    setActiveTrip(data)
    setActiveTripDriver(selectedDriver)
  }

  function handleModeSelect(nextMode) {
    if (nextMode === 'ella' && !canUseWomenMode(profile)) {
      setCategorySheet(getRideCategoryMeta('ella'))
      return
    }

    setMode(nextMode)
    setSelectedDriver(null)
    setMessage('')
  }

  async function handleWomenModeRequest() {
    if (!user) {
      window.location.href = '/login'
      return
    }

    if (canUseWomenMode(profile)) {
      setMode('ella')
      setSelectedDriver(null)
      setCategorySheet(null)
      return
    }

    try {
      setWomenRequesting(true)
      const { data, error } = await requestWomenMode('woman')

      if (error) throw error

      setProfile((current) => ({
        ...(current || {}),
        ...(data || {}),
        women_mode_requested: true,
        women_mode_status: data?.women_mode_status || 'requested',
      }))
      setCategorySheet(null)
      setMessage('Solicitud enviada. MiChofer Ella se activa cuando admin verifica tu perfil.')
    } catch (error) {
      console.error('WOMEN MODE REQUEST ERROR:', error)
      setMessage('No pude solicitar MiChofer Ella. Revisa que hayas corrido la migracion nueva en Supabase.')
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

async function cancelActiveTrip() {
  if (!activeTrip?.id || !user?.id) return

  if (activeTrip.client_id !== user.id) {
    setMessage('No podés cancelar un viaje que no pertenece a tu cuenta.')
    return
  }

  const { error } = await supabase
    .from('trips')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', activeTrip.id)
    .eq('client_id', user.id)

  if (error) {
    setMessage('No pude cancelar el viaje.')
    return
  }

  clearLiveTrip('Viaje cancelado. Podés elegir otro chofer.')
}

    async function refreshLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const nextLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
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
    if (
      !activeTripDriver ||
      !Number.isFinite(Number(activeTripDriver.lat)) ||
      !Number.isFinite(Number(activeTripDriver.lng))
    ) {
      return null
    }

    return {
  ...activeTripDriver,
  lat: Number(activeTripDriver.lat),
  lng: Number(activeTripDriver.lng),
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
}
   }, [
    activeTrip?.driver_heading,
    activeTrip?.driver_speed,
    activeTrip?.driver_accuracy,
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
    if (!activeTripAcceptedByDriver) return destinationPoint
    return activeTripWaitingForPickup && locationReady ? clientLocation : destinationPoint
  }, [
    activeTripAcceptedByDriver,
    activeTripWaitingForPickup,
    locationReady,
    clientLocation?.lat,
    clientLocation?.lng,
    destinationPoint?.lat,
    destinationPoint?.lng,
  ])

  const mapAvatar = shouldTrackDriverOnMap ? liveDriverPoint?.avatar : profile?.avatar_url

  const mapDrivers = useMemo(() => {
    return activeTrip ? [] : visibleDrivers
  }, [Boolean(activeTrip), visibleDrivers])

  const mapSelectedDriver = activeTrip ? null : selectedDriver

  return (
    <main className="app-shell">
      <section className={`${mode === 'ella' ? 'phone client-phone women-client-mode' : 'phone client-phone'} client-premium`}>
        <header className="client-top premium-map-header">
          <section className="map-search-bar" aria-label="Elegir destino">
            <MapPin className="map-search-icon" size={18} />

            <div className="map-search-copy">
              <label htmlFor="destination">Destino</label>
              <input
                id="destination"
                value={destination}
                onChange={(event) => {
  setDestination(event.target.value)
  setSelectedDriver(null)
  setGooglePlacePredictions([])
  setDestinationPlace(null)
  setDestinationPoint(null)
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
              className="avatar-button header-avatar"
              type="button"
              onClick={() => setShowMenu(true)}
              aria-label="Abrir cuenta"
            >
              {profile?.avatar_url ? <img src={profile.avatar_url} alt="Perfil" /> : <UserRound size={20} />}
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
            className={`michofer-live-sheet ${liveSheetExpanded ? 'is-expanded' : 'is-minimized'} status-${activeTrip.status || 'pending'}`}
            aria-label="Estado del viaje"
          >
            <button
              type="button"
              className="michofer-live-handle-button"
              onClick={() => setLiveSheetExpanded((current) => !current)}
              aria-label={liveSheetExpanded ? 'Minimizar detalles del viaje' : 'Ver detalles del viaje'}
            >
              <span />
            </button>

            <div className="michofer-live-progress" aria-hidden="true">
              <span style={{ width: rideProgressWidth }} />
            </div>

            {!liveSheetExpanded ? (
              <div className="michofer-live-compact">
                <div className="michofer-live-compact-avatar">
                  {activeTripDriver.avatar ? (
                    <img src={activeTripDriver.avatar} alt={activeTripDriver.name} />
                  ) : (
                    <span>{firstName(activeTripDriver.name).slice(0, 2).toUpperCase()}</span>
                  )}

                  <em aria-hidden="true">
                    <CheckCircle2 size={12} />
                  </em>
                </div>

                <div className="michofer-live-compact-copy">
                  <span>{rideUi.badge}</span>
                  <strong>{rideUi.title}</strong>
                  <small>{activeTrip.status === 'in_progress' ? 'Viaje en curso' : `${firstName(activeTripDriver.name)} viene hacia vos`}</small>
                </div>

                <button type="button" className="michofer-live-expand-action" onClick={() => setLiveSheetExpanded(true)}>
                  Detalles
                  <ChevronRight size={17} />
                </button>
              </div>
            ) : (
              <>
                <div className="michofer-live-main">
                  <div className="michofer-live-avatar">
                    {activeTripDriver.avatar ? (
                      <img src={activeTripDriver.avatar} alt={activeTripDriver.name} />
                    ) : (
                      <span>{firstName(activeTripDriver.name).slice(0, 2).toUpperCase()}</span>
                    )}

                    <em aria-hidden="true">
                      <CheckCircle2 size={13} />
                    </em>
                  </div>

                  <div className="michofer-live-copy">
                    <span className="michofer-live-pill">{rideUi.badge}</span>
                    <h2>{rideUi.title}</h2>
                    <p>{rideUi.subtitle}</p>
                  </div>
                </div>

                <div className="michofer-live-driver-card">
                  <div className="michofer-plate-box">
                    <span>Chapa</span>
                    <strong>{driverPlateText}</strong>
                  </div>

                  <div className="michofer-vehicle-box">
                    <span>Vehículo</span>
                    <strong>{driverVehicleText}</strong>
                  </div>

                  <div className="michofer-driver-box">
                    <span>Chofer</span>
                    <strong>{firstName(activeTripDriver.name)}</strong>
                  </div>
                </div>

                <div className="michofer-live-pickup-card">
                  <MapPin size={18} />
                  <div>
                    <span>Recogida</span>
                    <strong>{pickupPointText}</strong>
                  </div>
                </div>

                <div className="michofer-live-actions">
                  <a
                    className={canChatInRide ? 'michofer-chat-action' : 'michofer-chat-action disabled'}
                    href={canChatInRide ? `/chat?trip=${activeTrip.id}` : '#'}
                    onClick={(event) => {
                      if (!canChatInRide) {
                        event.preventDefault()
                        setMessage('El chat se activa cuando el chofer acepta tu solicitud.')
                      }
                    }}
                  >
                    <MessageCircle size={18} />
                    {canChatInRide ? 'Chatear' : 'Chat al aceptar'}
                  </a>

                  <button type="button" className="michofer-cancel-action" onClick={cancelActiveTrip}>
                    <X size={18} />
                    Cancelar
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
    destinationText={destination}
    clientAvatar={mapAvatar}
    drivers={mapDrivers}
    selectedDriver={mapSelectedDriver}
    onSelectDriver={setSelectedDriver}
    onChooseDriver={() => setShowDriverChooser(true)}
    onRefreshLocation={refreshLocation}
    onRouteUpdate={setRouteGuidance}
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
              <strong>{canOpenDrivers ? 'Ver opciones disponibles' : 'Elegí destino'}</strong>
              <ChevronRight size={20} />
            </button>
          </section>
        )}

        {!routeGuidance && !fares && !showMenu && !showDriverChooser && !selectedDriver && !activeTrip && !showDestinationSuggestions && (
          <div className="client-bottom-start-card client-empty-start-card" aria-label="Elegir chofer">
            <button
              type="button"
              className="client-start-ride-btn"
              onClick={() => setShowDriverChooser(true)}
              disabled={!canOpenDrivers}
            >
              <span>{canOpenDrivers ? 'MiChofer disponible' : 'Elegí destino'}</span>
              <strong>{canOpenDrivers ? 'Ver choferes cerca' : 'Buscar chofer'}</strong>
            </button>
          </div>
        )}

        {selectedDriver && !activeTrip && !showDriverChooser && (
          <article className="selected-map-card driver-confirm-card">
            <button
              className="driver-confirm-close"
              type="button"
              onClick={() => setSelectedDriver(null)}
              aria-label="Cerrar perfil del chofer"
            >
              <X size={15} />
            </button>

            <div className="driver-confirm-main">
              <div className="driver-confirm-avatar">
                {selectedDriver.avatar ? (
                  <img src={selectedDriver.avatar} alt={selectedDriver.name} />
                ) : (
                  <span>{firstName(selectedDriver.name).slice(0, 2).toUpperCase()}</span>
                )}
              </div>

              <div className="driver-confirm-copy">
                <span>Chofer seleccionado</span>
                <strong>{selectedDriver.name}</strong>
                {selectedDriver.vehicle && <small>{selectedDriver.vehicle}</small>}
              </div>
            </div>

            <div className="driver-confirm-metrics">
              <span>
                <Star size={12} /> {Number(selectedDriver.rating || 5).toFixed(2)}
              </span>
              {selectedDriver.eta && <span>{selectedDriver.eta}</span>}
              {selectedDriver.distance && <span>{selectedDriver.distance}</span>}
            </div>

            <div className="driver-confirm-bottom">
              <button type="button" className="driver-change-btn" onClick={() => setShowDriverChooser(true)}>
                Cambiar
              </button>

              <button
                type="button"
                className="driver-request-btn"
                onClick={requestRide}
                disabled={requesting || !destinationPoint}
              >
                {requesting ? 'Solicitando...' : currentFare ? `Solicitar · ${formatGs(currentFare)}` : 'Solicitar'}
              </button>
            </div>
          </article>
        )}

       {showDriverChooser && (
          <div className="driver-panel-backdrop driver-picker-backdrop" onClick={() => setShowDriverChooser(false)}>
            <section className="client-sheet floating-driver-panel driver-picker-sheet driver-picker-pro" onClick={(event) => event.stopPropagation()}>
              <div className="sheet-handle" />

                            <header className="driver-picker-pro-header driver-picker-focus-header">
                <div>
                  <p className="eyebrow">CHOFERES CERCA</p>
                  <h1>Elegí chofer</h1>
                  <span>
                    {destinationPoint
                      ? `${visibleDrivers.length} cerca`
                      : 'Elegí un destino'}
                  </span>
                </div>

                <button className="panel-close" type="button" onClick={() => setShowDriverChooser(false)} aria-label="Cerrar">
                  <X size={17} />
                </button>
              </header>

              <section className="driver-picker-pro-trip driver-picker-focus-trip" aria-label="Resumen del viaje">
                <div>
                  <span>Viaje</span>
                  <strong>
                    {fares?.details?.distanceKm != null ? `${fares.details.distanceKm.toFixed(1)} km` : '---'}
                    {' · '}
                    {fares?.details?.durationMin != null ? `${Math.ceil(fares.details.durationMin)} min` : '---'}
                  </strong>
                </div>

                <div>
                  <span>Desde</span>
                  <strong>{currentFare ? formatGs(currentFare) : '---'}</strong>
                </div>
              </section>

              <div className="driver-picker-pro-modes driver-picker-mode-cards driver-picker-focus-modes" aria-label="Tipo de viaje">
                {RIDE_CATEGORY_OPTIONS.map((category) => {
                  const categoryFareKey =
                    category.code === 'all'
                      ? 'auto_standard'
                      : category.code === 'ella'
                        ? 'ella'
                        : category.code

                  const categoryFare = fares?.[categoryFareKey]

                  const modeCopy = {
                    all: {
                      title: 'Todos',
                      label: 'Todas las opciones',
                    },
                    ella: {
                      title: 'Ella',
                      label: 'Chofer mujer',
                    },
                    moto: {
                      title: 'Moto',
                      label: 'Viaje en moto',
                    },
                    comfort: {
                      title: 'Comfort',
                      label: 'Más comodidad',
                    },
                    premium: {
                      title: 'Premium',
                      label: 'Alta gama',
                    },
                  }

                  const copy = modeCopy[category.code] || {
                    title: category.shortLabel,
                    label: 'Disponible',
                  }

                  const categoryIcon = RIDE_CATEGORY_ICONS[category.code] || RIDE_CATEGORY_ICONS.all
                  const fareText = categoryFare ? ` · ${formatGs(categoryFare)}` : ''

                  return (
                    <button
                      key={category.code}
                      type="button"
                      className={`ride-mode-pill ${mode === category.code ? 'active' : ''} ${category.code}`}
                      onClick={() => handleModeSelect(category.code)}
                      aria-label={`${copy.label}${fareText}`}
                      title={`${copy.label}${fareText}`}
                    >
                      <span className="mode-card-icon" aria-hidden="true">
                        <img src={categoryIcon} alt="" />
                      </span>

                      <span className="mode-card-copy">
                        <strong>{copy.title}</strong>
                      </span>
                    </button>
                  )
                })}
              </div>

              {mode !== 'all' && (
                <div className={`driver-picker-pro-mode-note ${mode}`}>
                  <ShieldCheck size={15} />
                  <span>
                    <strong>{selectedModeMeta.title}</strong>
                    {selectedModeMeta.description}
                  </span>
                </div>
              )}

              {message && <div className="notice-card driver-picker-notice">{message}</div>}

              <div className="driver-picker-scroll driver-picker-pro-scroll">
                {!hasDestination ? (
                  <div className="driver-picker-empty driver-picker-pro-empty">
                    <strong>Elegí un destino</strong>
                    <span>Después vas a ver choferes cercanos.</span>
                  </div>
                ) : destinationStatus === 'searching' ? (
                  <div className="driver-picker-empty driver-picker-pro-empty">
                    <strong>Buscando destino</strong>
                    <span>Estamos calculando la ruta.</span>
                  </div>
                ) : !destinationPoint ? (
                  <div className="driver-picker-empty driver-picker-pro-empty">
                    <strong>Sin ruta todavía</strong>
                    <span>Elegí una sugerencia válida.</span>
                  </div>
                ) : loading ? (
                  <div className="driver-picker-empty driver-picker-pro-empty">
                    <strong>Cargando choferes</strong>
                    <span>Buscando disponibles cerca.</span>
                  </div>
                ) : visibleDrivers.length === 0 ? (
                  <div className="driver-picker-empty driver-picker-pro-empty">
                    <strong>No hay choferes ahora</strong>
                    <span>Probá otro modo de viaje.</span>
                  </div>
                ) : (
                  <div className="driver-picker-pro-list">
                    {visibleDrivers.map((driver) => {
                      const driverFare = getDriverFare(driver)

                      return (
                        <button
                          key={driver.id}
                          type="button"
                          className="driver-picker-pro-card"
                          onClick={() => {
                            setSelectedDriver(driver)
                            setShowDriverChooser(false)
                          }}
                          disabled={!destinationPoint}
                        >
                          <div className="driver-picker-pro-avatar">
                            {driver.avatar ? (
                              <img src={driver.avatar} alt={driver.name} />
                            ) : (
                              <span>{firstName(driver.name).slice(0, 2).toUpperCase()}</span>
                            )}
                          </div>

                          <div className="driver-picker-pro-info">
                            <div className="driver-picker-pro-name">
                              <strong>{firstName(driver.name)}</strong>
                              {driver.verified && <CheckCircle2 size={14} />}
                              {isWomenDriver(driver) && <em>Ella</em>}
                            </div>

                            {driver.vehicle && <small>{driver.vehicle}</small>}

                            <div className="driver-picker-pro-meta">
                              <span>
                                <Star size={12} /> {Number(driver.rating || 5).toFixed(2)}
                              </span>
                              {driver.eta && <span>{driver.eta}</span>}
                              {driver.distance && <span>{driver.distance}</span>}
                            </div>
                          </div>

                          <div className="driver-picker-pro-action">
                            <strong>{driverFare ? formatGs(driverFare) : '---'}</strong>
                            <span>Elegir</span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
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
                <div className="notice-card">Tu solicitud de MiChofer Ella esta en revision.</div>
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

                {showMenu && (
          <div className="side-backdrop account-overlay" onClick={() => setShowMenu(false)}>
            <aside className="side-menu account-panel" onClick={(event) => event.stopPropagation()}>
              <button
                className="account-close-top"
                type="button"
                onClick={() => setShowMenu(false)}
                aria-label="Cerrar cuenta"
              >
                <X size={20} />
              </button>

              <div className="account-system-mark">
                <span />
                <strong>MICHOFER ID</strong>
              </div>

              <input
                ref={avatarInputRef}
                className="register-file-input"
                type="file"
                accept="image/*"
                onChange={handleAvatarUpload}
              />

              <div className="side-head account-hero">
                <button
                  className="avatar-large account-avatar account-avatar-large account-avatar-action"
                  type="button"
                  onClick={() => setShowAvatarPreview(true)}
                  disabled={avatarUploading}
                  aria-label="Ver foto de perfil"
                >
                  {profile?.avatar_url ? <img src={profile.avatar_url} alt="Perfil" /> : <UserRound size={30} />}
                </button>

                <div className="account-copy">
                  <span className="account-kicker">Cliente MiChofer</span>
                  <h2>{profile?.full_name || 'Hola'}</h2>
                  <p>{avatarUploading ? 'Subiendo foto...' : accountEmail || 'Cuenta MiChofer'}</p>
                </div>
              </div>

              <div className="google-account-head">
                <p>{accountEmail || 'Cuenta MiChofer'}</p>

                <button
                  className="google-account-avatar account-avatar-action"
                  type="button"
                  onClick={() => setShowAvatarPreview(true)}
                  disabled={avatarUploading}
                  aria-label="Ver foto de perfil"
                >
                  {profile?.avatar_url ? <img src={profile.avatar_url} alt="Perfil" /> : <UserRound size={38} />}
                </button>

                <h2>¡Hola, {profile?.full_name?.split(' ')[0] || 'cliente'}!</h2>
              </div>

              <button className="account-main-action" type="button">
                Gestionar cuenta MiChofer
                <ChevronRight size={18} />
              </button>

              <div className="account-section">
                <a href="/client">
                  <UserRound size={19} />
                  <span>Mi cuenta</span>
                  <ChevronRight size={17} />
                </a>

                <a href="/viajes">
                  <MapPin size={19} />
                  <span>Mis viajes</span>
                  <ChevronRight size={17} />
                </a>

                <a href="/chat">
                  <MessageCircle size={19} />
                  <span>Mensajes</span>
                  <ChevronRight size={17} />
                </a>
              </div>

              <div className="account-section">
                <button type="button" onClick={() => setPaymentMethod('cash')}>
                  <Banknote size={19} />
                  <span>Efectivo {paymentMethod === 'cash' ? 'actual' : ''}</span>
                  <ChevronRight size={17} />
                </button>

                <button type="button" onClick={() => setPaymentMethod('card')}>
                  <CreditCard size={19} />
                  <span>Tarjeta {paymentMethod === 'card' ? 'actual' : ''}</span>
                  <ChevronRight size={17} />
                </button>

                <button type="button">
                  <Banknote size={19} />
                  <span>Bancos y transferencias</span>
                  <ChevronRight size={17} />
                </button>
              </div>

              <div className="account-section">
                <button type="button" onClick={refreshLocation}>
                  <Share2 size={19} />
                  <span>Compartir ubicación</span>
                  <ChevronRight size={17} />
                </button>

                <button type="button">
                  <HelpCircle size={19} />
                  <span>Ayuda y soporte</span>
                  <ChevronRight size={17} />
                </button>
              </div>

              <button
                className="account-logout"
                type="button"
                onClick={handleLogout}
              >
                Cerrar sesión
              </button>
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
                      {profile?.avatar_url ? <img src={profile.avatar_url} alt="Foto de perfil" /> : <UserRound size={64} />}
                    </div>

                    <div className="avatar-preview-copy">
                      <span>MiChofer ID</span>
                      <h3>{profile?.full_name || 'Cliente MiChofer'}</h3>
                      <p>{accountEmail || 'Cuenta MiChofer'}</p>
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
