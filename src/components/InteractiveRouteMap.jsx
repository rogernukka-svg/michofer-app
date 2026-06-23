import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, LocateFixed, Navigation } from 'lucide-react'
import { loadGoogleMaps, GOOGLE_MAPS_MAP_ID } from '../lib/googleMaps'

import carRightImg from '../assets/128derecha.png'
import carLeftImg from '../assets/128izquierda.png'
import carTopImg from '../assets/128vistaarriba.png'
import carBackImg from '../assets/128vistadeatras.png'

const DEFAULT_CENTER = { lat: -25.5167, lng: -54.6167 }
const DEFAULT_PADDING = { top: 96, bottom: 122, left: 58, right: 58 }
const MAX_DRIVER_MARKERS = 6

// Cámara tipo Google Maps navegación:
// más cerca del vehículo, ruta vertical hacia adelante.
const NAVIGATION_ZOOM = 19.05
const NAVIGATION_TILT = 67
const NAVIGATION_LOOK_AHEAD_RATIO = 0.2
const NAVIGATION_MIN_LOOK_AHEAD_METERS = 95
const NAVIGATION_MAX_LOOK_AHEAD_METERS = 360
const NAVIGATION_HEADING_DISTANCE_METERS = 65

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

function getBearingBetweenPoints(start, end) {
  if (!isValidCoord(start) || !isValidCoord(end)) return 0

  const startLat = (Number(start.lat) * Math.PI) / 180
  const startLng = (Number(start.lng) * Math.PI) / 180
  const endLat = (Number(end.lat) * Math.PI) / 180
  const endLng = (Number(end.lng) * Math.PI) / 180
  const deltaLng = endLng - startLng

  const y = Math.sin(deltaLng) * Math.cos(endLat)
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng)

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
function normalizeMapPoint(point, fallback = DEFAULT_CENTER) {
  if (typeof point?.lat === 'function' && typeof point?.lng === 'function') {
    return { lat: point.lat(), lng: point.lng() }
  }

  if (isValidCoord(point)) {
    return toLatLng(point)
  }

  return fallback
}
function getDistanceMeters(start, end) {
  if (!isValidCoord(start) || !isValidCoord(end)) return 0

  const radius = 6371000
  const startLat = (Number(start.lat) * Math.PI) / 180
  const endLat = (Number(end.lat) * Math.PI) / 180
  const deltaLat = ((Number(end.lat) - Number(start.lat)) * Math.PI) / 180
  const deltaLng = ((Number(end.lng) - Number(start.lng)) * Math.PI) / 180

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2

  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function interpolatePoint(start, end, fraction) {
  if (!isValidCoord(start) || !isValidCoord(end)) return start

  const safeFraction = Math.max(0, Math.min(1, Number(fraction) || 0))

  return {
    lat: Number(start.lat) + (Number(end.lat) - Number(start.lat)) * safeFraction,
    lng: Number(start.lng) + (Number(end.lng) - Number(start.lng)) * safeFraction,
  }
}

function normalizeRoutePath(routePath, fallbackOrigin, fallbackDestination) {
  const points = Array.isArray(routePath)
    ? routePath.map((point) => normalizeMapPoint(point, null)).filter(isValidCoord)
    : []

  if (points.length >= 2) return points

  return [fallbackOrigin, fallbackDestination].filter(isValidCoord).map(toLatLng)
}

function getRouteDistanceMeters(routePoints) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) return 0

  return routePoints.reduce((sum, point, index) => {
    if (index === 0) return sum
    return sum + getDistanceMeters(routePoints[index - 1], point)
  }, 0)
}

function getRoutePointAtDistance(routePoints, targetDistanceMeters) {
  if (!Array.isArray(routePoints) || routePoints.length === 0) return DEFAULT_CENTER
  if (routePoints.length === 1) return routePoints[0]

  let travelled = 0

  for (let index = 1; index < routePoints.length; index += 1) {
    const previous = routePoints[index - 1]
    const current = routePoints[index]
    const segmentDistance = getDistanceMeters(previous, current)

    if (travelled + segmentDistance >= targetDistanceMeters) {
      const remaining = targetDistanceMeters - travelled
      const fraction = segmentDistance > 0 ? remaining / segmentDistance : 0
      return interpolatePoint(previous, current, fraction)
    }

    travelled += segmentDistance
  }

  return routePoints[routePoints.length - 1]
}

function getRouteLookAheadPoint(routePath, fallbackOrigin, fallbackDestination) {
  const routePoints = normalizeRoutePath(routePath, fallbackOrigin, fallbackDestination)

  if (!routePoints.length) {
    return isValidCoord(fallbackOrigin) ? toLatLng(fallbackOrigin) : DEFAULT_CENTER
  }

  if (routePoints.length === 1) {
    return routePoints[0]
  }

  const routeDistance = getRouteDistanceMeters(routePoints)

  if (routeDistance <= 80) {
    return routePoints[routePoints.length - 1]
  }

  // Cámara más cercana:
  // mira adelante, pero menos metros que antes para que el auto y la calle se vean grandes.
  const dynamicLookAhead = routeDistance * NAVIGATION_LOOK_AHEAD_RATIO
  const targetDistance = Math.min(
    routeDistance - 18,
    Math.max(
      NAVIGATION_MIN_LOOK_AHEAD_METERS,
      Math.min(dynamicLookAhead, NAVIGATION_MAX_LOOK_AHEAD_METERS)
    )
  )

  return getRoutePointAtDistance(routePoints, targetDistance)
}

function getRouteHeading(routePath, fallbackOrigin, fallbackDestination) {
  const routePoints = normalizeRoutePath(routePath, fallbackOrigin, fallbackDestination)

  if (routePoints.length >= 2) {
    const start = routePoints[0]
    const next = getRoutePointAtDistance(routePoints, NAVIGATION_HEADING_DISTANCE_METERS)

    return getBearingBetweenPoints(start, next)
  }

  return getBearingBetweenPoints(fallbackOrigin, fallbackDestination)
}

function applyNavigationCamera(map, center, heading) {
  if (!map || !isValidCoord(center)) return

  const camera = {
    center: toLatLng(center),
    zoom: NAVIGATION_ZOOM,
    tilt: NAVIGATION_TILT,
    heading,
  }

  if (typeof map.moveCamera === 'function') {
    map.moveCamera(camera)
  } else {
    map.setCenter(camera.center)
    map.setZoom(camera.zoom)

    if (typeof map.setTilt === 'function') {
      map.setTilt(camera.tilt)
    }

    if (typeof map.setHeading === 'function') {
      map.setHeading(camera.heading)
    }
  }
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
function getCarImageByHeading(heading = 0) {
  const normalizedHeading = ((Number(heading) % 360) + 360) % 360

  if (normalizedHeading >= 45 && normalizedHeading < 135) {
    return carRightImg
  }

  if (normalizedHeading >= 135 && normalizedHeading < 225) {
    return carBackImg
  }

  if (normalizedHeading >= 225 && normalizedHeading < 315) {
    return carLeftImg
  }

  return carTopImg
}
function createDriverOverlay(driver, selected, onSelect, google) {
  const overlay = new google.maps.OverlayView()
  const element = document.createElement('button')
  const initials = String(driver.name || 'CH').slice(0, 2).toUpperCase()

  element.type = 'button'

  const online = Boolean(
    driver.available ||
      driver.is_available ||
      driver.online ||
      driver.active ||
      driver.status === 'available' ||
      driver.status === 'online'
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
  const initials = String(name || 'Yo')
    .split(' ')
    .map((s) => s[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

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

    if (panes?.overlayMouseTarget) {
      panes.overlayMouseTarget.appendChild(element)
    }
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
    if (element.parentNode) {
      element.parentNode.removeChild(element)
    }
  }

  return overlay
}

function createNavigationOverlay(position, google, heading = 0) {
  const overlay = new google.maps.OverlayView()
  const element = document.createElement('div')
  const carImage = getCarImageByHeading(heading)

  element.className = 'google-navigation-marker car-navigation-marker'
  element.style.position = 'absolute'
  element.style.zIndex = '30'
  element.innerHTML = `
    <img class="navigation-car-img" src="${carImage}" alt="Auto en navegación" />
  `

  overlay.onAdd = function () {
    const panes = this.getPanes()

    if (panes?.overlayMouseTarget) {
      panes.overlayMouseTarget.appendChild(element)
    }
  }

  overlay.draw = function () {
    const projection = this.getProjection()
    if (!projection || !isValidCoord(position)) return

    const pos = new google.maps.LatLng(position.lat, position.lng)
    const point = projection.fromLatLngToDivPixel(pos)

    if (point) {
      element.style.left = `${point.x}px`
      element.style.top = `${point.y}px`
      element.style.transform = 'translate(-50%, -50%)'
    }
  }

  overlay.onRemove = function () {
    if (element.parentNode) {
      element.parentNode.removeChild(element)
    }
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
  showOriginCar = false,
  onRouteUpdate,
}) {
  const [is3d, setIs3d] = useState(() => !navigationMode)
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
  const routeSignatureRef = useRef('')
  const routeRequestSerialRef = useRef(0)
  const lastRouteUpdateRef = useRef(null)
  const navigationHeadingRef = useRef(0)

  const visibleDrivers = useMemo(() => {
    const safeDrivers = Array.isArray(drivers) ? drivers : []
    const selectedPresent = selectedDriver && safeDrivers.some((driver) => driver.id === selectedDriver.id)
    const candidates = selectedPresent || !selectedDriver ? safeDrivers : [selectedDriver, ...safeDrivers]

    return candidates.filter(isValidCoord).slice(0, MAX_DRIVER_MARKERS)
  }, [drivers, selectedDriver])

  useEffect(() => {
    let cancelled = false
    let timeoutId = null

    setMapError(null)

    timeoutId = setTimeout(() => {
      if (!mapRef.current) {
        setMapError(new Error('Timeout cargando Google Maps'))
      }
    }, 10000)

    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapContainerRef.current || mapRef.current) return

        if (
          !google?.maps?.Map ||
          !google?.maps?.DirectionsService ||
          !google?.maps?.Polyline ||
          !google?.maps?.TrafficLayer
        ) {
          throw new Error('Google Maps o las clases requeridas no están disponibles.')
        }

        setGoogleApi(google)

        const map = new google.maps.Map(mapContainerRef.current, {
  center: isValidCoord(origin) ? toLatLng(origin) : DEFAULT_CENTER,
  zoom: navigationMode ? NAVIGATION_ZOOM : 14.1,
  tilt: navigationMode ? NAVIGATION_TILT : is3d ? 45 : 0,
  heading: navigationMode ? navigationHeadingRef.current : is3d ? -18 : 0,
  renderingType: google.maps.RenderingType?.VECTOR,
  mapId: GOOGLE_MAPS_MAP_ID || undefined,
  mapTypeId: GOOGLE_MAPS_MAP_ID ? undefined : navigationMode ? 'roadmap' : is3d ? 'satellite' : 'roadmap',
  styles: navigationMode ? undefined : GOOGLE_MAPS_MAP_ID ? undefined : DARK_MAP_STYLE,
  disableDefaultUI: true,
  gestureHandling: mapInteractive ? 'greedy' : 'none',
  zoomControl: false,
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
          strokeColor: navigationMode ? '#3617ff' : '#1f7aff',
          strokeOpacity: 1,
          strokeWeight: navigationMode ? 8 : 5,
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

      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      markersRef.current.forEach((marker) => {
        try {
          marker.setMap(null)
        } catch {
          // no-op
        }
      })
      markersRef.current = []

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

    if (navigationMode) {
 map.setOptions({
  tilt: NAVIGATION_TILT,
  heading: navigationHeadingRef.current,
  mapId: GOOGLE_MAPS_MAP_ID || undefined,
  mapTypeId: GOOGLE_MAPS_MAP_ID ? undefined : 'roadmap',
})

  applyNavigationCamera(map, origin, navigationHeadingRef.current)
  return
}

    map.panTo(toLatLng(target))
    map.setZoom(selectedDriver ? 14.6 : 14.1)
    map.setOptions({
      tilt: is3d ? 45 : 0,
      heading: is3d ? -10 : 0,
      mapId: GOOGLE_MAPS_MAP_ID || undefined,
      mapTypeId: GOOGLE_MAPS_MAP_ID ? undefined : is3d ? 'satellite' : 'roadmap',
      styles: GOOGLE_MAPS_MAP_ID ? undefined : DARK_MAP_STYLE,
    })
  }, [animateCamera, destination, googleApi, is3d, mapReady, navigationMode, origin, selectedDriver])

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map || !googleApi) return

    markersRef.current.forEach((marker) => {
      try {
        marker.setMap(null)
      } catch {
        // no-op
      }
    })
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
    const showCarAsOrigin = navigationMode || showOriginCar

    const originOverlay = showCarAsOrigin
      ? createNavigationOverlay(origin, googleApi, navigationHeadingRef.current)
      : createClientOverlay(clientAvatar, 'Tu ubicación', googleApi, origin)

    originOverlay.setMap(map)
    markersRef.current.push(originOverlay)
  } catch (err) {
        const icon = createCircleIcon('#1f7aff', googleApi)

        addMarker(origin, {
          ...(icon ? { icon } : {}),
          label: {
            text: navigationMode ? '▶' : 'Yo',
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
      }, [
    clientAvatar,
    destination,
    googleApi,
    mapReady,
    navigationMode,
    onSelectDriver,
    origin,
    selectedDriver,
    showOriginCar,
    visibleDrivers,
  ])

  useEffect(() => {
    const map = mapRef.current
    const trafficLayer = trafficLayerRef.current

    if (!trafficLayer) return

    try {
      trafficLayer.setMap(showTraffic && mapReady && map ? map : null)
    } catch (error) {
      console.warn('No pude actualizar tráfico:', error)
    }
  }, [showTraffic, mapReady])

  useEffect(() => {
    const map = mapRef.current
    const directionsService = directionsServiceRef.current
    const routePolyline = routePolylineRef.current

    const emitRouteUpdate = (nextValue) => {
      const previous = lastRouteUpdateRef.current
      const previousKey = previous ? JSON.stringify(previous) : 'null'
      const nextKey = nextValue ? JSON.stringify(nextValue) : 'null'

      if (previousKey === nextKey) return

      lastRouteUpdateRef.current = nextValue
      onRouteUpdate?.(nextValue)
    }

    const clearRoute = () => {
      try {
        if (routePolyline) {
          routePolyline.setPath([])
        }
      } catch (error) {
        console.warn('No pude limpiar la ruta:', error)
      }

      emitRouteUpdate(null)
    }

    if (!mapReady || !map || !googleApi || !directionsService || !routePolyline || !isValidCoord(origin)) {
      routeSignatureRef.current = ''
      clearRoute()
      return
    }

    if (!isValidCoord(destination)) {
      if (routeSignatureRef.current !== 'no-destination') {
        routeSignatureRef.current = 'no-destination'
        clearRoute()
      }

      return
    }

    const normalizedOrigin = toLatLng(origin)
    const normalizedDestination = toLatLng(destination)
    const normalizedSelectedDriver = isValidCoord(selectedDriver) ? toLatLng(selectedDriver) : null

    const routeSignature = JSON.stringify({
      origin: normalizedOrigin,
      destination: normalizedDestination,
      selectedDriver: normalizedSelectedDriver,
      navigationMode,
    })

    if (routeSignatureRef.current === routeSignature) {
      return
    }

    routeSignatureRef.current = routeSignature
    routeRequestSerialRef.current += 1

    const requestSerial = routeRequestSerialRef.current
    let cancelled = false

    const waypoints = [normalizedOrigin]

    if (normalizedSelectedDriver) {
      waypoints.push(normalizedSelectedDriver)
    }

    waypoints.push(normalizedDestination)

    const routeRequest = {
      origin: waypoints[0],
      destination: waypoints[waypoints.length - 1],
      travelMode: googleApi.maps.TravelMode.DRIVING,
      waypoints: waypoints.length > 2 ? [{ location: waypoints[1], stopover: true }] : [],
      optimizeWaypoints: false,
      provideRouteAlternatives: false,
    }

    directionsService.route(routeRequest, (result, status) => {
      if (cancelled || requestSerial !== routeRequestSerialRef.current) return

      try {
        const currentMap = mapRef.current
        const currentPolyline = routePolylineRef.current

        if (!currentMap || !currentPolyline || !googleApi) return

        if (status === googleApi.maps.DirectionsStatus.OK && result?.routes?.[0]) {
          const route = result.routes[0]
          const routePath = Array.isArray(route.overview_path) ? route.overview_path : []

          currentPolyline.setPath(routePath)

          const distance = route.legs?.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0) || 0
          const duration = route.legs?.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0) || 0
          const instruction = route.legs?.[0]?.steps?.[0]?.instructions?.replace(/<[^>]*>/g, '') || ''

          emitRouteUpdate({ distance, duration, instruction })

          if (!navigationMode) {
            const bounds = getBounds(waypoints, googleApi)

            if (bounds) {
              const padding = typeof fitPadding === 'function' ? fitPadding() : fitPadding || DEFAULT_PADDING
              currentMap.fitBounds(bounds, padding)
            }
          }

          if (navigationMode) {
  const navigationHeading = getRouteHeading(routePath, normalizedOrigin, normalizedDestination)
  const lookAheadPoint = getRouteLookAheadPoint(routePath, normalizedOrigin, normalizedDestination)

  navigationHeadingRef.current = navigationHeading

  currentMap.setOptions({
  tilt: NAVIGATION_TILT,
  heading: navigationHeading,
  mapId: GOOGLE_MAPS_MAP_ID || undefined,
  mapTypeId: GOOGLE_MAPS_MAP_ID ? undefined : 'roadmap',
})

applyNavigationCamera(currentMap, lookAheadPoint, navigationHeading)
}

          return
        }

        currentPolyline.setPath([normalizedOrigin, normalizedDestination])
        emitRouteUpdate(null)
      } catch (error) {
        console.warn('Error seguro en route callback:', error)
        emitRouteUpdate(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [
    destination?.lat,
    destination?.lng,
    fitPadding,
    googleApi,
    mapReady,
    navigationMode,
    onRouteUpdate,
    origin?.lat,
    origin?.lng,
    selectedDriver?.id,
    selectedDriver?.lat,
    selectedDriver?.lng,
  ])

  return (
    <section className={is3d ? 'mobility-map interactive-map is-3d' : 'mobility-map interactive-map'}>
      <div ref={mapContainerRef} className={mapReady ? 'google-real-map ready' : 'google-real-map'} />

      <div className={navigationMode ? 'map-toolbar navigation-toolbar' : 'map-toolbar'} aria-label="Controles de mapa">
        {!navigationMode && (
          <button type="button" className={is3d ? 'active' : ''} onClick={() => setIs3d((value) => !value)}>
            <Layers size={16} />
            {is3d ? '3D' : '2D'}
          </button>
        )}

        <button
          type="button"
          className={showTraffic ? 'active' : ''}
          onClick={() => setShowTraffic((value) => !value)}
          title={destination ? 'Ver tráfico' : 'Elegí destino para ver tráfico'}
        >
          <Navigation size={16} />
          Tráfico
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