import { useEffect, useMemo, useRef, useState } from 'react'
import { signInWithGoogle, supabase, upsertOwnDriverProfile, upsertOwnProfile } from '../lib/supabase'
import logo from '../assets/logo.png'

const CAMERA_CONSTRAINTS = [
  {
    video: {
      facingMode: { ideal: 'user' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  },
  {
    video: {
      facingMode: 'user',
    },
    audio: false,
  },
  {
    video: true,
    audio: false,
  },
]

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function makeCameraErrorMessage(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return 'Chrome no tiene permiso para usar la cámara. Permití el acceso desde el icono de la barra de direcciones.'
  }

  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return 'No encontré una cámara disponible en este dispositivo.'
  }

  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return 'La cámara está ocupada por otra app. Cerrá Zoom, Meet, WhatsApp Web u otra pestaña y probá de nuevo.'
  }

  if (error?.name === 'OverconstrainedError') {
    return 'La cámara no soporta la configuración pedida. Probá de nuevo con la opción automática.'
  }

  if (error?.name === 'AbortError' || error?.name === 'CameraTimeoutError') {
    return 'La cámara tardó demasiado en iniciar. Cerrá otras apps que la usen, recargá la página o subí una foto.'
  }

  return 'No pude abrir la cámara. Probá de nuevo o subí una foto desde tu equipo.'
}

function getSupabaseErrorMessage(error) {
  return (
    error?.message ||
    error?.error_description ||
    error?.details ||
    'Error desconocido'
  )
}

function getSignupErrorMessage(error) {
  const message = getSupabaseErrorMessage(error)
  const normalized = message.toLowerCase()

  if (normalized.includes('email rate limit')) {
    return 'Supabase bloqueó nuevos correos por límite de email. Esperá el cooldown o desactivá Confirm email en Authentication > Providers > Email para probar en desarrollo.'
  }

  if (normalized.includes('already registered') || normalized.includes('already exists')) {
    return 'Ese correo ya tiene cuenta. Entrá desde Login con ese correo.'
  }

  if (normalized.includes('password')) {
    return message
  }

  if (message === 'Failed to fetch') {
    return 'No pude conectar con Supabase. Revisá la conexión, el Project URL en .env y reiniciá Vite.'
  }

  return message || 'No se pudo crear la cuenta.'
}

function getStorageUploadErrorMessage(error) {
  const message = getSupabaseErrorMessage(error)
  const normalized = message.toLowerCase()

  if (normalized.includes('database schema is invalid or incompatible')) {
    return 'Storage rechazó la foto por policies/schema del bucket avatars. Ejecutá supabase/fix_avatar_storage_policies.sql en Supabase SQL Editor y probá de nuevo.'
  }

  if (normalized.includes('row-level security') || normalized.includes('violates row-level security')) {
    return 'Storage bloqueó la foto por RLS. Ejecutá supabase/fix_avatar_storage_policies.sql y verificá que estés logueado.'
  }

  return `No pude subir la foto a Supabase Storage: ${message}`
}

function shouldFallbackAvatarToProfile(error) {
  const message = getSupabaseErrorMessage(error).toLowerCase()
  return (
    message.includes('database schema is invalid or incompatible') ||
    message.includes('row-level security') ||
    message.includes('violates row-level security')
  )
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function savePendingRegistration({ email, fullName, role, photoFile }) {
  const avatarDataUrl = photoFile ? await readFileAsDataUrl(photoFile) : ''

  localStorage.setItem(
    'michofer_pending_registration',
    JSON.stringify({
      email,
      fullName,
      role,
      avatarDataUrl,
      avatarName: photoFile?.name || `michofer-avatar-${Date.now()}.jpg`,
      avatarType: photoFile?.type || 'image/jpeg',
      createdAt: Date.now(),
    })
  )

  localStorage.setItem('michofer_last_email', email)
  localStorage.setItem('michofer_last_name', fullName)
  localStorage.setItem('michofer_last_role', role || 'passenger')
}

export default function Register() {
  const [step, setStep] = useState('start')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [knownUser, setKnownUser] = useState(null)
  const [errorMessage, setErrorMessage] = useState('')

  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const [cameraMessage, setCameraMessage] = useState('Preparando cámara...')
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const fileInputRef = useRef(null)

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

  useEffect(() => {
    return () => {
      if (photoPreview?.startsWith('blob:')) {
        URL.revokeObjectURL(photoPreview)
      }
    }
  }, [photoPreview])

  const title = useMemo(() => {
    if (knownUser?.email && step === 'start') {
      const firstName = knownUser.name?.split(' ')[0] || ''
      return firstName ? `Hola ${firstName}` : 'Bienvenido'
    }

    if (step === 'start') return 'Crea tu cuenta.'
    if (step === 'name') return 'Tu nombre'
    if (step === 'role') return 'Como queres usar MiChofer'
    if (step === 'photo') return role === 'driver' ? 'Verificación de chofer' : 'Tu perfil'
    if (step === 'email') return 'Tu correo'
    if (step === 'password') return 'Creá tu clave'
    if (step === 'loading') return 'Creando cuenta...'

    return 'MiChofer'
  }, [step, knownUser, role])

  const subtitle = useMemo(() => {
    if (knownUser?.email && step === 'start') return 'Este dispositivo ya usó MiChofer.'
    if (step === 'start') return 'Entrá con Google o completá tus datos.'
    if (step === 'name') return 'Decinos cómo querés aparecer.'
    if (step === 'role') return 'Elegi si vas a viajar o manejar.'
    if (step === 'photo') {
      return role === 'driver'
        ? 'Tu foto ayuda a que el pasajero viaje con confianza.'
        : 'Podés agregar una foto ahora o seguir sin cargarla.'
    }
    if (step === 'email') return 'Con este correo vas a entrar.'
    if (step === 'password') return 'Rápido, simple y seguro.'
    return ''
  }, [step, knownUser, role])

  function stopCameraStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }
  }

  async function getStreamWithTimeout(constraints) {
    let timeoutId
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        const error = new Error('Timeout starting video source')
        error.name = 'CameraTimeoutError'
        reject(error)
      }, 9000)
    })

    try {
      return await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        timeout,
      ])
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  async function findCameraStream() {
    let lastError = null

    for (const constraints of CAMERA_CONSTRAINTS) {
      try {
        return await getStreamWithTimeout(constraints)
      } catch (error) {
        lastError = error
      }
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cameras = devices.filter((device) => device.kind === 'videoinput')

      for (const camera of cameras) {
        try {
          return await getStreamWithTimeout({
            video: { deviceId: { exact: camera.deviceId } },
            audio: false,
          })
        } catch (error) {
          lastError = error
        }
      }
    } catch (error) {
      lastError = error
    }

    throw lastError || new Error('No camera stream available')
  }

  async function attachStreamToVideo(stream) {
    const video = videoRef.current
    if (!video) return

    video.srcObject = stream
    video.muted = true
    video.playsInline = true

    await new Promise((resolve) => {
      if (video.readyState >= 2) {
        resolve()
        return
      }

      video.onloadedmetadata = resolve
    })

    await video.play()
  }

  async function openCamera() {
    setCameraOpen(true)
    setCameraReady(false)
    setCameraError('')
    setCameraMessage('Activando cámara...')
    stopCameraStream()

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Tu navegador no permite usar cámara en esta página.')
      setCameraMessage('Podés subir una foto desde tu equipo.')
      return
    }

    try {
      const stream = await findCameraStream()
      streamRef.current = stream

      await new Promise((resolve) => window.setTimeout(resolve, 120))
      await attachStreamToVideo(stream)

      setCameraReady(true)
      setCameraMessage('Mirá de frente. Sin kepis, lentes oscuros ni rostro tapado.')
    } catch (error) {
      console.error('CAMERA ERROR:', error)
      stopCameraStream()
      setCameraReady(false)
      setCameraError(makeCameraErrorMessage(error))
      setCameraMessage('La cámara no arrancó.')
    }
  }

  function closeCamera() {
    stopCameraStream()
    setCameraOpen(false)
    setCameraReady(false)
    setCameraError('')
  }

  function setSelectedPhoto(file) {
    if (!file) return

    if (photoPreview?.startsWith('blob:')) {
      URL.revokeObjectURL(photoPreview)
    }

    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
    closeCamera()
  }

  function handlePhotoUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setErrorMessage('')

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Elegí una imagen válida.')
      event.target.value = ''
      return
    }

    setSelectedPhoto(file)
    event.target.value = ''
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

    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    ctx.restore()

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          alert('No pude capturar la foto')
          return
        }

        const file = new File([blob], `michofer-selfie-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        })

        setSelectedPhoto(file)
      },
      'image/jpeg',
      0.92
    )
  }

  function nextFromName(e) {
    e.preventDefault()
    setErrorMessage('')

    if (!fullName.trim()) {
      setErrorMessage('Escribí tu nombre.')
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
    setErrorMessage('')

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Poné un correo válido.')
      return
    }

    setEmail(cleanEmail)
    setStep('password')
  }

  async function handleRegister(e) {
    e.preventDefault()
    setErrorMessage('')

    const cleanEmail = normalizeEmail(email)

    if (!role) {
      setErrorMessage('Elegí si vas a viajar o manejar.')
      setStep('role')
      return
    }

    if (role === 'driver' && !photoFile) {
      setErrorMessage('Sacá o subí tu foto para continuar como chofer.')
      return
    }

    if (!password || password.length < 6) {
      setErrorMessage('La clave debe tener al menos 6 caracteres.')
      return
    }

    try {
      setBusy(true)
      setStep('loading')

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: fullName,
            role,
          },
        },
      })

      if (error) {
        console.error('SUPABASE SIGNUP ERROR:', error)
        const preciseSignupMessage = getSignupErrorMessage(error)

        if (preciseSignupMessage !== getSupabaseErrorMessage(error)) {
          setErrorMessage(preciseSignupMessage)
          setStep('password')
          return
        }

        setErrorMessage(
          error.message === 'Failed to fetch'
            ? 'No pude conectar con Supabase. Revisá DNS/conexión, reiniciá Vite o esperá que el proyecto termine de propagarse.'
            : error.message ||
              error.error_description ||
              'No se pudo crear la cuenta.'
        )

        setStep('password')
        return
      }

      const userId = data.user?.id
      let activeSession = data.session || null
      let avatarUrl = ''

      if (userId && !activeSession) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        })

        if (signInError) {
          console.error('SUPABASE SIGNIN AFTER SIGNUP ERROR:', signInError)
          await savePendingRegistration({
            email: cleanEmail,
            fullName,
            role,
            photoFile,
          })
          setErrorMessage(
            'La cuenta se creó, pero todavía no pude activar este dispositivo para subir la foto. Entrá desde Login y volvé a completar la foto si hace falta.'
          )
          setStep('password')
          return
        }

        activeSession = signInData.session || null
      }

      if (userId && photoFile) {
        const fileExt = photoFile.name.split('.').pop() || 'jpg'
        const filePath = `${userId}/avatar-${Date.now()}.${fileExt}`

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, photoFile, {
            cacheControl: '3600',
            upsert: true,
          })

        if (uploadError) {
          console.error('AVATAR UPLOAD ERROR:', uploadError)
          if (shouldFallbackAvatarToProfile(uploadError)) {
            avatarUrl = await readFileAsDataUrl(photoFile)
          } else {
          setErrorMessage(getStorageUploadErrorMessage(uploadError))
          setStep('photo')
          return null
          }
          if (!avatarUrl) {
          setErrorMessage(
            `La cuenta se creó, pero no pude subir la foto a Supabase Storage: ${getSupabaseErrorMessage(uploadError)}`
          )
          setStep('photo')
          return
          }
        } else {
          const { data: publicUrlData } = supabase.storage
            .from('avatars')
            .getPublicUrl(filePath)

          avatarUrl = publicUrlData.publicUrl
        }
      }

      if (!avatarUrl && role === 'driver') {
        setErrorMessage('No pude guardar la foto del perfil. Probá cambiar la foto y continuar de nuevo.')
        setStep('photo')
        return
      }

      if (userId) {
        const { error: profileError } = await upsertOwnProfile({
          fullName,
          role,
          avatarUrl,
          email: cleanEmail,
        })

        if (profileError) {
          console.error('PROFILE UPSERT ERROR:', profileError)
          setErrorMessage(
            `La foto subió, pero no pude guardar tu perfil: ${getSupabaseErrorMessage(profileError)}`
          )
          setStep('password')
          return
        }

        if (role === 'driver') {
          const { error: driverProfileError } = await upsertOwnDriverProfile({
            fullName,
            avatarUrl,
            email: cleanEmail,
          })

          if (driverProfileError) {
            console.error('DRIVER PROFILE UPSERT ERROR:', driverProfileError)
            setErrorMessage(
              `Tu cuenta se creó, pero no pude guardar el perfil de chofer: ${getSupabaseErrorMessage(driverProfileError)}`
            )
            setStep('password')
            return
          }
        }
      }

      localStorage.setItem('michofer_last_email', cleanEmail)
      localStorage.setItem('michofer_last_name', fullName)

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
      setErrorMessage('No se pudo crear la cuenta. Revisá la conexión con Supabase.')
      setStep('password')
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogleRegister() {
    setErrorMessage('')

    try {
      setBusy(true)
      setStep('loading')

      const { error } = await signInWithGoogle()

      if (error) {
        setErrorMessage(error.message || 'No pude registrar con Google.')
        setStep('start')
      }
    } catch (err) {
      console.error(err)
      setErrorMessage('No pude registrar con Google. Revisá la configuración en Supabase.')
      setStep('start')
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

          {errorMessage && (
            <div className="login-error-message">
              {errorMessage}
            </div>
          )}

          {step === 'start' && (
            <div className="auth-action-stack">
              {knownUser?.email && (
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

              <button
                type="button"
                className="login-google-btn login-google-btn-primary"
                onClick={handleGoogleRegister}
                disabled={busy}
              >
                <span className="google-mark" aria-hidden="true" />
                {busy ? 'Conectando...' : 'Registrarme con Google'}
              </button>

              <button
                type="button"
                className="login-main-btn auth-mail-btn"
                onClick={() => setStep('name')}
              >
                Crear con correo
              </button>

              <a className="login-create-link" href="/login">
                Ya tengo cuenta
              </a>
            </div>
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

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('start')}
              >
                ← Atrás
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
                Viajar como pasajero
              </button>

              <button
                type="button"
                className="login-choice-btn"
                onClick={() => nextFromRole('driver')}
              >
                Registrarme como chofer
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

                  <strong>{role === 'driver' ? 'Verificación facial' : 'Foto opcional'}</strong>

                  <small>
                    {role === 'driver'
                      ? 'Usá la cámara frontal. Sin kepis, lentes oscuros ni rostro tapado.'
                      : 'Si preferís, podés cargarla después desde tu perfil.'}
                  </small>

                  <button
                    type="button"
                    className="login-main-btn"
                    onClick={openCamera}
                  >
                    Abrir cámara
                  </button>

                  <button
                    type="button"
                    className="login-secondary-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Subir foto
                  </button>

                  {role === 'passenger' && (
                    <button
                      type="button"
                      className="login-text-btn"
                      onClick={() => setStep('email')}
                    >
                      Omitir por ahora
                    </button>
                  )}
                </div>
              )}

              <input
                ref={fileInputRef}
                className="register-file-input"
                type="file"
                accept="image/*"
                capture="user"
                onChange={handlePhotoUpload}
              />

              {photoPreview && (
                <>
                  <button
                    type="button"
                    className="login-main-btn"
                    onClick={() => setStep('email')}
                  >
                    Continuar
                  </button>

                  <button
                    type="button"
                    className="login-secondary-btn"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Cambiar foto
                  </button>
                </>
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
                  {showPassword ? 'Ocultar' : 'Ver'}
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

            {cameraError && (
              <p className="camera-error">
                {cameraError}
              </p>
            )}

            {!cameraError ? (
              <button
                type="button"
                className="login-main-btn"
                onClick={capturePhoto}
                disabled={!cameraReady}
              >
                Sacar foto
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="login-main-btn"
                  onClick={openCamera}
                >
                  Reintentar cámara
                </button>

                <button
                  type="button"
                  className="login-secondary-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Subir foto
                </button>
              </>
            )}

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
