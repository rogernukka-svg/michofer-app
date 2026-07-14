import { useEffect, useMemo, useState } from 'react'
import { readPerformanceConfig } from '../lib/performanceProfile'
import { usePerformanceProfile } from '../hooks/usePerformanceProfile'

const BOOT_MESSAGES = [
  'Preparando tu experiencia',
  'Optimizando el mapa',
  'Configurando la navegación',
  'Adaptando MiChofer a tu dispositivo',
]

export default function PerformanceBootstrap({ children }) {
  const { isTesting, runPerformanceTest } = usePerformanceProfile()
  const [ready, setReady] = useState(() => Boolean(readPerformanceConfig()))
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    if (ready) return undefined

    let cancelled = false
    runPerformanceTest()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [ready, runPerformanceTest])

  useEffect(() => {
    if (ready) return undefined
    const interval = window.setInterval(() => {
      setMessageIndex((value) => (value + 1) % BOOT_MESSAGES.length)
    }, 520)
    return () => window.clearInterval(interval)
  }, [ready])

  const message = useMemo(() => BOOT_MESSAGES[messageIndex], [messageIndex])

  if (!ready || isTesting) {
    return (
      <main className="performance-bootstrap" aria-live="polite">
        <div className="performance-bootstrap-mark">
          <span />
          <strong>MiChofer</strong>
        </div>
        <div className="performance-bootstrap-copy">
          <h1>{message}</h1>
          <p>Un momento, estamos dejando todo listo.</p>
        </div>
        <div className="performance-bootstrap-progress" aria-hidden="true">
          <i />
        </div>
      </main>
    )
  }

  return children
}
