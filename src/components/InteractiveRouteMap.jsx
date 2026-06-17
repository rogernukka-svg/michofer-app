import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, LocateFixed, Navigation } from 'lucide-react'

const PADDING = 0.004
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN || ''
const MAPBOX_JS = 'https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.js'
const MAPBOX_CSS = 'https://api.mapbox.com/mapbox-gl-js/v3.8.0/mapbox-gl.css'

function loadMapbox() {
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

function toLngLat(point) {
  return [Number(point.lng), Number(point.lat)]
}

function makeRouteFeature(points) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: points.map(toLngLat),
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
  drivers,
  selectedDriver,
  onSelectDriver,
  onChooseDriver,
  onRefreshLocation,
}) {
  const [is3d, setIs3d] = useState(true)
  const [showTraffic, setShowTraffic] = useState(true)
  const [mapReady, setMapReady] = useState(false)
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const routeRequestRef = useRef(0)

  const mapData = useMemo(() => {
    const selectedInList = selectedDriver && drivers.some((driver) => driver.id === selectedDriver.id)
    const visibleDrivers = (selectedInList || !selectedDriver ? drivers : [selectedDriver, ...drivers])
      .filter((driver) => Number.isFinite(driver.lat) && Number.isFinite(driver.lng))
      .slice(0, 6)
    const points = [origin, destination, selectedDriver, ...visibleDrivers].filter(Boolean)
    const bounds = getBounds(points)
    const originPoint = project(origin, bounds)
    const destinationPoint = destination ? project(destination, bounds) : null
    const selectedPoint = selectedDriver ? project(selectedDriver, bounds) : null
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
          center: toLngLat(origin),
          zoom: 14.1,
          pitch: is3d ? 64 : 0,
          bearing: is3d ? -18 : 0,
          antialias: true,
          attributionControl: false,
        })

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
              'line-color': '#050505',
              'line-opacity': 0.22,
              'line-width': 12,
            },
          })

          map.addLayer({
            id: 'michofer-route-core',
            type: 'line',
            source: 'michofer-route',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#e30613',
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
    if (!mapReady || !map) return

    map.easeTo({
      center: toLngLat(selectedDriver || origin),
      pitch: is3d ? 64 : 0,
      bearing: is3d ? -18 : 0,
      zoom: selectedDriver ? 14.6 : 14.1,
      duration: 650,
    })
  }, [is3d, mapReady, origin, selectedDriver])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return

    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    const mapboxgl = window.mapboxgl
    const originMarker = createMarkerElement('mapbox-point-marker origin', '<span></span>')
    markersRef.current.push(new mapboxgl.Marker(originMarker).setLngLat(toLngLat(origin)).addTo(map))
    if (destination) {
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
  }, [destination, mapData.driverPins, mapReady, onSelectDriver, origin, selectedDriver?.id])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.getSource('michofer-route')) return
    if (!destination) {
      map.getSource('michofer-route').setData(makeRouteFeature([origin, origin]))
      return
    }

    const requestId = routeRequestRef.current + 1
    routeRequestRef.current = requestId
    const waypoints = selectedDriver ? [origin, selectedDriver, destination] : [origin, destination]
    const coordinates = waypoints.map((point) => toLngLat(point).join(',')).join(';')
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?geometries=geojson&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`

    fetch(url)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Directions failed'))))
      .then((data) => {
        if (routeRequestRef.current !== requestId) return
        const route = data?.routes?.[0]?.geometry
        map.getSource('michofer-route').setData(
          route
            ? { type: 'Feature', geometry: route, properties: {} }
            : makeRouteFeature(waypoints)
        )
      })
      .catch(() => {
        if (routeRequestRef.current !== requestId) return
        map.getSource('michofer-route').setData(makeRouteFeature(waypoints))
      })

    const bounds = new window.mapboxgl.LngLatBounds()
    waypoints.forEach((point) => bounds.extend(toLngLat(point)))
    map.fitBounds(bounds, {
      padding: { top: 96, bottom: 122, left: 58, right: 58 },
      pitch: is3d ? 64 : 0,
      bearing: is3d ? -18 : 0,
      duration: 720,
      maxZoom: 15.2,
    })
  }, [destination, is3d, mapReady, origin, selectedDriver])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return

    try {
      if (!map.getSource('michofer-traffic')) {
        map.addSource('michofer-traffic', {
          type: 'vector',
          url: 'mapbox://mapbox.mapbox-traffic-v1',
        })
        map.addLayer(
          {
            id: 'michofer-traffic',
            type: 'line',
            source: 'michofer-traffic',
            'source-layer': 'traffic',
            paint: {
              'line-color': [
                'match',
                ['get', 'congestion'],
                'low',
                '#16a34a',
                'moderate',
                '#f59e0b',
                'heavy',
                '#ef4444',
                'severe',
                '#b42318',
                '#16a34a',
              ],
              'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 3.5],
              'line-opacity': 0.78,
            },
          },
          map.getLayer('michofer-route-shadow') ? 'michofer-route-shadow' : undefined
        )
      }

      map.setLayoutProperty('michofer-traffic', 'visibility', showTraffic ? 'visible' : 'none')
    } catch {
      // Some Mapbox styles do not expose traffic tiles for every token.
    }
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
          <strong>Mapa no disponible</strong>
          <span>Revisá la conexión para cargar el mapa real.</span>
        </div>
      )}

      {destination && (
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
