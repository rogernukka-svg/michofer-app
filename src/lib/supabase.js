import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
)

export function signInWithGoogle() {
  const appUrl = import.meta.env.VITE_APP_URL
  const baseUrl = appUrl || (typeof window !== 'undefined' ? window.location.origin : '')
  const redirectTo =
    baseUrl
      ? `${baseUrl.replace(/\/$/, '')}/login`
      : undefined

  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        prompt: 'select_account',
      },
    },
  })
}

function isMissingGenderProfileArg(error) {
  const message = String(error?.message || error?.details || '').toLowerCase()
  return (
    error?.code === 'PGRST202' ||
    message.includes('p_gender_identity') ||
    message.includes('could not find the function')
  )
}

export async function upsertOwnProfile({ fullName, role, avatarUrl, email, genderIdentity }) {
  const payload = {
    p_full_name: fullName || null,
    p_role: role || 'passenger',
    p_avatar_url: avatarUrl || null,
    p_email: email || null,
  }

  const result = await supabase.rpc('upsert_own_profile', {
    ...payload,
    p_gender_identity: genderIdentity || null,
  })

  if (result.error && isMissingGenderProfileArg(result.error)) {
    return supabase.rpc('upsert_own_profile', payload)
  }

  return result
}

export function getOwnProfile() {
  return supabase.rpc('get_own_profile')
}

export function getProfilePreviewByEmail(email) {
  return supabase.rpc('get_profile_preview_by_email', {
    lookup_email: email || '',
  })
}

export function upsertOwnDriverProfile({ fullName, avatarUrl, email }) {
  return supabase.rpc('upsert_own_driver_profile', {
    p_full_name: fullName || null,
    p_avatar_url: avatarUrl || null,
    p_email: email || null,
  })
}

export function getOwnDriverProfile() {
  return supabase.rpc('get_own_driver_profile')
}

export function getAvailableDrivers() {
  return supabase.rpc('get_available_drivers')
}

export function requestWomenMode(genderIdentity = 'woman') {
  return supabase.rpc('request_women_mode', {
    p_gender_identity: genderIdentity || 'woman',
  })
}

export function requestDriverCategory(categoryCode) {
  return supabase.rpc('request_driver_category', {
    p_category_code: categoryCode,
  })
}

export function adminReviewDriverCategory({ workerId, categoryCode, decision, reason }) {
  return supabase.rpc('admin_review_driver_category', {
    p_worker_id: workerId,
    p_category_code: categoryCode,
    p_decision: decision,
    p_reason: reason || null,
  })
}

export function adminReviewWomenMode({ userId, decision, reason }) {
  return supabase.rpc('admin_review_women_mode', {
    p_user_id: userId,
    p_decision: decision,
    p_reason: reason || null,
  })
}

function isLocalBrowser() {
  if (typeof window === 'undefined') return false
  return ['localhost', '127.0.0.1'].includes(window.location.hostname)
}

export async function getAvailableDriversViaLocalProxy() {
  if (!isLocalBrowser()) {
    return {
      data: null,
      error: new Error('Local Supabase proxy is only available on localhost'),
    }
  }

  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token || supabaseAnonKey
  const response = await fetch('/supabase-proxy/rest/v1/rpc/get_available_drivers', {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })

  if (!response.ok) {
    let details = ''
    try {
      details = await response.text()
    } catch {
      details = response.statusText
    }

    return {
      data: null,
      error: new Error(`Supabase proxy failed (${response.status}): ${details || response.statusText}`),
    }
  }

  return {
    data: await response.json(),
    error: null,
  }
}

function isMissingRideCategoryArg(error) {
  const message = String(error?.message || error?.details || '').toLowerCase()
  return (
    error?.code === 'PGRST202' ||
    message.includes('p_ride_category') ||
    message.includes('could not find the function') ||
    (message.includes('request_trip') && message.includes('ride_category'))
  )
}

export async function requestTrip({
  driverId,
  destinationText,
  destinationLat,
  destinationLng,
  pickupLat,
  pickupLng,
  driverLat,
  driverLng,
  routeKm,
  price,
  paymentMethod,
  womenMode,
  rideCategory,
}) {
  const payload = {
    p_driver_id: driverId,
    p_destination_text: destinationText,
    p_destination_lat: Number.isFinite(Number(destinationLat)) ? Number(destinationLat) : null,
    p_destination_lng: Number.isFinite(Number(destinationLng)) ? Number(destinationLng) : null,
    p_pickup_lat: Number.isFinite(Number(pickupLat)) ? Number(pickupLat) : null,
    p_pickup_lng: Number.isFinite(Number(pickupLng)) ? Number(pickupLng) : null,
    p_driver_lat: Number.isFinite(Number(driverLat)) ? Number(driverLat) : null,
    p_driver_lng: Number.isFinite(Number(driverLng)) ? Number(driverLng) : null,
    p_route_km: Number.isFinite(Number(routeKm)) ? Number(routeKm) : null,
    p_price: Number.isFinite(Number(price)) ? Number(price) : null,
    p_payment_method: paymentMethod || 'cash',
    p_women_mode: Boolean(womenMode),
  }

  const result = await supabase.rpc('request_trip', {
    ...payload,
    p_ride_category: rideCategory || 'auto_standard',
  })

  if (result.error && isMissingRideCategoryArg(result.error)) {
    return supabase.rpc('request_trip', payload)
  }

  return result
}

export function getOwnDriverTrips() {
  return supabase.rpc('get_own_driver_trips')
}

export function updateOwnDriverStatus({ isOnline, isAvailable, lat, lng }) {
  return supabase.rpc('update_own_driver_status', {
    p_is_online: Boolean(isOnline),
    p_is_available: Boolean(isAvailable),
    p_lat: Number.isFinite(Number(lat)) ? Number(lat) : null,
    p_lng: Number.isFinite(Number(lng)) ? Number(lng) : null,
  })
}

function isMissingRpc(error, rpcName = '') {
  const message = String(error?.message || error?.details || '').toLowerCase()
  return (
    error?.code === 'PGRST202' ||
    message.includes('could not find the function') ||
    (rpcName && message.includes(rpcName.toLowerCase()))
  )
}

export function isAdminSimulatorTrip(trip) {
  if (!trip) return false

  const destinationText = String(trip.destination_text || '').trim().toLowerCase()
  return trip.is_test === true || destinationText === 'viaje test admin'
}

export async function adminCreateTestTrip(payload) {
  const rpcPayload = {
    p_client_id: payload.clientId,
    p_driver_id: payload.driverId,
    p_pickup_lat: Number(payload.pickupLat),
    p_pickup_lng: Number(payload.pickupLng),
    p_destination_lat: Number(payload.destinationLat),
    p_destination_lng: Number(payload.destinationLng),
    p_destination_text: payload.destinationText || 'Viaje test admin',
    p_route_km: Number.isFinite(Number(payload.routeKm)) ? Number(payload.routeKm) : null,
    p_price: Number.isFinite(Number(payload.price)) ? Number(payload.price) : 25000,
  }

  const rpcResult = await supabase.rpc('admin_create_test_trip', rpcPayload)
  if (!rpcResult.error || !isMissingRpc(rpcResult.error, 'admin_create_test_trip')) return rpcResult

  return supabase
    .from('trips')
    .insert({
      client_id: payload.clientId,
      driver_id: payload.driverId,
      status: 'pending',
      pickup_lat: Number(payload.pickupLat),
      pickup_lng: Number(payload.pickupLng),
      destination_lat: Number(payload.destinationLat),
      destination_lng: Number(payload.destinationLng),
      destination_text: payload.destinationText || 'Viaje test admin',
      driver_lat: Number(payload.pickupLat),
      driver_lng: Number(payload.pickupLng),
      driver_heading: 0,
      driver_speed: 0,
      driver_accuracy: 10,
      route_km: Number.isFinite(Number(payload.routeKm)) ? Number(payload.routeKm) : null,
      price: Number.isFinite(Number(payload.price)) ? Number(payload.price) : 25000,
      payment_method: 'cash',
      ride_category: 'all',
      is_test: true,
      created_by_admin: payload.adminId || null,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single()
}

export async function adminUpdateTestTripLocation({ tripId, driverId, lat, lng, heading, speed, accuracy, status }) {
  const payload = {
    p_trip_id: tripId,
    p_driver_id: driverId,
    p_lat: Number(lat),
    p_lng: Number(lng),
    p_heading: Number.isFinite(Number(heading)) ? Number(heading) : null,
    p_speed: Number.isFinite(Number(speed)) ? Number(speed) : 0,
    p_accuracy: Number.isFinite(Number(accuracy)) ? Number(accuracy) : 10,
    p_status: status || null,
  }

  const rpcResult = await supabase.rpc('admin_update_test_trip_location', payload)
  if (!rpcResult.error || !isMissingRpc(rpcResult.error, 'admin_update_test_trip_location')) return rpcResult

  const nextUpdate = {
    driver_lat: Number(lat),
    driver_lng: Number(lng),
    driver_heading: payload.p_heading,
    driver_speed: payload.p_speed,
    driver_accuracy: payload.p_accuracy,
    updated_at: new Date().toISOString(),
  }
  if (status) nextUpdate.status = status

  const tripResult = await supabase
    .from('trips')
    .update(nextUpdate)
    .eq('id', tripId)
    .select('*')
    .single()

  if (tripResult.error) return tripResult

  return tripResult
}

export async function adminUpdateTestTripStatus({ tripId, status }) {
  const rpcResult = await supabase.rpc('admin_update_test_trip_status', {
    p_trip_id: tripId,
    p_status: status,
  })
  if (!rpcResult.error || !isMissingRpc(rpcResult.error, 'admin_update_test_trip_status')) return rpcResult

  return supabase
    .from('trips')
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tripId)
    .select('*')
    .single()
}
