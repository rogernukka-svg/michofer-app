import { ArrowLeft } from 'lucide-react'
import { useMemo } from 'react'

export default function LegalLayout({ children }) {
  const backUrl = useMemo(() => {
    // Si el usuario vino desde el panel de chofer, volver ahí.
    if (document.referrer.includes('/driver')) {
      return '/driver'
    }
    // Por defecto, volver al panel de cliente.
    return '/client'
  }, [])

  return (
    <div className="legal-screen">
      <div className="legal-shell">
        <a href={backUrl} className="legal-back">
          <ArrowLeft size={18} /> Volver a la app
        </a>

        <div className="legal-card">
          {children}
        </div>
      </div>
    </div>
  )
}