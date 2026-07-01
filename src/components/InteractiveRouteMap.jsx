import { useEffect, useMemo, useRef, useState } from 'react'
import { LocateFixed, Map, Navigation } from 'lucide-react'
import { loadGoogleMaps, GOOGLE_MAPS_MAP_ID, getAutoMapTheme, getMapIdForTheme, snapToRoads, GpsBuffer, GOOGLE_ROADS_API_ENABLED, GOOGLE_ROUTES_API_ENABLED, computeRouteWithRoutesApi } from '../lib/googleMaps'

import carBackImg from '../assets/128vistadeatras.png'
import carTopImg from '../assets/128vistaarriba.png'
import carRightImg from '../assets/128derecha.png'
import carLeftImg from '../assets/128izquierda.png'

const DEFAULT_CENTER = { lat: -25.5167, lng: -54.6167 }
const DEFAULT_PADDING = { top: 96, bottom: 122, left: 58, right: 58 }
const MAX_DRIVER_MARKERS = 6

// Cámara tipo Google Maps navegación - estilo Uber/Bolt/Waze
const NAVIGATION_ZOOM = 19.0
const NAVIGATION_MOBILE_ZOOM = 19.1
const NAVIGATION_DESKTOP_ZOOM = 18.8
const NAVIGATION_DRIVER_TILT = 50
const NAVIGATION_DRIVER_STATIONARY_TILT = 45
const NAVIGATION_CAMERA_AHEAD_METERS = 62
const NAVIGATION_CAMERA_AHEAD_METERS_FAST = 74
const NAVIGATION_CAMERA_MIN_UPDATE_MS = 850
const NAVIGATION_CAMERA_MIN_MOVE_METERS = 3.5
const NAVIGATION_LOOK_AHEAD_RATIO = 0.09
const NAVIGATION_MIN_LOOK_AHEAD_METERS = 30
const NAVIGATION_MAX_LOOK_AHEAD_METERS = 95
const NAVIGATION_HEADING_DISTANCE_METERS = 82
const NAVIGATION_MIN_HEADING_CHANGE = 6
const NAVIGATION_HEADING_SMOOTHING = 0.1

const NAVIGATION_SNAP_METERS = 55
const NAVIGATION_OFF_ROUTE_METERS = 75
const NAVIGATION_REROUTE_COOLDOWN_MS = 4200
const NAVIGATION_BACKTRACK_TOLERANCE = 2
const NAVIGATION_FORWARD_SEARCH = 55
const NAVIGATION_SOFT_OFF_ROUTE_METERS = 52
const NAVIGATION_HARD_OFF_ROUTE_METERS = 75
const NAVIGATION_RECALCULATE_HEADING_DEG = 68
const NAVIGATION_NEXT_STEP_HIGHLIGHT_METERS = 240
const CAR_SPRITE_ROTATION_OFFSET = 0
const CAR_SPRITE_TURN_ENTER_DEG = 24
const CAR_SPRITE_TURN_EXIT_DEG = 12
const CAR_SPRITE_MIN_CHANGE_MS = 900
const CAR_SPRITE_MIN_LATERAL_SPEED_MPS = 0.8
const CAR_SPRITE_STARTUP_STABLE_MS = 1800

// GPS filtering constants
const MAX_ACCURACY_AGGRESSIVE = 70
const MAX_ACCURACY_IGNORE = 100
const STATIONARY_MOVE_THRESHOLD_M = 8
const MIN_SPEED_MOVING = 1.0
const IMPOSSIBLE_SPEED_THRESHOLD_MPS = 45
const MIN_MOVE_FOR_UPDATE_M = 15
const MIN_MOVE_FOR_UPDATE_MOVING_M = 3
const GPS_STATIONARY_SPEED_MPS = 0.35
const GPS_ROUTE_BLEND_MAX_METERS = 80

// Animation durations (ms)
const DURATION_NEAR = 900
const DURATION_NORMAL = 1500
const DURATION_FAR = 2200
const MIN_ANIMATION_DURATION = 600
const MAX_ANIMATION_DURATION = 3000

// Theme update interval
const THEME_CHECK_INTERVAL_MS = 300000 // 5 min

// ==================== MATH HELPERS ====================

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeAngle(angle) {
  return ((angle % 360) + 360) % 360
}

function shortestAngleDiff(from, to) {
  return ((to - from + 540) % 360) - 180
}

function interpolateHeading(from, to, t) {
  const diff = shortestAngleDiff(from, to)
  return normalizeAngle(from + diff * t)
}

function interpolateLatLng(from, to, t) {
  if (!isValidCoord(from) || !isValidCoord(to)) return to
  return {
    lat: lerp(Number(from.lat), Number(to.lat), t),
    lng: lerp(Number(from.lng), Number(to.lng), t),
  }
}

function isValidCoord(point) {
  const lat = Number(point?.lat)
  const lng = Number(point?.lng)

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    lat >= -28 &&
    lat <= -19 &&
    lng >= -63 &&
    lng <= -53
  )
}

function toLatLng(point) {
  if (!isValidCoord(point)) return DEFAULT_CENTER
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

function estimateSpeedMps(previousPoint, nextPoint) {
  if (!previousPoint || !nextPoint) return null

  const prevTime = Number(previousPoint._timestamp || previousPoint.timestamp || 0)
  const nextTime = Number(nextPoint._timestamp || nextPoint.timestamp || Date.now())
  const seconds = Math.max(0.25, (nextTime - prevTime) / 1000)
  const meters = getDistanceMeters(previousPoint, nextPoint)

  if (!Number.isFinite(meters) || !Number.isFinite(seconds) || seconds <= 0) return null

  return meters / seconds
}

function getGpsAnimationDuration(previousPoint, nextPoint) {
  const prevTime = Number(previousPoint?._timestamp || 0)
  const nextTime = Number(nextPoint?._timestamp || Date.now())
  const delta = nextTime && prevTime ? nextTime - prevTime : 1500

  return clamp(delta * 0.85, 700, 2600)
}

function getGpsSmoothingAlpha(accuracy, speed) {
  const accuracyNumber = Number(accuracy)
  const speedNumber = Number(speed)
  const isStationary = Number.isFinite(speedNumber) && speedNumber < GPS_STATIONARY_SPEED_MPS

  if (isStationary) return 0.08
  if (!Number.isFinite(accuracyNumber) || accuracyNumber <= 25) return 0.3
  if (accuracyNumber <= 60) return 0.2
  return 0.11
}

function smoothVisualPosition(currentVisual, realPoint, accuracy, speed) {
  if (!isValidCoord(realPoint)) return currentVisual
  if (!isValidCoord(currentVisual)) return toLatLng(realPoint)

  const distance = getDistanceMeters(currentVisual, realPoint)
  const speedNumber = Number(speed)
  const isStationary = Number.isFinite(speedNumber) && speedNumber < GPS_STATIONARY_SPEED_MPS

  if (distance < 0.45) return toLatLng(currentVisual)
  if (isStationary && distance < 5) return toLatLng(currentVisual)

  const baseAlpha = getGpsSmoothingAlpha(accuracy, speed)
  const catchUpBoost = clamp(distance / GPS_ROUTE_BLEND_MAX_METERS, 0, 0.42)
  const alpha = clamp(baseAlpha + catchUpBoost, baseAlpha, 0.72)

  return interpolateLatLng(currentVisual, realPoint, alpha)
}


function isGoodGpsPoint(point, previousPoint) {
  if (!isValidCoord(point)) return false

  const accuracy = Number(point.accuracy)
  const speed = Number(point.speed)
  const estimatedSpeed = estimateSpeedMps(previousPoint, point)
  const effectiveSpeed = Number.isFinite(speed) ? speed : estimatedSpeed
  const prevTime = Number(previousPoint?._timestamp || previousPoint?.timestamp || 0)
  const nextTime = Number(point?._timestamp || point?.timestamp || Date.now())
  const timeDiff = prevTime && nextTime ? nextTime - prevTime : 0

  // If no previous point, accept if accuracy is reasonable
  if (!previousPoint || !isValidCoord(previousPoint)) {
    return !Number.isFinite(accuracy) || accuracy <= MAX_ACCURACY_IGNORE
  }

  // If accuracy is very bad, ignore
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_IGNORE) {
    return false
  }

  const distance = getDistanceMeters(previousPoint, point)
  const isMoving = Number.isFinite(effectiveSpeed) && effectiveSpeed >= GPS_STATIONARY_SPEED_MPS
  const meaningfulMovement = distance >= 3 || isMoving

  // If stationary and short move, ignore
  if (!isMoving && distance < 5) {
    return false
  }

  // If accuracy is poor and jump is moderate, ignore
  if (Number.isFinite(accuracy) && accuracy > MAX_ACCURACY_AGGRESSIVE && distance < 8) {
    return false
  }

  // If speed is impossible given time/distance, ignore as GPS glitch
  if (timeDiff > 0 && timeDiff < 10000) {
    const speedMps = distance / (timeDiff / 1000)
    if (speedMps > IMPOSSIBLE_SPEED_THRESHOLD_MPS) {
      return false
    }
  }

  return true
}

function getAnimationDuration(distanceMeters) {
  if (distanceMeters < 10) return DURATION_NEAR
  if (distanceMeters < 50) return DURATION_NORMAL
  return DURATION_FAR
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
      return interpolateLatLng(previous, current, fraction)
    }

    travelled += segmentDistance
  }

  return routePoints[routePoints.length - 1]
}

function cleanRouteInstruction(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeRouteStepPoint(value) {
  if (!value) return null
  const latLng = value.latLng || value.location?.latLng || value
  if (Number.isFinite(Number(latLng.latitude)) && Number.isFinite(Number(latLng.longitude))) {
    return { lat: Number(latLng.latitude), lng: Number(latLng.longitude) }
  }
  return normalizeMapPoint(value, null)
}

function normalizeRouteStep(step) {
  if (!step) return null

  const start = normalizeRouteStepPoint(step.start_location || step.startLocation)
  const end = normalizeRouteStepPoint(step.end_location || step.endLocation)
  const distance = Number(step.distance?.value ?? step.distanceMeters ?? step.localizedValues?.distance?.value)
  const durationValue = step.duration?.value ?? String(step.staticDuration || step.duration || '').replace('s', '')
  const duration = Number(durationValue)
  const instruction = cleanRouteInstruction(
    step.instructions || step.navigationInstruction?.instructions || step.localizedValues?.navigationInstruction?.instructions
  )

  if (!isValidCoord(start) || !isValidCoord(end) || !instruction) return null

  return {
    instruction,
    maneuver: step.maneuver || step.navigationInstruction?.maneuver || null,
    distance: Number.isFinite(distance) ? distance : getDistanceMeters(start, end),
    duration: Number.isFinite(duration) ? duration : 0,
    start_location: start,
    end_location: end,
  }
}

function getNextRouteInstruction(currentPoint, steps, destination) {
  if (!isValidCoord(currentPoint)) return null

  const destinationDistance = isValidCoord(destination)
    ? getDistanceMeters(currentPoint, destination)
    : Infinity

  if (destinationDistance < 35) {
    return {
      instruction: 'Llegaste al destino',
      distanceMeters: destinationDistance,
      durationSeconds: 0,
      maneuver: 'arrive',
    }
  }

  const validSteps = Array.isArray(steps) ? steps.filter(Boolean) : []
  if (!validSteps.length) return null

  let best = null
  validSteps.forEach((step, index) => {
    const startDistance = getDistanceMeters(currentPoint, step.start_location)
    const endDistance = getDistanceMeters(currentPoint, step.end_location)
    const score = Math.min(startDistance + index * 4, endDistance + index * 2)

    if (!best || score < best.score) {
      best = {
        score,
        step,
        distanceMeters: Math.min(startDistance, endDistance),
      }
    }
  })

  if (!best?.step) return null

  const distanceMeters = Math.max(0, best.distanceMeters)
  return {
    instruction: distanceMeters > 80
      ? `En ${Math.round(distanceMeters)} m ${best.step.instruction}`
      : `Ahora ${best.step.instruction}`,
    distanceMeters,
    durationSeconds: best.step.duration,
    maneuver: best.step.maneuver,
  }
}

function normalizeManeuver(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/^maneuver-/, '')
}

function inferManeuverFromText(instruction = '') {
  const text = String(instruction || '').toLowerCase()
  if (text.includes('derecha')) return 'turn-right'
  if (text.includes('izquierda')) return 'turn-left'
  if (text.includes('rotonda')) return 'roundabout'
  if (text.includes('retorn')) return 'u-turn-left'
  if (text.includes('salida')) return text.includes('izquierda') ? 'ramp-left' : 'ramp-right'
  if (text.includes('destino') || text.includes('lleg')) return 'arrive'
  return ''
}

function inferManeuverFromRoute(routePath, step, fallbackManeuver = '') {
  const normalized = normalizeManeuver(fallbackManeuver || inferManeuverFromText(step?.instruction))
  if (normalized) return normalized

  if (!Array.isArray(routePath) || routePath.length < 2) return 'straight'

  const beforeHeading = getBearingBetweenPoints(step?.start_location, step?.end_location)
  const afterHeading = getBearingBetweenPoints(step?.end_location, routePath?.[Math.min((step?.routeEndIndex || 1) + 2, routePath.length - 1)])
  const diff = shortestAngleDiff(beforeHeading, afterHeading)

  if (diff > 25) return 'turn-right'
  if (diff < -25) return 'turn-left'
  return 'straight'
}

function getManeuverCopy(maneuver, instruction = '') {
  const normalized = normalizeManeuver(maneuver || inferManeuverFromText(instruction))

  if (normalized.includes('right') && normalized.includes('u-turn')) return 'Retorná a la derecha'
  if (normalized.includes('left') && normalized.includes('u-turn')) return 'Retorná a la izquierda'
  if (normalized.includes('right') && normalized.includes('ramp')) return 'Tomá la salida a la derecha'
  if (normalized.includes('left') && normalized.includes('ramp')) return 'Tomá la salida a la izquierda'
  if (normalized.includes('right')) return 'Girá a la derecha'
  if (normalized.includes('left')) return 'Girá a la izquierda'
  if (normalized.includes('roundabout')) return 'Entrá a la rotonda'
  if (normalized.includes('merge')) return 'Incorporate'
  if (normalized.includes('arrive')) return 'Llegaste'
  if (normalized.includes('straight')) return 'Seguí derecho'

  return cleanRouteInstruction(instruction) || 'Seguí por la ruta'
}

function getRoutePathWithProjection(routePath, projection) {
  const routePoints = Array.isArray(routePath)
    ? routePath.map((point) => normalizeMapPoint(point, null)).filter(isValidCoord)
    : []

  if (!projection || routePoints.length < 2) return routePoints

  const index = Math.max(1, Math.min(projection.index, routePoints.length - 1))
  return [projection.point, ...routePoints.slice(index)]
}

function getDistanceAlongRouteFromProjection(routePath, fromProjection, toPoint) {
  const routePoints = Array.isArray(routePath)
    ? routePath.map((point) => normalizeMapPoint(point, null)).filter(isValidCoord)
    : []

  if (!fromProjection || !isValidCoord(fromProjection.point) || !isValidCoord(toPoint) || routePoints.length < 2) {
    return isValidCoord(fromProjection?.point) && isValidCoord(toPoint)
      ? getDistanceMeters(fromProjection.point, toPoint)
      : 0
  }

  const toProjection = getClosestRouteProjection(toPoint, routePoints, {
    fromIndex: Math.max(1, fromProjection.index),
  })

  if (!toProjection) return getDistanceMeters(fromProjection.point, toPoint)

  const startIndex = Math.max(1, Math.min(fromProjection.index, routePoints.length - 1))
  const endIndex = Math.max(startIndex, Math.min(toProjection.index, routePoints.length - 1))
  let distance = 0
  let previous = fromProjection.point

  for (let index = startIndex; index < endIndex; index += 1) {
    const current = routePoints[index]
    distance += getDistanceMeters(previous, current)
    previous = current
  }

  return distance + getDistanceMeters(previous, toProjection.point)
}

function getRoutePathSliceFromProjection(routePath, projection, maxMeters) {
  const routePoints = getRoutePathWithProjection(routePath, projection)
  if (routePoints.length < 2) return routePoints

  const result = [routePoints[0]]
  let travelled = 0

  for (let index = 1; index < routePoints.length; index += 1) {
    const previous = routePoints[index - 1]
    const current = routePoints[index]
    const segment = getDistanceMeters(previous, current)

    if (travelled + segment >= maxMeters) {
      const remaining = maxMeters - travelled
      const fraction = segment > 0 ? remaining / segment : 0
      result.push(interpolateLatLng(previous, current, fraction))
      return result
    }

    result.push(current)
    travelled += segment
  }

  return result
}

function formatInstructionDistance(meters) {
  const value = Number(meters)
  if (!Number.isFinite(value)) return ''
  if (value >= 950) return `${(value / 1000).toFixed(value >= 1000 ? 1 : 0)} km`
  if (value > 600) return `${Math.round(value / 50) * 50} m`
  if (value > 300) return `${Math.round(value / 25) * 25} m`
  if (value > 100) return `${Math.round(value / 10) * 10} m`
  return `${Math.max(10, Math.round(value / 5) * 5)} m`
}

function getSmartNavigationInstruction({
  currentPoint,
  routePath,
  routeSteps,
  destination,
  currentProjection,
  heading,
}) {
  if (!isValidCoord(currentPoint)) return null

  const initialProjection = currentProjection || getClosestRouteProjection(currentPoint, routePath)
  const hasRoutePath = Array.isArray(routePath) && routePath.length >= 2
  const destinationDistance = isValidCoord(destination)
    ? hasRoutePath && initialProjection
      ? getDistanceAlongRouteFromProjection(routePath, initialProjection, destination)
      : getDistanceMeters(currentPoint, destination)
    : Infinity

  if (destinationDistance <= 35) {
    return {
      distance: destinationDistance,
      duration: 0,
      instruction: 'Llegaste al destino',
      shortInstruction: 'Llegaste',
      maneuver: 'arrive',
      nextManeuver: null,
      nextStreet: '',
      alertLevel: 'arrived',
      progress: 1,
      remainingMeters: destinationDistance,
      distanceToNextStep: 0,
      shouldRecalculate: false,
    }
  }

  const projection = initialProjection
  const routeDistance = getRouteDistanceMeters(routePath)
  const remainingMeters = projection
    ? getRouteDistanceMeters(getRoutePathWithProjection(routePath, projection))
    : destinationDistance
  const validSteps = Array.isArray(routeSteps) ? routeSteps.filter(Boolean) : []

  let nextStep = null
  let nextStepDistance = Infinity

  validSteps.forEach((step) => {
    const distanceToStep = projection
      ? getDistanceAlongRouteFromProjection(routePath, projection, step.start_location)
      : getDistanceMeters(currentPoint, step.start_location)
    if (distanceToStep >= -5 && distanceToStep < nextStepDistance) {
      nextStep = step
      nextStepDistance = Math.max(0, distanceToStep)
    }
  })

  if (!nextStep && validSteps.length) {
    nextStep = validSteps[validSteps.length - 1]
    nextStepDistance = Math.min(remainingMeters, nextStep.distance || remainingMeters)
  }

  const routeHeading = projection
    ? getRouteHeadingFromProjection(routePath, projection, destination)
    : getBearingBetweenPoints(currentPoint, destination)
  const headingDiff = Math.abs(shortestAngleDiff(routeHeading, Number(heading)))
  const shouldRecalculate = Boolean(
    projection &&
    projection.distance >= NAVIGATION_SOFT_OFF_ROUTE_METERS &&
    headingDiff >= NAVIGATION_RECALCULATE_HEADING_DEG
  )

  if (!nextStep) {
    return {
      distance: remainingMeters,
      duration: 0,
      instruction: `Seguimos por ${formatInstructionDistance(remainingMeters)}`,
      shortInstruction: 'Seguimos por la ruta',
      maneuver: 'straight',
      nextManeuver: null,
      nextStreet: '',
      alertLevel: 'far',
      progress: routeDistance > 0 ? clamp(1 - remainingMeters / routeDistance, 0, 1) : 0,
      remainingMeters,
      distanceToNextStep: remainingMeters,
      shouldRecalculate,
    }
  }

  const maneuver = inferManeuverFromRoute(routePath, nextStep, nextStep.maneuver)
  const action = getManeuverCopy(maneuver, nextStep.instruction)
  const cleanInstruction = cleanRouteInstruction(nextStep.instruction)
  let alertLevel = 'far'
  let instruction = cleanInstruction || action
  let shortInstruction = action

  if (nextStepDistance <= 35) {
    alertLevel = 'now'
    instruction = `Ahora ${action.toLowerCase()}`
    shortInstruction = action
  } else if (nextStepDistance <= 100) {
    alertLevel = 'soon'
    instruction = `En ${formatInstructionDistance(nextStepDistance)} ${action.toLowerCase()}`
  } else if (nextStepDistance <= 300) {
    alertLevel = 'prepare'
    instruction = `En ${formatInstructionDistance(nextStepDistance)} preparate para ${action.toLowerCase()}`
  } else if (nextStepDistance <= 600) {
    alertLevel = 'prepare'
    instruction = `En ${formatInstructionDistance(nextStepDistance)} ${action.toLowerCase()}`
  } else {
    instruction = `Seguimos por ${formatInstructionDistance(nextStepDistance)}`
  }

  return {
    distance: remainingMeters,
    duration: nextStep.duration,
    instruction,
    shortInstruction,
    maneuver,
    nextManeuver: maneuver,
    nextStreet: cleanInstruction,
    alertLevel,
    progress: routeDistance > 0 ? clamp(1 - remainingMeters / routeDistance, 0, 1) : 0,
    remainingMeters,
    distanceToNextStep: nextStepDistance,
    shouldRecalculate,
  }
}

function getRouteLookAheadPoint(routePath, fallbackOrigin, fallbackDestination) {
  const routePoints = Array.isArray(routePath)
    ? routePath.map((point) => normalizeMapPoint(point, null)).filter(isValidCoord)
    : []

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
  const routePoints = Array.isArray(routePath)
    ? routePath.map((point) => normalizeMapPoint(point, null)).filter(isValidCoord)
    : []

  if (routePoints.length >= 2) {
    const start = routePoints[0]
    const next = getRoutePointAtDistance(routePoints, NAVIGATION_HEADING_DISTANCE_METERS)

    return getBearingBetweenPoints(start, next)
  }

  return getBearingBetweenPoints(fallbackOrigin, fallbackDestination)
}

function projectPointToSegment(point, start, end) {
  if (!isValidCoord(point) || !isValidCoord(start) || !isValidCoord(end)) return null

  const lat = Number(point.lat)
  const lng = Number(point.lng)
  const startLat = Number(start.lat)
  const startLng = Number(start.lng)
  const endLat = Number(end.lat)
  const endLng = Number(end.lng)

  const dx = endLng - startLng
  const dy = endLat - startLat
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) return start

  const t = Math.max(
    0,
    Math.min(1, ((lng - startLng) * dx + (lat - startLat) * dy) / lengthSquared)
  )

  return {
    lat: startLat + t * dy,
    lng: startLng + t * dx,
  }
}

function getClosestRouteProjection(point, routePath, options = {}) {
  const routePoints = Array.isArray(routePath)
    ? routePath.map((p) => normalizeMapPoint(p, null)).filter(isValidCoord)
    : []

  if (!isValidCoord(point) || routePoints.length < 2) {
    return null
  }

  const fromIndex = Math.max(1, Number(options.fromIndex) || 1)
  const toIndex = Math.min(
    routePoints.length - 1,
    Number.isFinite(Number(options.toIndex)) ? Number(options.toIndex) : routePoints.length - 1
  )

  let bestPoint = toLatLng(point)
  let bestDistance = Infinity
  let bestIndex = fromIndex

  for (let index = fromIndex; index <= toIndex; index += 1) {
    const projected = projectPointToSegment(point, routePoints[index - 1], routePoints[index])
    if (!projected) continue

    const distance = getDistanceMeters(point, projected)

    if (distance < bestDistance) {
      bestDistance = distance
      bestPoint = projected
      bestIndex = index
    }
  }

  return {
    point: bestPoint,
    distance: bestDistance,
    index: bestIndex,
  }
}

function getClosestPointOnRoute(point, routePath, maxSnapMeters = 45) {
  const projection = getClosestRouteProjection(point, routePath)

  if (!projection) {
    return isValidCoord(point) ? toLatLng(point) : point
  }

  return projection.distance <= maxSnapMeters ? projection.point : toLatLng(point)
}

function getRouteHeadingFromProjection(routePath, projection, fallbackDestination, distanceMeters = NAVIGATION_HEADING_DISTANCE_METERS) {
  const routePoints = Array.isArray(routePath)
    ? routePath.map((p) => normalizeMapPoint(p, null)).filter(isValidCoord)
    : []

  if (!projection || routePoints.length < 2) {
    return getBearingBetweenPoints(projection?.point, fallbackDestination)
  }

  const start = projection.point
  const startIndex = Math.max(1, Math.min(projection.index, routePoints.length - 1))
  let travelled = 0

  for (let index = startIndex; index < routePoints.length; index += 1) {
    const previous = index === startIndex ? start : routePoints[index - 1]
    const current = routePoints[index]
    const segmentDistance = getDistanceMeters(previous, current)

    if (travelled + segmentDistance >= distanceMeters) {
      const remaining = distanceMeters - travelled
      const fraction = segmentDistance > 0 ? remaining / segmentDistance : 0
      const nextPoint = interpolateLatLng(previous, current, fraction)

      return getBearingBetweenPoints(start, nextPoint)
    }

    travelled += segmentDistance
  }

  return getBearingBetweenPoints(start, fallbackDestination || routePoints[routePoints.length - 1])
}

function getRouteLookAheadFromProjection(routePath, projection, fallbackDestination) {
  const routePoints = Array.isArray(routePath)
    ? routePath.map((p) => normalizeMapPoint(p, null)).filter(isValidCoord)
    : []

  if (!projection || routePoints.length < 2) {
    return isValidCoord(fallbackDestination) ? toLatLng(fallbackDestination) : projection?.point
  }

  const startIndex = Math.max(1, Math.min(projection.index, routePoints.length - 1))
  const slicedRoute = [projection.point, ...routePoints.slice(startIndex)]
  const distance = Math.max(42, Math.min(90, getRouteDistanceMeters(slicedRoute) * 0.11))

  return getRoutePointAtDistance(slicedRoute, distance)
}

function getAngleDiff(from, to) {
  return ((to - from + 540) % 360) - 180
}

function getSmoothNavigationHeading(previousHeading, nextHeading, options = {}) {
  const previous = Number(previousHeading)
  const next = Number(nextHeading)
  const minChange = Number.isFinite(options.minChange) ? options.minChange : NAVIGATION_MIN_HEADING_CHANGE
  const smoothing = Number.isFinite(options.smoothing) ? options.smoothing : NAVIGATION_HEADING_SMOOTHING

  if (!Number.isFinite(previous)) return next
  if (!Number.isFinite(next)) return previous

  const diff = getAngleDiff(previous, next)

  if (Math.abs(diff) < minChange) {
    return previous
  }

  return normalizeAngle(previous + diff * smoothing)
}

function movePointByBearing(point, bearingDeg, distanceMeters) {
  if (!isValidCoord(point) || !Number.isFinite(distanceMeters) || distanceMeters === 0) return toLatLng(point)

  const radius = 6371000
  const bearing = (Number(bearingDeg) * Math.PI) / 180
  const lat1 = (Number(point.lat) * Math.PI) / 180
  const lng1 = (Number(point.lng) * Math.PI) / 180
  const angularDistance = distanceMeters / radius

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

function getNavigationZoom() {
  return window.innerWidth <= 700 ? NAVIGATION_MOBILE_ZOOM : NAVIGATION_DESKTOP_ZOOM
}

function isDriverNavigationVariant(navigationMode, navigationVariant) {
  return navigationMode && navigationVariant === 'driver'
}

function isMovingForNavigation(point) {
  const speed = Number(point?.speed)
  return Number.isFinite(speed) && speed >= CAR_SPRITE_MIN_LATERAL_SPEED_MPS
}

function isReliableHeading(point) {
  const heading = Number(point?.heading)
  const accuracy = Number(point?.accuracy)
  const speed = Number(point?.speed)

  if (!Number.isFinite(heading)) return false
  if (heading === 0 && (!Number.isFinite(speed) || speed < 1.4)) return false
  if (Number.isFinite(accuracy) && accuracy > 60) return false
  return Number.isFinite(speed) && speed >= CAR_SPRITE_MIN_LATERAL_SPEED_MPS
}

function getNavigationTiltForPoint(point) {
  return isMovingForNavigation(point) ? NAVIGATION_DRIVER_TILT : NAVIGATION_DRIVER_STATIONARY_TILT
}

/**
 * Smooth heading: evita giros bruscos de 180°.
 * Usa un factor de suavizado (más bajo = más suave).
 */
function smoothHeading(prevHeading, nextHeading, factor = 0.18) {
  const prev = Number(prevHeading)
  const next = Number(nextHeading)
  if (!Number.isFinite(prev)) return Number.isFinite(next) ? normalizeHeading(next) : 0
  if (!Number.isFinite(next)) return normalizeHeading(prev)
  const diff = shortestAngleDiff(prev, next)
  if (Math.abs(diff) < NAVIGATION_MIN_HEADING_CHANGE) return normalizeHeading(prev)
  return normalizeAngle(prev + diff * factor)
}

/**
 * Calcula el punto donde debe mirar la cámara para que el auto quede
 * en el tercio inferior de la pantalla (como Uber/Bolt).
 * El offset hacia adelante es mayor para que se vea la ruta.
 */
function getDriverNavigationCameraCenter(carPoint, heading, routePath, projection, destination, speed) {
  if (!isValidCoord(carPoint)) return carPoint

  let direction = Number(heading)
  if (!Number.isFinite(direction)) {
    if (projection && routePath?.length > 1) {
      direction = getRouteHeadingFromProjection(routePath, projection, destination)
    } else if (isValidCoord(destination)) {
      direction = getBearingBetweenPoints(carPoint, destination)
    } else {
      direction = 0
    }
  } else if (projection && routePath?.length > 1) {
    direction = getRouteHeadingFromProjection(routePath, projection, destination)
  }

  // Offset mayor: auto en tercio inferior, ruta visible adelante
  const offsetMeters = Number.isFinite(speed) && speed >= 8
    ? NAVIGATION_CAMERA_AHEAD_METERS_FAST
    : NAVIGATION_CAMERA_AHEAD_METERS

  return movePointByBearing(carPoint, direction, offsetMeters)
}

/**
 * Aplica la cámara de conducción directamente al mapa.
 * zoom: 18.5-19.5, tilt: 40-50, heading suave, center con offset.
 */
function applyNavigationCamera(map, center, heading, options = {}) {
  if (!map || !isValidCoord(center)) return

  const camera = {
    center: toLatLng(center),
    zoom: clamp(
      Number.isFinite(options.zoom) ? options.zoom : getNavigationZoom(),
      18.5,
      19.6
    ),
    tilt: clamp(
      Number.isFinite(options.tilt) ? options.tilt : NAVIGATION_DRIVER_TILT,
      40,
      55
    ),
    heading: Number.isFinite(Number(heading)) ? Number(heading) : 0,
  }

  if (typeof map.moveCamera === 'function') {
    map.moveCamera(camera)
    return
  }

  if (typeof map.setCenter === 'function') {
    map.setCenter(camera.center)
  }

  if (typeof map.setZoom === 'function') {
    map.setZoom(camera.zoom)
  }

  if (typeof map.setTilt === 'function') {
    map.setTilt(camera.tilt)
  }

  if (typeof map.setHeading === 'function') {
    map.setHeading(camera.heading)
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

function normalizeHeading(heading = 0) {
  return ((Number(heading) % 360) + 360) % 360
}

function getCarScreenHeading(heading = 0) {
  return normalizeHeading(heading + CAR_SPRITE_ROTATION_OFFSET)
}

function getVehicleSpriteSource(spriteType) {
  if (spriteType === 'right') return carRightImg
  if (spriteType === 'left') return carLeftImg
  if (spriteType === 'top') return carTopImg
  return carBackImg
}

function getCarScreenRotation({ navigationMode, vehicleHeading }) {
  if (navigationMode) return 0
  return getCarScreenHeading(vehicleHeading)
}

function getVehicleSpriteType({
  navigationMode,
  heading,
  previousHeading,
  speed,
  currentType = 'back',
  lastChangeAt = 0,
  navigationStartedAt = 0,
  now = Date.now(),
}) {
  if (!navigationMode) return 'top'

  const speedNumber = Number(speed)
  if (!Number.isFinite(speedNumber) || speedNumber < CAR_SPRITE_MIN_LATERAL_SPEED_MPS) return 'back'

  const headingNumber = Number(heading)
  const previousHeadingNumber = Number(previousHeading)
  const elapsedSinceChange = now - Number(lastChangeAt || 0)
  const elapsedSinceNavigationStart = now - Number(navigationStartedAt || now)

  if (elapsedSinceNavigationStart < CAR_SPRITE_STARTUP_STABLE_MS) {
    return 'back'
  }

  if (!Number.isFinite(headingNumber) || !Number.isFinite(previousHeadingNumber)) {
    return 'back'
  }

  const turnDelta = shortestAngleDiff(previousHeadingNumber, headingNumber)
  const absTurn = Math.abs(turnDelta)

  if (
    (currentType === 'left' || currentType === 'right') &&
    speedNumber >= 1.2 &&
    absTurn > CAR_SPRITE_TURN_EXIT_DEG
  ) {
    return currentType
  }

  if (elapsedSinceChange < CAR_SPRITE_MIN_CHANGE_MS) {
    return currentType === 'top' ? 'back' : currentType
  }

  if (absTurn >= CAR_SPRITE_TURN_ENTER_DEG) {
    return turnDelta > 0 ? 'right' : 'left'
  }

  return 'back'
}

function getBestVehicleHeading(origin, routeHeading, previousHeading, options = {}) {
  const gpsHeading = Number(origin?.heading)
  const speed = Number(origin?.speed)
  const preferRouteHeading = options.preferRouteHeading || !isReliableHeading(origin)

  if (!preferRouteHeading && Number.isFinite(gpsHeading) && Number.isFinite(speed) && speed >= CAR_SPRITE_MIN_LATERAL_SPEED_MPS) {
    return normalizeHeading(gpsHeading)
  }

  if (Number.isFinite(Number(routeHeading))) {
    return normalizeHeading(routeHeading)
  }

  return normalizeHeading(previousHeading || 0)
}

// ==================== DARK MAP OVERLAY STYLES ====================

const MICHOFER_LIGHT_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f6f7f9' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4b5563' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#d8e1ea' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#c7d0dc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#cbd5e1' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#aeb9c8' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#a9dcef' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#dff3e2' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#f2f4f7' }] },

  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.medical', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

const MICHOFER_DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#1a1d23' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1d23' }] },

  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d323b' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#3a3f4a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#363b45' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#454b56' }] },

  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1923' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#1c2128' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#1a1d23' }] },

  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.medical', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
]

// ==================== OVERLAY CREATORS ====================

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

  overlay.currentPosition = isValidCoord(onCenter) ? toLatLng(onCenter) : null
  overlay.__modeKey = 'client'
  overlay.__avatar = clientAvatar || ''

  element.className = 'google-client-marker'
  element.style.position = 'absolute'
  element.style.zIndex = '10'
  element.style.transition = 'left 900ms cubic-bezier(0.22, 1, 0.36, 1), top 900ms cubic-bezier(0.22, 1, 0.36, 1)'
  element.style.willChange = 'left, top'
  element.innerHTML = `
    <div class="google-client-marker-ring" aria-hidden="true"></div>
    <div class="google-client-marker-content">
      ${clientAvatar ? `<img src="${clientAvatar}" alt="${name}" />` : `<span>${initials}</span>`}
    </div>
  `

  overlay.updatePosition = function (nextPosition) {
    if (!isValidCoord(nextPosition)) return
    this.currentPosition = toLatLng(nextPosition)
    this.draw()
  }

  overlay.onAdd = function () {
    const panes = this.getPanes()

    if (panes?.overlayMouseTarget) {
      panes.overlayMouseTarget.appendChild(element)
    }
  }

  overlay.draw = function () {
    const projection = this.getProjection()
    if (!projection || !isValidCoord(this.currentPosition)) return

    const pos = new google.maps.LatLng(this.currentPosition.lat, this.currentPosition.lng)
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

/**
 * Creates a navigation overlay with requestAnimationFrame-based smooth animation.
 * Replaces the old CSS-transition-based overlay for smooth GPS tracking.
 */
function createNavigationOverlaySmooth(position, google, heading = 0, spriteType = 'back') {
  const overlay = new google.maps.OverlayView()
  const element = document.createElement('div')
  const image = document.createElement('img')

  // Current visual state (what the user sees)
  overlay.currentPosition = isValidCoord(position) ? toLatLng(position) : null
  overlay.currentHeading = normalizeHeading(heading)

  // Target state (where we're animating to)
  overlay.targetPosition = overlay.currentPosition
  overlay.targetHeading = overlay.currentHeading

  // Animation state
  overlay._animating = false
  overlay._animFrom = null
  overlay._animTo = null
  overlay._animFromHeading = null
  overlay._animToHeading = null
  overlay._animStartTime = null
  overlay._animDuration = null
  overlay._animFrameId = null
  overlay._firstPosition = true
  overlay.__modeKey = 'car'
  overlay.currentSpriteType = spriteType

  element.className = 'google-navigation-marker car-navigation-marker'
  element.style.position = 'absolute'
  element.style.zIndex = '30'
  element.style.willChange = 'left, top, transform'
  element.style.transform = 'translate(-50%, -50%)'

  image.className = 'navigation-car-img'
  image.alt = 'Auto en navegación'
  image.src = getVehicleSpriteSource(spriteType)
  image.style.display = 'block'
  image.style.transformOrigin = '50% 50%'
  image.style.transform = `rotate(${overlay.currentHeading}deg)`

  element.appendChild(image)

  /**
   * Internal animation loop using requestAnimationFrame.
   * Interpolates position and heading smoothly.
   */
  overlay._animate = function () {
    if (!this._animating) return

    const now = performance.now()
    const elapsed = now - (this._animStartTime || now)
    const duration = this._animDuration || DURATION_NORMAL
    const rawProgress = Math.min(elapsed / duration, 1)
    const progress = easeInOutCubic(rawProgress)

    // Interpolate position
    const interpolatedPos = interpolateLatLng(this._animFrom, this._animTo, progress)
    this.currentPosition = interpolatedPos

    // Interpolate heading
    if (this._animFromHeading != null && this._animToHeading != null) {
      const interpHeading = interpolateHeading(this._animFromHeading, this._animToHeading, progress)
      this.currentHeading = interpHeading
      image.style.transform = `rotate(${interpHeading}deg)`
    }

    // Redraw overlay
    this.draw()

    if (rawProgress < 1 && this._animating) {
      this._animFrameId = requestAnimationFrame(() => this._animate())
    } else {
      // Snap to final position
      if (this._animTo) {
        this.currentPosition = toLatLng(this._animTo)
        this.draw()
      }
      if (this._animToHeading != null) {
        this.currentHeading = normalizeHeading(this._animToHeading)
        image.style.transform = `rotate(${this.currentHeading}deg)`
      }
      this._animating = false
      this._animFrameId = null
    }
  }

  /**
   * Cancels any running animation.
   */
  overlay._cancelAnimation = function () {
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId)
      this._animFrameId = null
    }
    this._animating = false
  }

  overlay.updateVehicleVisual = function (nextSpriteType, nextRotation) {
    const spriteTypeValue = nextSpriteType || 'back'
    if (this.currentSpriteType !== spriteTypeValue) {
      this.currentSpriteType = spriteTypeValue
      image.src = getVehicleSpriteSource(spriteTypeValue)
    }

    const rotationNumber = Number(nextRotation)
    if (Number.isFinite(rotationNumber) && !this._animating) {
      this.currentHeading = normalizeHeading(rotationNumber)
      this.targetHeading = this.currentHeading
      image.style.transform = `rotate(${this.currentHeading}deg)`
    }
  }

  /**
   * Updates the marker position with smooth animation.
   * @param {object} nextPosition - {lat, lng}
   * @param {number|null} nextHeading - heading in degrees
   * @param {number} duration - animation duration in ms
   */
  overlay.updatePositionSmooth = function (nextPosition, nextHeading, duration) {
    if (!isValidCoord(nextPosition)) return

    const newPos = toLatLng(nextPosition)
    const newHeading = Number.isFinite(Number(nextHeading)) ? normalizeHeading(Number(nextHeading)) : null

    // If this is the first position, snap immediately
    if (this._firstPosition) {
      this.currentPosition = newPos
      this.targetPosition = newPos
      if (newHeading != null) {
        this.currentHeading = newHeading
        this.targetHeading = newHeading
        image.style.transform = `rotate(${newHeading}deg)`
      }
      this._firstPosition = false
      this.draw()
      return
    }

    // Calculate distance for dynamic duration
    const distance = getDistanceMeters(this.currentPosition, newPos)
    const animDuration = clamp(duration || getAnimationDuration(distance), MIN_ANIMATION_DURATION, MAX_ANIMATION_DURATION)

    // Cancel any previous animation
    this._cancelAnimation()

    // Set animation targets
    this._animFrom = toLatLng(this.currentPosition)
    this._animTo = newPos
    this._animFromHeading = this.currentHeading
    this._animToHeading = newHeading != null ? newHeading : this.currentHeading
    this._animStartTime = performance.now()
    this._animDuration = animDuration
    this._animating = true

    // Start animation
    this._animFrameId = requestAnimationFrame(() => this._animate())
  }

  /**
   * Legacy updatePosition for compatibility - uses smooth animation.
   */
  overlay.updatePosition = function (nextPosition) {
    this.updatePositionSmooth(nextPosition, null, DURATION_NORMAL)
  }

  /**
   * Legacy updateHeading for compatibility.
   */
  overlay.updateHeading = function (nextHeading) {
    const headingNumber = Number(nextHeading)
    if (!Number.isFinite(headingNumber)) return

    // If currently animating, just update target heading
    if (this._animating) {
      this._animToHeading = normalizeHeading(headingNumber)
    } else {
      // Smooth heading transition
      const fromHeading = this.currentHeading
      const toHeading = normalizeHeading(headingNumber)
      const diff = shortestAngleDiff(fromHeading, toHeading)
      const smoothedHeading = normalizeAngle(fromHeading + diff * 0.35)
      this.currentHeading = smoothedHeading
      this.targetHeading = toHeading
      image.style.transform = `rotate(${smoothedHeading}deg)`
    }
  }

  overlay.onAdd = function () {
    const panes = this.getPanes()

    if (panes?.overlayMouseTarget) {
      panes.overlayMouseTarget.appendChild(element)
    }
  }

  overlay.draw = function () {
    const projection = this.getProjection()
    if (!projection || !isValidCoord(this.currentPosition)) return

    const pos = new google.maps.LatLng(this.currentPosition.lat, this.currentPosition.lng)
    const point = projection.fromLatLngToDivPixel(pos)

    if (point) {
      element.style.left = `${point.x}px`
      element.style.top = `${point.y}px`
    }
  }

  overlay.onRemove = function () {
    this._cancelAnimation()
    if (element.parentNode) {
      element.parentNode.removeChild(element)
    }
  }

  return overlay
}

function createDriverRouteOverlay(google, containerElement) {
  const overlay = new google.maps.OverlayView()
  const element = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const casing = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  const glow = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')

  overlay.currentPath = []
  overlay.__modeKey = 'driver-route'

  element.className = 'driver-route-visual-overlay'
  element.style.position = 'absolute'
  element.style.left = '0'
  element.style.top = '0'
  element.style.right = '0'
  element.style.bottom = '0'
  element.style.width = '100%'
  element.style.height = '100%'
  element.style.pointerEvents = 'none'
  element.style.zIndex = '7'
  element.style.overflow = 'hidden'

  svg.setAttribute('width', '100%')
  svg.setAttribute('height', '100%')
  svg.style.position = 'absolute'
  svg.style.left = '0'
  svg.style.top = '0'
  svg.style.width = '100%'
  svg.style.height = '100%'
  svg.style.overflow = 'visible'
  svg.style.pointerEvents = 'none'

  ;[
    [casing, '#ffffff', '18', '0.92'],
    [glow, '#4de7ff', '26', '0.34'],
    [line, '#1269ff', '12', '1'],
  ].forEach(([node, color, width, opacity]) => {
    node.setAttribute('fill', 'none')
    node.setAttribute('stroke', color)
    node.setAttribute('stroke-width', width)
    node.setAttribute('stroke-opacity', opacity)
    node.setAttribute('stroke-linecap', 'round')
    node.setAttribute('stroke-linejoin', 'round')
    node.setAttribute('vector-effect', 'non-scaling-stroke')
  })

  svg.appendChild(glow)
  svg.appendChild(casing)
  svg.appendChild(line)
  element.appendChild(svg)

  overlay.updatePath = function (nextPath) {
    this.currentPath = Array.isArray(nextPath) ? nextPath.filter(isValidCoord).map(toLatLng) : []
    this.draw()
  }

  overlay.onAdd = function () {
    const host = containerElement || this.getMap()?.getDiv()?.parentElement
    if (host) host.appendChild(element)
  }

  overlay.draw = function () {
    const projection = this.getProjection()
    if (!projection || !Array.isArray(this.currentPath) || this.currentPath.length < 2) {
      element.style.display = 'none'
      casing.setAttribute('points', '')
      glow.setAttribute('points', '')
      line.setAttribute('points', '')
      return
    }

    const pixels = this.currentPath
      .map((point) => {
        if (typeof projection.fromLatLngToContainerPixel === 'function') {
          return projection.fromLatLngToContainerPixel(new google.maps.LatLng(point.lat, point.lng))
        }
        return projection.fromLatLngToDivPixel(new google.maps.LatLng(point.lat, point.lng))
      })
      .filter((pixel) => pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y))

    if (pixels.length < 2) {
      element.style.display = 'none'
      casing.setAttribute('points', '')
      glow.setAttribute('points', '')
      line.setAttribute('points', '')
      return
    }

    const points = pixels
      .map((pixel) => `${pixel.x},${pixel.y}`)
      .join(' ')

    element.style.display = 'block'
    const width = containerElement?.clientWidth || this.getMap()?.getDiv()?.clientWidth || 1
    const height = containerElement?.clientHeight || this.getMap()?.getDiv()?.clientHeight || 1
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)

    casing.setAttribute('points', points)
    glow.setAttribute('points', points)
    line.setAttribute('points', points)
  }

  overlay.onRemove = function () {
    if (element.parentNode) {
      element.parentNode.removeChild(element)
    }
  }

  return overlay
}

// ==================== COMPONENT ====================

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
  navigationVariant = 'default',
  showOriginCar = false,
  showMapTypeControl = true,
  safetyZones = [],
  onRouteUpdate,
}) {
  const [isSatellite, setIsSatellite] = useState(false)
  const [showTraffic, setShowTraffic] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [mapError, setMapError] = useState(null)
  const [googleApi, setGoogleApi] = useState(null)
  const [mapTheme, setMapTheme] = useState(() => getAutoMapTheme())
  const [isFollowingDriver, setIsFollowingDriver] = useState(true)
  const stableDriverNavigation = isDriverNavigationVariant(navigationMode, navigationVariant) || (navigationMode && showOriginCar)
  const isProgrammaticCameraMoveRef = useRef(false)
  const gpsSignalStatus = useMemo(() => {
    const accuracy = Number(origin?.accuracy)
    if (!Number.isFinite(accuracy)) return 'adjusting'
    if (accuracy <= 25) return 'good'
    if (accuracy <= 60) return 'adjusting'
    return 'weak'
  }, [origin?.accuracy])
  const gpsSignalLabel = {
    good: 'GPS preciso',
    adjusting: 'GPS ajustando',
    weak: 'GPS débil · manteniendo ruta',
  }[gpsSignalStatus]

  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const directionsServiceRef = useRef(null)
  const routePolylineRef = useRef(null)
  const focusRouteGlowRef = useRef(null)
  const routeCompletedPolylineRef = useRef(null)
  const routeNextStepPolylineRef = useRef(null)
  const driverRouteOverlayRef = useRef(null)
  const activeRoutePathRef = useRef([])
  const markersRef = useRef([])
  const originOverlayRef = useRef(null)
  const safetyZoneRefs = useRef([])
  const trafficLayerRef = useRef(null)
  const routeSignatureRef = useRef('')
  const routeRequestSerialRef = useRef(0)
  const lastRouteUpdateRef = useRef(null)
  const routeStepsRef = useRef([])
  const navigationHeadingRef = useRef(0)
  const userCameraTouchedRef = useRef(false)
  const hasAutoFittedRouteRef = useRef(false)
  const lastMatchedRouteIndexRef = useRef(1)
  const lastMatchedPointRef = useRef(null)
  const lastRerouteAtRef = useRef(0)
  const offRouteCountRef = useRef(0)
  const lastOffRouteAtRef = useRef(0)
  const rerouteReasonRef = useRef('')
  const routeOriginRef = useRef(null)
  const [routeRefreshToken, setRouteRefreshToken] = useState(0)

  // GPS filtering refs for car position
  const visualDriverPositionRef = useRef(null)
  const lastGoodDriverPositionRef = useRef(null)
  const lastRawDriverPositionRef = useRef(null)
  const driverAnimationFrameRef = useRef(null)
  const visualHeadingRef = useRef(0)
  const lastGoodHeadingRef = useRef(0)
  const lastVisualCameraAtRef = useRef(0)
  const lastDriverUpdateAtRef = useRef(0)

  // GPS buffer: keep last N valid points for filtering and dead reckoning
  const GPS_BUFFER_MAX_SIZE = 8
  const gpsBufferRef = useRef([])
  const DEAD_RECKONING_MAX_METERS = 18
  const DEAD_RECKONING_START_MS = 1200
  const DEAD_RECKONING_MAX_MS = 3500
  const deadReckoningFrameRef = useRef(null)
  const deadReckoningActiveRef = useRef(false)
  const lastDeadReckonUpdateRef = useRef(0)
  const predictedPositionRef = useRef(null)
  const predictionStartTimeRef = useRef(0)
  const lastKnownSpeedRef = useRef(0)
  const lastKnownHeadingRef = useRef(0)
  const lastKnownPositionRef = useRef(null)
  const cameraSmoothHeadingRef = useRef(0)
  const cameraLastCenterRef = useRef(null)
  const cameraLastHeadingRef = useRef(0)
  const cameraAnimFrameRef = useRef(null)
  const cameraAnimatingRef = useRef(false)
  const cameraAnimFromRef = useRef(null)
  const cameraAnimToRef = useRef(null)
  const cameraAnimFromHeadingRef = useRef(0)
  const cameraAnimToHeadingRef = useRef(0)
  const cameraAnimStartRef = useRef(0)
  const cameraAnimDurationRef = useRef(0)
  const currentCarSpriteRef = useRef('back')
  const lastSpriteChangeAtRef = useRef(0)
  const lastSpriteHeadingRef = useRef(0)
  const navigationStartedAtRef = useRef(0)

  function runProgrammaticCameraMove(callback) {
    isProgrammaticCameraMoveRef.current = true
    try {
      callback()
    } finally {
      window.setTimeout(() => {
        isProgrammaticCameraMoveRef.current = false
      }, 450)
    }
  }

  function getCurrentVehicleVisual(nextHeading, speed) {
    const now = Date.now()
    if (navigationMode && !navigationStartedAtRef.current) {
      navigationStartedAtRef.current = now
    }
    const previousHeading = lastSpriteHeadingRef.current
    const nextSpriteType = getVehicleSpriteType({
      navigationMode,
      heading: nextHeading,
      previousHeading,
      speed,
      currentType: currentCarSpriteRef.current,
      lastChangeAt: lastSpriteChangeAtRef.current,
      navigationStartedAt: stableDriverNavigation ? navigationStartedAtRef.current : 0,
      now,
    })

    if (currentCarSpriteRef.current !== nextSpriteType) {
      currentCarSpriteRef.current = nextSpriteType
      lastSpriteChangeAtRef.current = now
    }

    if (Number.isFinite(Number(nextHeading))) {
      lastSpriteHeadingRef.current = normalizeHeading(nextHeading)
    }

    return {
      spriteType: nextSpriteType,
      rotation: getCarScreenRotation({
        navigationMode,
        vehicleHeading: nextHeading,
      }),
    }
  }

  function getCurrentNavigationTilt() {
    return stableDriverNavigation ? getNavigationTiltForPoint(origin) : NAVIGATION_DRIVER_TILT
  }

  function updateDriverRouteOverlay(routePath) {
    const map = mapRef.current
    if (!stableDriverNavigation || !map || !googleApi || !Array.isArray(routePath) || routePath.length < 2) {
      if (driverRouteOverlayRef.current) {
        driverRouteOverlayRef.current.setMap(null)
        driverRouteOverlayRef.current = null
      }
      return
    }

    if (!driverRouteOverlayRef.current) {
      const routeOverlayHost = mapContainerRef.current?.closest('.mobility-map') || mapContainerRef.current?.parentElement
      driverRouteOverlayRef.current = createDriverRouteOverlay(googleApi, routeOverlayHost)
      driverRouteOverlayRef.current.setMap(map)
    }

    driverRouteOverlayRef.current.updatePath(routePath)
  }

  function updateNavigationRouteVisuals(routePath, projection, smartInstruction = null) {
    if (!Array.isArray(routePath) || routePath.length < 2) return

    const currentPolyline = routePolylineRef.current
    const currentFocusGlow = focusRouteGlowRef.current
    const completedPolyline = routeCompletedPolylineRef.current
    const nextStepPolyline = routeNextStepPolylineRef.current
    const routePathLength = routePath.length
    const projectionDistance = Number(projection?.distance)

    if (!projection) {
      currentPolyline?.setPath(routePath)
      currentFocusGlow?.setPath(routePath)
      updateDriverRouteOverlay(routePath)
      completedPolyline?.setPath([])
      nextStepPolyline?.setPath([])
      if (import.meta.env.DEV && stableDriverNavigation) {
        console.info('[MiChofer Driver Route]', {
          originValid: isValidCoord(origin),
          destinationValid: isValidCoord(destination),
          routePathLength,
          projectionDistance: null,
          remainingPathLength: routePathLength,
          fallback: 'no-projection-full-route',
        })
      }
      return
    }

    const index = Math.max(1, Math.min(projection.index, routePath.length - 1))
    const completedPath = [...routePath.slice(0, index), projection.point]
    const remainingPath = [projection.point, ...routePath.slice(index)].filter(isValidCoord)
    const remainingVisiblePath = remainingPath.length < 2 ? routePath : remainingPath
    const mainVisiblePath = stableDriverNavigation ? routePath : remainingVisiblePath
    const usedFallbackPath = remainingVisiblePath === routePath
    const highlightMeters = Math.min(
      NAVIGATION_NEXT_STEP_HIGHLIGHT_METERS,
      Math.max(80, Number(smartInstruction?.distanceToNextStep) || NAVIGATION_NEXT_STEP_HIGHLIGHT_METERS)
    )
    const nextStepPath = getRoutePathSliceFromProjection(routePath, projection, highlightMeters)
    const recalculating = smartInstruction?.alertLevel === 'recalculating' || smartInstruction?.recalculating

    completedPolyline?.setOptions({
      strokeColor: stableDriverNavigation ? '#ffffff' : '#7aa7ff',
      strokeOpacity: navigationMode ? (stableDriverNavigation ? 0.78 : 0.24) : 0,
      strokeWeight: navigationMode ? (stableDriverNavigation ? 17 : 6) : 0,
      zIndex: stableDriverNavigation ? 900 : 2,
    })
    currentFocusGlow?.setOptions({
      strokeColor: stableDriverNavigation ? '#4de7ff' : '#18e7ff',
      strokeOpacity: navigationMode ? (recalculating ? 0.2 : stableDriverNavigation ? 0.46 : 0.3) : 0,
      strokeWeight: navigationMode ? (stableDriverNavigation ? 25 : 17) : 0,
      zIndex: stableDriverNavigation ? 910 : 3,
    })
    currentPolyline?.setOptions({
      strokeColor: navigationMode ? (stableDriverNavigation ? '#1269ff' : '#2f45ff') : '#1f7aff',
      strokeOpacity: recalculating ? 0.62 : 1,
      strokeWeight: navigationMode ? (stableDriverNavigation ? 12 : 8) : 5,
      zIndex: stableDriverNavigation ? 920 : 4,
    })
    nextStepPolyline?.setOptions({
      strokeOpacity: navigationMode && !recalculating ? 0.95 : 0,
      strokeWeight: navigationMode ? (stableDriverNavigation ? 13 : 10) : 0,
      zIndex: stableDriverNavigation ? 930 : 5,
    })

    completedPolyline?.setPath(stableDriverNavigation ? mainVisiblePath : completedPath)
    currentFocusGlow?.setPath(remainingVisiblePath)
    currentPolyline?.setPath(mainVisiblePath)
    nextStepPolyline?.setPath(nextStepPath)
    updateDriverRouteOverlay(mainVisiblePath)

    if (import.meta.env.DEV && stableDriverNavigation) {
      console.info('[MiChofer Driver Route]', {
        originValid: isValidCoord(origin),
        destinationValid: isValidCoord(destination),
        routePathLength,
        projectionDistance: Number.isFinite(projectionDistance) ? projectionDistance : null,
        remainingPathLength: remainingPath.length,
        mainPathLength: mainVisiblePath.length,
        fallback: usedFallbackPath ? 'remaining-invalid-full-route' : stableDriverNavigation ? 'driver-full-route-with-remaining-focus' : 'remaining-route',
      })
    }
  }

const visibleDrivers = useMemo(() => {
  const safeDrivers = Array.isArray(drivers) ? drivers : []
  const selectedPresent = selectedDriver && safeDrivers.some((driver) => driver.id === selectedDriver.id)
  const candidates = selectedPresent || !selectedDriver ? safeDrivers : [selectedDriver, ...safeDrivers]

  return candidates.filter(isValidCoord).slice(0, MAX_DRIVER_MARKERS)
}, [drivers, selectedDriver])

  // ==================== THEME AUTO-SWITCH ====================

  useEffect(() => {
    const checkTheme = () => {
      setMapTheme(getAutoMapTheme())
    }

    checkTheme()
    const interval = setInterval(checkTheme, THEME_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (navigationMode) {
      setIsFollowingDriver(true)
      navigationStartedAtRef.current = Date.now()
      currentCarSpriteRef.current = 'back'
      lastSpriteChangeAtRef.current = Date.now()
      lastSpriteHeadingRef.current = navigationHeadingRef.current
    } else {
      navigationStartedAtRef.current = 0
    }
  }, [navigationMode])

  // Apply theme class to container
  useEffect(() => {
    const container = mapContainerRef.current?.parentElement?.closest('.mobility-map')
    if (container) {
      container.classList.remove('map-theme-light', 'map-theme-dark')
      container.classList.add(`map-theme-${mapTheme}`)
    }
  }, [mapTheme])

  // ==================== MAP INIT ====================

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

        const currentTheme = getAutoMapTheme()
        const effectiveMapId = getMapIdForTheme(currentTheme)

        const map = new google.maps.Map(mapContainerRef.current, {
          center: isValidCoord(origin) ? toLatLng(origin) : DEFAULT_CENTER,
          zoom: navigationMode ? getNavigationZoom() : 14.1,
          tilt: navigationMode ? getCurrentNavigationTilt() : isSatellite ? 45 : 0,
          heading: navigationMode ? navigationHeadingRef.current : isSatellite ? -18 : 0,
          renderingType: google.maps.RenderingType?.VECTOR,
          mapId: effectiveMapId,
          mapTypeId: effectiveMapId
            ? undefined
            : isSatellite
              ? 'satellite'
              : 'roadmap',
          styles: isSatellite || effectiveMapId
            ? undefined
            : currentTheme === 'dark'
              ? MICHOFER_DARK_MAP_STYLE
              : MICHOFER_LIGHT_MAP_STYLE,
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
        ;['zoom_changed', 'tilt_changed', 'heading_changed'].forEach((eventName) => {
          map.addListener(eventName, () => {
            if (!navigationMode) {
              userCameraTouchedRef.current = true
            }
          })
        })

        // Detectar cuando el usuario arrastra el mapa (no es movimiento programático)
        map.addListener('dragstart', () => {
          userCameraTouchedRef.current = true
          if (navigationMode && !isProgrammaticCameraMoveRef.current) {
            setIsFollowingDriver(false)
          }
        })

        map.addListener('idle', () => {
          if (!navigationMode && !isProgrammaticCameraMoveRef.current) {
            setIsFollowingDriver(false)
          }
        })

        focusRouteGlowRef.current = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: navigationMode ? '#4de7ff' : '#14f1e5',
          strokeOpacity: navigationMode ? 0.46 : 0,
          strokeWeight: navigationMode ? 25 : 0,
          clickable: false,
          geodesic: true,
          zIndex: navigationMode ? 910 : 3,
        })

        routePolylineRef.current = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: navigationMode ? '#1269ff' : '#1f7aff',
          strokeOpacity: 1,
          strokeWeight: navigationMode ? 12 : 5,
          clickable: false,
          geodesic: true,
          zIndex: navigationMode ? 920 : 4,
        })

        routeCompletedPolylineRef.current = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: navigationMode ? '#ffffff' : '#7aa7ff',
          strokeOpacity: navigationMode ? 0.78 : 0,
          strokeWeight: navigationMode ? 17 : 0,
          clickable: false,
          geodesic: true,
          zIndex: navigationMode ? 900 : 2,
        })

        routeNextStepPolylineRef.current = new google.maps.Polyline({
          map,
          path: [],
          strokeColor: '#00d9ff',
          strokeOpacity: navigationMode ? 0.92 : 0,
          strokeWeight: navigationMode ? 13 : 0,
          clickable: false,
          geodesic: true,
          zIndex: navigationMode ? 930 : 5,
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

      // Cancel any running smooth animation
      if (originOverlayRef.current?._cancelAnimation) {
        originOverlayRef.current._cancelAnimation()
      }

      if (originOverlayRef.current) {
        try {
          originOverlayRef.current.setMap(null)
        } catch {
          // no-op
        }

        originOverlayRef.current = null
      }
      markersRef.current.forEach((marker) => {
        try {
          marker.setMap(null)
        } catch {
          // no-op
        }
      })
      markersRef.current = []

      safetyZoneRefs.current.forEach((zone) => {
        try {
          zone.setMap(null)
        } catch {
          // no-op
        }
      })
      safetyZoneRefs.current = []

      if (routePolylineRef.current) {
        routePolylineRef.current.setMap(null)
        routePolylineRef.current = null
      }

      if (focusRouteGlowRef.current) {
        focusRouteGlowRef.current.setMap(null)
        focusRouteGlowRef.current = null
      }

      if (routeCompletedPolylineRef.current) {
        routeCompletedPolylineRef.current.setMap(null)
        routeCompletedPolylineRef.current = null
      }

      if (routeNextStepPolylineRef.current) {
        routeNextStepPolylineRef.current.setMap(null)
        routeNextStepPolylineRef.current = null
      }

      if (driverRouteOverlayRef.current) {
        driverRouteOverlayRef.current.setMap(null)
        driverRouteOverlayRef.current = null
      }

      if (trafficLayerRef.current) {
        trafficLayerRef.current.setMap(null)
        trafficLayerRef.current = null
      }

      mapRef.current = null
    }
  }, [])

  // ==================== THEME CHANGES ON MAP ====================

  useEffect(() => {
    const map = mapRef.current
    if (!map || !googleApi) return

    const currentTheme = getAutoMapTheme()
    const effectiveMapId = getMapIdForTheme(currentTheme)

    if (map.setOptions) {
      map.setOptions({
        mapId: effectiveMapId,
        mapTypeId: effectiveMapId ? undefined : isSatellite ? 'satellite' : 'roadmap',
        styles: isSatellite || effectiveMapId
          ? undefined
          : currentTheme === 'dark'
            ? MICHOFER_DARK_MAP_STYLE
            : MICHOFER_LIGHT_MAP_STYLE,
      })
    }
  }, [mapTheme, isSatellite, googleApi, mapReady])

  // ==================== CAMERA + OVERLAY SYNC ====================

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map || !isValidCoord(origin)) return

    const target = isValidCoord(selectedDriver) ? selectedDriver : origin

    if (navigationMode) {
      const currentTheme = getAutoMapTheme()
      const effectiveMapId = getMapIdForTheme(currentTheme)

      map.setOptions({
        tilt: getCurrentNavigationTilt(),
        heading: navigationHeadingRef.current,
        mapId: effectiveMapId,
        mapTypeId: effectiveMapId ? undefined : 'roadmap',
        styles: effectiveMapId ? undefined : currentTheme === 'dark' ? MICHOFER_DARK_MAP_STYLE : MICHOFER_LIGHT_MAP_STYLE,
      })
      return
    }

    if (animateCamera && !userCameraTouchedRef.current) {
      // Smooth pan instead of jump
      map.panTo(toLatLng(target))
      map.setZoom(selectedDriver ? 15.2 : 14.6)
    }

    const currentTheme = getAutoMapTheme()
    const effectiveMapId = getMapIdForTheme(currentTheme)
    map.setOptions({
      tilt: isSatellite ? 45 : 0,
      heading: isSatellite ? -10 : 0,
      mapId: effectiveMapId,
      mapTypeId: effectiveMapId ? undefined : isSatellite ? 'satellite' : 'roadmap',
      styles: isSatellite || effectiveMapId
        ? undefined
        : currentTheme === 'dark'
          ? MICHOFER_DARK_MAP_STYLE
          : MICHOFER_LIGHT_MAP_STYLE,
    })
  }, [animateCamera, destination, googleApi, isSatellite, mapReady, navigationMode, origin, selectedDriver, mapTheme])

  // ==================== GPS BUFFER MANAGEMENT ====================

  // Add a valid point to the GPS buffer, maintaining max size
  function pushGpsBuffer(point) {
    const buffer = gpsBufferRef.current
    buffer.push(point)
    if (buffer.length > GPS_BUFFER_MAX_SIZE) {
      buffer.shift()
    }
  }

  // Get smoothed position from buffer (median of last N points)
  function getSmoothedBufferPosition() {
    const buffer = gpsBufferRef.current
    if (buffer.length === 0) return null
    if (buffer.length === 1) return buffer[0]

    const lats = buffer.map(p => p.lat).sort((a, b) => a - b)
    const lngs = buffer.map(p => p.lng).sort((a, b) => a - b)
    const mid = Math.floor(lats.length / 2)

    return {
      lat: lats.length % 2 === 0 ? (lats[mid - 1] + lats[mid]) / 2 : lats[mid],
      lng: lngs.length % 2 === 0 ? (lngs[mid - 1] + lngs[mid]) / 2 : lngs[mid],
    }
  }

  // ==================== DEAD RECKONING LOOP ====================

  function startDeadReckoning() {
    if (deadReckoningActiveRef.current) return
    deadReckoningActiveRef.current = true
    predictionStartTimeRef.current = performance.now()
    lastDeadReckonUpdateRef.current = Date.now()

    const deadReckonLoop = () => {
      if (!deadReckoningActiveRef.current) return

      const now = Date.now()
      const elapsed = now - lastDeadReckonUpdateRef.current
      const totalElapsed = now - lastDriverUpdateAtRef.current

      // Stop dead reckoning if too much time passed or we got a new update
      if (totalElapsed > DEAD_RECKONING_MAX_MS || !lastKnownPositionRef.current) {
        deadReckoningActiveRef.current = false
        deadReckoningFrameRef.current = null
        return
      }

      // Only predict if we have speed and heading
      const speed = lastKnownSpeedRef.current
      const heading = lastKnownHeadingRef.current
      if (Number.isFinite(speed) && speed > 0.5 && Number.isFinite(heading)) {
        // Calculate how far we should have moved since last known position
        const secondsSinceUpdate = totalElapsed / 1000
        const predictedDistance = Math.min(speed * secondsSinceUpdate, DEAD_RECKONING_MAX_METERS)

        if (predictedDistance > 0.5) {
          const predictedPos = movePointByBearing(lastKnownPositionRef.current, heading, predictedDistance)

          // Snap predicted position to route if available
          const routePath = activeRoutePathRef.current
          let finalPredicted = predictedPos
          if (routePath.length > 1) {
            const proj = getClosestRouteProjection(predictedPos, routePath)
            if (proj && proj.distance <= NAVIGATION_SNAP_METERS) {
              finalPredicted = proj.point
            }
          }

          predictedPositionRef.current = finalPredicted

          // Update overlay with predicted position
          if (originOverlayRef.current?.__modeKey === 'car' &&
              typeof originOverlayRef.current.updatePositionSmooth === 'function') {
            const vehicleVisual = getCurrentVehicleVisual(heading, speed)
            if (typeof originOverlayRef.current.updateVehicleVisual === 'function') {
              originOverlayRef.current.updateVehicleVisual(vehicleVisual.spriteType, vehicleVisual.rotation)
            }
            originOverlayRef.current.updatePositionSmooth(finalPredicted, vehicleVisual.rotation, 400)
          }

          if (navigationMode && isFollowingDriver && mapRef.current) {
            const projection = routePath.length > 1
              ? getClosestRouteProjection(finalPredicted, routePath)
              : null
            const cameraPoint = getDriverNavigationCameraCenter(
              finalPredicted,
              heading,
              routePath,
              projection,
              destination,
              speed
            )

            if (isValidCoord(cameraPoint)) {
              animateCameraSmooth(mapRef.current, cameraPoint, heading, 500)
            }
          }
        }
      }

      lastDeadReckonUpdateRef.current = now
      deadReckoningFrameRef.current = requestAnimationFrame(deadReckonLoop)
    }

    deadReckoningFrameRef.current = requestAnimationFrame(deadReckonLoop)
  }

  function stopDeadReckoning() {
    deadReckoningActiveRef.current = false
    if (deadReckoningFrameRef.current) {
      cancelAnimationFrame(deadReckoningFrameRef.current)
      deadReckoningFrameRef.current = null
    }
    predictedPositionRef.current = null
  }

  // ==================== SMOOTH CAMERA ANIMATION ====================

  function animateCameraSmooth(map, targetCenter, targetHeading, duration = 800) {
    if (!map || !isValidCoord(targetCenter)) return

    const fromCenter = cameraLastCenterRef.current || targetCenter
    const fromHeading = cameraLastHeadingRef.current
    const toHeading = Number.isFinite(Number(targetHeading)) ? Number(targetHeading) : fromHeading

    // If distance is very small, just snap
    const dist = getDistanceMeters(fromCenter, targetCenter)
    if (dist < 0.5) {
      runProgrammaticCameraMove(() => {
        applyNavigationCamera(map, targetCenter, targetHeading, {
          zoom: getNavigationZoom(),
          tilt: getCurrentNavigationTilt(),
        })
      })
      cameraLastCenterRef.current = targetCenter
      cameraLastHeadingRef.current = toHeading
      return
    }

    // Cancel previous camera animation
    if (cameraAnimFrameRef.current) {
      cancelAnimationFrame(cameraAnimFrameRef.current)
      cameraAnimFrameRef.current = null
    }

    cameraAnimFromRef.current = fromCenter
    cameraAnimToRef.current = targetCenter
    cameraAnimFromHeadingRef.current = fromHeading
    cameraAnimToHeadingRef.current = toHeading
    cameraAnimStartRef.current = performance.now()
    cameraAnimDurationRef.current = clamp(duration, 300, 1200)
    cameraAnimatingRef.current = true

    const cameraAnimLoop = () => {
      if (!cameraAnimatingRef.current) return

      const elapsed = performance.now() - cameraAnimStartRef.current
      const rawProgress = Math.min(elapsed / cameraAnimDurationRef.current, 1)
      const progress = easeInOutCubic(rawProgress)

      const interpCenter = interpolateLatLng(cameraAnimFromRef.current, cameraAnimToRef.current, progress)
      const interpHeading = interpolateHeading(cameraAnimFromHeadingRef.current, cameraAnimToHeadingRef.current, progress)

      runProgrammaticCameraMove(() => {
        applyNavigationCamera(map, interpCenter, interpHeading, {
          zoom: getNavigationZoom(),
          tilt: getCurrentNavigationTilt(),
        })
      })

      if (rawProgress < 1) {
        cameraAnimFrameRef.current = requestAnimationFrame(cameraAnimLoop)
      } else {
        // Final snap
        runProgrammaticCameraMove(() => {
          applyNavigationCamera(map, cameraAnimToRef.current, cameraAnimToHeadingRef.current, {
          zoom: getNavigationZoom(),
          tilt: getCurrentNavigationTilt(),
          })
        })
        cameraLastCenterRef.current = cameraAnimToRef.current
        cameraLastHeadingRef.current = cameraAnimToHeadingRef.current
        cameraAnimatingRef.current = false
        cameraAnimFrameRef.current = null
      }
    }

    cameraAnimFrameRef.current = requestAnimationFrame(cameraAnimLoop)
  }

  // ==================== SMOOTH CAR POSITION UPDATE ====================

  useEffect(() => {
    const map = mapRef.current

    if (!mapReady || !map || !googleApi) return

    if (!isValidCoord(origin)) {
      if (originOverlayRef.current) {
        originOverlayRef.current.setMap(null)
        originOverlayRef.current = null
      }

      // Reset refs
      visualDriverPositionRef.current = null
      lastGoodDriverPositionRef.current = null
      lastRawDriverPositionRef.current = null
      visualHeadingRef.current = 0
      lastGoodHeadingRef.current = 0
      currentCarSpriteRef.current = 'back'
      lastSpriteChangeAtRef.current = 0
      lastSpriteHeadingRef.current = 0
      offRouteCountRef.current = 0
      rerouteReasonRef.current = ''
      gpsBufferRef.current = []
      stopDeadReckoning()

      return
    }

    const showCarAsOrigin = navigationMode || showOriginCar
    const nextModeKey = showCarAsOrigin ? 'car' : 'client'
    const currentOverlay = originOverlayRef.current
    const routePath = activeRoutePathRef.current

    // === GPS FILTERING ===
    const rawPoint = toLatLng(origin)
    const rawHeading = Number(origin?.heading)
    const rawSpeed = Number(origin?.speed)
    const rawAccuracy = Number(origin?.accuracy)

    const originTimestamp = Date.parse(origin?.updated_at || origin?.timestamp || origin?._timestamp || '')
    const gpsTimestamp = Number.isFinite(Number(origin?._timestamp))
      ? Number(origin._timestamp)
      : Number.isFinite(Number(origin?.timestamp))
        ? Number(origin.timestamp)
        : Number.isFinite(originTimestamp)
          ? originTimestamp
          : Date.now()

    // Add timestamp for speed calculation
    const pointWithTs = { ...rawPoint, heading: rawHeading, speed: rawSpeed, accuracy: rawAccuracy, _timestamp: gpsTimestamp }
    const previousPoint = lastGoodDriverPositionRef.current
    const estimatedSpeed = estimateSpeedMps(previousPoint, pointWithTs)
    const effectiveSpeed = Number.isFinite(rawSpeed) ? rawSpeed : estimatedSpeed

    // Update raw position ref
    lastRawDriverPositionRef.current = rawPoint

    // Determine if this is a good GPS point
    let matchedOrigin = rawPoint
    let matchedProjection = null
    let nextHeading = navigationHeadingRef.current
    let acceptedGpsUpdate = !showCarAsOrigin

    if (showCarAsOrigin) {
      // Track GPS quality
      const goodPoint = isGoodGpsPoint(pointWithTs, previousPoint)

      if (import.meta.env.DEV) {
        console.info('[MiChofer GPS]', {
          rawPoint: pointWithTs,
          matchedOrigin,
          goodPoint,
          rawSpeed: Number.isFinite(rawSpeed) ? rawSpeed : null,
          estimatedSpeed,
          accuracy: Number.isFinite(rawAccuracy) ? rawAccuracy : null,
          movedMeters: previousPoint ? getDistanceMeters(previousPoint, pointWithTs) : 0,
          heading: navigationHeadingRef.current,
        })
      }

      if (goodPoint) {
        acceptedGpsUpdate = true
        // Push to GPS buffer for smoothing
        pushGpsBuffer(rawPoint)

        // Use smoothed position from buffer
        const smoothedPos = getSmoothedBufferPosition()
        if (smoothedPos) {
          matchedOrigin = smoothedPos
        }

        lastGoodDriverPositionRef.current = pointWithTs
        lastGoodHeadingRef.current = Number.isFinite(rawHeading) ? normalizeHeading(rawHeading) : lastGoodHeadingRef.current

        // Store last known state for dead reckoning
        lastKnownPositionRef.current = matchedOrigin
        lastKnownSpeedRef.current = Number.isFinite(effectiveSpeed) ? effectiveSpeed : 0
        lastKnownHeadingRef.current = Number.isFinite(rawHeading) ? normalizeHeading(rawHeading) : lastGoodHeadingRef.current

        // Stop dead reckoning since we have a real update
        stopDeadReckoning()

        // Snap to route if we have one
        if (routePath.length > 1) {
          const currentIndex = Math.max(1, lastMatchedRouteIndexRef.current || 1)
          const fromIndex = Math.max(1, currentIndex - NAVIGATION_BACKTRACK_TOLERANCE)
          const toIndex = Math.min(routePath.length - 1, currentIndex + NAVIGATION_FORWARD_SEARCH)

          matchedProjection = getClosestRouteProjection(matchedOrigin, routePath, {
            fromIndex,
            toIndex,
          })

          if (!matchedProjection) {
            matchedProjection = getClosestRouteProjection(matchedOrigin, routePath)
          }

          if (matchedProjection && matchedProjection.distance <= NAVIGATION_SNAP_METERS) {
            matchedOrigin = matchedProjection.point
            offRouteCountRef.current = 0
            rerouteReasonRef.current = ''

            lastMatchedRouteIndexRef.current = Math.max(
              currentIndex - NAVIGATION_BACKTRACK_TOLERANCE,
              matchedProjection.index
            )

            lastMatchedPointRef.current = matchedOrigin
            const routeHeading = getRouteHeadingFromProjection(routePath, matchedProjection, destination)
            nextHeading = getBestVehicleHeading(origin, routeHeading, navigationHeadingRef.current, {
              preferRouteHeading: stableDriverNavigation && !isReliableHeading(origin),
            })
          } else {
            // Off route
            const now = Date.now()
            const projectionDistance = Number(matchedProjection?.distance)
            const routeHeading = matchedProjection
              ? getRouteHeadingFromProjection(routePath, matchedProjection, destination)
              : navigationHeadingRef.current
            const headingDiff = Math.abs(shortestAngleDiff(routeHeading, navigationHeadingRef.current))
            const softOffRoute = Number.isFinite(projectionDistance) && projectionDistance >= NAVIGATION_SOFT_OFF_ROUTE_METERS
            const hardOffRoute = Number.isFinite(projectionDistance) && projectionDistance >= NAVIGATION_HARD_OFF_ROUTE_METERS
            const headingOffRoute = softOffRoute && headingDiff >= NAVIGATION_RECALCULATE_HEADING_DEG

            if (softOffRoute) {
              offRouteCountRef.current += 1
              lastOffRouteAtRef.current = now
              rerouteReasonRef.current = hardOffRoute ? 'off-route-distance' : headingOffRoute ? 'off-route-heading' : 'possible-off-route'
            } else {
              offRouteCountRef.current = 0
              rerouteReasonRef.current = ''
            }

            const shouldReroute = navigationMode &&
              (hardOffRoute || headingOffRoute || offRouteCountRef.current >= 2) &&
              now - lastRerouteAtRef.current > NAVIGATION_REROUTE_COOLDOWN_MS

            if (shouldReroute) {
              lastRerouteAtRef.current = now
              routeOriginRef.current = isValidCoord(matchedOrigin) ? toLatLng(matchedOrigin) : toLatLng(origin)
              routeSignatureRef.current = ''
              onRouteUpdate?.({
                distance: isValidCoord(destination) ? getDistanceMeters(matchedOrigin, destination) : 0,
                duration: 0,
                instruction: 'Recalculando ruta...',
                shortInstruction: 'Recalculando',
                maneuver: 'recalculating',
                heading: navigationHeadingRef.current,
                alertLevel: 'recalculating',
                distanceToNextStep: 0,
                nextInstruction: null,
                nextManeuver: null,
                remainingMeters: isValidCoord(destination) ? getDistanceMeters(matchedOrigin, destination) : 0,
                progress: 0,
                recalculating: true,
                rerouteReason: rerouteReasonRef.current,
              })
              setRouteRefreshToken((value) => value + 1)
            }

            if (lastMatchedPointRef.current) {
              nextHeading = getBearingBetweenPoints(lastMatchedPointRef.current, matchedOrigin)
            } else if (isValidCoord(destination)) {
              nextHeading = getBearingBetweenPoints(matchedOrigin, destination)
            }
          }
        } else if (isValidCoord(destination)) {
          const routeHeading = getBearingBetweenPoints(matchedOrigin, destination)
          nextHeading = getBestVehicleHeading(origin, routeHeading, navigationHeadingRef.current, {
            preferRouteHeading: stableDriverNavigation && !isReliableHeading(origin),
          })
        }

        matchedOrigin = smoothVisualPosition(
          visualDriverPositionRef.current || originOverlayRef.current?.currentPosition || previousPoint,
          matchedOrigin,
          rawAccuracy,
          effectiveSpeed
        )

        lastKnownPositionRef.current = matchedOrigin
      } else {
        // Bad GPS point - don't update position, keep previous
        if (predictedPositionRef.current) {
          matchedOrigin = predictedPositionRef.current
        } else if (lastGoodDriverPositionRef.current) {
          matchedOrigin = toLatLng(lastGoodDriverPositionRef.current)
        }
        // Keep previous heading
        nextHeading = navigationHeadingRef.current
      }

      // Smooth heading with angular interpolation
      navigationHeadingRef.current = getSmoothNavigationHeading(navigationHeadingRef.current, nextHeading, {
        minChange: stableDriverNavigation ? 7 : NAVIGATION_MIN_HEADING_CHANGE,
        smoothing: stableDriverNavigation ? 0.1 : NAVIGATION_HEADING_SMOOTHING,
      })
      lastKnownHeadingRef.current = navigationHeadingRef.current

      if (navigationMode) {
        const nextInstruction = getSmartNavigationInstruction({
          currentPoint: matchedOrigin,
          routePath,
          routeSteps: routeStepsRef.current,
          destination,
          currentProjection: matchedProjection,
          heading: navigationHeadingRef.current,
        }) || getNextRouteInstruction(matchedOrigin, routeStepsRef.current, destination)
        if (nextInstruction) {
          updateNavigationRouteVisuals(routePath, matchedProjection, nextInstruction)
          const distanceToDestination = Number.isFinite(Number(nextInstruction.remainingMeters))
            ? Number(nextInstruction.remainingMeters)
            : isValidCoord(destination)
            ? getDistanceMeters(matchedOrigin, destination)
            : nextInstruction.distanceMeters
          const navUpdate = {
            distance: distanceToDestination,
            duration: nextInstruction.duration ?? nextInstruction.durationSeconds,
            instruction: nextInstruction.instruction,
            maneuver: nextInstruction.maneuver,
            heading: navigationHeadingRef.current,
            shortInstruction: nextInstruction.shortInstruction,
            alertLevel: nextInstruction.alertLevel,
            distanceToNextStep: nextInstruction.distanceToNextStep,
            nextInstruction: nextInstruction.nextStreet,
            nextManeuver: nextInstruction.nextManeuver,
            remainingMeters: nextInstruction.remainingMeters ?? distanceToDestination,
            progress: nextInstruction.progress,
            recalculating: false,
          }

          lastRouteUpdateRef.current = navUpdate
          onRouteUpdate?.(navUpdate)

          if (import.meta.env.DEV) {
            console.info('[MiChofer Nav]', {
              instruction: nextInstruction.instruction,
              distanceMeters: nextInstruction.distanceMeters,
              following: isFollowingDriver,
              deadReckoning: deadReckoningActiveRef.current,
            })
          }
        }
      }
    }

    // === OVERLAY MANAGEMENT ===
    if (
      !currentOverlay ||
      currentOverlay.__modeKey !== nextModeKey ||
      (!showCarAsOrigin && currentOverlay.__avatar !== (clientAvatar || ''))
    ) {
      if (currentOverlay) {
        currentOverlay.setMap(null)
      }

      const vehicleVisual = getCurrentVehicleVisual(navigationHeadingRef.current, effectiveSpeed)

      if (showCarAsOrigin) {
        // Use smooth overlay for car
        originOverlayRef.current = createNavigationOverlaySmooth(
          matchedOrigin,
          googleApi,
          vehicleVisual.rotation,
          vehicleVisual.spriteType
        )
        originOverlayRef.current._firstPosition = true
      } else {
        originOverlayRef.current = createClientOverlay(clientAvatar, 'Tu ubicación', googleApi, matchedOrigin)
      }

      originOverlayRef.current.setMap(map)
    } else if (showCarAsOrigin) {
      // Update car position with smooth animation
      if (typeof originOverlayRef.current.updatePositionSmooth === 'function') {
        const duration = getGpsAnimationDuration(
          originOverlayRef.current.currentPosition || previousPoint,
          pointWithTs
        )
        const vehicleVisual = getCurrentVehicleVisual(navigationHeadingRef.current, effectiveSpeed)
        if (typeof originOverlayRef.current.updateVehicleVisual === 'function') {
          originOverlayRef.current.updateVehicleVisual(vehicleVisual.spriteType, vehicleVisual.rotation)
        }
        originOverlayRef.current.updatePositionSmooth(matchedOrigin, vehicleVisual.rotation, duration)
      } else {
        // Fallback for legacy overlay
        originOverlayRef.current.updatePosition(matchedOrigin)
        if (typeof originOverlayRef.current.updateHeading === 'function') {
          originOverlayRef.current.updateHeading(getCarScreenRotation({
            navigationMode,
            vehicleHeading: navigationHeadingRef.current,
          }))
        }
      }
    } else {
      // Client overlay - CSS transition is sufficient
      originOverlayRef.current.updatePosition(matchedOrigin)
    }

    // === CAMERA UPDATE ===
    const now = Date.now()
    if (navigationMode && showCarAsOrigin) {
        const cameraPoint = getDriverNavigationCameraCenter(
          matchedOrigin,
          navigationHeadingRef.current,
          routePath,
          matchedProjection,
          destination,
          effectiveSpeed
        )

        // Apply navigation camera with smooth animation
        if (isValidCoord(cameraPoint)) {
          const cameraDist = cameraLastCenterRef.current
            ? getDistanceMeters(cameraLastCenterRef.current, cameraPoint)
            : 999

          if (
            cameraDist > NAVIGATION_CAMERA_MIN_MOVE_METERS ||
            now - lastVisualCameraAtRef.current > NAVIGATION_CAMERA_MIN_UPDATE_MS ||
            !cameraLastCenterRef.current
          ) {
            // Use smooth camera animation instead of jump
            animateCameraSmooth(map, cameraPoint, navigationHeadingRef.current, 600)
            lastVisualCameraAtRef.current = now
          }
        }
      }
    // Update visual position ref
    visualDriverPositionRef.current = matchedOrigin
    if (acceptedGpsUpdate) {
      lastDriverUpdateAtRef.current = now
    }

    // === START DEAD RECKONING IF SIGNAL IS LATE ===
    // If we have a known position and the car is moving, start predicting
    if (acceptedGpsUpdate && showCarAsOrigin && lastKnownPositionRef.current &&
        Number.isFinite(lastKnownSpeedRef.current) && lastKnownSpeedRef.current > 0.35) {
      // Start dead reckoning after a short delay with no update
      // (will be stopped when a new good GPS point arrives)
      setTimeout(() => {
        const timeSinceUpdate = Date.now() - lastDriverUpdateAtRef.current
        if (timeSinceUpdate >= DEAD_RECKONING_START_MS && !deadReckoningActiveRef.current) {
          startDeadReckoning()
        }
      }, DEAD_RECKONING_START_MS)
    }
  }, [
    clientAvatar,
    destination?.lat,
    destination?.lng,
    googleApi,
    mapReady,
    navigationMode,
    navigationVariant,
    origin?.lat,
    origin?.lng,
    origin?.heading,
    origin?.speed,
    origin?.accuracy,
    onRouteUpdate,
    isFollowingDriver,
    showOriginCar,
    mapTheme,
  ])

  // ==================== DRIVERS MARKERS ====================

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
    selectedDriver,
    showOriginCar,
    visibleDrivers,
  ])

  // ==================== TRAFFIC LAYER ====================

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

  // ==================== ROUTE CALCULATION ====================

  useEffect(() => {
    const map = mapRef.current
    const directionsService = directionsServiceRef.current
    const routePolyline = routePolylineRef.current
    const focusRouteGlow = focusRouteGlowRef.current
    const completedPolyline = routeCompletedPolylineRef.current
    const nextStepPolyline = routeNextStepPolylineRef.current

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
        const hasDriverVisibleRoute =
          stableDriverNavigation &&
          isValidCoord(origin) &&
          isValidCoord(destination) &&
          Array.isArray(activeRoutePathRef.current) &&
          activeRoutePathRef.current.length >= 2

        if (hasDriverVisibleRoute) {
          if (import.meta.env.DEV) {
            console.info('[MiChofer Driver Route]', {
              originValid: true,
              destinationValid: true,
              routePathLength: activeRoutePathRef.current.length,
              projectionDistance: null,
              remainingPathLength: activeRoutePathRef.current.length,
              fallback: 'preserve-existing-route-on-clear',
            })
          }
          return
        }

        activeRoutePathRef.current = []
        routeStepsRef.current = []
        lastMatchedRouteIndexRef.current = 1
        lastMatchedPointRef.current = null
        offRouteCountRef.current = 0
        rerouteReasonRef.current = ''
        routeOriginRef.current = null

        if (routePolyline) {
          routePolyline.setPath([])
        }
        if (focusRouteGlow) {
          focusRouteGlow.setPath([])
        }
        if (completedPolyline) {
          completedPolyline.setPath([])
        }
        if (nextStepPolyline) {
          nextStepPolyline.setPath([])
        }
        if (driverRouteOverlayRef.current) {
          driverRouteOverlayRef.current.setMap(null)
          driverRouteOverlayRef.current = null
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

    const routeOrigin = routeOriginRef.current || normalizedOrigin
    const routeSignature = JSON.stringify({
      origin: routeOrigin,
      destination: normalizedDestination,
      selectedDriver: normalizedSelectedDriver,
      navigationMode,
      routeRefreshToken,
    })

    if (routeSignatureRef.current === routeSignature) {
      return
    }

    routeSignatureRef.current = routeSignature
    routeOriginRef.current = routeOrigin
    routeRequestSerialRef.current += 1

    if (!navigationMode) {
      hasAutoFittedRouteRef.current = false
    }

    const requestSerial = routeRequestSerialRef.current
    let cancelled = false

    const waypoints = [routeOrigin]
    if (normalizedSelectedDriver) {
      waypoints.push(normalizedSelectedDriver)
    }
    waypoints.push(normalizedDestination)

    const loadRoute = async () => {
      const currentMap = mapRef.current
      const currentPolyline = routePolylineRef.current
      const currentFocusGlow = focusRouteGlowRef.current
      const currentCompletedPolyline = routeCompletedPolylineRef.current
      const currentNextStepPolyline = routeNextStepPolylineRef.current
      if (!currentMap || !currentPolyline || !googleApi) return

      let routeResult = null
      if (GOOGLE_ROUTES_API_ENABLED) {
        routeResult = await computeRouteWithRoutesApi({
          origin: routeOrigin,
          destination: normalizedDestination,
          waypoints: normalizedSelectedDriver ? [normalizedSelectedDriver] : [],
        })
      }

      if (cancelled || requestSerial !== routeRequestSerialRef.current) return

      const handleRouteResult = (routePath, distance, duration, instruction, steps = []) => {
        activeRoutePathRef.current = routePath
        routeStepsRef.current = steps.map(normalizeRouteStep).filter(Boolean)
        if (stableDriverNavigation) {
          currentPolyline.setOptions({
            strokeColor: '#1269ff',
            strokeOpacity: 1,
            strokeWeight: 12,
            zIndex: 920,
          })
        }
        currentPolyline.setPath(routePath)
        updateDriverRouteOverlay(routePath)
        if (currentCompletedPolyline) {
          if (stableDriverNavigation) {
            currentCompletedPolyline.setOptions({
              strokeColor: '#ffffff',
              strokeOpacity: 0.78,
              strokeWeight: 17,
              zIndex: 900,
            })
            currentCompletedPolyline.setPath(routePath)
          } else {
            currentCompletedPolyline.setPath([])
          }
        }
        if (currentNextStepPolyline) currentNextStepPolyline.setPath([])
        if (currentFocusGlow) {
          currentFocusGlow.setOptions({
            strokeColor: stableDriverNavigation ? '#4de7ff' : '#14f1e5',
            strokeOpacity: navigationMode ? (stableDriverNavigation ? 0.46 : 0.28) : 0,
            strokeWeight: navigationMode ? (stableDriverNavigation ? 25 : 16) : 0,
            zIndex: stableDriverNavigation ? 910 : 3,
          })
          currentFocusGlow.setPath(routePath)
        }

        const currentProjection = getClosestRouteProjection(normalizedOrigin, routePath) || {
          point: normalizedOrigin,
          index: 1,
          distance: 0,
        }

        if (import.meta.env.DEV && stableDriverNavigation) {
          console.info('[MiChofer Driver Route]', {
            originValid: isValidCoord(normalizedOrigin),
            destinationValid: isValidCoord(normalizedDestination),
            routePathLength: routePath.length,
            projectionDistance: Number.isFinite(Number(currentProjection?.distance)) ? Number(currentProjection.distance) : null,
            remainingPathLength: Math.max(0, routePath.length - Math.max(1, Number(currentProjection?.index) || 1) + 1),
            fallback: currentProjection?.distance === 0 && currentProjection?.point === normalizedOrigin ? 'initial-origin-projection' : 'new-route',
          })
        }

        lastMatchedRouteIndexRef.current = currentProjection.index
        lastMatchedPointRef.current = currentProjection.point

        const routeHeading = getRouteHeadingFromProjection(
          routePath,
          currentProjection,
          normalizedDestination
        )

        const heading = getBestVehicleHeading(
          origin,
          routeHeading,
          navigationHeadingRef.current,
          {
            preferRouteHeading: stableDriverNavigation && !isReliableHeading(origin),
          }
        )
        const smoothHeading = getSmoothNavigationHeading(navigationHeadingRef.current, heading, {
          minChange: stableDriverNavigation ? 7 : NAVIGATION_MIN_HEADING_CHANGE,
          smoothing: stableDriverNavigation ? 0.1 : NAVIGATION_HEADING_SMOOTHING,
        })

        navigationHeadingRef.current = smoothHeading

        if (
          originOverlayRef.current?.__modeKey === 'car' &&
          typeof originOverlayRef.current.updatePositionSmooth === 'function'
        ) {
          const vehicleVisual = getCurrentVehicleVisual(smoothHeading, Number(origin?.speed))
          if (typeof originOverlayRef.current.updateVehicleVisual === 'function') {
            originOverlayRef.current.updateVehicleVisual(vehicleVisual.spriteType, vehicleVisual.rotation)
          }
          originOverlayRef.current.updatePositionSmooth(
            originOverlayRef.current.currentPosition || normalizedOrigin,
            vehicleVisual.rotation,
            900
          )
        } else if (
          originOverlayRef.current?.__modeKey === 'car' &&
          typeof originOverlayRef.current.updateHeading === 'function'
        ) {
          originOverlayRef.current.updateHeading(getCarScreenRotation({
            navigationMode,
            vehicleHeading: smoothHeading,
          }))
        }

        const currentInstruction = getSmartNavigationInstruction({
          currentPoint: lastMatchedPointRef.current || normalizedOrigin,
          routePath,
          routeSteps: routeStepsRef.current,
          destination: normalizedDestination,
          currentProjection,
          heading: smoothHeading,
        }) || getNextRouteInstruction(
          lastMatchedPointRef.current || normalizedOrigin,
          routeStepsRef.current,
          normalizedDestination
        )
        updateNavigationRouteVisuals(routePath, currentProjection, currentInstruction)
        emitRouteUpdate({
          distance: currentInstruction?.remainingMeters ?? distance,
          duration: currentInstruction?.duration ?? duration,
          instruction: currentInstruction?.instruction || instruction,
          maneuver: currentInstruction?.maneuver || null,
          heading: smoothHeading,
          shortInstruction: currentInstruction?.shortInstruction,
          alertLevel: currentInstruction?.alertLevel,
          distanceToNextStep: currentInstruction?.distanceToNextStep,
          nextInstruction: currentInstruction?.nextStreet,
          nextManeuver: currentInstruction?.nextManeuver,
          remainingMeters: currentInstruction?.remainingMeters,
          progress: currentInstruction?.progress,
          recalculating: false,
        })

        if (!navigationMode && !userCameraTouchedRef.current && !hasAutoFittedRouteRef.current) {
          const bounds = getBounds(waypoints, googleApi)

          if (bounds) {
            const padding = typeof fitPadding === 'function' ? fitPadding() : fitPadding || DEFAULT_PADDING
            currentMap.fitBounds(bounds, padding)
            hasAutoFittedRouteRef.current = true
          }
        }

        if (navigationMode) {
          const navigationHeading = smoothHeading
          const carPoint = lastMatchedPointRef.current || normalizedOrigin
          const cameraCenter = getDriverNavigationCameraCenter(
            carPoint,
            navigationHeading,
            routePath,
            currentProjection,
            normalizedDestination,
            Number(origin?.speed)
          )

          const currentTheme = getAutoMapTheme()
          const effectiveMapId = getMapIdForTheme(currentTheme)

          currentMap.setOptions({
            tilt: getCurrentNavigationTilt(),
            heading: navigationHeading,
            mapId: effectiveMapId,
            mapTypeId: effectiveMapId ? undefined : 'roadmap',
            styles: effectiveMapId ? undefined : currentTheme === 'dark' ? MICHOFER_DARK_MAP_STYLE : MICHOFER_LIGHT_MAP_STYLE,
          })

          runProgrammaticCameraMove(() => {
            applyNavigationCamera(currentMap, cameraCenter, navigationHeading, {
              zoom: getNavigationZoom(),
              tilt: getCurrentNavigationTilt(),
              force: true,
            })
          })
        }
      }

      if (routeResult && Array.isArray(routeResult.path) && routeResult.path.length >= 2) {
        const routePath = routeResult.path.filter(isValidCoord)
        if (routePath.length >= 2) {
          handleRouteResult(routePath, routeResult.distance, routeResult.duration, routeResult.instruction, routeResult.steps)
          return
        }
      }

      if (!directionsService) {
        if (stableDriverNavigation && activeRoutePathRef.current.length >= 2 && isValidCoord(origin) && isValidCoord(destination)) {
          currentPolyline.setPath(activeRoutePathRef.current)
          if (currentFocusGlow) currentFocusGlow.setPath(activeRoutePathRef.current)
          updateDriverRouteOverlay(activeRoutePathRef.current)
          if (import.meta.env.DEV) {
            console.info('[MiChofer Driver Route]', {
              originValid: true,
              destinationValid: true,
              routePathLength: activeRoutePathRef.current.length,
              projectionDistance: null,
              remainingPathLength: activeRoutePathRef.current.length,
              fallback: 'no-directions-service-preserve-route',
            })
          }
          return
        }

        currentPolyline.setPath([])
        if (currentFocusGlow) currentFocusGlow.setPath([])
        if (currentCompletedPolyline) currentCompletedPolyline.setPath([])
        if (currentNextStepPolyline) currentNextStepPolyline.setPath([])
        emitRouteUpdate(null)
        return
      }

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
        const currentFocusGlow = focusRouteGlowRef.current
        const currentCompletedPolyline = routeCompletedPolylineRef.current
        const currentNextStepPolyline = routeNextStepPolylineRef.current

        if (!currentMap || !currentPolyline || !googleApi) return

          if (status === googleApi.maps.DirectionsStatus.OK && result?.routes?.[0]) {
            const route = result.routes[0]
            const routePath = Array.isArray(route.overview_path)
              ? route.overview_path.map((point) => normalizeMapPoint(point, null)).filter(isValidCoord)
              : []

            if (routePath.length >= 2) {
              handleRouteResult(
                routePath,
                route.legs?.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0) || 0,
                route.legs?.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0) || 0,
                cleanRouteInstruction(route.legs?.[0]?.steps?.[0]?.instructions),
                route.legs?.flatMap((leg) => Array.isArray(leg.steps) ? leg.steps : []) || []
              )
              return
            }
          }

          if (stableDriverNavigation && activeRoutePathRef.current.length >= 2 && isValidCoord(origin) && isValidCoord(destination)) {
            currentPolyline.setPath(activeRoutePathRef.current)
            if (currentFocusGlow) currentFocusGlow.setPath(activeRoutePathRef.current)
            updateDriverRouteOverlay(activeRoutePathRef.current)
            if (import.meta.env.DEV) {
              console.info('[MiChofer Driver Route]', {
                originValid: true,
                destinationValid: true,
                routePathLength: activeRoutePathRef.current.length,
                projectionDistance: null,
                remainingPathLength: activeRoutePathRef.current.length,
                fallback: 'directions-failed-preserve-route',
              })
            }
            return
          }

          currentPolyline.setPath([])
          if (currentFocusGlow) currentFocusGlow.setPath([])
          if (currentCompletedPolyline) currentCompletedPolyline.setPath([])
          if (currentNextStepPolyline) currentNextStepPolyline.setPath([])
          emitRouteUpdate(null)
        } catch (error) {
          console.warn('Error seguro en route callback:', error)
          if (stableDriverNavigation && activeRoutePathRef.current.length >= 2 && isValidCoord(origin) && isValidCoord(destination)) {
            currentPolyline.setPath(activeRoutePathRef.current)
            if (currentFocusGlow) currentFocusGlow.setPath(activeRoutePathRef.current)
            updateDriverRouteOverlay(activeRoutePathRef.current)
            if (import.meta.env.DEV) {
              console.info('[MiChofer Driver Route]', {
                originValid: true,
                destinationValid: true,
                routePathLength: activeRoutePathRef.current.length,
                projectionDistance: null,
                remainingPathLength: activeRoutePathRef.current.length,
                fallback: 'route-callback-error-preserve-route',
              })
            }
            return
          }
          currentPolyline.setPath([])
          if (currentFocusGlow) currentFocusGlow.setPath([])
          if (currentCompletedPolyline) currentCompletedPolyline.setPath([])
          if (currentNextStepPolyline) currentNextStepPolyline.setPath([])
          emitRouteUpdate(null)
        }
      })
    }

    loadRoute()

    return () => {
      cancelled = true
    }

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
    navigationVariant,
    onRouteUpdate,
    origin?.lat,
    origin?.lng,
    routeRefreshToken,
    selectedDriver?.id,
    selectedDriver?.lat,
    selectedDriver?.lng,
    mapTheme,
  ])

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (driverAnimationFrameRef.current) {
        cancelAnimationFrame(driverAnimationFrameRef.current)
        driverAnimationFrameRef.current = null
      }
    }
  }, [])

  // ==================== RECENTER DRIVER CAMERA ====================

  function recenterDriverCamera() {
    setIsFollowingDriver(true)
    const map = mapRef.current
    if (!map || !isValidCoord(origin)) return

    const carPoint = lastMatchedPointRef.current || toLatLng(origin)
    const cameraCenter = getDriverNavigationCameraCenter(
      carPoint,
      navigationHeadingRef.current,
      activeRoutePathRef.current,
      lastMatchedPointRef.current
        ? { point: lastMatchedPointRef.current, index: lastMatchedRouteIndexRef.current, distance: 0 }
        : null,
      destination,
      Number(origin?.speed)
    )

    runProgrammaticCameraMove(() => {
      applyNavigationCamera(map, cameraCenter, navigationHeadingRef.current, {
        zoom: getNavigationZoom(),
        tilt: getCurrentNavigationTilt(),
        force: true,
      })
    })
  }

  return (
    <section
      className={`mobility-map interactive-map map-theme-${mapTheme}${navigationMode ? ' focus-drive' : ''}`}
      data-map-theme={mapTheme}
    >
      <div ref={mapContainerRef} className={mapReady ? 'google-real-map ready' : 'google-real-map'} />

      <div className={navigationMode ? 'map-toolbar navigation-toolbar' : 'map-toolbar'} aria-label="Controles de mapa">
        {!navigationMode && showMapTypeControl && (
          <button
            type="button"
            className={isSatellite ? 'active' : ''}
            onClick={() => setIsSatellite((value) => !value)}
            title={isSatellite ? 'Volver al mapa normal' : 'Ver mapa satelital'}
          >
            <Map size={16} />
            Satélite
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

      <button
        className="map-locate-btn"
        type="button"
        onClick={() => {
          if (navigationMode) {
            userCameraTouchedRef.current = false
            const map = mapRef.current
            if (map && isValidCoord(origin)) {
              const cameraCenter = getDriverNavigationCameraCenter(
                lastMatchedPointRef.current || toLatLng(origin),
                navigationHeadingRef.current,
                activeRoutePathRef.current,
                lastMatchedPointRef.current ? { point: lastMatchedPointRef.current, index: lastMatchedRouteIndexRef.current, distance: 0 } : null,
                destination,
                Number(origin?.speed)
              )
              runProgrammaticCameraMove(() => {
                applyNavigationCamera(map, cameraCenter, navigationHeadingRef.current, {
                  zoom: getNavigationZoom(),
                  tilt: getCurrentNavigationTilt(),
                  force: true,
                })
              })
            }
          }

          if (typeof onRefreshLocation === 'function') {
            onRefreshLocation()
          }
        }}
        aria-label="Actualizar ubicación"
      >
        <LocateFixed size={19} />
      </button>

      {navigationMode && (
        <div className={`map-gps-status ${gpsSignalStatus}`} aria-live="polite">
          {gpsSignalLabel}
        </div>
      )}

      {navigationMode && !isFollowingDriver && (
        <button
          className="map-recenter-btn"
          type="button"
          onClick={recenterDriverCamera}
          aria-label="Centrar en el conductor"
        >
          ⦿
        </button>
      )}

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
