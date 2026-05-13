import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import logo from '../assets/logo.png'

export default function Register() {
  const [step, setStep] = useState('name')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [knownUser, setKnownUser] = useState(null)

  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraMessage, setCameraMessage] = useState('Preparando cámara...')
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    const savedEmail = localStorage.getItem('michofer_last_email')
    const savedName = localStorage.getItem('michofer_last_name')

    if (savedEmail) {
      setKnownUser({
        email: savedEmail,
        name: savedName || '',
      })
    }

    return () => closeCamera()
  }, [])

  const title = useMemo(() => {
    if (knownUser?.email && step === 'name') {
      return `👋 Hola ${knownUser.name?.split(' ')[0] || ''}`
    }

    if (step === 'name') return 'Empecemos rápido.'
    if (step === 'role') return '¿Cómo usarás michofer?'
    if (step === 'photo') return 'Queremos conocerte 👌'
    if (step === 'email') return 'Tu correo'
    if (step === 'password') return 'Creá tu clave'
    if (step === 'loading') return 'Creando cuenta...'

    return 'MiChofer'
  }, [step, knownUser])

  const subtitle = useMemo(() => {
    if (knownUser?.email && step === 'name') return 'Este dispositivo ya usó MiChofer.'
    if (step === 'name') return 'Tu movilidad empieza acá.'
    if (step === 'role') return 'Elegí tu experiencia.'
    if (step === 'photo') return 'Tu foto ayuda a generar confianza.'
    if (step === 'email') return 'Con este correo vas a entrar.'
    if (step === 'password') return 'Rápido, simple y seguro.'
    return ''
  }, [step, knownUser])

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase()
  }

  async function openCamera() {
    try {
      setCameraOpen(true)
      setCameraReady(false)
      setCameraMessage('Activando cámara...')

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 720 },
          height: { ideal: 960 },
        },
        audio: false,
      })

      streamRef.current = stream

      setTimeout(async () => {
        if (!videoRef.current) return

        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        videoRef.current.playsInline = true

        await videoRef.current.play()

        setCameraReady(true)
        setCameraMessage('Mirá de frente. Sin kepis, lentes oscuros ni rostro tapado.')
      }, 150)
    } catch (err) {
      console.error(err)
      setCameraOpen(false)
      alert('Permití el acceso a la cámara para continuar.')
    }
  }

  function closeCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    setCameraOpen(false)
    setCameraReady(false)
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) {
      alert('La cámara todavía no está lista')
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current

    if (!video.videoWidth || !video.videoHeight) {
      alert('Esperá un segundo y probá otra vez')
      return
    }

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          alert('No pude capturar la foto')
          return
        }

        const file = new File([blob], `michofer-selfie-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        })

        setPhotoFile(file)
        setPhotoPreview(URL.createObjectURL(blob))
        closeCamera()
      },
      'image/jpeg',
      0.92
    )
  }

  function nextFromName(e) {
    e.preventDefault()

    if (!fullName.trim()) {
      alert('Escribí tu nombre')
      return
    }

    setStep('role')
  }

  function nextFromRole(value) {
    setRole(value)
    setStep('photo')
  }

  function nextFromEmail(e) {
    e.preventDefault()

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !cleanEmail.includes('@')) {
      alert('Poné un correo válido')
      return
    }

    setEmail(cleanEmail)
    setStep('password')
  }

  async function handleRegister(e) {
    e.preventDefault()

    const cleanEmail = normalizeEmail(email)

    if (!photoFile) {
  alert('Sacá tu foto para continuar')
  return
}

if (!password || password.length < 6) {
  alert('La clave debe tener al menos 6 caracteres')
  return
}

    try {
      setBusy(true)
      setStep('loading')

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
      })

      if (error) {
  console.error('SUPABASE SIGNUP ERROR:', error)

  alert(
    error.message ||
    error.error_description ||
    'No se pudo crear la cuenta'
  )

  setStep('password')
  return
}

      const userId = data.user?.id

      let avatarUrl = ''

if (userId && photoFile) {
  const fileExt = photoFile.name.split('.').pop()
  const filePath = `${userId}/avatar-${Date.now()}.${fileExt}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, photoFile, {
      cacheControl: '3600',
      upsert: true,
    })

  if (uploadError) {
    console.error(uploadError)
    alert('No se pudo subir la foto')
    setStep('photo')
    return
  }

  const { data: publicUrlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath)

  avatarUrl = publicUrlData.publicUrl

  await supabase.from('profiles').upsert(
  {
    id: userId,
    full_name: fullName,
    role,
    email: cleanEmail,
    avatar_url: avatarUrl,
    updated_at: new Date().toISOString(),
  },
  { onConflict: 'id' }
)
}

      localStorage.setItem('michofer_last_email', cleanEmail)
      localStorage.setItem('michofer_last_name', fullName)
      localStorage.setItem('michofer_last_role', role)

      if (avatarUrl) {
  localStorage.setItem('michofer_last_photo', avatarUrl)
}
await supabase.auth.updateUser({
  data: {
    full_name: fullName,
    avatar_url: avatarUrl,
    role,
  },
})

const targetRole = role || 'passenger'

localStorage.setItem('michofer_last_role', targetRole)

if (targetRole === 'driver') {
  window.location.replace('/driver')
  return
}

window.location.replace('/client')
    } catch (err) {
      console.error(err)
      alert('No se pudo crear la cuenta')
      setStep('password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-phone">
        <div className="login-panel">
          <div className="login-hero-logo">
            <img src={logo} alt="MiChofer" />
          </div>

          <div className="login-spacer" />

          <h1>{title}</h1>

          <p className="login-subtitle">{subtitle}</p>

          {knownUser?.email && step === 'name' && (
            <button
              type="button"
              className="login-main-btn"
              onClick={() => {
                window.location.href =
                  '/login?email=' + encodeURIComponent(knownUser.email)
              }}
            >
              Sí, soy yo
            </button>
          )}

          {step === 'name' && (
            <form className="login-step-form" onSubmit={nextFromName}>
              <input
                autoFocus
                placeholder="Tu nombre"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />

              <button className="login-main-btn" type="submit">
                Continuar
              </button>
            </form>
          )}

          {step === 'role' && (
            <div className="login-step-form">
              <button
                type="button"
                className="login-choice-btn"
                onClick={() => nextFromRole('passenger')}
              >
                Necesito viajar
              </button>

              <button
                type="button"
                className="login-choice-btn"
                onClick={() => nextFromRole('driver')}
              >
                Soy chofer
              </button>

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('name')}
              >
                ← Atrás
              </button>
            </div>
          )}

          {step === 'photo' && (
            <div className="login-step-form">
              {photoPreview ? (
                <img
                  src={photoPreview}
                  alt="Foto"
                  className="register-photo-preview"
                />
              ) : (
                <div className="register-photo-box">
                  <span className="photo-icon">📷</span>

                  <strong>Verificación facial</strong>

                  <small>
                    Usá la cámara frontal. Sin kepis, lentes oscuros ni rostro tapado.
                  </small>

                  <button
                    type="button"
                    className="login-main-btn"
                    onClick={openCamera}
                  >
                    Abrir cámara
                  </button>
                </div>
              )}

              {photoPreview && (
                <button
                  type="button"
                  className="login-main-btn"
                  onClick={() => setStep('email')}
                >
                  Continuar
                </button>
              )}

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('role')}
              >
                ← Atrás
              </button>
            </div>
          )}

          {step === 'email' && (
            <form className="login-step-form" onSubmit={nextFromEmail}>
              <input
                autoFocus
                placeholder="Tu correo"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <button className="login-main-btn" type="submit">
                Continuar
              </button>

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('photo')}
              >
                ← Atrás
              </button>
            </form>
          )}

          {step === 'password' && (
            <form className="login-step-form" onSubmit={handleRegister}>
              <div className="login-recognized-pill">{email}</div>

              <div className="password-box">
                <input
                  autoFocus
                  placeholder="Tu clave"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? '🙈' : '👁'}
                </button>
              </div>

              <button
                className="login-main-btn"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Creando...' : 'Crear cuenta'}
              </button>

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('email')}
              >
                ← Atrás
              </button>
            </form>
          )}

          {step === 'loading' && (
            <div className="login-loading-box">
              <div className="login-spinner" />
            </div>
          )}
        </div>
      </div>

      {cameraOpen && (
        <div className="camera-modal">
          <div className="camera-card">
            <div className="camera-frame">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="camera-video"
              />

              <div className="camera-face-guide" />
            </div>

            <canvas ref={canvasRef} className="camera-canvas" />

            <p className="camera-message">{cameraMessage}</p>

            <button
              type="button"
              className="login-main-btn"
              onClick={capturePhoto}
              disabled={!cameraReady}
            >
              Sacar foto
            </button>

            <button
              type="button"
              className="login-text-btn"
              onClick={closeCamera}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}