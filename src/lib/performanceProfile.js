const STORAGE_KEY = 'michofer_performance_profile'
const CURRENT_VERSION = 1

export const PERFORMANCE_PROFILES = {
  low: {
    reducedAnimations: true,
    reducedShadows: true,
    reducedBlur: true,
    mapDetailLevel: 'low',
    gpsUpdateInterval: 5000,
    driverAnimationLevel: 'basic',
    maxDriverMarkers: 3,
    cameraUpdateMinMs: 220,
    carAnimationDuration: 520,
    enableTrafficByDefault: false,
  },
  medium: {
    reducedAnimations: false,
    reducedShadows: true,
    reducedBlur: true,
    mapDetailLevel: 'medium',
    gpsUpdateInterval: 3500,
    driverAnimationLevel: 'balanced',
    maxDriverMarkers: 5,
    cameraUpdateMinMs: 130,
    carAnimationDuration: 380,
    enableTrafficByDefault: false,
  },
  high: {
    reducedAnimations: false,
    reducedShadows: false,
    reducedBlur: false,
    mapDetailLevel: 'high',
    gpsUpdateInterval: 2500,
    driverAnimationLevel: 'premium',
    maxDriverMarkers: 6,
    cameraUpdateMinMs: 70,
    carAnimationDuration: 300,
    enableTrafficByDefault: true,
  },
}

export const PROFILE_LABELS = {
  low: 'Básico',
  medium: 'Equilibrado',
  high: 'Máxima calidad',
}

export const MODE_LABELS = {
  auto: 'Automático',
  low: 'Ahorro',
  medium: 'Equilibrado',
  high: 'Máxima calidad',
}

function safeNavigator() {
  return typeof navigator !== 'undefined' ? navigator : {}
}

function safeWindow() {
  return typeof window !== 'undefined' ? window : {}
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getSettings(profile) {
  return PERFORMANCE_PROFILES[profile] || PERFORMANCE_PROFILES.medium
}

function createConfig(profile, score, mode = 'auto') {
  const safeProfile = PERFORMANCE_PROFILES[profile] ? profile : 'medium'
  return {
    version: CURRENT_VERSION,
    mode,
    profile: safeProfile,
    score: Math.round(Number(score) || 0),
    testedAt: new Date().toISOString(),
    settings: getSettings(safeProfile),
  }
}

export function getFallbackPerformanceConfig() {
  return createConfig('medium', 55, 'auto')
}

export function readPerformanceConfig() {
  if (typeof localStorage === 'undefined') return null

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (parsed?.version !== CURRENT_VERSION) return null
    if (!PERFORMANCE_PROFILES[parsed?.profile]) return null

    return {
      ...parsed,
      mode: parsed.mode || 'auto',
      settings: getSettings(parsed.profile),
    }
  } catch {
    return null
  }
}

export function savePerformanceConfig(config) {
  if (typeof localStorage === 'undefined' || !config) return config

  const normalized = createConfig(config.profile, config.score, config.mode || 'auto')
  normalized.testedAt = config.testedAt || normalized.testedAt

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // Storage can fail in private mode; the app must continue.
  }

  return normalized
}

export function clearPerformanceConfig() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}

function detectStaticScore() {
  const nav = safeNavigator()
  const win = safeWindow()
  const cores = Number(nav.hardwareConcurrency) || 2
  const memory = Number(nav.deviceMemory) || 4
  const connection = nav.connection || nav.mozConnection || nav.webkitConnection || {}
  const reducedMotion = Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const dpr = Number(win.devicePixelRatio) || 1
  const width = Number(win.innerWidth) || 390
  const height = Number(win.innerHeight) || 760
  const effectiveType = String(connection.effectiveType || '')
  const saveData = Boolean(connection.saveData)

  let score = 48
  score += clamp(cores, 1, 8) * 4
  score += clamp(memory, 1, 8) * 4
  if (width * height >= 1200 * 800) score += 5
  if (dpr >= 2.5 && memory <= 3) score -= 7
  if (effectiveType.includes('2g')) score -= 12
  if (effectiveType.includes('3g')) score -= 6
  if (saveData) score -= 10
  if (reducedMotion) score -= 7

  return clamp(score, 10, 90)
}

async function measureFrames(durationMs = 900) {
  if (typeof requestAnimationFrame !== 'function') return { fps: 45, worstFrame: 22 }

  return new Promise((resolve) => {
    const start = performance.now()
    let last = start
    let frames = 0
    let worstFrame = 0

    const step = (now) => {
      frames += 1
      worstFrame = Math.max(worstFrame, now - last)
      last = now

      if (now - start >= durationMs) {
        const elapsed = Math.max(1, now - start)
        resolve({
          fps: Math.round((frames * 1000) / elapsed),
          worstFrame,
        })
        return
      }

      requestAnimationFrame(step)
    }

    requestAnimationFrame(step)
  })
}

function measureJavaScriptLoop() {
  const start = performance.now()
  let total = 0

  for (let i = 0; i < 90000; i += 1) {
    total += Math.sqrt(i % 997)
  }

  const duration = performance.now() - start
  return { duration, total }
}

function profileFromScore(score) {
  if (score < 45) return 'low'
  if (score < 72) return 'medium'
  return 'high'
}

export async function runDevicePerformanceTest() {
  try {
    const staticScore = detectStaticScore()
    await new Promise((resolve) => setTimeout(resolve, 120))
    const frames = await measureFrames(900)
    await new Promise((resolve) => setTimeout(resolve, 80))
    const js = measureJavaScriptLoop()

    let score = staticScore
    score += clamp(frames.fps - 45, -20, 20)
    if (frames.worstFrame > 80) score -= 12
    if (frames.worstFrame > 130) score -= 8
    if (js.duration > 18) score -= 8
    if (js.duration > 35) score -= 10

    score = clamp(score, 10, 100)
    return createConfig(profileFromScore(score), score, 'auto')
  } catch {
    return getFallbackPerformanceConfig()
  }
}

export function createManualPerformanceConfig(profile) {
  const safeProfile = PERFORMANCE_PROFILES[profile] ? profile : 'medium'
  const score = safeProfile === 'high' ? 86 : safeProfile === 'low' ? 30 : 58
  return createConfig(safeProfile, score, safeProfile)
}

export function shouldDegradePerformance(currentProfile, samples) {
  if (!Array.isArray(samples) || samples.length < 5) return null
  if (currentProfile === 'low') return null

  const recent = samples.slice(-8)
  const poorFrames = recent.filter((sample) => sample.fps < 34 || sample.worstFrame > 90).length
  if (poorFrames < 5) return null

  return currentProfile === 'high' ? 'medium' : 'low'
}

export function getPerformanceStorageKey() {
  return STORAGE_KEY
}
