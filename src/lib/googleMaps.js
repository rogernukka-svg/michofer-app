export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
export const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || ''
const GOOGLE_MAPS_JS = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,geometry`

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
