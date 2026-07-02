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
    description: 'Debe estar vigente y a nombre del conductor.',
  },
  {
    key: 'identity_document',
    label: 'Cédula / DNI',
    required: true,
    description: 'Documento de identidad del conductor.',
  },
  {
    key: 'driver_profile_photo',
    label: 'Foto de perfil',
    required: true,
    description: 'Foto clara del rostro del conductor.',
  },
  {
    key: 'vehicle_photo',
    label: 'Foto del vehículo',
    required: true,
    description: 'Debe verse el vehículo y la matrícula.',
  },
  {
    key: 'green_card',
    label: 'Cédula verde',
    required: true,
    description: 'Documento del vehículo.',
  },
  {
    key: 'vehicle_insurance',
    label: 'Seguro del vehículo',
    required: true,
    description: 'Póliza vigente del vehículo.',
  },
  {
    key: 'vehicle_registration',
    label: 'Registro / habilitación',
    required: true,
    description: 'Registro o habilitación vehicular si aplica.',
  },
  {
    key: 'criminal_record',
    label: 'Antecedentes penales',
    required: true,
    description: 'Certificado de no antecedentes.',
  },
  {
    key: 'vehicle_inspection',
    label: 'Inspección técnica',
    required: false,
    description: 'Revisión técnica o inspección vehicular.',
  },
]

const DOCUMENT_LABELS = DOCUMENT_REQUIREMENTS.reduce((acc, item) => {
  acc[item.key] = item.label
  return acc
}, {})

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
  const uploadedRequiredCount = requiredDocs.filter((doc) => documents[doc.key]).length
  const totalRequiredCount = requiredDocs.length
  const uploadedTotalCount = DOCUMENT_REQUIREMENTS.filter((doc) => documents[doc.key]).length
  const docsComplete = uploadedRequiredCount >= totalRequiredCount
  const missingRequiredDocs = requiredDocs.filter((doc) => !documents[doc.key])

  return {
    requiredDocs,
    uploadedRequiredCount,
    totalRequiredCount,
    uploadedTotalCount,
    docsComplete,
    missingRequiredDocs,
  }
}

const DEFAULT_SIM_A = { lat: -25.5167, lng: -54.6167 }
const DEFAULT_SIM_B = { lat: -25.5098, lng: -54.6128 }
const SIM_SPEEDS = {
  slow: { label: 'Lento', interval: 1400, speed: 4 },
  normal: { label: 'Normal', interval: 850, speed: 8 },
  fast: { label: 'Rapido', interval: 420, speed: 14 },
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

function interpolateSimRoute(a, b, steps = 80) {
  if (!isValidSimPoint(a) || !isValidSimPoint(b)) return []
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps
    return {
      lat: Number(a.lat) + (Number(b.lat) - Number(a.lat)) * progress,
      lng: Number(a.lng) + (Number(b.lng) - Number(a.lng)) * progress,
    }
  })
}

function formatSimPoint(point) {
  if (!isValidSimPoint(point)) return ''
  return `${Number(point.lat).toFixed(6)}, ${Number(point.lng).toFixed(6)}`
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
  const timerRef = useRef(null)
  const routeRef = useRef([])
  const tripRef = useRef(null)

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.user_id === selectedDriverId) || null,
    [drivers, selectedDriverId]
  )

  const mapOrigin = isValidSimPoint(pointA) ? pointA : DEFAULT_SIM_A
  const mapDestination = isValidSimPoint(pointB) ? pointB : DEFAULT_SIM_B
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
    if (!enabled || !adminUser?.id) return

    let cancelled = false
    async function loadClients() {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
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
    if (markMode === 'b') {
      setPointB(point)
    } else {
      setPointA(point)
    }
  }

  function updatePoint(which, field, value) {
    const setter = which === 'a' ? setPointA : setPointB
    setter((current) => ({ ...current, [field]: Number(value) }))
  }

  async function buildRoute() {
    if (!isValidSimPoint(pointA) || !isValidSimPoint(pointB)) return []

    const routeResult = await computeRouteWithRoutesApi({
      origin: pointA,
      destination: pointB,
      waypoints: [],
    })

    if (Array.isArray(routeResult?.path) && routeResult.path.length >= 2) {
      setRoutePath(routeResult.path)
      setRouteSource('Google Routes API')
      return routeResult.path
    }

    const fallback = interpolateSimRoute(pointA, pointB)
    setRoutePath(fallback)
    setRouteSource('Fallback interpolado')
    return fallback
  }

  async function createTrip() {
    if (!canCreateTrip) {
      onMessage?.('Elegí punto A, punto B, chofer y cliente para crear el viaje test.')
      return
    }

    stopSimulation()
    const path = await buildRoute()
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
      onMessage?.('No pude crear el viaje test. Ejecutá el SQL admin del simulador si RLS bloquea.')
      return
    }

    setRoutePath(path)
    setActiveTrip(data)
    setSimIndex(0)
    onMessage?.('Viaje test creado. Abrí /client y /driver para ver el flujo real.')
  }

  async function setTripStatus(status) {
    if (!activeTrip?.id) return
    const { data, error } = await adminUpdateTestTripStatus({ tripId: activeTrip.id, status })
    if (error) {
      console.error('ADMIN TEST TRIP STATUS ERROR:', error)
      onMessage?.('No pude actualizar el estado del viaje test.')
      return
    }
    setActiveTrip(data || { ...activeTrip, status })
  }

  async function pushSimPoint(index, status = null) {
    const path = routeRef.current.length >= 2 ? routeRef.current : interpolateSimRoute(pointA, pointB)
    const point = path[Math.min(index, path.length - 1)]
    const nextPoint = path[Math.min(index + 1, path.length - 1)] || point
    const trip = tripRef.current
    if (!trip?.id || !isValidSimPoint(point)) return

    const heading = simBearing(point, nextPoint)
    const speed = SIM_SPEEDS[speedMode]?.speed || SIM_SPEEDS.normal.speed
    const { data, error } = await adminUpdateTestTripLocation({
      tripId: trip.id,
      driverId: trip.driver_id || selectedDriverId,
      lat: point.lat,
      lng: point.lng,
      heading,
      speed,
      accuracy: 8,
      status,
    })

    if (error) {
      console.error('ADMIN TEST TRIP LOCATION ERROR:', error)
      onMessage?.('No pude mover el viaje test. Revisá RPC/RLS admin.')
      stopSimulation()
      return
    }

    if (data) setActiveTrip(data)
    setSimIndex(index)
  }

  async function startSimulation() {
    if (!activeTrip?.id) {
      onMessage?.('Primero creá un viaje test.')
      return
    }

    const path = routePath.length >= 2 ? routePath : await buildRoute()
    if (path.length < 2) {
      onMessage?.('No hay ruta válida para simular.')
      return
    }

    if (activeTrip.status === 'pending') {
      await setTripStatus('accepted')
    }

    stopSimulation()
    setSimulating(true)
    const interval = SIM_SPEEDS[speedMode]?.interval || SIM_SPEEDS.normal.interval

    timerRef.current = window.setInterval(async () => {
      const nextIndex = Math.min((simIndexRef.current || 0) + 1, routeRef.current.length - 1)
      const nextStatus = tripRef.current?.status === 'in_progress' ? 'in_progress' : 'arriving'
      await pushSimPoint(nextIndex, nextStatus)

      if (nextIndex >= routeRef.current.length - 1) {
        stopSimulation()
        if (tripRef.current?.status === 'in_progress') {
          await setTripStatus('completed')
        }
      }
    }, interval)
  }

  const simIndexRef = useRef(0)
  useEffect(() => {
    simIndexRef.current = simIndex
  }, [simIndex])

  async function resetSimulation() {
    stopSimulation()
    setSimIndex(0)
    if (activeTrip?.id) {
      await pushSimPoint(0, activeTrip.status || 'accepted')
    }
  }

  const progress = routePath.length > 1 ? Math.round((simIndex / (routePath.length - 1)) * 100) : 0

  if (!enabled) {
    return (
      <section className="admin-simulator admin-empty">
        No autorizado para usar el simulador.
      </section>
    )
  }

  return (
    <section className="admin-simulator">
      <div className="admin-list-title">
        <strong>Simulador de viajes</strong>
        <span>{activeTrip?.status || 'sin viaje'} · {progress}%</span>
      </div>

      <div className="admin-sim-grid">
        <div className="admin-sim-map">
          <InteractiveRouteMap
            origin={mapOrigin}
            destination={mapDestination}
            destinationText="Viaje test admin"
            drivers={selectedDriver ? [{ ...selectedDriver, lat: Number(selectedDriver.lat), lng: Number(selectedDriver.lng) }] : []}
            selectedDriver={null}
            onSelectDriver={() => {}}
            onChooseDriver={() => {}}
            onRefreshLocation={() => {}}
            onMapClick={handleMapClick}
            showRouteSummary={false}
            animateCamera={false}
          />
        </div>

        <div className="admin-sim-panel">
          <div className="admin-sim-markers">
            <button type="button" className={markMode === 'a' ? 'active' : ''} onClick={() => setMarkMode('a')}>
              <MapPin size={16} /> Marcar punto A
            </button>
            <button type="button" className={markMode === 'b' ? 'active' : ''} onClick={() => setMarkMode('b')}>
              <MapPin size={16} /> Marcar punto B
            </button>
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

          <div className="admin-sim-points">
            <label>
              A lat
              <input type="number" step="0.000001" value={pointA.lat} onChange={(event) => updatePoint('a', 'lat', event.target.value)} />
            </label>
            <label>
              A lng
              <input type="number" step="0.000001" value={pointA.lng} onChange={(event) => updatePoint('a', 'lng', event.target.value)} />
            </label>
            <label>
              B lat
              <input type="number" step="0.000001" value={pointB.lat} onChange={(event) => updatePoint('b', 'lat', event.target.value)} />
            </label>
            <label>
              B lng
              <input type="number" step="0.000001" value={pointB.lng} onChange={(event) => updatePoint('b', 'lng', event.target.value)} />
            </label>
          </div>

          <div className="admin-sim-status">
            <span>A: {formatSimPoint(pointA)}</span>
            <span>B: {formatSimPoint(pointB)}</span>
            <span>Ruta: {routeSource || 'sin calcular'} · {routeKm.toFixed(2)} km</span>
            <span>Trip: {activeTrip?.id || 'sin viaje'}</span>
          </div>

          <div className="admin-sim-speed">
            {Object.entries(SIM_SPEEDS).map(([key, item]) => (
              <button key={key} type="button" className={speedMode === key ? 'active' : ''} onClick={() => setSpeedMode(key)}>
                {item.label}
              </button>
            ))}
          </div>

          <div className="admin-sim-actions">
            <button type="button" className="approve" onClick={createTrip} disabled={!canCreateTrip}>
              Crear viaje test
            </button>
            <button type="button" onClick={() => setTripStatus('accepted')} disabled={!activeTrip?.id}>
              Aceptar viaje
            </button>
            <button type="button" onClick={() => setTripStatus('arriving')} disabled={!activeTrip?.id}>
              Llegue al punto
            </button>
            <button type="button" onClick={() => setTripStatus('in_progress')} disabled={!activeTrip?.id}>
              Iniciar viaje
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

    if (approved) {
      const documents = driver.documents || {}
      const { missingRequiredDocs } = getDocumentStats(documents)

      if (missingRequiredDocs.length > 0) {
        setMessage(
          `No se puede aprobar. Faltan documentos obligatorios: ${missingRequiredDocs
            .map((doc) => doc.label)
            .join(', ')}.`
        )
        return
      }
    }

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

    setMessage(approved ? 'Chofer aprobado. Ya puede comenzar viajes.' : 'Chofer rechazado. Queda bloqueado para recibir viajes.')
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
      setMessage('No pude revisar MiChofer Ella. Revisá permisos admin.')
      return
    }

    setMessage(decision === 'approved' ? 'Acceso Ella aprobado.' : 'Acceso Ella rechazado.')
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

          <button type="button" onClick={loadDrivers} aria-label="Actualizar">
            <RefreshCw size={20} />
          </button>
        </header>

        <section className="admin-stats">
          <div>
            <ShieldCheck size={20} />
            <span>En revisión</span>
            <strong>{stats.submitted}</strong>
          </div>

          <div>
            <UserCheck size={20} />
            <span>Aprobados</span>
            <strong>{stats.approved}</strong>
          </div>

          <div>
            <FileText size={20} />
            <span>Docs completas</span>
            <strong>{stats.docsComplete}</strong>
          </div>

          <div>
            <AlertTriangle size={20} />
            <span>Docs pendientes</span>
            <strong>{stats.docsPending}</strong>
          </div>
        </section>

        <section className="admin-filters" aria-label="Filtros de verificación">
          <button
            type="button"
            className={filterStatus === 'submitted' ? 'active' : ''}
            onClick={() => setFilterStatus('submitted')}
          >
            En revisión
            <strong>{stats.submitted}</strong>
          </button>

          <button
            type="button"
            className={filterStatus === 'approved' ? 'active' : ''}
            onClick={() => setFilterStatus('approved')}
          >
            Aprobados
            <strong>{stats.approved}</strong>
          </button>

          <button
            type="button"
            className={filterStatus === 'rejected' ? 'active' : ''}
            onClick={() => setFilterStatus('rejected')}
          >
            Rechazados
            <strong>{stats.rejected}</strong>
          </button>

          <button
            type="button"
            className={filterStatus === 'docs_complete' ? 'active' : ''}
            onClick={() => setFilterStatus('docs_complete')}
          >
            Docs OK
            <strong>{stats.docsComplete}</strong>
          </button>

          <button
            type="button"
            className={filterStatus === 'docs_pending' ? 'active' : ''}
            onClick={() => setFilterStatus('docs_pending')}
          >
            Faltan docs
            <strong>{stats.docsPending}</strong>
          </button>

          <button
            type="button"
            className={filterStatus === 'all' ? 'active' : ''}
            onClick={() => setFilterStatus('all')}
          >
            Todos
            <strong>{stats.total}</strong>
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
              <strong>MiChofer Ella pasajeras</strong>
              <span>{womenRequests.length} pendiente{womenRequests.length === 1 ? '' : 's'}</span>
            </div>

            {womenRequests.map((request) => (
              <article key={request.id} className="admin-driver-card admin-category-review-card">
                <div className="admin-driver-head">
                  <div>
                    <span className="admin-status submitted">En revisión</span>
                    <h2>{request.full_name || request.email || 'Pasajera MiChofer'}</h2>
                    <p>Solicitó acceso a viajes con conductoras verificadas.</p>
                  </div>
                </div>

                <div className="admin-driver-meta">
                  <span>{request.email || 'Sin correo'}</span>
                  <span>Género privado</span>
                  <span>{request.women_mode_status || 'requested'}</span>
                </div>

                <div className="admin-actions">
                  <button className="approve" type="button" onClick={() => updateWomenRequest(request, 'approved')}>
                    Aprobar Ella
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
                      <span>{driver?.car_brand || 'Vehículo'} {driver?.car_model || ''}</span>
                      <span>{driver?.plate || 'Sin matrícula'}</span>
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
                        {driver.car_brand || 'Vehículo'} {driver.car_model || ''} · {driver.plate || 'Sin matrícula'}
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
                          const uploaded = documents[doc.key]

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
                        Aprobar
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
  .admin-screen {
    min-height: 100vh;
    background: #050706;
    color: #07110f;
    display: flex;
    justify-content: center;
    font-family: Inter, Arial, sans-serif;
  }

  .admin-shell {
    width: 100%;
    max-width: 1080px;
    min-height: 100vh;
    padding: 24px;
    background: #f5f7f6;
  }

  .admin-top {
    min-height: 112px;
    border-radius: 30px;
    background: #07110f;
    color: white;
    padding: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .admin-top p {
    margin: 0 0 8px;
    color: #63c0ba;
    font-size: 11px;
    letter-spacing: .16em;
    font-weight: 950;
  }

  .admin-top h1 {
    margin: 0;
    font-size: 36px;
    line-height: 1;
    font-weight: 950;
  }

  .admin-top span {
    display: block;
    margin-top: 9px;
    color: rgba(255,255,255,.62);
    font-size: 13px;
    font-weight: 850;
  }

  .admin-top button {
    width: 56px;
    height: 56px;
    border: 0;
    border-radius: 20px;
    background: rgba(255,255,255,.1);
    color: white;
    display: grid;
    place-items: center;
    cursor: pointer;
  }

  .admin-stats {
    margin-top: 16px;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
  }

  .admin-stats div,
  .admin-driver-card,
  .admin-empty {
    border-radius: 26px;
    background: white;
    box-shadow: 0 12px 30px rgba(0,0,0,.06);
  }

  .admin-stats div {
    min-height: 118px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .admin-stats svg {
    color: #63c0ba;
  }

  .admin-stats span {
    color: #667085;
    font-size: 13px;
    font-weight: 900;
  }

  .admin-stats strong {
    font-size: 34px;
    line-height: 1;
    font-weight: 950;
  }

  .admin-filters {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 8px;
  }

  .admin-filters button {
    min-height: 54px;
    border: 0;
    border-radius: 18px;
    background: #ffffff;
    color: #667085;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    padding: 0 11px;
    font-size: 12px;
    font-weight: 950;
    cursor: pointer;
    box-shadow: 0 12px 30px rgba(0,0,0,.05);
  }

  .admin-filters button.active {
    background: #07110f;
    color: #ffffff;
  }

  .admin-filters strong {
    font-size: 18px;
    line-height: 1;
  }

  .admin-message,
  .admin-session,
  .admin-empty,
  .admin-login-link {
    margin-top: 14px;
    padding: 16px;
    font-weight: 900;
  }

  .admin-message {
    border-radius: 20px;
    background: #fff4cc;
    color: #442d00;
  }

  .admin-session {
    border-radius: 20px;
    background: #ffffff;
    display: grid;
    gap: 5px;
    box-shadow: 0 12px 30px rgba(0,0,0,.06);
  }

  .admin-session strong {
    color: #07110f;
    font-size: 14px;
  }

  .admin-session span {
    color: #667085;
    font-size: 13px;
  }

  .admin-login-link {
    display: flex;
    min-height: 52px;
    align-items: center;
    justify-content: center;
    border-radius: 18px;
    background: #07110f;
    color: white;
    text-decoration: none;
  }

  .admin-simulator {
    margin-top: 18px;
    border-radius: 28px;
    padding: 18px;
    background: #07110f;
    color: #f8fffd;
    box-shadow: 0 18px 48px rgba(7, 17, 15, 0.16);
  }

  .admin-sim-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
    gap: 14px;
    margin-top: 14px;
  }

  .admin-sim-map {
    min-height: 430px;
    overflow: hidden;
    border-radius: 24px;
    background: #dfe8e6;
  }

  .admin-sim-map .mobility-map {
    height: 430px;
    margin: 0;
    border-radius: 24px;
  }

  .admin-sim-panel {
    display: grid;
    gap: 12px;
    align-content: start;
  }

  .admin-sim-panel label {
    display: grid;
    gap: 6px;
    color: rgba(248, 255, 253, 0.72);
    font-size: 12px;
    font-weight: 900;
  }

  .admin-sim-panel input,
  .admin-sim-panel select {
    width: 100%;
    min-height: 42px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    padding: 0 12px;
    background: rgba(255, 255, 255, 0.08);
    color: #f8fffd;
    outline: 0;
    font-weight: 850;
  }

  .admin-sim-panel option {
    color: #07110f;
  }

  .admin-sim-markers,
  .admin-sim-speed,
  .admin-sim-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .admin-sim-markers button,
  .admin-sim-speed button,
  .admin-sim-actions button {
    min-height: 40px;
    border: 0;
    border-radius: 999px;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.1);
    color: #f8fffd;
    font-weight: 950;
    cursor: pointer;
  }

  .admin-sim-markers button.active,
  .admin-sim-speed button.active,
  .admin-sim-actions button.approve {
    background: linear-gradient(135deg, #18d7a8, #00c7f5);
    color: #04110f;
  }

  .admin-sim-actions button.reject {
    background: rgba(255, 77, 99, 0.18);
    color: #ffdce3;
  }

  .admin-sim-actions button:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  .admin-sim-points {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .admin-sim-status {
    display: grid;
    gap: 6px;
    padding: 12px;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.08);
    color: rgba(248, 255, 253, 0.72);
    font-size: 12px;
    font-weight: 850;
  }

  .admin-list {
    margin-top: 16px;
    display: grid;
    gap: 14px;
  }

  .admin-list-title {
    min-height: 50px;
    border-radius: 20px;
    background: #ffffff;
    padding: 0 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    box-shadow: 0 12px 30px rgba(0,0,0,.05);
  }

  .admin-list-title strong {
    font-size: 15px;
    font-weight: 950;
  }

  .admin-list-title span {
    color: #667085;
    font-size: 12px;
    font-weight: 900;
  }

  .admin-driver-card {
    padding: 16px;
    display: grid;
    gap: 14px;
  }

  .admin-driver-head {
    display: flex;
    justify-content: space-between;
    gap: 14px;
  }

  .admin-status {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    border-radius: 999px;
    padding: 0 10px;
    background: #fff4cc;
    color: #442d00;
    font-size: 12px;
    font-weight: 950;
  }

  .admin-status.approved {
    background: #e8f7f5;
    color: #075e57;
  }

  .admin-status.rejected {
    background: #ffe8e8;
    color: #b42318;
  }

  .admin-driver-card h2 {
    margin: 10px 0 0;
    font-size: 24px;
    line-height: 1;
    font-weight: 950;
  }

  .admin-driver-card p {
    margin: 7px 0 0;
    color: #667085;
    font-size: 14px;
    font-weight: 850;
  }

  .admin-driver-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .admin-driver-meta span {
    min-height: 34px;
    border-radius: 999px;
    background: #f1f4f3;
    padding: 8px 10px;
    color: #34403d;
    font-size: 12px;
    font-weight: 900;
  }

  .admin-doc-badge {
    width: fit-content;
    min-height: 34px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 11px;
    font-size: 12px;
    font-weight: 950;
    white-space: nowrap;
  }

  .admin-doc-badge.ok {
    background: #e8f7f5;
    color: #075e57;
  }

  .admin-doc-badge.warn {
    background: #fff4cc;
    color: #442d00;
  }

  .admin-missing-docs {
    border-radius: 18px;
    background: #fff4cc;
    color: #442d00;
    padding: 12px;
    font-size: 13px;
    font-weight: 850;
    line-height: 1.35;
  }

  .admin-docs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .admin-docs.collapsed {
    align-items: center;
  }

  .admin-doc-summary,
  .admin-docs button.toggle-docs {
    min-height: 36px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 950;
  }

  .admin-doc-summary {
    background: #07110f;
    color: white;
  }

  .admin-docs button.toggle-docs {
    border: 0;
    background: #ffffff;
    color: #07110f;
    box-shadow: inset 0 0 0 1px #dde5e2;
    cursor: pointer;
  }

  .admin-doc-grid {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .admin-doc-card {
    min-height: 122px;
    border: 0;
    border-radius: 20px;
    padding: 12px;
    text-align: left;
    display: grid;
    gap: 8px;
    cursor: pointer;
  }

  .admin-doc-card.done {
    background: #e8f7f5;
    color: #075e57;
  }

  .admin-doc-card.missing {
    background: #fff4cc;
    color: #442d00;
  }

  .admin-doc-card:disabled {
    cursor: not-allowed;
    opacity: .82;
  }

  .admin-doc-card-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .admin-doc-card-head strong {
    font-size: 13px;
    font-weight: 950;
  }

  .admin-doc-card span {
    width: fit-content;
    border-radius: 999px;
    background: rgba(255,255,255,.58);
    padding: 5px 8px;
    font-size: 11px;
    font-weight: 950;
  }

  .admin-doc-card p {
    margin: 0;
    color: inherit;
    opacity: .78;
    font-size: 12px;
    line-height: 1.25;
    font-weight: 800;
  }

  .admin-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .admin-actions button {
    min-height: 52px;
    border: 0;
    border-radius: 18px;
    font-size: 15px;
    font-weight: 950;
    cursor: pointer;
  }

  .admin-actions .approve {
    background: #07110f;
    color: white;
  }

  .admin-actions .reject {
    background: #ffe8e8;
    color: #b42318;
  }

  .admin-preview-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgba(5,7,6,.72);
    padding: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .admin-preview {
    width: min(920px, 100%);
    max-height: calc(100vh - 36px);
    border-radius: 30px;
    background: #ffffff;
    padding: 16px;
    display: grid;
    gap: 14px;
    box-shadow: 0 30px 90px rgba(0,0,0,.38);
  }

  .admin-preview header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }

  .admin-preview header p {
    margin: 0 0 6px;
    color: #63c0ba;
    font-size: 11px;
    letter-spacing: .16em;
    font-weight: 950;
  }

  .admin-preview h2 {
    margin: 0;
    color: #07110f;
    font-size: 24px;
    line-height: 1;
    font-weight: 950;
  }

  .admin-preview header span {
    display: block;
    margin-top: 7px;
    color: #667085;
    font-size: 13px;
    font-weight: 850;
  }

  .admin-preview-close {
    width: 48px;
    height: 48px;
    border: 0;
    border-radius: 17px;
    background: #f1f4f3;
    color: #07110f;
    display: grid;
    place-items: center;
    cursor: pointer;
    flex: 0 0 auto;
  }

  .admin-preview-body {
    min-height: 280px;
    max-height: 62vh;
    border-radius: 24px;
    background: #f1f4f3;
    overflow: hidden;
    display: grid;
    place-items: center;
  }

  .admin-preview-body img,
  .admin-preview-body iframe {
    width: 100%;
    height: 100%;
    min-height: 280px;
    border: 0;
  }

  .admin-preview-body img {
    object-fit: contain;
  }

  .admin-preview-file {
    padding: 26px;
    color: #667085;
    display: grid;
    justify-items: center;
    gap: 12px;
    text-align: center;
  }

  .admin-preview a {
    min-height: 52px;
    border-radius: 18px;
    background: #07110f;
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    text-decoration: none;
    font-size: 15px;
    font-weight: 950;
  }

  @media (max-width: 860px) {
    .admin-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .admin-filters {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .admin-doc-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    .admin-shell {
      padding: 18px;
    }

    .admin-top {
      border-radius: 26px;
    }

    .admin-top h1 {
      font-size: 30px;
    }

    .admin-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .admin-filters {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .admin-doc-grid {
      grid-template-columns: 1fr;
    }

    .admin-driver-head {
      display: grid;
    }

    .admin-preview {
      border-radius: 24px;
    }
  }
`
