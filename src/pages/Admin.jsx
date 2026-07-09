//Admin.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  FileText,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  UserCheck,
  X,
  XCircle,
} from 'lucide-react'
import InteractiveRouteMap from '../components/InteractiveRouteMap'
import { computeRouteWithRoutesApi } from '../lib/googleMaps'
import {
  adminCreateTestTrip,
  adminReviewDriverCategory,
  adminReviewWomenMode,
  adminUpdateTestTripLocation,
  adminUpdateTestTripStatus,
  supabase,
} from '../lib/supabase'
import { categoryStatusLabel, getRideCategoryMeta } from '../lib/rideCategories'

const ADMIN_EMAILS = ['robycho@gmail.com', 'rogercho@gmail.com']

const DOCUMENT_REQUIREMENTS = [
  {
    key: 'driver_license',
    label: 'Licencia de conducir',
    required: true,
    description: 'Vigente y con la antigüedad mínima requerida.',
  },
  {
    key: 'identity_document',
    label: 'Cédula / DNI',
    required: true,
    description: 'Verifica identidad y edad mínima del conductor.',
  },
  {
    key: 'driver_profile_photo',
    label: 'Foto de perfil',
    required: true,
    description: 'Rostro claro, de frente, a color y sin lentes oscuros.',
  },
  {
    key: 'criminal_record',
    label: 'Antecedentes',
    required: true,
    description: 'Certificado policial, penal o judicial reciente.',
  },
  {
    key: 'ruc_certificate',
    label: 'Constancia de RUC',
    required: true,
    description: 'Necesaria para facturar ganancias cuando aplica.',
  },
  {
    key: 'vehicle_insurance',
    label: 'Seguro del vehículo',
    required: true,
    description: 'Póliza vigente, idealmente con cobertura a terceros/pasajeros.',
  },
  {
    key: 'vehicle_registration',
    label: 'Habilitación / permiso',
    required: true,
    description: 'Habilitación de rodados o permiso de circulación al día.',
  },
  {
    key: 'vehicle_document',
    label: 'Documento del vehículo',
    required: true,
    description: 'Tarjeta de circulación, título, cédula verde o certificado del automotor.',
  },
  {
    key: 'vehicle_photo',
    label: 'Foto del vehículo',
    required: true,
    description: 'Foto clara del auto o moto, idealmente con matrícula visible.',
  },
]

const DOCUMENT_LABELS = DOCUMENT_REQUIREMENTS.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

const DOCUMENT_ALIASES = {
  vehicle_document: ['green_card'],
}

function statusLabel(status) {
  if (status === 'approved') return 'Aprobado'
  if (status === 'rejected') return 'Rechazado'
  if (status === 'submitted') return 'En revisión'
  return 'Incompleto'
}

function isImageFile(value) {
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(value || ''))
}

function isPdfFile(value) {
  return /\.pdf$/i.test(String(value || ''))
}

function isAdminAccount(user, profile) {
  const email = String(user?.email || '').toLowerCase()
  return profile?.role === 'admin' || ADMIN_EMAILS.includes(email)
}

function getDocumentStats(documents = {}) {
  const requiredDocs = DOCUMENT_REQUIREMENTS.filter((doc) => doc.required)
  const uploadedRequiredCount = requiredDocs.filter((doc) => getDocumentValue(documents, doc.key)).length
  const totalRequiredCount = requiredDocs.length
  const uploadedTotalCount = DOCUMENT_REQUIREMENTS.filter((doc) => getDocumentValue(documents, doc.key)).length
  const docsComplete = uploadedRequiredCount >= totalRequiredCount
  const missingRequiredDocs = requiredDocs.filter((doc) => !getDocumentValue(documents, doc.key))

  return {
    requiredDocs,
    uploadedRequiredCount,
    totalRequiredCount,
    uploadedTotalCount,
    docsComplete,
    missingRequiredDocs,
  }
}

function getDocumentValue(documents = {}, key) {
  if (documents[key]) return documents[key]

  const aliases = DOCUMENT_ALIASES[key] || []
  const aliasKey = aliases.find((item) => documents[item])

  return aliasKey ? documents[aliasKey] : null
}

function getDriverVehicleKind(driver = {}) {
  if (driver.driver_type === 'moto') return 'Moto'
  if (driver.driver_type === 'auto_and_moto') return 'Auto y moto'
  return 'Auto'
}

function getDriverVehicleTitle(driver = {}) {
  const hasAuto = driver.driver_type !== 'moto'
  const autoTitle = [driver.vehicle_make || driver.car_brand, driver.vehicle_model || driver.car_model]
    .filter(Boolean)
    .join(' ')
    .trim()
  const motoTitle = [driver.moto_brand, driver.moto_model].filter(Boolean).join(' ').trim()

  if (driver.driver_type === 'moto') return motoTitle || 'Moto'
  if (driver.driver_type === 'auto_and_moto') {
    return [autoTitle || 'Auto', motoTitle || 'Moto'].join(' + ')
  }

  return hasAuto ? autoTitle || 'Vehículo' : 'Vehículo'
}

function getDriverVehiclePlate(driver = {}) {
  if (driver.driver_type === 'moto') return driver.moto_plate || driver.plate || 'Sin matrícula'
  if (driver.driver_type === 'auto_and_moto') {
    const autoPlate = driver.vehicle_plate || driver.plate
    const motoPlate = driver.moto_plate
    return [autoPlate, motoPlate].filter(Boolean).join(' / ') || 'Sin matrícula'
  }

  return driver.vehicle_plate || driver.plate || 'Sin matrícula'
}

const DEFAULT_SIM_A = { lat: -25.5167, lng: -54.6167 }
const DEFAULT_SIM_B = { lat: -25.5098, lng: -54.6128 }
const DEFAULT_SIM_DRIVER_START = { lat: -25.5209, lng: -54.6208 }
const QUICK_DEMO_A = { lat: -25.5161, lng: -54.6164 }
const QUICK_DEMO_B = { lat: -25.5039, lng: -54.6111 }
const QUICK_DEMO_DRIVER_START = { lat: -25.5213, lng: -54.6222 }
const SIM_SPEEDS = {
  slow: { label: 'Lento', interval: 700, speed: 3.5 },
  normal: { label: 'Normal', interval: 460, speed: 6 },
  fast: { label: 'Rapido', interval: 300, speed: 9.5 },
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isValidSimPoint(point) {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -28 && lat <= -19 && lng >= -63 && lng <= -53
}

function simDistanceKm(a, b) {
  if (!isValidSimPoint(a) || !isValidSimPoint(b)) return 0
  const radius = 6371
  const dLat = ((Number(b.lat) - Number(a.lat)) * Math.PI) / 180
  const dLng = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180
  const startLat = (Number(a.lat) * Math.PI) / 180
  const endLat = (Number(b.lat) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function simBearing(a, b) {
  if (!isValidSimPoint(a) || !isValidSimPoint(b)) return 0
  const lat1 = (Number(a.lat) * Math.PI) / 180
  const lat2 = (Number(b.lat) * Math.PI) / 180
  const dLng = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function interpolateSimRoute(a, b, steps = 96) {
  if (!isValidSimPoint(a) || !isValidSimPoint(b)) return []
  const start = { lat: Number(a.lat), lng: Number(a.lng) }
  const end = { lat: Number(b.lat), lng: Number(b.lng) }
  const midA = { lat: start.lat, lng: end.lng }
  const midB = { lat: start.lat + (end.lat - start.lat) * 0.68, lng: end.lng }
  const points = [start, midA, midB, end]
  const result = []

  for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
    const from = points[segmentIndex]
    const to = points[segmentIndex + 1]
    const segmentSteps = Math.max(10, Math.round(steps / (points.length - 1)))

    for (let index = 0; index <= segmentSteps; index += 1) {
      if (segmentIndex > 0 && index === 0) continue
      const progress = index / segmentSteps
      result.push({
        lat: from.lat + (to.lat - from.lat) * progress,
        lng: from.lng + (to.lng - from.lng) * progress,
      })
    }
  }

  return result
}

function densifySimRoute(path = [], maxSegmentMeters = 6) {
  const validPath = path.filter(isValidSimPoint)
  if (validPath.length < 2) return validPath
  const result = []

  for (let index = 0; index < validPath.length - 1; index += 1) {
    const from = validPath[index]
    const to = validPath[index + 1]
    const segmentMeters = simDistanceKm(from, to) * 1000
    const steps = Math.max(1, Math.ceil(segmentMeters / maxSegmentMeters))

    for (let step = 0; step <= steps; step += 1) {
      if (index > 0 && step === 0) continue
      const progress = step / steps
      result.push({
        lat: Number(from.lat) + (Number(to.lat) - Number(from.lat)) * progress,
        lng: Number(from.lng) + (Number(to.lng) - Number(from.lng)) * progress,
      })
    }
  }

  return result
}

function createDriverSpawnPoint(pickup, destination) {
  if (!isValidSimPoint(pickup) || !isValidSimPoint(destination)) return DEFAULT_SIM_DRIVER_START
  const awayHeading = normalizeSimHeading(simBearing(destination, pickup))
  const spawn = moveSimPointByBearing(pickup, awayHeading, 520)
  return isValidSimPoint(spawn) ? spawn : DEFAULT_SIM_DRIVER_START
}

function normalizeSimHeading(heading = 0) {
  return ((Number(heading) % 360) + 360) % 360
}

function moveSimPointByBearing(point, heading, distanceMeters) {
  if (!isValidSimPoint(point)) return point
  const radius = 6371000
  const bearing = (Number(heading) * Math.PI) / 180
  const lat1 = (Number(point.lat) * Math.PI) / 180
  const lng1 = (Number(point.lng) * Math.PI) / 180
  const angularDistance = Number(distanceMeters) / radius

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  )
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  )

  return {
    lat: (lat2 * 180) / Math.PI,
    lng: (lng2 * 180) / Math.PI,
  }
}

function formatSimPoint(point) {
  if (!isValidSimPoint(point)) return ''
  return `${Number(point.lat).toFixed(6)}, ${Number(point.lng).toFixed(6)}`
}

function formatSimNavDistance(value) {
  const meters = Number(value)
  if (!Number.isFinite(meters) || meters <= 0) return ''
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`
  return `${Math.round(meters)} m`
}

function supabaseErrorText(error) {
  if (!error) return ''
  return [error.message, error.details, error.hint].filter(Boolean).join(' · ')
}

function AdminTripSimulator({ adminUser, drivers, enabled, onMessage }) {
  const [pointA, setPointA] = useState(DEFAULT_SIM_A)
  const [pointB, setPointB] = useState(DEFAULT_SIM_B)
  const [markMode, setMarkMode] = useState('a')
  const [selectedDriverId, setSelectedDriverId] = useState('')
  const [clients, setClients] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [activeTrip, setActiveTrip] = useState(null)
  const [routePath, setRoutePath] = useState([])
  const [routeSource, setRouteSource] = useState('')
  const [speedMode, setSpeedMode] = useState('normal')
  const [simulating, setSimulating] = useState(false)
  const [simIndex, setSimIndex] = useState(0)
  const [simPhase, setSimPhase] = useState('pickup')
  const [simDriverPoint, setSimDriverPoint] = useState(DEFAULT_SIM_DRIVER_START)
  const [lastSimUpdateAt, setLastSimUpdateAt] = useState('')
  const [simRouteInfo, setSimRouteInfo] = useState(null)
  const [liveMapVersion, setLiveMapVersion] = useState(0)
  const [simulatorOpen, setSimulatorOpen] = useState(false)
  const [mapPickerOpen, setMapPickerOpen] = useState(false)
  const timerRef = useRef(null)
  const routeRef = useRef([])
  const tripRef = useRef(null)
  const simDriverPointRef = useRef(DEFAULT_SIM_DRIVER_START)
  const simIndexRef = useRef(0)
  const markModeRef = useRef('a')
  const autoRunRef = useRef(false)

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.user_id === selectedDriverId) || null,
    [drivers, selectedDriverId]
  )

  const fallbackDriverStartPoint = createDriverSpawnPoint(pointA, pointB)
  const selectedDriverPoint = isValidSimPoint(selectedDriver)
    ? { lat: Number(selectedDriver.lat), lng: Number(selectedDriver.lng) }
    : null
  const driverStartPoint = selectedDriverPoint && simDistanceKm(selectedDriverPoint, pointA) > 0.12
    ? selectedDriverPoint
    : fallbackDriverStartPoint
  const mapPickerOrigin = isValidSimPoint(pointA) ? pointA : DEFAULT_SIM_A
  const mapPickerDestination = isValidSimPoint(pointB) ? pointB : DEFAULT_SIM_B
  const liveMapOrigin = isValidSimPoint(simDriverPoint) ? simDriverPoint : pointA
  const liveMapDestination = simPhase === 'trip'
    ? (isValidSimPoint(pointB) ? pointB : DEFAULT_SIM_B)
    : (isValidSimPoint(pointA) ? pointA : DEFAULT_SIM_A)
  const routeKm = simDistanceKm(pointA, pointB)
  const canCreateTrip = enabled && selectedDriverId && (selectedClientId || adminUser?.id) && isValidSimPoint(pointA) && isValidSimPoint(pointB)

  useEffect(() => {
    if (!enabled) return
    if (!selectedDriverId && drivers[0]?.user_id) {
      setSelectedDriverId(drivers[0].user_id)
    }
  }, [drivers, enabled, selectedDriverId])

  useEffect(() => {
    tripRef.current = activeTrip
  }, [activeTrip])

  useEffect(() => {
    routeRef.current = routePath
  }, [routePath])

  useEffect(() => {
    simDriverPointRef.current = simDriverPoint
  }, [simDriverPoint])

  useEffect(() => {
    simIndexRef.current = simIndex
  }, [simIndex])

  useEffect(() => {
    markModeRef.current = markMode
  }, [markMode])

  useEffect(() => {
    if (!activeTrip?.id) {
      setSimDriverPoint(fallbackDriverStartPoint)
      simDriverPointRef.current = fallbackDriverStartPoint
    }
  }, [fallbackDriverStartPoint.lat, fallbackDriverStartPoint.lng, activeTrip?.id])

  useEffect(() => {
    if (!enabled || !adminUser?.id) return

    let cancelled = false
    async function loadClients() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, avatar_url, updated_at')
        .order('updated_at', { ascending: false })
        .limit(60)

      if (cancelled) return
      if (error) {
        setClients([{ id: adminUser.id, full_name: adminUser.email, email: adminUser.email, role: 'admin' }])
        setSelectedClientId(adminUser.id)
        return
      }

      const nextClients = data?.length ? data : [{ id: adminUser.id, full_name: adminUser.email, email: adminUser.email, role: 'admin' }]
      setClients(nextClients)
      setSelectedClientId((current) => current || nextClients[0]?.id || adminUser.id)
    }

    loadClients()
    return () => {
      cancelled = true
    }
  }, [adminUser?.id, adminUser?.email, enabled])

  useEffect(() => () => stopSimulation(), [])

  function stopSimulation() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    setSimulating(false)
  }

  function handleMapClick(point) {
    if (markModeRef.current === 'b') {
      setPointB(point)
    } else {
      setPointA(point)
      setMarkMode('b')
    }
  }

  function updatePoint(which, field, value) {
    const setter = which === 'a' ? setPointA : setPointB
    setter((current) => ({ ...current, [field]: Number(value) }))
  }

  function getRouteEndpoints(phase = simPhase) {
    if (phase === 'trip' || tripRef.current?.status === 'in_progress') {
      return { origin: pointA, destination: pointB }
    }

    return {
      origin: isValidSimPoint(simDriverPointRef.current) ? simDriverPointRef.current : driverStartPoint,
      destination: pointA,
    }
  }

  async function buildRoute(phase = simPhase) {
    const endpoints = getRouteEndpoints(phase)
    if (!isValidSimPoint(endpoints.origin) || !isValidSimPoint(endpoints.destination)) {
      onMessage?.('No pude calcular la ruta: origen o destino inválido.')
      return []
    }

    let routeResult = null
    try {
      routeResult = await computeRouteWithRoutesApi({
        origin: endpoints.origin,
        destination: endpoints.destination,
        waypoints: [],
      })
    } catch (routeError) {
      console.error('ADMIN TEST TRIP ROUTE ERROR:', routeError)
      onMessage?.(`Google Routes API falló, uso ruta en línea recta: ${routeError?.message || 'revisá la clave de Google Maps.'}`)
    }

    if (Array.isArray(routeResult?.path) && routeResult.path.length >= 2) {
      const precisePath = densifySimRoute(routeResult.path, 2)
      setRoutePath(precisePath)
      routeRef.current = precisePath
      setRouteSource(`${phase === 'trip' ? 'Viaje' : 'Pickup'} · Google Routes API`)
      return precisePath
    }

    const fallback = densifySimRoute(interpolateSimRoute(endpoints.origin, endpoints.destination), 2)
    setRoutePath(fallback)
    routeRef.current = fallback
    setRouteSource(`${phase === 'trip' ? 'Viaje' : 'Pickup'} · fallback interpolado`)
    return fallback
  }

  async function createTrip() {
    if (!canCreateTrip) {
      onMessage?.('Elegí punto A, punto B, chofer y cliente para crear el viaje test.')
      return
    }

    stopSimulation()
    setSimPhase('pickup')

    try {
      const path = await buildRoute('pickup')
      const { data, error } = await adminCreateTestTrip({
        adminId: adminUser.id,
        clientId: selectedClientId || adminUser.id,
        driverId: selectedDriverId,
        pickupLat: pointA.lat,
        pickupLng: pointA.lng,
        destinationLat: pointB.lat,
        destinationLng: pointB.lng,
        destinationText: 'Viaje test admin',
        routeKm: routeKm || simDistanceKm(pointA, pointB),
        price: Math.max(12000, Math.round((routeKm || 1) * 4500)),
      })

      if (error) {
        console.error('ADMIN TEST TRIP CREATE ERROR:', error)
        onMessage?.(`No pude crear el viaje test: ${supabaseErrorText(error) || 'RLS/RPC bloqueó la creación.'}`)
        return
      }

      // adminCreateTestTrip a veces devuelve un array (insert) en vez de un objeto único.
      const tripRow = Array.isArray(data) ? data[0] : data

      if (!tripRow?.id) {
        console.error('ADMIN TEST TRIP CREATE ERROR: respuesta sin id de viaje.', data)
        onMessage?.('El viaje test se creó pero la respuesta no trae un id válido. Revisá adminCreateTestTrip en lib/supabase.js.')
        return
      }

      const routeStart = path[0] || driverStartPoint
      const routeNext = path[1] || pointA
      const initialPoint = {
        lat: routeStart.lat,
        lng: routeStart.lng,
        heading: simBearing(routeStart, routeNext),
        speed: 0,
        accuracy: 8,
      }

      setRoutePath(path)
      setActiveTrip(tripRow)
      setSimIndex(0)
      simIndexRef.current = 0
      setSimDriverPoint(initialPoint)
      simDriverPointRef.current = initialPoint
      tripRef.current = tripRow
      await pushSimPoint(0, 'pending')
      onMessage?.('Viaje test creado. Abrí /client y /driver para ver el flujo real.')
      return tripRow
    } catch (createError) {
      console.error('ADMIN TEST TRIP CREATE UNEXPECTED ERROR:', createError)
      onMessage?.(`No pude crear el viaje test: ${createError?.message || 'revisá la consola.'}`)
    }
    return null
  }

  async function setTripStatus(status) {
    const currentTrip = tripRef.current || activeTrip
    if (!currentTrip?.id) return
    try {
      const { data, error } = await adminUpdateTestTripStatus({ tripId: currentTrip.id, status })
      if (error) {
        console.error('ADMIN TEST TRIP STATUS ERROR:', error)
        onMessage?.(`No pude actualizar el estado del viaje test: ${supabaseErrorText(error) || error?.message || ''}`)
        return
      }
      const tripRow = Array.isArray(data) ? data[0] : data
      const nextTrip = tripRow?.id ? tripRow : { ...currentTrip, status }
      setActiveTrip(nextTrip)
      tripRef.current = nextTrip
    } catch (statusError) {
      console.error('ADMIN TEST TRIP STATUS UNEXPECTED ERROR:', statusError)
      onMessage?.(`No pude actualizar el estado del viaje test: ${statusError?.message || 'revisá la consola.'}`)
    }
  }

  async function pushSimPoint(index, status = null) {
    const path = routeRef.current.length >= 2 ? routeRef.current : interpolateSimRoute(pointA, pointB)
    const point = path[Math.min(index, path.length - 1)]
    const nextPoint = path[Math.min(index + 1, path.length - 1)] || point
    const trip = tripRef.current

    if (!trip?.id) {
      console.error('ADMIN TEST TRIP LOCATION ERROR: viaje sin id, no se puede mover.', trip)
      onMessage?.('No hay un viaje test válido (sin id). Creá el viaje test de nuevo.')
      stopSimulation()
      return false
    }

    if (!isValidSimPoint(point)) {
      console.error('ADMIN TEST TRIP LOCATION ERROR: punto de ruta inválido.', point)
      onMessage?.('La ruta calculada tiene un punto inválido. Volvé a marcar A y B en el mapa.')
      stopSimulation()
      return false
    }

    const heading = simBearing(point, nextPoint)
    const speed = SIM_SPEEDS[speedMode]?.speed || SIM_SPEEDS.normal.speed
    const visualPoint = {
      lat: point.lat,
      lng: point.lng,
      heading,
      speed,
      accuracy: 8,
    }
    setSimDriverPoint(visualPoint)
    simDriverPointRef.current = visualPoint
    setLastSimUpdateAt(new Date().toLocaleTimeString())

    let data = null
    let error = null
    try {
      const result = await adminUpdateTestTripLocation({
        tripId: trip.id,
        driverId: trip.driver_id || selectedDriverId,
        lat: point.lat,
        lng: point.lng,
        heading,
        speed,
        accuracy: 8,
        status,
      })
      data = result?.data
      error = result?.error
    } catch (thrownError) {
      error = thrownError
    }

    if (error) {
      console.error('ADMIN TEST TRIP LOCATION ERROR:', error)
      onMessage?.(`RLS/RPC bloqueó movimiento: ${supabaseErrorText(error) || error?.message || 'revisá admin_update_test_trip_location.'}`)
      stopSimulation()
      return false
    }

    const tripRow = Array.isArray(data) ? data[0] : data
    if (tripRow?.id) {
      setActiveTrip(tripRow)
      tripRef.current = tripRow
    }
    setSimIndex(index)
    simIndexRef.current = index
    return true
  }

  async function startSimulation() {
    const currentTrip = tripRef.current || activeTrip
    if (!currentTrip?.id) {
      onMessage?.('Primero crea un viaje test.')
      return
    }

    let path = routeRef.current
    try {
      if (!path || path.length < 2) {
        path = await buildRoute(simPhase)
        routeRef.current = path
      }
    } catch (routeError) {
      console.error('ADMIN TEST TRIP START ROUTE ERROR:', routeError)
      onMessage?.(`No pude calcular la ruta: ${routeError?.message || 'revisá la consola.'}`)
      return
    }

    if (!path || path.length < 2) {
      onMessage?.('No hay ruta valida para simular.')
      return
    }

    if (simIndexRef.current >= path.length - 1) {
      simIndexRef.current = 0
      setSimIndex(0)
    }

    if (tripRef.current?.status === 'pending') {
      await setTripStatus('accepted')
    }

    stopSimulation()
    setSimulating(true)
    const interval = SIM_SPEEDS[speedMode]?.interval || SIM_SPEEDS.normal.interval

    timerRef.current = window.setInterval(async () => {
      try {
        const currentPath = routeRef.current || []
        const currentIndex = simIndexRef.current || 0
        const nextIndex = Math.min(currentIndex + 1, currentPath.length - 1)
        const currentStatus = tripRef.current?.status === 'in_progress' ? 'in_progress' : 'arriving'
        const ok = await pushSimPoint(nextIndex, currentStatus)

        if (!ok) {
          // pushSimPoint ya mostró el mensaje de error y detuvo el timer.
          return
        }

        if (nextIndex >= currentPath.length - 1) {
          stopSimulation()
          if (tripRef.current?.status === 'in_progress') {
            autoRunRef.current = false
            await setTripStatus('completed')
          } else if (autoRunRef.current) {
            onMessage?.('Pickup completado. Arranco el recorrido al destino.')
            await prepareTripSimulation()
            await startSimulation()
          } else {
            onMessage?.('Simulacion llego al punto. Toca Iniciar viaje para simular A -> B.')
          }
        }
      } catch (tickError) {
        console.error('ADMIN TEST TRIP SIMULATION TICK ERROR:', tickError)
        onMessage?.(`La simulación se detuvo por un error: ${tickError?.message || 'revisá la consola.'}`)
        stopSimulation()
      }
    }, interval)
  }

  async function preparePickupSimulation() {
    const currentTrip = tripRef.current || activeTrip
    if (!currentTrip?.id) {
      onMessage?.('Primero creá un viaje test.')
      return
    }

    stopSimulation()
    setSimPhase('pickup')
    setSimIndex(0)
    simIndexRef.current = 0

    try {
      const path = await buildRoute('pickup')
      if (path.length < 2) {
        onMessage?.('No pude calcular una ruta de pickup válida.')
        return
      }
      const ok = await pushSimPoint(0, tripRef.current?.status || 'accepted')
      if (!ok) return
      setLiveMapVersion((value) => value + 1)
      await wait(240)
      onMessage?.('Pickup listo: simulá ida al cliente.')
      await startSimulation()
    } catch (prepareError) {
      console.error('ADMIN PICKUP SIMULATION ERROR:', prepareError)
      onMessage?.(`No pude preparar el pickup: ${prepareError?.message || 'revisá la consola.'}`)
    }
  }

  async function prepareTripSimulation() {
    const currentTrip = tripRef.current || activeTrip
    if (!currentTrip?.id) {
      onMessage?.('Primero creá un viaje test.')
      return
    }

    stopSimulation()
    setSimPhase('trip')
    setSimIndex(0)
    simIndexRef.current = 0

    try {
      await setTripStatus('in_progress')
      const startPoint = {
        lat: pointA.lat,
        lng: pointA.lng,
        heading: simBearing(pointA, pointB),
        speed: 0,
        accuracy: 8,
      }
      setSimDriverPoint(startPoint)
      simDriverPointRef.current = startPoint
      const path = await buildRoute('trip')
      if (path.length < 2) {
        onMessage?.('No pude calcular una ruta de viaje válida.')
        return
      }
      const ok = await pushSimPoint(0, 'in_progress')
      if (!ok) return
      setLiveMapVersion((value) => value + 1)
      await wait(240)
      onMessage?.('Viaje iniciado: simulá recorrido al destino.')
    } catch (prepareError) {
      console.error('ADMIN TRIP SIMULATION ERROR:', prepareError)
      onMessage?.(`No pude iniciar el viaje: ${prepareError?.message || 'revisá la consola.'}`)
    }
  }

  async function launchSimulator() {
    autoRunRef.current = true
    stopSimulation()

    let currentTrip = tripRef.current || activeTrip
    if (!currentTrip?.id) {
      currentTrip = await createTrip()
    }

    if (!currentTrip?.id && !tripRef.current?.id) {
      autoRunRef.current = false
      return
    }

    onMessage?.('Simulador arrancado: el chofer va al punto A y luego al punto B.')
    await preparePickupSimulation()
  }

  async function quickDemoCde() {
    stopSimulation()
    setPointA(QUICK_DEMO_A)
    setPointB(QUICK_DEMO_B)
    setSimDriverPoint(QUICK_DEMO_DRIVER_START)
    simDriverPointRef.current = QUICK_DEMO_DRIVER_START
    setSimPhase('pickup')
    setSimIndex(0)
    simIndexRef.current = 0
    if (!selectedDriverId && drivers[0]?.user_id) setSelectedDriverId(drivers[0].user_id)
    if (!selectedClientId && (clients[0]?.id || adminUser?.id)) setSelectedClientId(clients[0]?.id || adminUser.id)
    const fallback = densifySimRoute(interpolateSimRoute(QUICK_DEMO_DRIVER_START, QUICK_DEMO_A), 2)
    setRoutePath(fallback)
    routeRef.current = fallback
    setRouteSource('Demo rápido CDE')
    onMessage?.('Demo rápido CDE listo. Creá el viaje test y empezá a simular.')
  }

  async function resetSimulation() {
    stopSimulation()
    setSimIndex(0)
    simIndexRef.current = 0
    if (activeTrip?.id) {
      await pushSimPoint(0, activeTrip.status || 'accepted')
    }
  }

    const progress = routePath.length > 1 ? Math.round((simIndex / (routePath.length - 1)) * 100) : 0

  if (!enabled) {
    return (
      <section className="admin-simulator-trigger admin-empty">
        No autorizado para usar el simulador.
      </section>
    )
  }

  return (
    <>
      <section className="admin-simulator-trigger">
        <div className="admin-sim-trigger-info">
          <strong>Simulador de viajes</strong>
          <span>{activeTrip?.status || 'sin viaje'} · {progress}%</span>
        </div>
        <button type="button" className="admin-sim-trigger-btn" onClick={() => setSimulatorOpen(true)}>
          <Play size={16} /> Abrir simulador
        </button>
      </section>

      {simulatorOpen && (
        <div className="admin-preview-backdrop" onClick={() => setSimulatorOpen(false)}>
          <section className="admin-simulator-modal" onClick={(event) => event.stopPropagation()}>
            <header className="admin-sim-modal-header">
              <div>
                <p>SIMULADOR</p>
                <h2>Viaje test</h2>
                <span>{activeTrip?.status || 'sin viaje'} · {progress}%</span>
              </div>
              <button type="button" className="admin-preview-close" onClick={() => setSimulatorOpen(false)} aria-label="Cerrar simulador">
                <X size={20} />
              </button>
            </header>

            <div className="admin-sim-modal-body">
              <div className="admin-sim-live-map">
                <InteractiveRouteMap
                  key={`admin-sim-map-${simPhase}-${liveMapVersion}`}
                  origin={liveMapOrigin}
                  destination={liveMapDestination}
                  destinationText={simPhase === 'trip' ? 'Destino del viaje' : 'Punto de recogida'}
                  drivers={[]}
                  selectedDriver={null}
                  onSelectDriver={() => {}}
                  onChooseDriver={() => {}}
                  onRefreshLocation={() => {}}
                  showRouteSummary={false}
                  animateCamera
                  showOriginCar
                  navigationMode
                  navigationVariant="driver"
                  navigationCamera="cinematic"
                  onRouteUpdate={setSimRouteInfo}
                />
                <div className="admin-sim-navigation-hud">
                  <span>{formatSimNavDistance(simRouteInfo?.distance) || (simPhase === 'trip' ? 'Viaje al destino' : 'Ida al cliente')}</span>
                  <strong>{simRouteInfo?.shortInstruction || simRouteInfo?.instruction || 'Seguimos por la ruta'}</strong>
                  <small>{simRouteInfo?.instruction || (simPhase === 'trip' ? 'Guiando al destino final' : 'Guiando al punto de recogida')}</small>
                </div>
              </div>

              <div className="admin-sim-control-panel">
              <div className="admin-sim-steps">
                <span>Paso 1: Elegí chofer y cliente</span>
                <span>Paso 2: Marcá A y B en el mapa</span>
                <span>Paso 3: Crear viaje test</span>
                <span>Paso 4: Abrí /client y /driver</span>
                <span>Paso 5: Iniciar recorrido</span>
              </div>

              <div className="admin-sim-location-card">
                <div className="admin-sim-location-row">
                  <div>
                    <span>Punto A · recogida</span>
                    <strong>{formatSimPoint(pointA) || 'Sin marcar'}</strong>
                  </div>
                  <div>
                    <span>Punto B · destino</span>
                    <strong>{formatSimPoint(pointB) || 'Sin marcar'}</strong>
                  </div>
                </div>
                <div className="admin-sim-location-actions">
                  <button type="button" className="admin-sim-map-btn" onClick={() => setMapPickerOpen(true)}>
                    <MapPin size={16} /> Marcar en el mapa
                  </button>
                  <button type="button" className="admin-sim-map-btn ghost" onClick={quickDemoCde}>
                    Demo rápido CDE
                  </button>
                </div>
                <span className="admin-sim-route-hint">Ruta: {routeSource || 'sin calcular'} · {routeKm.toFixed(2)} km</span>
              </div>

              <label>
                Chofer
                <select value={selectedDriverId} onChange={(event) => setSelectedDriverId(event.target.value)}>
                  <option value="">Seleccionar chofer</option>
                  {drivers.map((driver) => (
                    <option key={driver.user_id} value={driver.user_id}>
                      {driver.full_name || driver.email || driver.user_id}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Cliente test
                <select value={selectedClientId} onChange={(event) => setSelectedClientId(event.target.value)}>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.full_name || client.email || client.id}
                    </option>
                  ))}
                </select>
              </label>

              <div className="admin-sim-status">
                <span>Trip: {activeTrip?.id || 'sin viaje'}</span>
                <span>Driver: {selectedDriverId || 'sin chofer'}</span>
                <span>Client: {selectedClientId || adminUser?.id || 'sin cliente'}</span>
                <span>Fase: {simPhase === 'trip' ? 'viaje al destino' : 'ida al cliente'}</span>
                <span>Progreso: {progress}%</span>
                <span>Auto: {formatSimPoint(simDriverPoint)}</span>
                <span>Heading: {Number(simDriverPoint?.heading || 0).toFixed(0)}°</span>
                <span>Speed: {Number(simDriverPoint?.speed || 0).toFixed(1)} m/s</span>
                <span>Último update: {lastSimUpdateAt || 'sin movimiento'}</span>
              </div>

              <div className="admin-sim-speed">
                {Object.entries(SIM_SPEEDS).map(([key, item]) => (
                  <button key={key} type="button" className={speedMode === key ? 'active' : ''} onClick={() => setSpeedMode(key)}>
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="admin-sim-actions">
                <button type="button" className="admin-sim-start" onClick={launchSimulator} disabled={!canCreateTrip || simulating}>
                  <Play size={17} /> Arrancar simulador
                </button>
                <button type="button" className="approve" onClick={createTrip} disabled={!canCreateTrip}>
                  Crear viaje test
                </button>
                <button type="button" onClick={preparePickupSimulation} disabled={!activeTrip?.id || simulating}>
                  Simular ida al cliente
                </button>
                <button type="button" onClick={() => setTripStatus('accepted')} disabled={!activeTrip?.id}>
                  Aceptar viaje
                </button>
                <button type="button" onClick={() => setTripStatus('arriving')} disabled={!activeTrip?.id}>
                  Llegue al punto
                </button>
                <button type="button" onClick={prepareTripSimulation} disabled={!activeTrip?.id || simulating}>
                  Iniciar viaje
                </button>
                <button type="button" className="approve" onClick={startSimulation} disabled={!activeTrip?.id || simulating || simPhase !== 'trip'}>
                  Simular viaje al destino
                </button>
                <button type="button" className="approve" onClick={startSimulation} disabled={!activeTrip?.id || simulating}>
                  <Play size={15} /> Iniciar recorrido
                </button>
                <button type="button" onClick={stopSimulation} disabled={!simulating}>
                  <Pause size={15} /> Pausar
                </button>
                <button type="button" onClick={resetSimulation} disabled={!activeTrip?.id}>
                  Reiniciar
                </button>
                <button type="button" onClick={() => setTripStatus('completed')} disabled={!activeTrip?.id}>
                  <Square size={15} /> Finalizar
                </button>
                <button type="button" className="reject" onClick={() => setTripStatus('cancelled')} disabled={!activeTrip?.id}>
                  Cancelar
                </button>
              </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {mapPickerOpen && (
        <div className="admin-preview-backdrop" onClick={() => setMapPickerOpen(false)}>
          <section className="admin-map-picker-modal" onClick={(event) => event.stopPropagation()}>
            <header className="admin-sim-modal-header">
              <div>
                <p>MAPA</p>
                <h2>Marcar puntos</h2>
                <span>Tocá el mapa para ubicar el punto {markMode === 'a' ? 'A (recogida)' : 'B (destino)'}</span>
              </div>
              <button type="button" className="admin-preview-close" onClick={() => setMapPickerOpen(false)} aria-label="Cerrar mapa">
                <X size={20} />
              </button>
            </header>

            <div className="admin-map-picker-toggle">
              <button type="button" className={markMode === 'a' ? 'active' : ''} onClick={() => setMarkMode('a')}>
                <MapPin size={16} /> Punto A
              </button>
              <button type="button" className={markMode === 'b' ? 'active' : ''} onClick={() => setMarkMode('b')}>
                <MapPin size={16} /> Punto B
              </button>
            </div>

            <div className="admin-map-picker-map">
              <InteractiveRouteMap
                origin={mapPickerOrigin}
                destination={mapPickerDestination}
                destinationText="Viaje test admin"
                drivers={[]}
                selectedDriver={null}
                onSelectDriver={() => {}}
                onChooseDriver={() => {}}
                onRefreshLocation={() => {}}
                onMapClick={handleMapClick}
                showRouteSummary={false}
                animateCamera={false}
                showOriginCar={false}
              />
            </div>

            <div className="admin-map-picker-footer">
              <div className="admin-map-picker-coords">
                <span>A: {formatSimPoint(pointA) || 'sin marcar'}</span>
                <span>B: {formatSimPoint(pointB) || 'sin marcar'}</span>
              </div>
              <button type="button" className="approve" onClick={() => setMapPickerOpen(false)}>
                Confirmar puntos
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}

export default function Admin() {
  const [loading, setLoading] = useState(true)
  const [drivers, setDrivers] = useState([])
  const [message, setMessage] = useState('')
  const [adminUser, setAdminUser] = useState(null)
  const [adminProfile, setAdminProfile] = useState(null)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState('submitted')
  const [expandedDocs, setExpandedDocs] = useState({})
  const [categoryRequests, setCategoryRequests] = useState([])
  const [womenRequests, setWomenRequests] = useState([])

  useEffect(() => {
    loadDrivers()

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      loadDrivers()
    })

    return () => {
      listener?.subscription?.unsubscribe()
    }
  }, [])

  const stats = useMemo(() => {
    return drivers.reduce(
      (acc, driver) => {
        const status = driver.verification_status || 'incomplete'
        const documents = driver.documents || {}
        const docStats = getDocumentStats(documents)

        acc.total += 1
        acc[status] = (acc[status] || 0) + 1

        if (docStats.docsComplete) {
          acc.docsComplete += 1
        } else {
          acc.docsPending += 1
        }

        return acc
      },
      {
        total: 0,
        submitted: 0,
        approved: 0,
        rejected: 0,
        incomplete: 0,
        docsComplete: 0,
        docsPending: 0,
      }
    )
  }, [drivers])

  const filteredDrivers = useMemo(() => {
    if (filterStatus === 'all') return drivers

    if (filterStatus === 'docs_complete') {
      return drivers.filter((driver) => getDocumentStats(driver.documents || {}).docsComplete)
    }

    if (filterStatus === 'docs_pending') {
      return drivers.filter((driver) => !getDocumentStats(driver.documents || {}).docsComplete)
    }

    return drivers.filter((driver) => {
      const status = driver.verification_status || 'incomplete'
      return status === filterStatus
    })
  }, [drivers, filterStatus])

  const adminSimulatorEnabled = Boolean(adminUser && isAdminAccount(adminUser, adminProfile))

  async function getCurrentUser() {
    const { data: sessionData } = await supabase.auth.getSession()
    const sessionUser = sessionData?.session?.user || null

    if (sessionUser) return sessionUser

    const { data: authData } = await supabase.auth.getUser()
    return authData?.user || null
  }

  async function loadDrivers() {
    setLoading(true)
    setMessage('')

    const currentUser = await getCurrentUser()
    setAdminUser(currentUser)

    if (!currentUser) {
      setDrivers([])
      setCategoryRequests([])
      setWomenRequests([])
      setAdminProfile(null)
      setMessage('No hay sesión activa. Iniciá sesión con robycho@gmail.com o rogercho@gmail.com y volvé a /admin.')
      setLoading(false)
      return
    }

    const { data: ownProfile, error: ownProfileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .maybeSingle()

    if (ownProfileError) {
      console.warn('ADMIN PROFILE LOAD ERROR:', ownProfileError)
    }

    const fallbackAdminProfile = {
      id: currentUser.id,
      email: currentUser.email,
      role: ADMIN_EMAILS.includes(String(currentUser.email || '').toLowerCase()) ? 'admin' : 'sin rol',
      full_name: currentUser.user_metadata?.full_name || 'Admin',
    }

    const finalProfile = ownProfile || fallbackAdminProfile
    setAdminProfile(finalProfile)

    if (!isAdminAccount(currentUser, finalProfile)) {
      setDrivers([])
      setCategoryRequests([])
      setWomenRequests([])
      setMessage(`Estás logueado como ${currentUser.email}, pero su rol no es admin.`)
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('driver_profiles')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) {
      console.error('ADMIN DRIVER LOAD ERROR:', error)
      setDrivers([])
      setMessage('Tu usuario es admin, pero RLS no está devolviendo choferes. Ejecutá las políticas SQL de admin.')
      setLoading(false)
      return
    }

    const { data: categoryData, error: categoryError } = await supabase
      .from('category_approval_requests')
      .select('*')
      .order('updated_at', { ascending: false })

    if (categoryError) {
      console.warn('ADMIN CATEGORY REQUESTS LOAD ERROR:', categoryError)
      setCategoryRequests([])
    } else {
      setCategoryRequests(categoryData || [])
    }

    const { data: womenData, error: womenError } = await supabase
      .from('profiles')
      .select('*')
      .eq('women_mode_status', 'requested')
      .order('updated_at', { ascending: false })

    if (womenError) {
      console.warn('ADMIN WOMEN REQUESTS LOAD ERROR:', womenError)
      setWomenRequests([])
    } else {
      setWomenRequests(womenData || [])
    }

    if (!data?.length) {
      setMessage('Admin activo. Todavía no hay choferes registrados o RLS no está devolviendo registros.')
    }

    setDrivers(data || [])
    setLoading(false)
  }

  async function openDocument(key, doc) {
    setMessage('')

    if (doc?.url) {
      const fileName = doc.name || DOCUMENT_LABELS[key] || 'Documento'

      setPreviewDoc({
        label: DOCUMENT_LABELS[key] || 'Documento',
        name: fileName,
        url: doc.url,
        isImage: true,
        isPdf: false,
      })
      return
    }

    if (!doc?.path) {
      setMessage('Ese documento todavía no fue cargado.')
      return
    }

    setPreviewLoading(true)

    const { data, error } = await supabase.storage
      .from('driver-documents')
      .createSignedUrl(doc.path, 60 * 10)

    setPreviewLoading(false)

    if (error || !data?.signedUrl) {
      console.error('ADMIN DOCUMENT PREVIEW ERROR:', error)
      setMessage('No pude abrir el documento. Revisá la política de lectura del bucket driver-documents para admin.')
      return
    }

    const fileName = doc.name || doc.path.split('/').pop() || DOCUMENT_LABELS[key]

    setPreviewDoc({
      label: DOCUMENT_LABELS[key] || 'Documento',
      name: fileName,
      url: data.signedUrl,
      isImage: isImageFile(fileName),
      isPdf: isPdfFile(fileName),
    })
  }

  async function updateDriverStatus(driver, status) {
    setMessage('')

    const approved = status === 'approved'
    const documents = driver.documents || {}
    const { missingRequiredDocs } = getDocumentStats(documents)

    const reviewedAt = new Date().toISOString()

    const { error } = await supabase
      .from('driver_profiles')
      .update({
        verification_status: status,
        verified: approved,
        is_online: approved ? driver.is_online : false,
        is_available: approved ? driver.is_available : false,
        reviewed_at: reviewedAt,
        updated_at: reviewedAt,
      })
      .eq('user_id', driver.user_id)

    if (error) {
      console.error('ADMIN DRIVER REVIEW ERROR:', error)
      setMessage('No pude guardar la revisión. Revisá permisos RLS de admin.')
      return
    }

    setDrivers((current) =>
      current.map((item) =>
        item.user_id === driver.user_id
          ? {
              ...item,
              verification_status: status,
              verified: approved,
              is_online: approved ? item.is_online : false,
              is_available: approved ? item.is_available : false,
              reviewed_at: reviewedAt,
            }
          : item
      )
    )

    setMessage(
      approved
        ? missingRequiredDocs.length > 0
          ? `Chofer aprobado con documentos pendientes: ${missingRequiredDocs.map((doc) => doc.label).join(', ')}.`
          : 'Chofer aprobado. Ya puede comenzar viajes.'
        : 'Chofer rechazado. Queda bloqueado para recibir viajes.'
    )
  }

  async function updateCategoryRequest(request, decision) {
    setMessage('')

    const { error } = await adminReviewDriverCategory({
      workerId: request.worker_id,
      categoryCode: request.category_code,
      decision,
      reason: decision === 'approved' ? null : 'Rechazado desde panel admin',
    })

    if (error) {
      console.error('ADMIN CATEGORY REVIEW ERROR:', error)
      setMessage('No pude revisar la categoría. Revisá permisos admin.')
      return
    }

    setMessage(decision === 'approved' ? 'Categoría aprobada.' : 'Categoría rechazada.')
    await loadDrivers()
  }

  async function updateWomenRequest(profileRequest, decision) {
    setMessage('')

    const { error } = await adminReviewWomenMode({
      userId: profileRequest.id,
      decision,
      reason: decision === 'approved' ? null : 'Rechazado desde panel admin',
    })

    if (error) {
      console.error('ADMIN WOMEN REVIEW ERROR:', error)
      setMessage('No pude revisar la preferencia de confianza. Revisa permisos admin.')
      return
    }

    setMessage(decision === 'approved' ? 'Preferencia de confianza aprobada.' : 'Preferencia de confianza rechazada.')
    await loadDrivers()
  }

  function filterTitle() {
    if (filterStatus === 'approved') return 'Aprobados'
    if (filterStatus === 'rejected') return 'Rechazados'
    if (filterStatus === 'all') return 'Todos los choferes'
    if (filterStatus === 'docs_complete') return 'Documentación completa'
    if (filterStatus === 'docs_pending') return 'Documentación pendiente'
    return 'En revisión'
  }

  return (
    <div className="admin-screen">
      <style>{adminStyles}</style>

      <main className="admin-shell">
        <header className="admin-top">
          <div>
            <p>MI CHOFER</p>
            <h1>Verificación</h1>
            <span>Centro de control documental para choferes</span>
          </div>

          <div className="admin-header-right">
            <button type="button" className="admin-refresh" onClick={loadDrivers} aria-label="Actualizar">
              <RefreshCw size={18} />
            </button>

            <div className="admin-user">
              <div className="admin-avatar-wrap">
                {adminProfile?.avatar_url ? (
                  <img className="admin-avatar" src={adminProfile.avatar_url} alt={adminProfile.full_name || adminUser?.email} />
                ) : (
                  <div className="admin-avatar placeholder">{(adminProfile?.full_name || adminUser?.email || 'A').slice(0,1).toUpperCase()}</div>
                )}
              </div>

              <div className="admin-meta">
                <strong>{adminProfile?.full_name || adminUser?.email || 'Admin'}</strong>
                <span className="admin-role">{adminProfile?.role || 'admin'}</span>
              </div>
              <div className="admin-badge">PRO</div>
            </div>
          </div>
        </header>

        <div className="admin-panel">
        <section className="admin-filter-bar" aria-label="Filtros de verificación">
          <button type="button" className={filterStatus === 'submitted' ? 'active' : ''} onClick={() => setFilterStatus('submitted')}>
            <ShieldCheck size={18} />
            <div><strong>{stats.submitted}</strong><span>En revisión</span></div>
          </button>
          <button type="button" className={filterStatus === 'approved' ? 'active' : ''} onClick={() => setFilterStatus('approved')}>
            <UserCheck size={18} />
            <div><strong>{stats.approved}</strong><span>Aprobados</span></div>
          </button>
          <button type="button" className={filterStatus === 'rejected' ? 'active' : ''} onClick={() => setFilterStatus('rejected')}>
            <XCircle size={18} />
            <div><strong>{stats.rejected}</strong><span>Rechazados</span></div>
          </button>
          <button type="button" className={filterStatus === 'docs_complete' ? 'active' : ''} onClick={() => setFilterStatus('docs_complete')}>
            <FileText size={18} />
            <div><strong>{stats.docsComplete}</strong><span>Docs OK</span></div>
          </button>
          <button type="button" className={filterStatus === 'docs_pending' ? 'active' : ''} onClick={() => setFilterStatus('docs_pending')}>
            <AlertTriangle size={18} />
            <div><strong>{stats.docsPending}</strong><span>Faltan docs</span></div>
          </button>
          <button type="button" className={filterStatus === 'all' ? 'active' : ''} onClick={() => setFilterStatus('all')}>
            <div><strong>{stats.total}</strong><span>Todos</span></div>
          </button>
        </section>

        {message && <div className="admin-message">{message}</div>}

        <section className="admin-session">
          <strong>{adminUser?.email || 'Sin sesión'}</strong>
          <span>Rol: {adminProfile?.role || 'sin perfil visible'}</span>
        </section>

        {!adminUser && (
          <a className="admin-login-link" href="/login">
            Iniciar sesión como admin
          </a>
        )}

        {adminUser && (
          <AdminTripSimulator
            adminUser={adminUser}
            drivers={drivers}
            enabled={adminSimulatorEnabled}
            onMessage={setMessage}
          />
        )}

        {womenRequests.length > 0 && (
          <section className="admin-list">
            <div className="admin-list-title">
              <strong>Preferencia de confianza</strong>
              <span>{womenRequests.length} pendiente{womenRequests.length === 1 ? '' : 's'}</span>
            </div>

            {womenRequests.map((request) => (
              <article key={request.id} className="admin-driver-card admin-category-review-card">
                <div className="admin-driver-head">
                  <div>
                    <span className="admin-status submitted">En revisión</span>
                    <h2>{request.full_name || request.email || 'Persona MiChofer'}</h2>
                    <p>Solicito activar preferencia de conductora verificada para viajes con mas privacidad.</p>
                  </div>
                </div>

                <div className="admin-driver-meta">
                  <span>{request.email || 'Sin correo'}</span>
                  <span>Identidad privada</span>
                  <span>{request.women_mode_status || 'requested'}</span>
                </div>

                <div className="admin-actions">
                  <button className="approve" type="button" onClick={() => updateWomenRequest(request, 'approved')}>
                    Aprobar preferencia
                  </button>

                  <button className="reject" type="button" onClick={() => updateWomenRequest(request, 'rejected')}>
                    Rechazar
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}

        {categoryRequests.filter((request) => ['requested', 'in_review'].includes(request.status)).length > 0 && (
          <section className="admin-list">
            <div className="admin-list-title">
              <strong>Categorías de chofer</strong>
              <span>
                {categoryRequests.filter((request) => ['requested', 'in_review'].includes(request.status)).length} pendiente
              </span>
            </div>

            {categoryRequests
              .filter((request) => ['requested', 'in_review'].includes(request.status))
              .map((request) => {
                const driver = drivers.find((item) => item.user_id === request.worker_id)
                const meta = getRideCategoryMeta(request.category_code)

                return (
                  <article key={request.id} className="admin-driver-card admin-category-review-card">
                    <div className="admin-driver-head">
                      <div>
                        <span className="admin-status submitted">{categoryStatusLabel('requested')}</span>
                        <h2>{meta.title}</h2>
                        <p>{driver?.full_name || 'Chofer MiChofer'} quiere activar esta categoría.</p>
                      </div>
                    </div>

                    <div className="admin-driver-meta">
                      <span>{driver?.email || 'Sin correo visible'}</span>
                      <span>{getDriverVehicleKind(driver)} · {getDriverVehicleTitle(driver)}</span>
                      <span>{getDriverVehiclePlate(driver)}</span>
                    </div>

                    <div className="admin-actions">
                      <button className="approve" type="button" onClick={() => updateCategoryRequest(request, 'approved')}>
                        Aprobar categoría
                      </button>

                      <button className="reject" type="button" onClick={() => updateCategoryRequest(request, 'rejected')}>
                        Rechazar
                      </button>
                    </div>
                  </article>
                )
              })}
          </section>
        )}

        {loading ? (
          <section className="admin-empty">Cargando choferes...</section>
        ) : drivers.length === 0 ? (
          <section className="admin-empty">Todavía no hay choferes registrados.</section>
        ) : filteredDrivers.length === 0 ? (
          <section className="admin-empty">No hay choferes en {filterTitle().toLowerCase()}.</section>
        ) : (
          <section className="admin-list">
            <div className="admin-list-title">
              <strong>{filterTitle()}</strong>
              <span>{filteredDrivers.length} resultado{filteredDrivers.length === 1 ? '' : 's'}</span>
            </div>

            {filteredDrivers.map((driver) => {
              const documents = driver.documents || {}
              const docStats = getDocumentStats(documents)
              const status = driver.verification_status || 'incomplete'
              const showDocuments = status === 'submitted' || expandedDocs[driver.user_id]

              return (
                <article key={driver.user_id} className="admin-driver-card">
                  <div className="admin-driver-head">
                    <div>
                      <span className={`admin-status ${status}`}>
                        {statusLabel(status)}
                      </span>

                      <h2>{driver.full_name || 'Chofer MiChofer'}</h2>

                      <p>
                        {getDriverVehicleKind(driver)} · {getDriverVehicleTitle(driver)} · {getDriverVehiclePlate(driver)}
                      </p>
                    </div>

                    <div className={docStats.docsComplete ? 'admin-doc-badge ok' : 'admin-doc-badge warn'}>
                      <FileText size={15} />
                      {docStats.docsComplete ? 'Docs OK' : 'Faltan docs'}
                    </div>
                  </div>

                  <div className="admin-driver-meta">
                    <span>{driver.phone || 'Sin teléfono'}</span>
                    <span>{driver.email || 'Sin correo'}</span>
                    <span>{driver.payout_alias || 'Sin alias'}</span>
                    <span>{docStats.uploadedRequiredCount}/{docStats.totalRequiredCount} obligatorios</span>
                  </div>

                  {!docStats.docsComplete && (
                    <div className="admin-missing-docs">
                      <strong>Faltan:</strong>{' '}
                      {docStats.missingRequiredDocs.map((doc) => doc.label).join(', ')}
                    </div>
                  )}

                  <div className={showDocuments ? 'admin-docs' : 'admin-docs collapsed'}>
                    <div className="admin-doc-summary">
                      <FileText size={18} />
                      <strong>
                        {docStats.uploadedRequiredCount}/{docStats.totalRequiredCount} obligatorios
                      </strong>
                    </div>

                    {status !== 'submitted' && (
                      <button
                        type="button"
                        className="toggle-docs"
                        onClick={() =>
                          setExpandedDocs((current) => ({
                            ...current,
                            [driver.user_id]: !current[driver.user_id],
                          }))
                        }
                      >
                        {showDocuments ? 'Ocultar archivos' : 'Ver archivos'}
                      </button>
                    )}

                    {showDocuments && (
                      <div className="admin-doc-grid">
                        {DOCUMENT_REQUIREMENTS.map((doc) => {
                          const uploaded = getDocumentValue(documents, doc.key)

                          return (
                            <button
                              key={doc.key}
                              type="button"
                              className={uploaded ? 'admin-doc-card done' : 'admin-doc-card missing'}
                              onClick={() => openDocument(doc.key, uploaded)}
                              disabled={!uploaded || previewLoading}
                              title={uploaded ? 'Ver documento' : 'Documento pendiente'}
                            >
                              <div className="admin-doc-card-head">
                                {uploaded ? <Eye size={16} /> : <XCircle size={16} />}
                                <strong>{doc.label}</strong>
                              </div>

                              <span>{doc.required ? 'Obligatorio' : 'Opcional'}</span>
                              <p>{uploaded ? 'Documento cargado. Tocar para revisar.' : doc.description}</p>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {status !== 'approved' && status !== 'rejected' && (
                    <div className="admin-actions">
                      <button
                        type="button"
                        className="approve"
                        onClick={() => updateDriverStatus(driver, 'approved')}
                      >
                        {docStats.docsComplete ? 'Aprobar' : 'Aprobar con faltantes'}
                      </button>

                      <button
                        type="button"
                        className="reject"
                        onClick={() => {
                          if (window.confirm('Rechazar este chofer impedirá que reciba viajes.')) {
                            updateDriverStatus(driver, 'rejected')
                          }
                        }}
                      >
                        Rechazar
                      </button>
                    </div>
                  )}
                </article>
              )
            })}
          </section>
        )}
        </div>
      </main>

      {previewDoc && (
        <div className="admin-preview-backdrop" onClick={() => setPreviewDoc(null)}>
          <section className="admin-preview" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <p>DOCUMENTO</p>
                <h2>{previewDoc.label}</h2>
                <span>{previewDoc.name}</span>
              </div>

              <button
                type="button"
                className="admin-preview-close"
                onClick={() => setPreviewDoc(null)}
                aria-label="Cerrar vista previa"
              >
                <X size={20} />
              </button>
            </header>

            <div className="admin-preview-body">
              {previewDoc.isImage ? (
                <img src={previewDoc.url} alt={previewDoc.label} />
              ) : previewDoc.isPdf ? (
                <iframe src={previewDoc.url} title={previewDoc.label} />
              ) : (
                <div className="admin-preview-file">
                  <FileText size={38} />
                  <strong>No hay vista previa para este formato.</strong>
                </div>
              )}
            </div>

            <a href={previewDoc.url} target="_blank" rel="noreferrer">
              <ExternalLink size={18} />
              Abrir archivo completo
            </a>
          </section>
        </div>
      )}
    </div>
  )
}

const adminStyles = `
  :root{
    --bg-0: #071018; /* deep navy */
    --bg-1: linear-gradient(180deg,#071018 0%, #031018 100%);
    --card: rgba(255,255,255,0.04);
    --muted: rgba(255,255,255,0.62);
    --accent-a: #22f0bd;
    --accent-b: #04c7f4;
    --glass: rgba(255,255,255,0.06);
    --success: #06a77d;
    --danger: #ff4d63;
    --surface: rgba(255,255,255,0.02);
  }

  .admin-screen {
    min-height: 100vh;
    height: 100vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    background: var(--bg-1);
    color: var(--muted);
    display: flex;
    justify-content: center;
    font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;
    -webkit-font-smoothing: antialiased;
  }

  .admin-shell {
    width: 100%;
    max-width: 1180px;
    padding: 28px;
    display: grid;
    gap: 18px;
    align-content: start;
  }

  .admin-panel {
    background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    border-radius: 28px;
    padding: 22px;
    display: grid;
    gap: 18px;
    align-content: start;
    box-shadow: 0 20px 60px rgba(2,8,10,0.6), inset 0 1px 0 rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.03);
  }

  .admin-top {
    min-height: 120px;
    border-radius: 22px;
    background: linear-gradient(90deg, rgba(34,240,189,0.12), rgba(4,199,244,0.08));
    color: white;
    padding: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    position: relative;
    overflow: visible;
  }

  .admin-top::after{
    content: '';
    position: absolute;
    right: -40px;
    top: -20px;
    width: 220px;
    height: 220px;
    background: radial-gradient(circle at 30% 30%, rgba(34,240,189,0.08), transparent 20%), radial-gradient(circle at 70% 70%, rgba(4,199,244,0.06), transparent 30%);
    filter: blur(18px);
    pointer-events: none;
  }

  .admin-top p {
    margin: 0 0 8px;
    color: var(--accent-a);
    font-size: 12px;
    letter-spacing: .14em;
    font-weight: 800;
    text-transform: uppercase;
  }

  .admin-top h1 {
    margin: 0;
    font-size: 36px;
    line-height: 1;
    font-weight: 900;
    color: #f7fbfb;
  }

  .admin-top span {
    display: block;
    margin-top: 8px;
    color: rgba(255,255,255,.66);
    font-size: 13px;
    font-weight: 700;
  }

  .admin-top button {
    width: 56px;
    height: 56px;
    border: 0;
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02));
    color: white;
    display: grid;
    place-items: center;
    cursor: pointer;
    transition: transform .18s ease, box-shadow .18s ease;
  }
  .admin-top button:hover{ transform: translateY(-3px); box-shadow: 0 10px 30px rgba(2,8,10,0.45); }

  .admin-header-right { display: flex; align-items: center; gap: 12px; }
  .admin-refresh { width: 46px; height: 46px; border: 0; border-radius: 12px; background: rgba(255,255,255,0.03); display: grid; place-items: center; color: #fff; cursor: pointer; }

  .admin-user { display: flex; align-items: center; gap: 10px; background: linear-gradient(90deg, rgba(255,255,255,0.02), transparent); padding: 6px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.02); }
  .admin-avatar-wrap { width: 44px; height: 44px; border-radius: 10px; overflow: hidden; display: grid; place-items: center; background: rgba(255,255,255,0.03); }
  .admin-avatar { width: 100%; height: 100%; object-fit: cover; display: block; }
  .admin-avatar.placeholder { width: 44px; height: 44px; display: grid; place-items: center; color: #fff; font-weight: 900; font-size: 18px; }
  .admin-meta { display: grid; line-height: 1; }
  .admin-meta strong { font-size: 13px; color: #fff; font-weight: 900; }
  .admin-meta span { font-size: 11px; color: rgba(255,255,255,0.66); font-weight: 700; }
  .admin-badge { background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; font-weight: 900; padding: 6px 10px; border-radius: 999px; font-size: 12px; }

  .admin-filter-bar {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    padding-bottom: 6px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .admin-filter-bar::-webkit-scrollbar { display: none; }

  .admin-filter-bar button {
    flex: 0 0 auto;
    min-width: 130px;
    min-height: 96px;
    border: 0;
    border-radius: 18px;
    background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    box-shadow: 0 12px 40px rgba(0,0,0,0.45);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 16px;
    cursor: pointer;
    color: rgba(255,255,255,0.9);
    transition: transform .18s ease, box-shadow .18s ease;
  }
  .admin-filter-bar button:hover{ transform: translateY(-6px); box-shadow: 0 20px 60px rgba(0,0,0,0.6); }

  .admin-filter-bar button svg { color: var(--accent-a); }
  .admin-filter-bar button div { display: flex; flex-direction: column; }
  .admin-filter-bar button strong { font-size: 28px; font-weight: 900; line-height: 1; color: #fff; }
  .admin-filter-bar button span { color: rgba(255,255,255,0.66); font-size: 12px; font-weight: 700; margin-top: 4px; }

  .admin-filter-bar button.active { background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; box-shadow: 0 26px 70px rgba(3,199,244,0.12); }
  .admin-filter-bar button.active span { color: rgba(4,17,15,.8); }

  .admin-message,
  .admin-session,
  .admin-empty,
  .admin-login-link {
    padding: 16px;
    font-weight: 800;
  }

  .admin-message {
    border-radius: 16px;
    background: linear-gradient(180deg,#fff8e0,#fff6d0);
    color: #6a3e00;
  }

  .admin-session {
    border-radius: 14px;
    background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
    display: grid;
    gap: 6px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.45);
  }

  .admin-session strong { color: #f7fbfb; font-size: 14px; }
  .admin-session span { color: rgba(255,255,255,0.66); font-size: 13px; }

  .admin-login-link { display: flex; min-height: 52px; align-items: center; justify-content: center; border-radius: 12px; background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; text-decoration: none; font-weight: 900; }

  .admin-sim-steps { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .admin-sim-steps span { min-height: 30px; border-radius: 999px; padding: 0 12px; display: inline-flex; align-items: center; color: rgba(255,255,255,0.88); background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.02); font-size: 12px; font-weight: 800; }

  .admin-sim-panel { display: grid; gap: 12px; align-content: start; }
  .admin-sim-panel label { display: grid; gap: 6px; color: rgba(255,255,255,0.85); font-size: 12px; font-weight: 800; }

  .admin-sim-panel input, .admin-sim-panel select { width: 100%; min-height: 44px; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 0 12px; background: rgba(255,255,255,0.02); color: #fff; outline: 0; font-weight: 700; }

  .admin-sim-speed, .admin-sim-actions { display: flex; flex-wrap: wrap; gap: 10px; }

  .admin-sim-markers button, .admin-sim-speed button, .admin-sim-actions button { min-height: 44px; border: 0; border-radius: 999px; padding: 0 14px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: rgba(255,255,255,0.02); color: #fff; font-weight: 800; cursor: pointer; transition: transform .14s ease, box-shadow .14s ease; }
  .admin-sim-markers button:hover, .admin-sim-speed button:hover, .admin-sim-actions button:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(0,0,0,0.5); }

  .admin-sim-markers button.active, .admin-sim-speed button.active, .admin-sim-actions button.approve { background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; }
  .admin-sim-actions button.reject { background: linear-gradient(90deg, rgba(255,77,99,0.18), rgba(255,77,99,0.06)); color: #ffdce3; }

  .admin-sim-actions .admin-sim-start { flex: 1 1 100%; min-height: 56px; border-radius: 14px; background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; box-shadow: 0 24px 64px rgba(4,199,244,0.12); letter-spacing: .03em; text-transform: uppercase; font-weight: 900; }
  .admin-sim-actions button:disabled { opacity: 0.36; cursor: not-allowed; transform: none; box-shadow: none; }

  .admin-simulator-trigger { border-radius: 18px; padding: 14px 18px; background: radial-gradient(circle at 10% 20%, rgba(34,240,189,0.06), transparent), rgba(2,6,8,0.4); color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.6); }

  .admin-sim-trigger-info { display: flex; flex-direction: column; gap: 4px; }
  .admin-sim-trigger-info strong { font-size: 15px; font-weight: 900; color: #fff; }
  .admin-sim-trigger-info span { font-size: 12px; color: rgba(255,255,255,0.8); font-weight: 700; }

  .admin-sim-trigger-btn { flex: 0 0 auto; min-height: 46px; border: 0; border-radius: 999px; padding: 0 16px; display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; font-weight: 900; cursor: pointer; box-shadow: 0 18px 44px rgba(4,199,244,0.12); }

  .admin-simulator-modal { width: min(1200px, calc(100vw - 36px)); height: calc(100vh - 36px); max-height: calc(100vh - 36px); border-radius: 22px; background: linear-gradient(180deg, rgba(3,6,10,0.95), rgba(3,6,10,0.94)); color: #f8fffd; padding: 18px; display: grid; grid-template-rows: auto 1fr; gap: 14px; box-shadow: 0 40px 120px rgba(0,0,0,0.6); overflow: hidden; }

  .admin-map-picker-modal { width: min(1180px, calc(100vw - 36px)); height: calc(100vh - 36px); max-height: calc(100vh - 36px); border-radius: 22px; background: linear-gradient(180deg, rgba(3,6,10,0.95), rgba(3,6,10,0.94)); color: #f8fffd; padding: 18px; display: grid; grid-template-rows: auto auto minmax(220px, 1fr) auto; gap: 14px; box-shadow: 0 40px 120px rgba(0,0,0,0.6); overflow: hidden; }

  .admin-sim-modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
  .admin-sim-modal-header p { margin: 0 0 6px; color: var(--accent-a); font-size: 11px; letter-spacing: .16em; font-weight: 900; }
  .admin-sim-modal-header h2 { margin: 0; font-size: 22px; font-weight: 900; }
  .admin-sim-modal-header span { display: block; margin-top: 6px; color: rgba(248,255,253,.76); font-size: 12px; font-weight: 700; }
  .admin-sim-modal-header .admin-preview-close { background: rgba(255,255,255,0.04); color: #fff; }

  .admin-sim-modal-body { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 480px); gap: 16px; overflow: hidden; -webkit-overflow-scrolling: touch; }

  .admin-sim-live-map { position: relative; min-height: 0; border-radius: 18px; overflow: hidden; background: #0b1416; box-shadow: inset 0 -60px 120px rgba(0,0,0,0.4); }
  .admin-sim-live-map .mobility-map { height: 100%; min-height: 100%; margin: 0; border-radius: 18px; }

  .admin-sim-navigation-hud { position: absolute; top: 18px; left: 18px; z-index: 8; width: min(420px, calc(100% - 36px)); border-radius: 14px; padding: 16px 18px; background: linear-gradient(180deg, rgba(2,8,10,0.86), rgba(2,8,10,0.72)); color: #f8fffd; box-shadow: 0 22px 60px rgba(0,0,0,0.6); backdrop-filter: blur(8px); display: grid; gap: 4px; pointer-events: none; border: 1px solid rgba(255,255,255,0.02); }
  .admin-sim-navigation-hud span { font-size: 12px; font-weight: 800; color: var(--accent-a); text-transform: uppercase; letter-spacing: .08em; }
  .admin-sim-navigation-hud strong { font-size: clamp(22px, 3.4vw, 36px); line-height: 1.02; font-weight: 900; color: #fff; }
  .admin-sim-navigation-hud small { font-size: 13px; color: rgba(255,255,255,0.72); font-weight: 700; }

  .admin-sim-control-panel { min-height: 0; display: grid; gap: 12px; align-content: start; overflow-y: auto; padding-right: 8px; }

  .admin-sim-modal-body label { display: grid; gap: 6px; color: rgba(255,255,255,0.9); font-size: 12px; font-weight: 800; }
  .admin-sim-modal-body select { width: 100%; min-height: 46px; border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 0 12px; background: rgba(255,255,255,0.02); color: #fff; outline: 0; font-weight: 700; }
  .admin-sim-modal-body option { color: #07110f; }

  .admin-sim-location-card { border-radius: 12px; background: rgba(255,255,255,0.02); padding: 14px; display: grid; gap: 12px; border: 1px solid rgba(255,255,255,0.02); }
  .admin-sim-location-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .admin-sim-location-row > div { display: flex; flex-direction: column; gap: 4px; }
  .admin-sim-location-row span { font-size: 12px; color: rgba(255,255,255,0.6); font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
  .admin-sim-location-row strong { font-size: 13px; font-weight: 900; word-break: break-word; color: #fff; }
  .admin-sim-location-actions { display: flex; flex-wrap: wrap; gap: 8px; }

  .admin-sim-map-btn { flex: 1 1 auto; min-height: 46px; border: 0; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; font-weight: 900; cursor: pointer; }
  .admin-sim-map-btn.ghost { background: rgba(255,255,255,0.03); color: #fff; }
  .admin-sim-route-hint { font-size: 12px; color: rgba(255,255,255,0.6); font-weight: 700; }

  .admin-map-picker-toggle { display: flex; gap: 8px; flex: 0 0 auto; }
  .admin-map-picker-toggle button { flex: 1 1 auto; min-height: 44px; border: 0; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; background: rgba(255,255,255,0.03); color: #fff; font-weight: 800; cursor: pointer; }
  .admin-map-picker-toggle button.active { background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; }

  .admin-map-picker-map { flex: 1 1 auto; min-height: 0; border-radius: 14px; overflow: hidden; background: #0b1416; }
  .admin-map-picker-map .mobility-map { height: 100%; min-height: 100%; margin: 0; border-radius: 14px; }

  .admin-map-picker-footer { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .admin-map-picker-coords { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: rgba(255,255,255,0.7); font-weight: 700; }
  .admin-map-picker-footer .approve { min-height: 48px; border: 0; border-radius: 12px; padding: 0 20px; background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; font-weight: 900; cursor: pointer; white-space: nowrap; }

  @media (max-width: 760px) { .admin-sim-modal-body { grid-template-columns: 1fr; grid-template-rows: minmax(44vh, 1fr) auto; } .admin-sim-live-map { min-height: 44vh; } .admin-map-picker-map { min-height: 50vh; } }

  .admin-sim-status { display: grid; gap: 6px; padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.02); color: rgba(255,255,255,0.8); font-size: 13px; font-weight: 700; }

  .admin-list { display: grid; gap: 14px; }
  .admin-list-title { min-height: 54px; border-radius: 14px; background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)); padding: 0 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: 0 10px 36px rgba(0,0,0,0.45); }
  .admin-list-title strong { font-size: 16px; font-weight: 900; color: #fff; }
  .admin-list-title span { color: rgba(255,255,255,0.66); font-size: 13px; font-weight: 700; }

  .admin-driver-card { padding: 16px; display: grid; gap: 12px; border-radius: 12px; background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.005)); border: 1px solid rgba(255,255,255,0.02); box-shadow: 0 8px 30px rgba(0,0,0,0.45); }

  .admin-driver-head { display: flex; justify-content: space-between; gap: 14px; }

  .admin-status { display: inline-flex; min-height: 30px; align-items: center; border-radius: 999px; padding: 0 12px; background: rgba(255,255,255,0.04); color: #fff; font-size: 12px; font-weight: 900; }
  .admin-status.approved { background: rgba(6,167,125,0.12); color: var(--accent-a); }
  .admin-status.rejected { background: rgba(255,77,99,0.08); color: var(--danger); }

  .admin-driver-card h2 { margin: 6px 0 0; font-size: 22px; line-height: 1; font-weight: 900; color: #fff; }
  .admin-driver-card p { margin: 6px 0 0; color: rgba(255,255,255,0.66); font-size: 14px; font-weight: 700; }

  .admin-driver-meta { display: flex; flex-wrap: wrap; gap: 8px; }
  .admin-driver-meta span { min-height: 34px; border-radius: 999px; background: rgba(255,255,255,0.02); padding: 8px 10px; color: rgba(255,255,255,0.78); font-size: 13px; font-weight: 700; }

  .admin-doc-badge { width: fit-content; min-height: 34px; border-radius: 999px; display: inline-flex; align-items: center; gap: 8px; padding: 0 12px; font-size: 13px; font-weight: 900; white-space: nowrap; }
  .admin-doc-badge.ok { background: rgba(6,167,125,0.08); color: var(--accent-a); }
  .admin-doc-badge.warn { background: rgba(255,200,100,0.06); color: #ffd27a; }

  .admin-missing-docs { border-radius: 12px; background: rgba(255,200,100,0.06); color: #ffd27a; padding: 12px; font-size: 13px; font-weight: 700; line-height: 1.35; }

  .admin-docs { display: flex; flex-wrap: wrap; gap: 8px; }
  .admin-docs.collapsed { align-items: center; }
  .admin-doc-summary, .admin-docs button.toggle-docs { min-height: 36px; border-radius: 999px; display: flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 12px; font-weight: 900; }
  .admin-doc-summary { background: rgba(255,255,255,0.02); color: #fff; }
  .admin-docs button.toggle-docs { border: 0; background: #fff; color: #07110f; box-shadow: inset 0 0 0 1px #dde5e2; cursor: pointer; }

  .admin-doc-grid { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }

  .admin-doc-card { min-height: 122px; border: 0; border-radius: 12px; padding: 12px; text-align: left; display: grid; gap: 8px; cursor: pointer; }
  .admin-doc-card.done { background: rgba(6,167,125,0.06); color: var(--accent-a); }
  .admin-doc-card.missing { background: rgba(255,200,100,0.04); color: #ffd27a; }
  .admin-doc-card:disabled { cursor: not-allowed; opacity: .82; }

  .admin-doc-card-head { display: flex; align-items: center; gap: 8px; }
  .admin-doc-card-head strong { font-size: 13px; font-weight: 900; }
  .admin-doc-card span { width: fit-content; border-radius: 999px; background: rgba(255,255,255,0.04); padding: 5px 8px; font-size: 11px; font-weight: 900; }
  .admin-doc-card p { margin: 0; color: inherit; opacity: .9; font-size: 12px; line-height: 1.3; font-weight: 700; }

  .admin-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .admin-actions button { min-height: 48px; border: 0; border-radius: 12px; font-size: 15px; font-weight: 900; cursor: pointer; }
  .admin-actions .approve { background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; }
  .admin-actions .reject { background: rgba(255,77,99,0.08); color: var(--danger); }

  .admin-preview-backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(2,6,8,0.7); padding: 18px; display: flex; align-items: center; justify-content: center; }
  .admin-preview { width: min(980px, 100%); max-height: calc(100vh - 36px); border-radius: 16px; background: linear-gradient(180deg,#0a1112,#061216); padding: 18px; display: grid; gap: 14px; box-shadow: 0 40px 120px rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.02); }

  .admin-preview header { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .admin-preview header p { margin: 0 0 6px; color: var(--accent-a); font-size: 11px; letter-spacing: .16em; font-weight: 900; }
  .admin-preview h2 { margin: 0; color: #fff; font-size: 20px; line-height: 1; font-weight: 900; }
  .admin-preview header span { display: block; margin-top: 6px; color: rgba(255,255,255,0.6); font-size: 13px; font-weight: 700; }

  .admin-preview-close { width: 46px; height: 46px; border: 0; border-radius: 12px; background: rgba(255,255,255,0.03); color: #fff; display: grid; place-items: center; cursor: pointer; flex: 0 0 auto; }

  .admin-preview-body { min-height: 320px; max-height: 62vh; border-radius: 12px; background: rgba(255,255,255,0.02); overflow: hidden; display: grid; place-items: center; }
  .admin-preview-body img, .admin-preview-body iframe { width: 100%; height: 100%; min-height: 320px; border: 0; }
  .admin-preview-body img { object-fit: contain; }
  .admin-preview-file { padding: 26px; color: rgba(255,255,255,0.7); display: grid; justify-items: center; gap: 12px; text-align: center; }
  .admin-preview a { min-height: 48px; border-radius: 12px; background: linear-gradient(90deg,var(--accent-a),var(--accent-b)); color: #04110f; display: flex; align-items: center; justify-content: center; gap: 8px; text-decoration: none; font-size: 14px; font-weight: 900; }

  @media (max-width: 860px) { .admin-doc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .admin-shell { padding: 12px; gap: 12px; } .admin-panel { padding: 12px; border-radius: 14px; gap: 12px; } .admin-top { border-radius: 14px; } .admin-top h1 { font-size: 28px; } .admin-doc-grid { grid-template-columns: 1fr; } .admin-driver-head { display: grid; } .admin-preview { border-radius: 12px; } }
`
