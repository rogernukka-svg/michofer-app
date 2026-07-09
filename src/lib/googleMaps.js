export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
export const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || ''
export const GOOGLE_MAPS_LIGHT_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_LIGHT_MAP_ID || ''
export const GOOGLE_MAPS_DARK_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_DARK_MAP_ID || ''
function isLocalNetworkHost(hostname) {
  if (!hostname) return false
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  // Private IPv4 ranges (10.x, 192.168.x, 172.16-31.x)
  if (/^10\./.test(hostname)) return true
  if (/^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)) return true
  return false
}

const RUNTIME_HOSTNAME = typeof window !== 'undefined' ? window.location.hostname : ''
const DISABLE_ROUTES_IN_LOCAL = isLocalNetworkHost(RUNTIME_HOSTNAME)

export const GOOGLE_ROADS_API_ENABLED = import.meta.env.VITE_GOOGLE_ROADS_API_ENABLED === 'true' && !DISABLE_ROUTES_IN_LOCAL
export const GOOGLE_ROUTES_API_ENABLED = import.meta.env.VITE_GOOGLE_ROUTES_API_ENABLED === 'true' && !DISABLE_ROUTES_IN_LOCAL
export const GOOGLE_PLACES_NEW_ENABLED = import.meta.env.VITE_GOOGLE_PLACES_NEW_ENABLED === 'true'
const GOOGLE_MAPS_JS = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,geometry,marker`

let googleMapsPromise = null

export function loadGoogleMaps() {
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('Missing Google Maps API key'))
  }

  if (window.google?.maps?.Map) {
    return Promise.resolve(window.google)
  }

  if (googleMapsPromise) {
    return googleMapsPromise
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[src^="https://maps.googleapis.com/maps/api/js"]')

    if (existingScript) {
      existingScript.addEventListener(
        'load',
        () => {
          if (window.google?.maps?.Map) {
            resolve(window.google)
          } else {
            reject(new Error('Google Maps loaded but window.google.maps.Map is not available'))
          }
        },
        { once: true }
      )
      existingScript.addEventListener('error', reject, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = GOOGLE_MAPS_JS
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.maps?.Map) {
        resolve(window.google)
      } else {
        reject(new Error('Google Maps loaded but window.google.maps.Map is not available'))
      }
    }
    script.onerror = () => reject(new Error('Failed to load Google Maps script'))
    document.head.appendChild(script)
  })

  return googleMapsPromise
}

export async function reverseGeocode(lat, lng) {
  try {
    const google = await loadGoogleMaps()
    if (!google?.maps?.Geocoder) {
      console.warn('Geocoder no disponible para reverse geocode')
      return null
    }
    return new Promise((resolve) => {
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode(
        { location: { lat: Number(lat), lng: Number(lng) } },
        (results, status) => {
          if (status === 'OK' && results?.[0]) {
            resolve({
              formatted_address: results[0].formatted_address,
              lat: Number(results[0].geometry.location.lat()),
              lng: Number(results[0].geometry.location.lng()),
            })
          } else {
            console.warn('Reverse geocoding no exitoso:', status)
            resolve(null)
          }
        }
      )
    })
  } catch (error) {
    console.error('Error en reverse geocodificacion:', error)
    return null
  }
}

/**
 * Determines if it's currently "dark time" based on local time.
 * Dark: 18:30 - 05:45
 * Light: 05:45 - 18:30
 * @returns {'light' | 'dark'}
 */
export function getAutoMapTheme() {
  const now = new Date()
  const hours = now.getHours()
  const minutes = now.getMinutes()
  const totalMinutes = hours * 60 + minutes

  // Dark from 18:30 (1110 min) to 05:45 (345 min)
  if (totalMinutes >= 1110 || totalMinutes < 345) {
    return 'dark'
  }
  return 'light'
}

/**
 * Returns the appropriate MapID for the given theme.
 * Falls back to GOOGLE_MAPS_MAP_ID if no dedicated dark/light MapID is set.
 */
export function getMapIdForTheme(theme) {
  if (theme === 'dark' && GOOGLE_MAPS_DARK_MAP_ID) return GOOGLE_MAPS_DARK_MAP_ID
  if (theme === 'light' && GOOGLE_MAPS_LIGHT_MAP_ID) return GOOGLE_MAPS_LIGHT_MAP_ID
  return GOOGLE_MAPS_MAP_ID || undefined
}

/**
 * Roads API: Snap GPS points to roads.
 * Uses the Google Roads API endpoint directly.
 * Max 100 points per request. We send last 5-20 points.
 * Falls back silently if Roads API fails.
 * @param {Array<{lat: number, lng: number}>} points - GPS points to snap
 * @returns {Promise<{lat: number, lng: number, placeId: string|null, originalIndex: number, snappedAt: number}|null>} last snapped point
 */
export async function snapToRoads(points) {
  if (!GOOGLE_ROADS_API_ENABLED || !Array.isArray(points) || points.length < 2) {
    return null
  }

  // Use only last 100 points
  const limitedPoints = points.slice(-100)
  const path = limitedPoints.map((p) => `${Number(p.lat)},${Number(p.lng)}`).join('|')

  const url = `https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(path)}&interpolate=true&key=${GOOGLE_MAPS_API_KEY}`

  try {
    const response = await fetch(url)
    if (!response.ok) return null

    const data = await response.json()
    if (!data?.snappedPoints?.length) return null

    // Return the LAST snapped point (most recent)
    const last = data.snappedPoints[data.snappedPoints.length - 1]
    return {
      lat: last.location.latitude,
      lng: last.location.longitude,
      placeId: last.placeId || null,
      originalIndex: last.originalIndex,
      snappedAt: Date.now(),
    }
  } catch {
    // Silently fail - app continues without Roads
    return null
  }
}

/**
 * Stores recent GPS points for Roads API calls.
 * Auto-prunes points older than 30 seconds.
 */
export class GpsBuffer {
  constructor(maxPoints = 20) {
    this.points = []
    this.maxPoints = maxPoints
    this.maxAgeMs = 30000
  }

  push(point) {
    const now = Date.now()
    this.points.push({ ...point, _ts: now })

    // Prune old points
    this.points = this.points
      .filter((p) => now - p._ts < this.maxAgeMs)
      .slice(-this.maxPoints)
  }

  getForRoads() {
    // Return last 5-20 points with timestamps
    return this.points.length >= 5 ? this.points.slice(-Math.min(this.points.length, 20)) : []
  }

  clear() {
    this.points = []
  }
}

/**
 * Decodes a Google Maps encoded polyline string into an array of {lat, lng}.
 * @param {string} encoded - The encoded polyline string
 * @returns {Array<{lat: number, lng: number}>}
 */
export function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return []

  const points = []
  let index = 0
  const len = encoded.length
  let lat = 0
  let lng = 0

  while (index < len) {
    let b
    let shift = 0
    let result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1)
    lat += dlat

    shift = 0
    result = 0
    do {
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1)
    lng += dlng

    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }

  return points
}

/**
 * Routes API moderna: computeRoutes.
 * Usa POST https://routes.googleapis.com/directions/v2:computeRoutes
 * Si falla, devuelve null para que el caller use DirectionsService como fallback.
 * @param {object} params
 * @param {object} params.origin - {lat, lng}
 * @param {object} params.destination - {lat, lng}
 * @param {Array<object>} [params.waypoints] - [{lat, lng}]
 * @returns {Promise<{path: Array, encodedPolyline: string, distance: number, duration: number, instruction: string, steps: Array, source: string, trafficStatus?: string}|null>}
 */
export async function computeRouteWithRoutesApi({ origin, destination, waypoints }) {
  if (!GOOGLE_ROUTES_API_ENABLED) return null
  if (!origin || !destination) return null

  const body = {
    origin: {
      location: {
        latLng: { latitude: origin.lat, longitude: origin.lng },
      },
    },
    destination: {
      location: {
        latLng: { latitude: destination.lat, longitude: destination.lng },
      },
    },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: false,
    polylineQuality: 'HIGH_QUALITY',
    languageCode: 'es-419',
    units: 'METRIC',
  }

  // Add waypoints if provided
  if (Array.isArray(waypoints) && waypoints.length > 0) {
    body.intermediates = waypoints.map((wp) => ({
      location: { latLng: { latitude: wp.lat, longitude: wp.lng } },
    }))
  }

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.travelAdvisory.speedReadingIntervals,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.localizedValues',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) return null

    const data = await response.json()
    if (!data?.routes?.[0]) return null

    const route = data.routes[0]
    const encodedPolyline = route.polyline?.encodedPolyline
    if (!encodedPolyline) return null

    const path = decodePolyline(encodedPolyline)
    if (path.length < 2) return null

    // Extract distance from route
    const distance = Number(route.distanceMeters) || 0
    const duration = Math.ceil(Number(route.duration?.replace('s', '')) || 0)
    const staticDuration = Math.ceil(Number(route.staticDuration?.replace('s', '')) || 0)
    const delayRatio = staticDuration > 0 && duration > 0 ? duration / staticDuration : 1
    const speedIntervals = Array.isArray(route.travelAdvisory?.speedReadingIntervals)
      ? route.travelAdvisory.speedReadingIntervals
      : []
    const hasSlowTraffic = speedIntervals.some((interval) =>
      String(interval?.speed || '').toUpperCase().includes('SLOW')
    )
    const hasTrafficJam = speedIntervals.some((interval) =>
      String(interval?.speed || '').toUpperCase().includes('TRAFFIC_JAM')
    )
    const trafficStatus = hasTrafficJam || delayRatio >= 1.35
      ? 'heavy'
      : hasSlowTraffic || delayRatio >= 1.15
        ? 'moderate'
        : staticDuration > 0
          ? 'normal'
          : null

    // Get first step instruction
    let instruction = ''
    try {
      if (route.legs?.[0]?.steps?.[0]?.navigationInstruction?.instructions) {
        instruction = route.legs[0].steps[0].navigationInstruction.instructions.replace(/<[^>]*>/g, '')
      }
    } catch {
      // ignore
    }

    const steps = Array.isArray(route.legs)
      ? route.legs.flatMap((leg) => Array.isArray(leg.steps) ? leg.steps : [])
      : []

    return {
      path,
      encodedPolyline,
      distance,
      duration,
      staticDuration,
      instruction,
      steps,
      source: 'routes_api',
      trafficStatus,
    }
  } catch {
    return null
  }
}

export async function geocodeAddress(address, signal) {
  try {
    const google = await loadGoogleMaps()
    if (!google?.maps?.Geocoder) {
      console.warn('Geocoder no disponible')
      return null
    }
    return new Promise((resolve) => {
      const geocoder = new google.maps.Geocoder()
      geocoder.geocode(
        {
          address: String(address || '').trim(),
          componentRestrictions: { country: 'PY' }
        },
        (results, status) => {
          if (status === 'OK' && results?.[0]) {
            const location = results[0].geometry.location
            resolve({
              lat: Number(location.lat()),
              lng: Number(location.lng()),
            })
          } else {
            console.warn('Geocoding no exitoso:', status)
            resolve(null)
          }
        }
      )
    })
  } catch (error) {
    console.error('Error en geocodificacion:', error)
    return null
  }
}
