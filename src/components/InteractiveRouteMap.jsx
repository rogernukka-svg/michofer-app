import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, LocateFixed, Navigation } from 'lucide-react'

const PADDING = 0.004
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN || ''
const MAPBOX_JS = 'https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.js'
const MAPBOX_CSS = 'https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.css'

function loadMapbox() {
  if (!MAPBOX_TOKEN) {
    return Promise.reject(new Error('Missing Mapbox token'))
  }

  if (window.mapboxgl) return Promise.resolve(window.mapboxgl)

  return new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPBOX_CSS}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = MAPBOX_CSS
      document.head.appendChild(link)
    }

    const existing = document.querySelector(`script[src="${MAPBOX_JS}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(window.mapboxgl), { once: true })
      existing.addEventListener('error', reject, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = MAPBOX_JS
    script.async = true
    script.onload = () => resolve(window.mapboxgl)
    script.onerror = reject
    document.head.appendChild(script)
  })
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getBounds(points) {
  const valid = points.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng))
  if (!valid.length) {
    return {
      minLat: -25.525,
      maxLat: -25.505,
      minLng: -54.63,
      maxLng: -54.605,
    }
  }

  const lats = valid.map((point) => point.lat)
  const lngs = valid.map((point) => point.lng)
  return {
    minLat: Math.min(...lats) - PADDING,
    maxLat: Math.max(...lats) + PADDING,
    minLng: Math.min(...lngs) - PADDING,
    maxLng: Math.max(...lngs) + PADDING,
  }
}

function project(point, bounds) {
  const lngRange = bounds.maxLng - bounds.minLng || 1
  const latRange = bounds.maxLat - bounds.minLat || 1
  return {
    x: clamp(((point.lng - bounds.minLng) / lngRange) * 100, 7, 93),
    y: clamp((1 - (point.lat - bounds.minLat) / latRange) * 100, 9, 91),
  }
}

function routePath(points) {
  if (points.length < 2) return ''
  const [first, ...rest] = points
  return rest.reduce((path, point, index) => {
    const previous = index === 0 ? first : rest[index - 1]
    const midX = (previous.x + point.x) / 2
    const bend = previous.y > point.y ? -8 : 8
    return `${path} C ${midX} ${previous.y + bend}, ${midX} ${point.y - bend}, ${point.x} ${point.y}`
  }, `M ${first.x} ${first.y}`)
}

function isValidCoord(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng))
}

function sameCoord(a, b) {
  return Math.abs(Number(a.lat) - Number(b.lat)) < 0.000001 && Math.abs(Number(a.lng) - Number(b.lng)) < 0.000001
}

function toLngLat(point) {
  return [Number(point.lng), Number(point.lat)]
}

function pointFromCoordinate(coordinate) {
  const point = { lng: Number(coordinate?.[0]), lat: Number(coordinate?.[1]) }
  return isValidCoord(point) ? point : null
}

function bearingBetween(from, to) {
  if (!isValidCoord(from) || !isValidCoord(to)) return 0

  const fromLat = (Number(from.lat) * Math.PI) / 180
  const toLat = (Number(to.lat) * Math.PI) / 180
  const deltaLng = ((Number(to.lng) - Number(from.lng)) * Math.PI) / 180
  const y = Math.sin(deltaLng) * Math.cos(toLat)
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng)

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function distanceMeters(a, b) {
  const km = (() => {
    if (!isValidCoord(a) || !isValidCoord(b)) return null
    const R = 6371
    const dLat = ((Number(b.lat) - Number(a.lat)) * Math.PI) / 180
    const dLng = ((Number(b.lng) - Number(a.lng)) * Math.PI) / 180
    const latA = (Number(a.lat) * Math.PI) / 180
    const latB = (Number(b.lat) * Math.PI) / 180
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(latA) * Math.cos(latB) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  })()

  return km == null ? null : km * 1000
}

function routeDistanceMeters(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null

  let total = 0
  let previous = pointFromCoordinate(coordinates[0])

  for (let index = 1; index < coordinates.length; index += 1) {
    const point = pointFromCoordinate(coordinates[index])
    const segment = distanceMeters(previous, point)
    if (segment != null) total += segment
    previous = point
  }

  return total
}

function routePointAtDistance(coordinates, targetMeters) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null

  let walked = 0
  let previous = pointFromCoordinate(coordinates[0])

  for (let index = 1; index < coordinates.length; index += 1) {
    const point = pointFromCoordinate(coordinates[index])
    const segment = distanceMeters(previous, point)

    if (segment != null && walked + segment >= targetMeters) {
      const ratio = clamp((targetMeters - walked) / segment, 0, 1)
      return {
        lat: Number(previous.lat) + (Number(point.lat) - Number(previous.lat)) * ratio,
        lng: Number(previous.lng) + (Number(point.lng) - Number(previous.lng)) * ratio,
      }
    }

    walked += segment || 0
    previous = point
  }

  return pointFromCoordinate(coordinates[coordinates.length - 1])
}

function navigationZoomForDistance(distance) {
  if (!Number.isFinite(distance)) return 19.35
  if (distance <= 90) return 19.65
  if (distance <= 250) return 19.5
  if (distance <= 1000) return 19.35
  return 19.15
}

function bearingDelta(a, b) {
  const delta = Math.abs(Number(a) - Number(b)) % 360
  return delta > 180 ? 360 - delta : delta
}

function nextRoutePoint(origin, coordinates) {
  if (!isValidCoord(origin) || !Array.isArray(coordinates)) return null

  for (const coordinate of coordinates) {
    const point = pointFromCoordinate(coordinate)
    if (isValidCoord(point) && !sameCoord(origin, point)) return point
  }

  return null
}

function makeRouteFeature(points) {
  const validPoints = points.filter(isValidCoord)
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: validPoints.length > 1 ? validPoints.map(toLngLat) : [],
    },
    properties: {},
  }
}

function createMarkerElement(className, content) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = className
  element.innerHTML = content
  return element
}

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
  const [showTraffic, setShowTraffic] = useState(true)
  const [mapReady, setMapReady] = useState(false)
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const routeRequestRef = useRef(0)
  const navigationCameraRef = useRef(null)
  const [navigationPose, setNavigationPose] = useState(null)

  const mapData = useMemo(() => {
    const selectedInList = selectedDriver && drivers.some((driver) => driver.id === selectedDriver.id)
    const visibleDrivers = (selectedInList || !selectedDriver ? drivers : [selectedDriver, ...drivers])
      .filter(isValidCoord)
      .slice(0, 6)
    const points = [origin, destination, selectedDriver, ...visibleDrivers].filter(isValidCoord)
    const bounds = getBounds(points)
    const originPoint = isValidCoord(origin) ? project(origin, bounds) : null
    const destinationPoint = isValidCoord(destination) ? project(destination, bounds) : null
    const selectedPoint = isValidCoord(selectedDriver) ? project(selectedDriver, bounds) : null
    const routePoints = destinationPoint && selectedPoint
      ? [originPoint, selectedPoint, destinationPoint]
      : destinationPoint
        ? [originPoint, destinationPoint]
        : []

    return {
      originPoint,
      destinationPoint,
      selectedPoint,
      path: routePath(routePoints),
      driverPins: visibleDrivers.map((driver) => ({
        driver,
        point: project(driver, bounds),
      })),
    }
  }, [origin, destination, selectedDriver, drivers])

  useEffect(() => {
    let cancelled = false

    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled || !mapContainerRef.current || mapRef.current) return

        mapboxgl.accessToken = MAPBOX_TOKEN
        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: 'mapbox://styles/mapbox/navigation-night-v1',
          center: toLngLat(isValidCoord(origin) ? origin : { lat: -25.5167, lng: -54.6167 }),
          zoom: navigationMode ? 18.2 : 14.1,
          pitch: is3d ? (navigationMode ? 72 : 64) : 0,
          bearing: is3d ? -18 : 0,
          antialias: true,
          attributionControl: false,
          interactive: mapInteractive,
        })

        if (!mapInteractive) {
          map.scrollZoom.disable()
          map.boxZoom.disable()
          map.dragRotate.disable()
          map.dragPan.disable()
          map.keyboard.disable()
          map.doubleClickZoom.disable()
          map.touchZoomRotate.disable()
        }

        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
        mapRef.current = map

        map.on('load', () => {
          if (cancelled) return
          setMapReady(true)

          map.addSource('michofer-route', {
            type: 'geojson',
            data: makeRouteFeature([origin, origin]),
          })

          map.addLayer({
            id: 'michofer-route-shadow',
            type: 'line',
            source: 'michofer-route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#061a3d',
              'line-opacity': 0.34,
              'line-width': 12,
            },
          })

          map.addLayer({
            id: 'michofer-route-core',
            type: 'line',
            source: 'michofer-route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#1f7aff',
              'line-width': 5,
            },
          })

          if (map.getLayer('building')) {
            const labelLayer = map.getLayer('road-label-simple') ? 'road-label-simple' : undefined
            map.addLayer(
              {
                id: 'michofer-3d-buildings',
                source: 'composite',
                'source-layer': 'building',
                filter: ['==', 'extrude', 'true'],
                type: 'fill-extrusion',
                minzoom: 13,
                paint: {
                  'fill-extrusion-color': '#d7dde6',
                  'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['get', 'height']],
                  'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['get', 'min_height']],
                  'fill-extrusion-opacity': 0.72,
                },
              },
              labelLayer
            )
          }

          try {
            map.addSource('mapbox-dem', {
              type: 'raster-dem',
              url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
              tileSize: 512,
              maxzoom: 14,
            })
            map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.15 })
          } catch {
            // Terrain is cosmetic; the routing layer still works without it.
          }
        })
      })
      .catch(() => setMapReady(false))

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !isValidCoord(origin)) return
    if (navigationMode && isValidCoord(destination)) return

    map.easeTo({
      center: toLngLat(isValidCoord(selectedDriver) ? selectedDriver : origin),
      pitch: is3d ? 64 : 0,
      bearing: is3d ? -18 : 0,
      zoom: selectedDriver ? 14.6 : 14.1,
      duration: animateCamera ? 650 : 0,
    })
  }, [animateCamera, destination, is3d, mapReady, navigationMode, origin, selectedDriver])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !isValidCoord(origin)) return

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    const mapboxgl = window.mapboxgl
    if (navigationMode) {
      const markerPoint = navigationPose?.point || origin
      const navigationBearing = Number.isFinite(navigationPose?.bearing)
        ? navigationPose.bearing
        : bearingBetween(markerPoint, destination)
      const originMarker = createMarkerElement(
        'mapbox-navigation-marker',
        '<span class="navigation-arrow"></span>'
      )
      markersRef.current.push(
        new mapboxgl.Marker({
          element: originMarker,
          rotation: navigationBearing,
          rotationAlignment: 'map',
          pitchAlignment: 'map',
        })
          .setLngLat(toLngLat(markerPoint))
          .addTo(map)
      )
    } else {
      const originMarker = createMarkerElement(
        clientAvatar ? 'mapbox-point-marker origin with-avatar' : 'mapbox-point-marker origin',
        clientAvatar ? `<img src="${clientAvatar}" alt="">` : '<span></span>'
      )
      markersRef.current.push(new mapboxgl.Marker(originMarker).setLngLat(toLngLat(origin)).addTo(map))
    }
    if (isValidCoord(destination)) {
      const destinationMarker = createMarkerElement('mapbox-point-marker destination', '<span></span>')
      markersRef.current.push(new mapboxgl.Marker(destinationMarker).setLngLat(toLngLat(destination)).addTo(map))
    }

    mapData.driverPins.forEach(({ driver }) => {
      const initials = String(driver.name || 'CH').slice(0, 2).toUpperCase()
      const markerElement = createMarkerElement(
        selectedDriver?.id === driver.id ? 'mapbox-driver-marker active' : 'mapbox-driver-marker',
        driver.avatar ? `<img src="${driver.avatar}" alt="">` : `<span>${initials}</span>`
      )
      markerElement.addEventListener('click', () => onSelectDriver(driver))
      markersRef.current.push(new mapboxgl.Marker(markerElement).setLngLat(toLngLat(driver)).addTo(map))
    })
  }, [clientAvatar, destination, mapData.driverPins, mapReady, navigationMode, navigationPose, onSelectDriver, origin, selectedDriver?.id])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.getSource('michofer-route')) return
    if (!isValidCoord(origin) || !isValidCoord(destination)) {
      map.getSource('michofer-route').setData(makeRouteFeature([origin, origin]))
      return
    }

    const requestId = routeRequestRef.current + 1
    routeRequestRef.current = requestId
    const rawWaypoints = selectedDriver && isValidCoord(selectedDriver)
      ? [origin, selectedDriver, destination]
      : [origin, destination]
    const waypoints = rawWaypoints.filter(isValidCoord).filter((point, index, list) => {
      const previous = list[index - 1]
      return !previous || !sameCoord(previous, point)
    })

    if (waypoints.length < 2) {
      map.getSource('michofer-route').setData(makeRouteFeature([origin, destination]))
      return
    }

    const applyNavigationCamera = (routeCoordinates = []) => {
      const snappedPoint = pointFromCoordinate(routeCoordinates[0]) || origin
      const nextPoint = nextRoutePoint(snappedPoint, routeCoordinates) || destination
      const routeBearing = bearingBetween(snappedPoint, nextPoint)
      const remainingMeters = routeDistanceMeters(routeCoordinates)
      const cameraPoint = snappedPoint
      const cameraZoom = navigationZoomForDistance(remainingMeters)
      const previousCamera = navigationCameraRef.current
      const movedMeters = previousCamera?.origin ? distanceMeters(previousCamera.origin, snappedPoint) : null
      const cameraMovedMeters = previousCamera?.center ? distanceMeters(previousCamera.center, cameraPoint) : null
      const changedBearing = previousCamera ? bearingDelta(previousCamera.bearing, routeBearing) : 999
      const changedZoom = previousCamera ? Math.abs(previousCamera.zoom - cameraZoom) : 999

      setNavigationPose((current) => {
        const poseMoved = current?.point ? distanceMeters(current.point, snappedPoint) : null
        const poseBearingChanged = current ? bearingDelta(current.bearing, routeBearing) : 999

        if (poseMoved != null && poseMoved < 3 && poseBearingChanged < 5) return current
        return {
          point: snappedPoint,
          bearing: routeBearing,
        }
      })

      if (
        previousCamera?.ready &&
        movedMeters != null &&
        movedMeters < 8 &&
        cameraMovedMeters != null &&
        cameraMovedMeters < 14 &&
        changedBearing < 10 &&
        changedZoom < 0.15 &&
        previousCamera.is3d === is3d
      ) {
        return
      }

      navigationCameraRef.current = {
        ready: true,
        origin: { lat: Number(snappedPoint.lat), lng: Number(snappedPoint.lng) },
        center: { lat: Number(cameraPoint.lat), lng: Number(cameraPoint.lng) },
        bearing: routeBearing,
        zoom: cameraZoom,
        is3d,
      }

      map.easeTo({
        center: toLngLat(cameraPoint),
        zoom: cameraZoom,
        pitch: is3d ? 58 : 0,
        bearing: is3d ? routeBearing : 0,
        padding: { top: 92, bottom: 44, left: 34, right: 34 },
        offset: [0, 145],
        duration: animateCamera ? 420 : 0,
      })
    }

    const coordinates = waypoints.map((point) => toLngLat(point).join(',')).join(';')
    const routeProfile = showTraffic ? 'driving-traffic' : 'driving'
    const url = `https://api.mapbox.com/directions/v5/mapbox/${routeProfile}/${coordinates}?geometries=geojson&overview=full&steps=true&language=es&access_token=${MAPBOX_TOKEN}`

    fetch(url)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Directions failed'))))
      .then((data) => {
        if (routeRequestRef.current !== requestId) return
        const routeData = data?.routes?.[0]
        const route = routeData?.geometry
        map.getSource('michofer-route').setData(
          route
            ? { type: 'Feature', geometry: route, properties: {} }
            : makeRouteFeature(waypoints)
        )
        onRouteUpdate?.({
          distance: routeData?.distance ?? null,
          duration: routeData?.duration ?? null,
          instruction: routeData?.legs?.[0]?.steps?.[0]?.maneuver?.instruction || '',
        })
        if (navigationMode) applyNavigationCamera(route?.coordinates || waypoints.map(toLngLat))
      })
      .catch(() => {
        if (routeRequestRef.current !== requestId) return
        map.getSource('michofer-route').setData(makeRouteFeature(waypoints))
        onRouteUpdate?.(null)
        if (navigationMode) applyNavigationCamera(waypoints.map(toLngLat))
      })

    if (navigationMode) {
      return
    }

    const bounds = new window.mapboxgl.LngLatBounds()
    waypoints.forEach((point) => bounds.extend(toLngLat(point)))
    const padding = typeof fitPadding === 'function'
      ? fitPadding()
      : fitPadding || { top: 96, bottom: 122, left: 58, right: 58 }

    map.fitBounds(bounds, {
      padding,
      pitch: is3d ? 64 : 0,
      bearing: is3d ? -18 : 0,
      duration: animateCamera ? 720 : 0,
      maxZoom: 15.2,
    })
  }, [animateCamera, destination, fitPadding, is3d, mapReady, navigationMode, onRouteUpdate, origin, selectedDriver, showTraffic])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return
    map.getCanvas().classList.toggle('traffic-enabled', showTraffic)
  }, [mapReady, showTraffic])

  return (
    <section className={is3d ? 'mobility-map interactive-map is-3d' : 'mobility-map interactive-map'}>
      <div ref={mapContainerRef} className={mapReady ? 'mapbox-real-map ready' : 'mapbox-real-map'} />

      <div className="map-toolbar" aria-label="Controles de mapa">
        <button type="button" className={is3d ? 'active' : ''} onClick={() => setIs3d((value) => !value)}>
          <Layers size={16} />
          {is3d ? '3D' : '2D'}
        </button>
        <button
          type="button"
          className={showTraffic ? 'active' : ''}
          onClick={() => setShowTraffic((value) => !value)}
        >
          <Navigation size={16} />
          Trafico
        </button>
      </div>

      <button className="map-locate-btn" type="button" onClick={onRefreshLocation} aria-label="Actualizar ubicacion">
        <LocateFixed size={19} />
      </button>

      {!mapReady && (
        <div className="map-empty-state">
          <div className="map-loading-orbit" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <strong>Cargando mapa</strong>
          <span>Preparando ruta en vivo</span>
        </div>
      )}

      {showRouteSummary && destination && (
        <article className="route-summary">
          <div>
            <span>Ruta al destino</span>
            <strong>{destinationText}</strong>
          </div>
          <button type="button" onClick={onChooseDriver}>Elegir chofer</button>
        </article>
      )}
    </section>
  )
}
