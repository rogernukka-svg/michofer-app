import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'

function isStandaloneMode() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '')
}

export default function InstallMiChoferButton({ className = '' }) {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    setInstalled(isStandaloneMode())
    setShowIosHint(isIosDevice() && !isStandaloneMode())

    function handleBeforeInstallPrompt(event) {
      event.preventDefault()
      setInstallPrompt(event)
    }

    function handleInstalled() {
      setInstalled(true)
      setInstallPrompt(null)
      setShowIosHint(false)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  if (installed || (!installPrompt && !showIosHint)) return null

  async function handleInstall() {
    if (installPrompt) {
      installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice?.outcome === 'accepted') {
        setInstalled(true)
      }
      setInstallPrompt(null)
      return
    }

    window.alert('En iPhone: Compartir > Agregar a pantalla de inicio.')
  }

  return (
    <button
      type="button"
      className={['install-michofer-btn', className].filter(Boolean).join(' ')}
      onClick={handleInstall}
    >
      <Download size={16} />
      Instalar MiChofer
    </button>
  )
}
