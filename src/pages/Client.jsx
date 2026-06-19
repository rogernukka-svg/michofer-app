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

const DEFAULT_CENTER = { lat: -25.5167, lng: -54.6167 }
const ACTIVE_STATUSES = ['pending', 'accepted', 'arriving', 'in_progress']
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''
const CAR_PRICE_PER_KM = 4500
const CAR_MIN_PRICE = 12000

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

function statusCopy(status, driverName) {
  const name = firstName(driverName)
  if (status === 'accepted') return [`${name} aceptó tu viaje`, 'Chofer en camino']
  if (status === 'arriving') return [`${name} llegó al punto`, 'Listo para iniciar']
  if (status === 'in_progress') return ['Viaje en curso', 'Seguimos tu recorrido']
  return [`Esperando respuesta de ${name}`, 'Solicitud enviada']
}

export default function Client() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [destination, setDestination] = useState('')
  const [destinationPoint, setDestinationPoint] = useState(null)
  const [destinationStatus, setDestinationStatus] = useState('idle')
  const [destinationFocused, setDestinationFocused] = useState(false)
  const [localPlaces, setLocalPlaces] = useState([])
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
  const [categorySheet, setCategorySheet] = useState(null)
  const [womenRequesting, setWomenRequesting] = useState(false)
  const [activeTrip, setActiveTrip] = useState(null)
  const [activeTripDriver, setActiveTripDriver] = useState(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [showAvatarPreview, setShowAvatarPreview] = useState(false)
  const avatarInputRef = useRef(null)
  const driversInFlightRef = useRef(false)
  const driversFailureCountRef = useRef(0)
  const driversRetryAtRef = useRef(0)

  const hasDestination = Boolean(destination.trim())
  const canOpenDrivers = Boolean(destinationPoint)
  const routeKm = useMemo(
    () => (destinationPoint ? distanceKm(clientLocation, destinationPoint) : null),
    [clientLocation, destinationPoint]
  )
  const routePrice = useMemo(() => estimatePrice(routeKm), [routeKm])
  const accountEmail = user?.email || profile?.email || localStorage.getItem('michofer_last_email') || ''
  const selectedModeMeta = useMemo(() => getRideCategoryMeta(mode), [mode])
  const womenModeStatus = getWomenModeStatus(profile)
  const destinationSuggestions = useMemo(
    () => searchLocalPlaces(destination, localPlaces, 6),
    [destination, localPlaces]
  )
  const bestLocalSuggestion = destinationSuggestions[0] || null
  const showDestinationSuggestions = !activeTrip && destinationFocused && destination.trim().length > 0 && destinationSuggestions.length > 0

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
    const query = destination.trim()
    const suggestedQuery = bestLocalSuggestion ? getPlaceSearchText(bestLocalSuggestion) : query

    if (query.length < 2) {
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
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(suggestedQuery)}.json?limit=1&language=es&country=py&proximity=${proximity}&access_token=${MAPBOX_TOKEN}`,
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
    }, bestLocalSuggestion ? 250 : 450)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [bestLocalSuggestion, clientLocation, destination])

  useEffect(() => {
    let refreshTimeout = 0
    const channel = supabase
      .channel('client-drivers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_profiles' }, () => {
        window.clearTimeout(refreshTimeout)
        refreshTimeout = window.setTimeout(() => loadDrivers(clientLocation), 450)
      })
      .subscribe()

    const interval = window.setInterval(() => loadDrivers(clientLocation), 15000)

    return () => {
      window.clearTimeout(refreshTimeout)
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
    }, 3000)

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

    const { data, error } = await requestTrip({
      driverId: selectedDriver.user_id,
      destinationText: destination,
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

  function chooseDestinationSuggestion(place) {
    const title = getPlaceTitle(place)

    setDestination(title)
    setDestinationFocused(false)
    setSelectedDriver(null)
    setMessage('')

    if (Number.isFinite(place?.lat) && Number.isFinite(place?.lng)) {
      setDestinationPoint({ lat: place.lat, lng: place.lng })
      setDestinationStatus('ready')
    } else {
      setDestinationStatus('searching')
    }
  }

  async function cancelActiveTrip() {
    if (!activeTrip?.id) return

    await supabase
      .from('trips')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', activeTrip.id)

    clearLiveTrip('Viaje cancelado. Podés elegir otro chofer.')
  }

  async function refreshLocation() {
    navigator.geolocation.getCurrentPosition((pos) => {
      const nextLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude }
      setClientLocation(nextLocation)
      loadDrivers(nextLocation)
    })
  }

  const [statusTitle, statusSub] = statusCopy(activeTrip?.status, activeTripDriver?.name || selectedDriver?.name)
  const liveDriverPoint = activeTripDriver &&
    Number.isFinite(Number(activeTripDriver.lat)) &&
    Number.isFinite(Number(activeTripDriver.lng))
    ? { ...activeTripDriver, lat: Number(activeTripDriver.lat), lng: Number(activeTripDriver.lng) }
    : null
  const activeTripWaitingForPickup = activeTrip && activeTrip.status !== 'in_progress'
  const mapOrigin = activeTrip && liveDriverPoint ? liveDriverPoint : clientLocation
  const mapDestination = activeTrip
    ? activeTripWaitingForPickup
      ? clientLocation
      : destinationPoint
    : destinationPoint
  const mapAvatar = activeTrip && liveDriverPoint ? liveDriverPoint.avatar : profile?.avatar_url
  const mapDrivers = activeTrip ? [] : visibleDrivers
  const mapSelectedDriver = activeTrip ? null : selectedDriver

  return (
    <main className="app-shell">
      <section className={mode === 'ella' ? 'phone client-phone women-client-mode' : 'phone client-phone'}>
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
                  setSelectedDriver(null)
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
              {destinationSuggestions.map((place) => (
                <button
                  key={`${place.id}-${place.alias}`}
                  type="button"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseDestinationSuggestion(place)}
                >
                  <MapPin size={15} />
                  <span>
                    <strong>{getPlaceTitle(place)}</strong>
                    <small>{getPlaceSubtitle(place)}</small>
                  </span>
                </button>
              ))}
            </section>
          )}
        </header>

        {activeTrip && activeTripDriver && (
          <section className="active-trip-card">
            <div>
              <span>{statusSub}</span>
              <h2>{statusTitle}</h2>
            </div>

            <div className="active-trip-driver">
              {activeTripDriver.avatar ? (
                <img src={activeTripDriver.avatar} alt={activeTripDriver.name} />
              ) : (
                <div className="driver-avatar-fallback">{firstName(activeTripDriver.name).slice(0, 2).toUpperCase()}</div>
              )}
              <strong>{firstName(activeTripDriver.name)}</strong>
            </div>

            <a className="active-trip-chat" href={`/chat?trip=${activeTrip.id}`} aria-label="Abrir chat">
              <MessageCircle size={18} />
            </a>

            <button className="active-trip-cancel" type="button" onClick={cancelActiveTrip} aria-label="Cancelar viaje">
              <X size={18} />
            </button>
          </section>
        )}

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
          showRouteSummary={false}
        />

        {activeTrip && activeTripDriver && (
          <section className="active-trip-actions" aria-label="Acciones del viaje">
            <a href={`/chat?trip=${activeTrip.id}`}>
              <MessageCircle size={18} />
              Chat
            </a>

            <button type="button" onClick={cancelActiveTrip}>
              <X size={18} />
              Cancelar viaje
            </button>
          </section>
        )}

        {!showMenu && !showDriverChooser && !selectedDriver && !activeTrip && (
          <div className="client-bottom-quickbar" aria-label="Acciones rápidas del cliente">
            <div className="ride-category-strip">
              {RIDE_CATEGORY_OPTIONS.map((category) => (
                <button
                  key={category.code}
                  type="button"
                  className={mode === category.code ? `active ${category.code}` : category.code}
                  onClick={() => handleModeSelect(category.code)}
                >
                  {category.shortLabel}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="primary-destination-chip"
              onClick={() => setShowDriverChooser(true)}
              disabled={!canOpenDrivers}
            >
              {canOpenDrivers ? `${visibleDrivers.length} choferes cerca` : 'Elegí destino'}
            </button>
          </div>
        )}

        {selectedDriver && !activeTrip && (
          <article className="selected-map-card driver-map-profile">
            <button
              className="driver-profile-close"
              type="button"
              onClick={() => setSelectedDriver(null)}
              aria-label="Cerrar perfil del chofer"
            >
              <X size={15} />
            </button>

            <div className="driver-map-profile-head">
              <div className="driver-map-profile-avatar">
                {selectedDriver.avatar ? (
                  <img src={selectedDriver.avatar} alt={selectedDriver.name} />
                ) : (
                  <span>{firstName(selectedDriver.name).slice(0, 2).toUpperCase()}</span>
                )}
              </div>

              <div>
                <span>Perfil del chofer</span>
                <strong>{selectedDriver.name}</strong>
                {selectedDriver.vehicle && <small>{selectedDriver.vehicle}</small>}
              </div>
            </div>

            <div className="driver-map-profile-metrics">
              <small>
                <Star size={13} /> {Number(selectedDriver.rating || 5).toFixed(2)}
              </small>
              {selectedDriver.distance && <small>{selectedDriver.distance}</small>}
              {selectedDriver.eta && <small>{selectedDriver.eta}</small>}
              {routeKm && <small>{routeKm.toFixed(1)} km ruta</small>}
            </div>

            <div className="driver-map-profile-actions">
              <button type="button" className="ghost-profile-btn" onClick={() => setShowDriverChooser(true)}>
                Ver opciones
              </button>

              <button type="button" onClick={requestRide} disabled={requesting || !destinationPoint}>
                {requesting ? 'Solicitando...' : routePrice ? formatGs(routePrice) : 'Solicitar'}
              </button>
            </div>
          </article>
        )}

        {showDriverChooser && (
          <div className="driver-panel-backdrop" onClick={() => setShowDriverChooser(false)}>
            <section className="client-sheet floating-driver-panel" onClick={(event) => event.stopPropagation()}>
              <div className="sheet-handle" />

              <div className="sheet-heading">
                <div>
                  <p className="eyebrow">CHOFERES DISPONIBLES CERCA</p>
                  <h1>Elegí tu chofer</h1>
                  <p>Vos decidís con quién viajar.</p>
                </div>

                <span>{destinationPoint ? `${visibleDrivers.length} online` : 'Sin destino'}</span>

                <button className="panel-close" type="button" onClick={() => setShowDriverChooser(false)} aria-label="Cerrar">
                  <X size={18} />
                </button>
              </div>

              <div className="filters-row">
                {RIDE_CATEGORY_OPTIONS.map((category) => (
                  <button
                    key={category.code}
                    className={mode === category.code ? `active ${category.code}` : category.code}
                    onClick={() => handleModeSelect(category.code)}
                  >
                    {category.shortLabel}
                  </button>
                ))}

                <button className={sort === 'rating' ? 'active icon-text' : 'icon-text'} onClick={() => setSort('rating')}>
                  <SlidersHorizontal size={16} />
                  Mejor calificados
                </button>

                <button className={sort === 'near' ? 'active icon-text' : 'icon-text'} onClick={() => setSort('near')}>
                  <MapPin size={16} />
                  Más cerca
                </button>
              </div>

              {mode !== 'all' && (
                <div className="safety-message">
                  <ShieldCheck size={17} />
                  <span>
                    <strong>{selectedModeMeta.title}</strong>
                    {selectedModeMeta.description}
                  </span>
                </div>
              )}

              {message && <div className="notice-card">{message}</div>}

              {!hasDestination ? (
                <div className="empty-state">Elegí un destino para ver la ruta y los choferes disponibles.</div>
              ) : destinationStatus === 'searching' ? (
                <div className="empty-state">Buscando destino...</div>
              ) : !destinationPoint ? (
                <div className="empty-state">Todavía no hay datos suficientes para mostrar una ruta real a ese destino.</div>
              ) : loading ? (
                <div className="empty-state">Cargando choferes verificados...</div>
              ) : visibleDrivers.length === 0 ? (
                <div className="empty-state">
                  {mode === 'ella'
                    ? 'No hay conductoras verificadas para MiChofer Ella cerca en este momento. Podes volver a Todos.'
                    : 'No hay choferes disponibles ahora. Probá otro filtro.'}
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
                          {isWomenDriver(driver) && <em>Ella</em>}
                        </div>

                        {driver.vehicle && <span>{driver.vehicle}</span>}

                        <div className="driver-meta">
                          {driver.rating != null && (
                            <small>
                              <Star size={13} /> {Number(driver.rating).toFixed(2)}
                            </small>
                          )}
                          {driver.distance && <small>{driver.distance}</small>}
                          {driver.eta && <small>{driver.eta}</small>}
                        </div>
                      </div>

                      <div className="driver-side">
                        {routePrice && <div className="driver-price">{formatGs(routePrice)}</div>}

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
                  <a className="main-btn compact" href={`/chat?trip=${activeTrip.id}`}>
                    <MessageCircle size={18} /> Chat
                  </a>

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
                      : 'Elegí un chofer'}
                  <ChevronRight size={20} />
                </button>
              )}
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
