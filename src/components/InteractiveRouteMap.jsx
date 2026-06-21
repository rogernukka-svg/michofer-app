import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, LocateFixed, Navigation } from 'lucide-react'
import { loadGoogleMaps, GOOGLE_MAPS_MAP_ID } from '../lib/googleMaps'

const DEFAULT_CENTER = { lat: -25.5167, lng: -54.6167 }
const DEFAULT_PADDING = { top: 96, bottom: 122, left: 58, right: 58 }
const MAX_DRIVER_MARKERS = 6

function isValidCoord(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))
}

function toLatLng(point) {
  return { lat: Number(point.lat), lng: Number(point.lng) }
}

function getBounds(points, google) {
  const validPoints = points.filter(isValidCoord)
  if (!google?.maps?.LatLngBounds) {
    return null
  }
  const bounds = new google.maps.LatLngBounds()

  if (!validPoints.length) {
    bounds.extend(toLatLng(DEFAULT_CENTER))
    return bounds
  }

  validPoints.forEach((point) => bounds.extend(toLatLng(point)))
  return bounds
}

function createCircleIcon(color, google) {
  if (!google?.maps?.SymbolPath?.CIRCLE) {
    return null
  }
  return {
    path: google.maps.SymbolPath.CIRCLE,
    scale: 10,
    fillColor: color,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  }
}

function createDriverOverlay(driver, selected, onSelect, google) {
  const overlay = new google.maps.OverlayView()
  const element = document.createElement('button')
  const initials = String(driver.name || 'CH').slice(0, 2).toUpperCase()

  element.type = 'button'
  // infer availability
  const online = Boolean(
    driver.available || driver.is_available || driver.online || driver.active || driver.status === 'available' || driver.status === 'online'
  )
  element.className = `google-driver-marker${selected ? ' active' : ''} ${online ? 'online' : 'offline'}`
  element.dataset.driverId = driver.id
  element.title = driver.name
  element.style.position = 'absolute'
  element.style.transform = 'translate(-50%, -100%)'
  element.style.cursor = 'pointer'
  element.style.border = 'none'
  element.style.padding = '0'
  element.style.background = 'transparent'
  element.style.zIndex = selected ? '999' : '900'
  element.innerHTML = `
    <span class="google-driver-marker-content">
      ${driver.avatar ? `<img src="${driver.avatar}" alt="${driver.name}" />` : `<span>${initials}</span>`}
      <span class="google-driver-marker-status" aria-hidden="true"></span>
    </span>
  `

  element.addEventListener('click', (event) => {
    event.stopPropagation()
    onSelect?.(driver)
  })

  overlay.onAdd = function () {
    const panes = this.getPanes()
    if (panes?.overlayMouseTarget) {
      panes.overlayMouseTarget.appendChild(element)
    }
  }

  overlay.draw = function () {
    const projection = this.getProjection()
    if (!projection) return
    const position = new google.maps.LatLng(driver.lat, driver.lng)
    const point = projection.fromLatLngToDivPixel(position)
    if (point) {
      element.style.left = `${point.x}px`
      element.style.top = `${point.y}px`
    }
  }

  overlay.onRemove = function () {
    if (element.parentNode) {
      element.parentNode.removeChild(element)
    }
  }

  return overlay
}

function createClientOverlay(clientAvatar, name, google, onCenter) {
  const overlay = new google.maps.OverlayView()
  const element = document.createElement('div')
  const initials = String(name || 'Yo').split(' ').map((s) => s[0] || '').join('').slice(0,2).toUpperCase()

  element.className = 'google-client-marker'
  element.style.position = 'absolute'
  element.style.zIndex = '10'
  element.innerHTML = `
    <div class="google-client-marker-ring" aria-hidden="true"></div>
    <div class="google-client-marker-content">
      ${clientAvatar ? `<img src="${clientAvatar}" alt="${name}" />` : `<span>${initials}</span>`}
    </div>
  `

  overlay.onAdd = function () {
    const panes = this.getPanes()
    if (panes?.overlayMouseTarget) panes.overlayMouseTarget.appendChild(element)
  }

  overlay.draw = function () {
    const projection = this.getProjection()
    if (!projection || !onCenter) return
    const pos = new google.maps.LatLng(onCenter.lat, onCenter.lng)
    const point = projection.fromLatLngToDivPixel(pos)
    if (point) {
      element.style.left = `${point.x}px`
      element.style.top = `${point.y}px`
    }
  }

  overlay.onRemove = function () {
    if (element.parentNode) element.parentNode.removeChild(element)
  }

  return overlay
}

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0f1724' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b1220' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#021126' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#0b1220' }] },
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

export default function InteractiveRouteMap({
  origin,
  destination,
  destinationText,
  clientAvatar,
  drivers,
  selectedDriver,
  onSelectDriver,
  onChooseDriver,
  onRefreshLocation,
  fitPadding,
  mapInteractive = true,
  animateCamera = true,
  showRouteSummary = true,
  navigationMode = false,
  onRouteUpdate,
}) {
  const [is3d, setIs3d] = useState(true)
  const [showTraffic, setShowTraffic] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState(null)
  const [googleApi, setGoogleApi] = useState(null)
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const directionsServiceRef = useRef(null)
  const routePolylineRef = useRef(null)
  const markersRef = useRef([])
  const trafficLayerRef = useRef(null)

  const visibleDrivers = useMemo(() => {
    const selectedPresent = selectedDriver && drivers.some((driver) => driver.id === selectedDriver.id)
    const candidates = selectedPresent || !selectedDriver ? drivers : [selectedDriver, ...drivers]
    return candidates.filter(isValidCoord).slice(0, MAX_DRIVER_MARKERS)
  }, [drivers, selectedDriver])

  useEffect(() => {
    let cancelled = false
    let timeoutId = null

    setMapError(null)
    // if map doesn't become ready in 10s, show an error
    timeoutId = setTimeout(() => {
      if (!mapRef.current) setMapError(new Error('Timeout cargando Google Maps'))
    }, 10000)

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapContainerRef.current || mapRef.current) return

        if (!google?.maps?.Map || !google?.maps?.DirectionsService || !google?.maps?.Polyline || !google?.maps?.TrafficLayer) {
          throw new Error('Google Maps o las clases requeridas (Map, DirectionsService, Polyline, TrafficLayer) no están disponibles.')
        }

        setGoogleApi(google)

        const map = new google.maps.Map(mapContainerRef.current, {
          center: isValidCoord(origin) ? toLatLng(origin) : DEFAULT_CENTER,
          zoom: navigationMode ? 18.2 : 14.1,
          tilt: is3d ? 55 : 0,
          heading: is3d ? -18 : 0,
          mapId: GOOGLE_MAPS_MAP_ID || undefined,
          mapTypeId: GOOGLE_MAPS_MAP_ID ? undefined : is3d ? 'satellite' : 'roadmap',
          styles: GOOGLE_MAPS_MAP_ID ? undefined : DARK_MAP_STYLE,
          disableDefaultUI: true,
          gestureHandling: mapInteractive ? 'auto' : 'none',
          zoomControl: mapInteractive,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        })

        mapRef.current = map
        directionsServiceRef.current = new google.maps.DirectionsService()
        routePolylineRef.current = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: '#1f7aff',
          strokeOpacity: 1,
          strokeWeight: 5,
          clickable: false,
          geodesic: true,
        })
        trafficLayerRef.current = new google.maps.TrafficLayer()
        setMapReady(true)
        setMapError(null)
      })
      .catch((err) => {
        console.error('Error cargando Google Maps:', err)
        setMapReady(false)
        setMapError(err || new Error('Error cargando Google Maps'))
      })

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
      if (routePolylineRef.current) {
        routePolylineRef.current.setMap(null)
        routePolylineRef.current = null
      }
      if (trafficLayerRef.current) {
        trafficLayerRef.current.setMap(null)
        trafficLayerRef.current = null
      }
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !isValidCoord(origin)) return

    const target = isValidCoord(selectedDriver) ? selectedDriver : origin
    map.panTo(toLatLng(target))
    map.setZoom(selectedDriver ? 14.6 : 14.1)
    map.setOptions({
      tilt: is3d ? 55 : 0,
      heading: is3d ? -10 : 0,
      mapId: GOOGLE_MAPS_MAP_ID || undefined,
      mapTypeId: GOOGLE_MAPS_MAP_ID ? undefined : is3d ? 'satellite' : 'roadmap',
    })
  }, [animateCamera, destination, is3d, mapReady, navigationMode, origin, selectedDriver])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !googleApi) return

    markersRef.current.forEach((marker) => marker.setMap(null))
    markersRef.current = []

    if (!googleApi?.maps?.Marker) return

    const addMarker = (position, options = {}) => {
      const marker = new googleApi.maps.Marker({
        map,
        position: toLatLng(position),
        optimized: false,
        ...options,
      })
      markersRef.current.push(marker)
      return marker
    }

    if (isValidCoord(origin)) {
      try {
        const clientOverlay = createClientOverlay(clientAvatar, 'Tu ubicación', googleApi, origin)
        clientOverlay.setMap(map)
        markersRef.current.push(clientOverlay)
      } catch (err) {
        // fallback to simple marker if overlay fails
        const icon = createCircleIcon('#1f7aff', googleApi)
        addMarker(origin, {
          ...(icon ? { icon } : {}),
          label: {
            text: 'Yo',
            color: '#ffffff',
            fontSize: '10px',
            fontWeight: '700',
          },
          zIndex: 10,
        })
      }
    }

    if (isValidCoord(destination)) {
      const icon = createCircleIcon('#dc2626', googleApi)
      addMarker(destination, {
        ...(icon ? { icon } : {}),
        label: {
          text: 'D',
          color: '#ffffff',
          fontSize: '10px',
          fontWeight: '700',
        },
        zIndex: 9,
      })
    }

    visibleDrivers.forEach((driver) => {
      if (driver.lat == null || driver.lng == null) return
      const selected = selectedDriver?.id === driver.id
      const overlay = createDriverOverlay(driver, selected, onSelectDriver, googleApi)
      overlay.setMap(map)
      markersRef.current.push(overlay)
    })
  }, [destination, mapReady, onSelectDriver, origin, selectedDriver, visibleDrivers, googleApi])

  useEffect(() => {
    const map = mapRef.current
    const directionsService = directionsServiceRef.current
    const routePolyline = routePolylineRef.current
    const trafficLayer = trafficLayerRef.current

    if (trafficLayer) {
      trafficLayer.setMap(showTraffic ? map : null)
    }

    if (!mapReady || !map || !directionsService || !routePolyline || !isValidCoord(origin) || !googleApi) return

    if (!isValidCoord(destination)) {
      routePolyline.setPath([])
      onRouteUpdate?.(null)
      return
    }

    const waypoints = [origin]
    if (isValidCoord(selectedDriver)) {
      waypoints.push(selectedDriver)
    }
    waypoints.push(destination)

    const routeRequest = {
      origin: toLatLng(waypoints[0]),
      destination: toLatLng(waypoints[waypoints.length - 1]),
      travelMode: googleApi.maps.TravelMode.DRIVING,
      waypoints: waypoints.length > 2 ? [{ location: toLatLng(waypoints[1]), stopover: true }] : [],
      optimizeWaypoints: false,
      provideRouteAlternatives: false,
    }

    directionsService.route(routeRequest, (result, status) => {
      if (status === googleApi.maps.DirectionsStatus.OK && result.routes?.[0]) {
        const route = result.routes[0]
        routePolyline.setPath(route.overview_path || [])

        const distance = route.legs?.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0) || 0
        const duration = route.legs?.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0) || 0
        const instruction = route.legs?.[0]?.steps?.[0]?.instructions?.replace(/<[^>]*>/g, '') || ''

        onRouteUpdate?.({ distance, duration, instruction })

        if (!navigationMode) {
          const bounds = getBounds(waypoints.filter(isValidCoord), googleApi)
          if (bounds) {
            const padding = typeof fitPadding === 'function' ? fitPadding() : fitPadding || DEFAULT_PADDING
            map.fitBounds(bounds, padding)
          }
        }

        if (navigationMode) {
          map.setCenter(toLatLng(origin))
          map.setTilt(is3d ? 55 : 0)
          map.setHeading(is3d ? -18 : 0)
        }
        return
      }

      routePolyline.setPath([toLatLng(origin), toLatLng(destination)])
      onRouteUpdate?.(null)
    })
  }, [destination, fitPadding, is3d, mapReady, navigationMode, onRouteUpdate, origin, selectedDriver, showTraffic, googleApi])

  return (
    <section className={is3d ? 'mobility-map interactive-map is-3d' : 'mobility-map interactive-map'}>
      <div ref={mapContainerRef} className={mapReady ? 'google-real-map ready' : 'google-real-map'} />

      <div className="map-toolbar" aria-label="Controles de mapa">
        <button type="button" className={is3d ? 'active' : ''} onClick={() => setIs3d((value) => !value)}>
          <Layers size={16} />
          {is3d ? '3D' : '2D'}
        </button>
        <button
          type="button"
          className={showTraffic ? 'active' : ''}
          onClick={() => setShowTraffic((value) => !value)}
          title={destination ? 'Calcular ruta con trafico' : 'Elegí destino para calcular trafico'}
        >
          <Navigation size={16} />
          Trafico
        </button>
      </div>

      <button className="map-locate-btn" type="button" onClick={onRefreshLocation} aria-label="Actualizar ubicación">
        <LocateFixed size={19} />
      </button>

      {!mapReady && (
        <div className="map-empty-state">
          <div className="map-empty-card">
            {mapError ? (
              <>
                <span className="map-empty-eyebrow">Vista de viaje</span>
                <strong>No se pudo cargar el mapa interactivo</strong>
                <span>Revisá tu conexión o la clave de Google Maps para ver la ruta en vivo.</span>
              </>
            ) : (
              <>
                <div className="map-loading-orbit" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <strong>Cargando mapa</strong>
                <span>Preparando la experiencia MiChofer</span>
              </>
            )}
          </div>
        </div>
      )}

      {showRouteSummary && destination && (
        <article className="route-summary">
          <div>
            <span>Ruta al destino</span>
            <strong>{destinationText}</strong>
          </div>
          <button type="button" onClick={onChooseDriver}>
            Elegir chofer
          </button>
        </article>
      )}
    </section>
  )
}

