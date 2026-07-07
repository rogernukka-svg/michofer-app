import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronLeft, FileCheck2, UploadCloud } from 'lucide-react'
import { signInWithGoogle, supabase, upsertOwnDriverProfile, upsertOwnProfile } from '../lib/supabase'

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

const DRIVER_DOCUMENT_REQUIREMENTS = [
  {
    key: 'driver_license',
    label: 'Licencia de conducir',
    helper: 'Vigente y habilitada para conducir.',
    required: true,
  },
  {
    key: 'identity_document',
    label: 'Cedula / DNI',
    helper: 'Documento de identidad claro y legible.',
    required: true,
  },
  {
    key: 'criminal_record',
    label: 'Antecedentes',
    helper: 'Certificado policial, penal o judicial reciente.',
    required: true,
  },
  {
    key: 'ruc_certificate',
    label: 'Constancia de RUC',
    helper: 'Necesaria para facturacion de ganancias.',
    required: true,
  },
  {
    key: 'vehicle_insurance',
    label: 'Seguro vigente',
    helper: 'Poliza del vehiculo al dia.',
    required: true,
  },
  {
    key: 'vehicle_registration',
    label: 'Habilitacion',
    helper: 'Permiso de circulacion o habilitacion de rodados.',
    required: true,
  },
  {
    key: 'vehicle_document',
    label: 'Documento del vehiculo',
    helper: 'Cedula verde, titulo o certificado del automotor.',
    required: true,
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

function sanitizeFileName(value) {
  return String(value || 'documento')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

async function uploadDriverDocuments(userId, documentFiles, avatarUrl) {
  const uploaded = {}
  const now = new Date().toISOString()

  if (avatarUrl) {
    uploaded.driver_profile_photo = {
      name: 'Foto de perfil',
      url: avatarUrl,
      uploadedAt: now,
    }
  }

  for (const doc of DRIVER_DOCUMENT_REQUIREMENTS) {
    const file = documentFiles[doc.key]
    if (!file) continue

    const extension = file.name.split('.').pop() || 'file'
    const filePath = `${userId}/${doc.key}-${Date.now()}.${sanitizeFileName(extension)}`

    const { error } = await supabase.storage
      .from('driver-documents')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || undefined,
      })

    if (error) throw error

    uploaded[doc.key] = {
      name: file.name,
      path: filePath,
      type: file.type || '',
      size: file.size,
      uploadedAt: now,
    }
  }

  return uploaded
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
  const [driverDocumentFiles, setDriverDocumentFiles] = useState({})
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
    if (step === 'role') return '¿Cómo querés usar MiChofer?'
    if (step === 'photo') return role === 'driver' ? 'Verificación de chofer' : 'Tu perfil'
    if (step === 'documents') return 'Documentos de chofer'
    if (step === 'email') return 'Tu correo'
    if (step === 'password') return 'Creá tu clave'
    if (step === 'loading') return 'Creando cuenta...'

    return 'MiChofer'
  }, [step, knownUser, role])

  const subtitle = useMemo(() => {
    if (knownUser?.email && step === 'start') return 'Este dispositivo ya usó MiChofer.'
    if (step === 'start') return 'Entrá con Google o completá tus datos.'
    if (step === 'name') return 'Decinos cómo querés aparecer.'
    if (step === 'role') return 'Elegí tu modo para continuar.'
    if (step === 'photo') {
      return role === 'driver'
        ? 'Tu foto ayuda a que el pasajero viaje con confianza.'
        : 'Podés agregar una foto ahora o seguir sin cargarla.'
    }
    if (step === 'documents') return 'Cargá los documentos basicos para revision del administrador.'
    if (step === 'email') return 'Con este correo vas a entrar.'
    if (step === 'password') return 'Rápido, simple y seguro.'
    return ''
  }, [step, knownUser, role])

  const polishedTitle = useMemo(() => {
    if (knownUser?.email && step === 'start') {
      const firstName = knownUser.name?.split(' ')[0] || ''
      return firstName ? `Hola ${firstName}` : 'Bienvenido'
    }

    if (step === 'start') return 'Crear cuenta'
    if (step === 'name') return 'Tu nombre'
    if (step === 'role') return 'Elegir perfil'
    if (step === 'photo') return role === 'driver' ? 'Verificacion' : 'Tu foto'
    if (step === 'documents') return 'Documentos'
    if (step === 'email') return 'Tu correo'
    if (step === 'password') return 'Crear clave'
    if (step === 'loading') return 'Creando cuenta...'

    return title
  }, [step, knownUser, role, title])

  const polishedSubtitle = useMemo(() => {
    if (knownUser?.email && step === 'start') return 'Usa tu cuenta guardada o cambia de usuario.'
    if (step === 'start') return 'Un perfil claro para viajar o manejar.'
    if (step === 'name') return 'Como queres aparecer en MiChofer.'
    if (step === 'role') return 'Esto ordena tu experiencia dentro de la app.'
    if (step === 'photo') return role === 'driver'
      ? 'Tu foto aumenta confianza antes del primer viaje.'
      : 'Opcional. Podes cargarla despues.'
    if (step === 'documents') return 'Licencia, cedula, antecedentes, RUC y datos del vehiculo.'
    if (step === 'email') return 'Lo vas a usar para entrar.'
    if (step === 'password') return 'Minimo 6 caracteres.'
    if (step === 'loading') return 'Guardando tu perfil...'

    return subtitle
  }, [step, knownUser, role, subtitle])

  const registerSteps = useMemo(
    () => (role === 'driver'
      ? ['name', 'role', 'photo', 'documents', 'email', 'password']
      : ['name', 'role', 'photo', 'email', 'password']),
    [role]
  )
  const registerStepIndex = Math.max(0, registerSteps.indexOf(step))
  const showRegisterProgress = registerSteps.includes(step)
  const canGoBack = !['start', 'loading'].includes(step)

  function clearRememberedAccount() {
    localStorage.removeItem('michofer_last_email')
    localStorage.removeItem('michofer_last_name')
    localStorage.removeItem('michofer_last_photo')
    localStorage.removeItem('michofer_last_role')
    setKnownUser(null)
  }

  function handleBack() {
    setErrorMessage('')

    if (step === 'name') {
      setStep('start')
      return
    }

    if (step === 'role') {
      setStep('name')
      return
    }

    if (step === 'photo') {
      setStep('role')
      return
    }

    if (step === 'documents') {
      setStep('photo')
      return
    }

    if (step === 'email') {
      setStep(role === 'driver' ? 'documents' : 'photo')
      return
    }

    if (step === 'password') {
      setStep('email')
      return
    }

    setStep('start')
  }

  function updateDriverDocument(key, file) {
    setDriverDocumentFiles((current) => {
      const next = { ...current }

      if (file) {
        next[key] = file
      } else {
        delete next[key]
      }

      return next
    })
  }

  function nextFromDriverDocuments() {
    setErrorMessage('')

    const missing = DRIVER_DOCUMENT_REQUIREMENTS.filter((doc) => doc.required && !driverDocumentFiles[doc.key])

    if (missing.length > 0) {
      setErrorMessage(`Faltan documentos obligatorios: ${missing.map((doc) => doc.label).join(', ')}.`)
      return
    }

    setStep('email')
  }

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

    if (role === 'driver') {
      const missingDocs = DRIVER_DOCUMENT_REQUIREMENTS.filter((doc) => doc.required && !driverDocumentFiles[doc.key])

      if (missingDocs.length > 0) {
        setErrorMessage(`Faltan documentos obligatorios: ${missingDocs.map((doc) => doc.label).join(', ')}.`)
        setStep('documents')
        return
      }
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

          let uploadedDocuments = {}

          try {
            uploadedDocuments = await uploadDriverDocuments(userId, driverDocumentFiles, avatarUrl)
          } catch (documentError) {
            console.error('DRIVER DOCUMENT UPLOAD ERROR:', documentError)
            setErrorMessage(
              `Tu cuenta se creo, pero no pude subir los documentos: ${getSupabaseErrorMessage(documentError)}`
            )
            setStep('documents')
            return
          }

          const { error: driverDocumentsError } = await supabase
            .from('driver_profiles')
            .update({
              documents: uploadedDocuments,
              verification_status: 'submitted',
              verified: false,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)

          if (driverDocumentsError) {
            console.error('DRIVER DOCUMENTS SAVE ERROR:', driverDocumentsError)
            setErrorMessage(
              `Los documentos subieron, pero no pude guardar la revision del chofer: ${getSupabaseErrorMessage(driverDocumentsError)}`
            )
            setStep('documents')
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
          {canGoBack && (
            <button
              type="button"
              className="auth-panel-back"
              onClick={handleBack}
              aria-label="Volver"
            >
              <ChevronLeft size={25} strokeWidth={2.4} />
            </button>
          )}

          <div className="login-spacer" />

          {showRegisterProgress && (
            <div className="auth-progress" aria-label="Progreso de registro">
              {registerSteps.map((item, index) => (
                <span
                  key={item}
                  className={index <= registerStepIndex ? 'active' : ''}
                />
              ))}
            </div>
          )}

          <div className="auth-flow-kicker">
            {step === 'start'
              ? (knownUser?.email ? 'Cuenta encontrada' : 'Nuevo perfil')
              : `Paso ${registerStepIndex + 1} de ${registerSteps.length}`}
          </div>

          <h1>{polishedTitle}</h1>

          <p className="login-subtitle">{polishedSubtitle}</p>

          {errorMessage && (
            <div className="login-error-message">
              {errorMessage}
            </div>
          )}

          {step === 'start' && (
            <div className="auth-action-stack">
              {knownUser?.email ? (
                <>
                  <button
                    type="button"
                    className="login-main-btn"
                    onClick={() => {
                      window.location.href =
                        '/login?email=' + encodeURIComponent(knownUser.email)
                    }}
                  >
                    Continuar como {knownUser.name?.split(' ')[0] || knownUser.email}
                  </button>

                  <button
                    type="button"
                    className="login-google-btn login-google-btn-primary"
                    onClick={() => {
                      clearRememberedAccount()
                      handleGoogleRegister()
                    }}
                    disabled={busy}
                  >
                    <span className="google-mark" aria-hidden="true" />
                    {busy ? 'Conectando...' : 'Entrar con Google'}
                  </button>

                  <button
                    type="button"
                    className="login-create-link"
                    onClick={() => {
                      clearRememberedAccount()
                      setStep('name')
                    }}
                  >
                    Crear cuenta nueva
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="login-google-btn login-google-btn-primary"
                    onClick={handleGoogleRegister}
                    disabled={busy}
                  >
                    <span className="google-mark" aria-hidden="true" />
                    {busy ? 'Conectando...' : 'Continuar con Google'}
                  </button>

                  <a className="login-create-link" href="/login">
                    Ya tengo cuenta
                  </a>

                  <button
                    type="button"
                    className="login-main-btn auth-mail-btn"
                    onClick={() => setStep('name')}
                  >
                    Crear con correo
                  </button>
                </>
              )}
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
            </form>
          )}

          {step === 'role' && (
            <div className="login-step-form">
              <button
                type="button"
                className="login-choice-btn auth-choice-card"
                onClick={() => nextFromRole('passenger')}
              >
                <strong>Pasajero</strong>
                <small>Pedir viajes y seguir tu recorrido.</small>
              </button>

              <button
                type="button"
                className="login-choice-btn auth-choice-card"
                onClick={() => nextFromRole('driver')}
              >
                <strong>Chofer</strong>
                <small>Recibir solicitudes y gestionar viajes.</small>
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
                      onClick={() => setStep(role === 'driver' ? 'documents' : 'email')}
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
                    onClick={() => setStep(role === 'driver' ? 'documents' : 'email')}
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

            </div>
          )}

          {step === 'documents' && (
            <div className="login-step-form driver-documents-step">
              <div className="driver-documents-intro">
                <FileCheck2 size={19} />
                <div>
                  <strong>Revision profesional</strong>
                  <span>Subi fotos o PDF legibles. Admin revisa todo antes de habilitar viajes.</span>
                </div>
              </div>

              <div className="driver-documents-grid">
                <div className="driver-document-card driver-document-card-ready">
                  <div>
                    <CheckCircle2 size={17} />
                    <strong>Foto de perfil</strong>
                  </div>
                  <span>Tomada en el paso anterior</span>
                </div>

                {DRIVER_DOCUMENT_REQUIREMENTS.map((doc) => {
                  const file = driverDocumentFiles[doc.key]

                  return (
                    <label
                      className={file ? 'driver-document-card uploaded' : 'driver-document-card'}
                      key={doc.key}
                    >
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        onChange={(event) => updateDriverDocument(doc.key, event.target.files?.[0] || null)}
                      />

                      <div>
                        <UploadCloud size={17} />
                        <strong>{doc.label}</strong>
                      </div>

                      <span>{file ? file.name : doc.helper}</span>
                    </label>
                  )
                })}
              </div>

              <button
                type="button"
                className="login-main-btn"
                onClick={nextFromDriverDocuments}
              >
                Continuar
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

              <p className="auth-terms-copy">
                Al continuar aceptás los <a href="/terms">Terminos</a> y la{' '}
                <a href="/privacy">Politica de Privacidad</a>.
              </p>

              <button
                className="login-main-btn"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Creando...' : 'Crear cuenta'}
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
