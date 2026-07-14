import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createManualPerformanceConfig,
  getFallbackPerformanceConfig,
  PROFILE_LABELS,
  readPerformanceConfig,
  runDevicePerformanceTest,
  savePerformanceConfig,
  shouldDegradePerformance,
} from '../lib/performanceProfile'

const PerformanceContext = createContext(null)

function applyPerformanceDataset(config) {
  if (typeof document === 'undefined') return
  const profile = config?.profile || 'medium'
  document.documentElement.dataset.performance = profile
  document.documentElement.dataset.performanceMode = config?.mode || 'auto'
}

function measureRuntimeFrame(callback) {
  if (typeof requestAnimationFrame !== 'function') return () => {}

  let active = true
  let last = performance.now()
  let frames = 0
  let worstFrame = 0
  let windowStart = last
  let rafId = 0

  const loop = (now) => {
    if (!active) return

    frames += 1
    worstFrame = Math.max(worstFrame, now - last)
    last = now

    if (now - windowStart >= 3200) {
      const fps = Math.round((frames * 1000) / Math.max(1, now - windowStart))
      callback({ fps, worstFrame })
      frames = 0
      worstFrame = 0
      windowStart = now
    }

    rafId = requestAnimationFrame(loop)
  }

  rafId = requestAnimationFrame(loop)

  return () => {
    active = false
    if (rafId) cancelAnimationFrame(rafId)
  }
}

export function PerformanceProvider({ children }) {
  const initialConfig = readPerformanceConfig()
  const [config, setConfig] = useState(initialConfig)
  const [isTesting, setIsTesting] = useState(false)
  const [slowNotice, setSlowNotice] = useState(false)
  const runtimeSamplesRef = useRef([])
  const degradeLockRef = useRef(false)

  useEffect(() => {
    applyPerformanceDataset(config || getFallbackPerformanceConfig())
  }, [config])

  const runPerformanceTest = useCallback(async ({ force = false } = {}) => {
    if (!force) {
      const saved = readPerformanceConfig()
      if (saved) {
        setConfig(saved)
        applyPerformanceDataset(saved)
        return saved
      }
    }

    setIsTesting(true)
    const nextConfig = await runDevicePerformanceTest()
    const savedConfig = savePerformanceConfig(nextConfig)
    setConfig(savedConfig)
    applyPerformanceDataset(savedConfig)
    setIsTesting(false)
    setSlowNotice(false)
    return savedConfig
  }, [])

  const setManualProfile = useCallback((nextMode) => {
    if (nextMode === 'auto') {
      const current = config || getFallbackPerformanceConfig()
      const nextConfig = savePerformanceConfig({ ...current, mode: 'auto' })
      setConfig(nextConfig)
      setSlowNotice(false)
      return nextConfig
    }

    const nextConfig = savePerformanceConfig(createManualPerformanceConfig(nextMode))
    setConfig(nextConfig)
    setSlowNotice(false)
    return nextConfig
  }, [config])

  useEffect(() => {
    const stop = measureRuntimeFrame((sample) => {
      const current = config || getFallbackPerformanceConfig()
      if (current.mode !== 'auto' || degradeLockRef.current) return

      runtimeSamplesRef.current = [...runtimeSamplesRef.current, sample].slice(-10)
      const degradedProfile = shouldDegradePerformance(current.profile, runtimeSamplesRef.current)

      if (!degradedProfile) {
        if (sample.fps < 32 || sample.worstFrame > 120) setSlowNotice(true)
        return
      }

      degradeLockRef.current = true
      const score = degradedProfile === 'low' ? 34 : 60
      const nextConfig = savePerformanceConfig({
        version: current.version,
        mode: 'auto',
        profile: degradedProfile,
        score,
        testedAt: new Date().toISOString(),
      })
      setConfig(nextConfig)
      setSlowNotice(true)

      window.setTimeout(() => {
        degradeLockRef.current = false
        runtimeSamplesRef.current = []
      }, 90000)
    })

    return stop
  }, [config])

  const value = useMemo(() => {
    const safeConfig = config || getFallbackPerformanceConfig()

    return {
      config: safeConfig,
      profile: safeConfig.profile,
      profileLabel: PROFILE_LABELS[safeConfig.profile] || PROFILE_LABELS.medium,
      mode: safeConfig.mode || 'auto',
      settings: safeConfig.settings,
      score: safeConfig.score,
      testedAt: safeConfig.testedAt,
      isTesting,
      slowNotice,
      dismissSlowNotice: () => setSlowNotice(false),
      runPerformanceTest,
      setManualProfile,
    }
  }, [config, isTesting, runPerformanceTest, setManualProfile, slowNotice])

  return (
    <PerformanceContext.Provider value={value}>
      {children}
    </PerformanceContext.Provider>
  )
}

export function usePerformanceProfile() {
  const context = useContext(PerformanceContext)
  if (!context) {
    throw new Error('usePerformanceProfile debe usarse dentro de PerformanceProvider')
  }
  return context
}
