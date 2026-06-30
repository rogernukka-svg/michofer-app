import { useEffect, useMemo, useRef, useState } from 'react'
import InstallMiChoferButton from '../components/InstallMiChoferButton.jsx'
import {
  getOwnProfile,
  signInWithGoogle,
  supabase,
  upsertOwnDriverProfile,
  upsertOwnProfile,
} from '../lib/supabase'
import logo from '../assets/logo.png'

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function isAvatarImage(value) {
  const photo = String(value || '')
  return photo.startsWith('http') || photo.startsWith('data:image') || photo.startsWith('blob:')
}

function getStoredRoleForEmail(email) {
  const savedEmail = normalizeEmail(localStorage.getItem('michofer_last_email'))
  const savedRole = localStorage.getItem('michofer_last_role') || ''

  return savedEmail === normalizeEmail(email) ? savedRole : ''
}

function resolveRole(user, profile, email) {
  return (
    profile?.role ||
    user?.user_metadata?.role ||
    getStoredRoleForEmail(email) ||
    ''
  )
}

function getRoleConfirmationKey(email) {
  return `michofer_role_confirmed_${normalizeEmail(email)}`
}

function hasConfirmedRole(email, user) {
  if (user?.user_metadata?.role_confirmed === true) return true
  if (!email) return false
  return localStorage.getItem(getRoleConfirmationKey(email)) === 'true'
}

function markRoleConfirmed(email) {
  if (!email) return
  localStorage.setItem(getRoleConfirmationKey(email), 'true')
}

function isGoogleUser(user) {
  const providers = user?.app_metadata?.providers || []
  return user?.app_metadata?.provider === 'google' || providers.includes('google')
}

function shouldAskForRole({ user, profile, role, email, pendingRole }) {
  if (pendingRole) return false
  if (!role) return true
  if (role === 'driver') return false
  return isGoogleUser(user) && !hasConfirmedRole(email, user) && !profile?.phone
}

async function findStoredAvatarUrl(userId) {
  if (!userId) return ''

  const { data, error } = await supabase.storage
    .from('avatars')
    .list(userId, {
      limit: 20,
      sortBy: { column: 'created_at', order: 'desc' },
    })

  if (error || !data?.length) return ''

  const latest = data
    .filter((item) => item.name && !item.name.endsWith('/'))
    .sort((a, b) => {
      const dateA = new Date(a.updated_at || a.created_at || 0).getTime()
      const dateB = new Date(b.updated_at || b.created_at || 0).getTime()
      return dateB - dateA
    })[0]

  if (!latest) return ''

  const { data: publicUrlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(`${userId}/${latest.name}`)

  return publicUrlData?.publicUrl || ''
}

function cacheProfile({ email, fullName, role, avatarUrl }) {
  if (email) localStorage.setItem('michofer_last_email', email)
  if (fullName) localStorage.setItem('michofer_last_name', fullName)
  if (role) localStorage.setItem('michofer_last_role', role)

  if (avatarUrl) {
    localStorage.setItem('michofer_last_photo', avatarUrl)
  }
}

function getRolePath(role) {
  return role === 'driver' ? '/driver' : '/client'
}

function goToRole(role) {
  const targetPath = getRolePath(role || 'passenger')

  if (window.location.pathname === targetPath) return

  window.location.replace(targetPath)
}

function dataUrlToFile(dataUrl, filename, fallbackType = 'image/jpeg') {
  const [header, data] = String(dataUrl || '').split(',')
  const mime = header?.match(/data:(.*?);base64/)?.[1] || fallbackType
  const binary = atob(data || '')
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new File([bytes], filename, { type: mime })
}

async function uploadPendingRegistrationAvatar(user, email) {
  const raw = localStorage.getItem('michofer_pending_registration')
  if (!raw || !user?.id) return null

  let pending
  try {
    pending = JSON.parse(raw)
  } catch {
    localStorage.removeItem('michofer_pending_registration')
    return null
  }

  if (normalizeEmail(pending.email) !== normalizeEmail(email)) {
    return null
  }

  if (!pending.avatarDataUrl) {
    localStorage.removeItem('michofer_pending_registration')
    return {
      avatarUrl: '',
      fullName: pending.fullName || '',
      role: pending.role || '',
    }
  }

  const file = dataUrlToFile(
    pending.avatarDataUrl,
    pending.avatarName || `michofer-avatar-${Date.now()}.jpg`,
    pending.avatarType || 'image/jpeg'
  )
  const fileExt = file.name.split('.').pop() || 'jpg'
  const filePath = `${user.id}/avatar-${Date.now()}.${fileExt}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
    })

  if (uploadError) {
    console.error('PENDING AVATAR UPLOAD ERROR:', uploadError)
    localStorage.removeItem('michofer_pending_registration')
    return {
      avatarUrl: pending.avatarDataUrl,
      fullName: pending.fullName || '',
      role: pending.role || '',
    }
  }

  const { data: publicUrlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(filePath)

  const avatarUrl = publicUrlData?.publicUrl || ''
  if (!avatarUrl) return null

  localStorage.removeItem('michofer_pending_registration')

  return {
    avatarUrl,
    fullName: pending.fullName || '',
    role: pending.role || '',
  }
}

export default function Login() {
  const [step, setStep] = useState('welcome')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [knownUser, setKnownUser] = useState(null)
  const [sessionUser, setSessionUser] = useState(null)
  const [profileDraft, setProfileDraft] = useState({
    fullName: '',
    avatarUrl: '',
  })
  const [driverDetails, setDriverDetails] = useState({
    phone: '',
    carBrand: '',
    carModel: '',
    carColor: '',
    plate: '',
    vehicleYear: '',
  })
    const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const redirectingRef = useRef(false)

  useEffect(() => {
    let alive = true

    async function initLogin() {
      const { data: sessionData } = await supabase.auth.getSession()
      const sessionUser = sessionData?.session?.user

      if (sessionUser) {
        const cleanEmail = normalizeEmail(sessionUser.email)
        const { data: profile, error: profileError } = await getOwnProfile()

        if (profileError) {
          console.warn('PROFILE SESSION LOAD ERROR:', profileError)
        }

        const pendingUpload = !profile?.avatar_url
          ? await uploadPendingRegistrationAvatar(sessionUser, cleanEmail)
          : null
        const storedAvatar = !profile?.avatar_url && !pendingUpload?.avatarUrl
          ? await findStoredAvatarUrl(sessionUser.id)
          : ''
        const role = pendingUpload?.role || resolveRole(sessionUser, profile, cleanEmail)
        const fullName =
          profile?.full_name ||
          pendingUpload?.fullName ||
          sessionUser.user_metadata?.full_name ||
          localStorage.getItem('michofer_last_name') ||
          ''
        const avatarUrl =
          profile?.avatar_url ||
          pendingUpload?.avatarUrl ||
          storedAvatar ||
          sessionUser.user_metadata?.avatar_url ||
          ''

        const needsRoleChoice = shouldAskForRole({
          user: sessionUser,
          profile,
          role,
          email: cleanEmail,
          pendingRole: pendingUpload?.role,
        })

        if (needsRoleChoice) {
          if (!alive) return

          setSessionUser(sessionUser)
          setEmail(cleanEmail)
          setKnownUser({
            email: cleanEmail,
            name: fullName,
            role: role || '',
            photo: avatarUrl,
          })
          setProfileDraft({ fullName, avatarUrl })
          cacheProfile({ email: cleanEmail, fullName, avatarUrl })
          setStep('role')
          return
        }

        cacheProfile({ email: cleanEmail, fullName, role, avatarUrl })
        markRoleConfirmed(cleanEmail)

        if ((!profile || !profile.avatar_url) && !profileError) {
          await upsertOwnProfile({
            email: cleanEmail,
            fullName,
            role: pendingUpload?.role || role || 'passenger',
            avatarUrl,
          })
        }

        if (pendingUpload?.avatarUrl || pendingUpload?.fullName || pendingUpload?.role) {
          await supabase.auth.updateUser({
            data: {
              full_name: fullName,
              avatar_url: avatarUrl,
              role: role || 'passenger',
              role_confirmed: true,
            },
          })
        }

                if (redirectingRef.current) return

        redirectingRef.current = true
        goToRole(role || 'passenger')
        return
      }

      if (!alive) return

      const params = new URLSearchParams(window.location.search)
      const emailFromUrl = params.get('email')

      const savedEmail = localStorage.getItem('michofer_last_email')
      const savedName = localStorage.getItem('michofer_last_name')
      const savedRole = localStorage.getItem('michofer_last_role')
      const savedPhoto = localStorage.getItem('michofer_last_photo')

      const finalEmail = emailFromUrl || savedEmail

      if (finalEmail) {
        setEmail(finalEmail)

        setKnownUser({
          email: finalEmail,
          name: savedName || '',
          role: savedRole || '',
          photo: savedPhoto || '',
        })

        setStep('password')
        loadProfilePreview(finalEmail)
      }
    }

    initLogin()

    return () => {
      alive = false
    }
  }, [])

  const title = useMemo(() => {
    if (knownUser?.email && step === 'password') {
      const firstName = knownUser.name?.split(' ')[0] || ''
      return firstName ? `Hola ${firstName}` : 'Hola'
    }

    if (step === 'welcome') return 'Movilidad conectada.'
    if (step === 'email') return 'Entrar con correo'
    if (step === 'password') return 'Tu clave'
    if (step === 'role') return '¿Cómo querés usar MiChofer?'
    if (step === 'driverDetails') return 'Datos de chofer'
    if (step === 'loading') return 'Entrando...'

    return 'MiChofer'
  }, [step, knownUser])

  const subtitle = useMemo(() => {
    if (knownUser?.email && step === 'password') {
      return 'Tu dispositivo ya esta registrado.'
    }

    if (step === 'welcome') return 'Acceso rapido, claro y seguro.'
    if (step === 'email') return 'Usa tu correo y clave de MiChofer.'
    if (step === 'password') return 'Ultimo paso y seguimos.'
    if (step === 'role') return 'Elegí tu modo para continuar.'
    if (step === 'driverDetails') return 'Carga tus datos. Admin aprueba tu perfil antes de que recibas viajes.'
    if (step === 'loading') return 'Verificando acceso.'

    return ''
  }, [step, knownUser])

  async function loadProfilePreview(value) {
    const cleanEmail = normalizeEmail(value)
    if (!cleanEmail) return null

    const { data, error } = await supabase.rpc('get_profile_preview_by_email', {
      lookup_email: cleanEmail,
    })

    if (error) {
      console.warn('PROFILE PREVIEW LOAD ERROR:', error)
      return null
    }

    const preview = Array.isArray(data) ? data[0] : data
    if (!preview) return null

    const nextKnownUser = {
      email: cleanEmail,
      name: preview.full_name || '',
      role: preview.role || '',
      photo: preview.avatar_url || '',
    }

    setKnownUser((current) => ({
      ...(current || {}),
      ...nextKnownUser,
      name: nextKnownUser.name || current?.name || '',
      role: nextKnownUser.role || current?.role || '',
      photo: nextKnownUser.photo || current?.photo || '',
    }))

    cacheProfile({
      email: cleanEmail,
      fullName: preview.full_name,
      role: preview.role,
      avatarUrl: preview.avatar_url,
    })

    return nextKnownUser
  }

  function getActiveIdentity() {
    const cleanEmail = normalizeEmail(email || sessionUser?.email || knownUser?.email)
    const fallbackName = cleanEmail ? cleanEmail.split('@')[0] : ''
    const fullName = String(
      profileDraft.fullName ||
      knownUser?.name ||
      sessionUser?.user_metadata?.full_name ||
      fallbackName
    ).trim()
    const avatarUrl =
      profileDraft.avatarUrl ||
      knownUser?.photo ||
      sessionUser?.user_metadata?.avatar_url ||
      ''

    return { cleanEmail, fullName, avatarUrl }
  }

  function updateDriverDetail(field, value) {
    setDriverDetails((current) => ({
      ...current,
      [field]: value,
    }))
  }

  async function saveRoleAndEnter(nextRole, details = null) {
    setErrorMessage('')

    let activeUser = sessionUser
    if (!activeUser) {
      const { data: sessionData } = await supabase.auth.getSession()
      activeUser = sessionData?.session?.user || null
      setSessionUser(activeUser)
    }

    if (!activeUser) {
      setErrorMessage('Volvemos a iniciar con Google para confirmar tu cuenta.')
      setStep('welcome')
      return
    }

    const { cleanEmail, fullName, avatarUrl } = getActiveIdentity()
    if (!cleanEmail) {
      setErrorMessage('No pude leer el correo de tu cuenta.')
      setStep('role')
      return
    }

    try {
      setBusy(true)
      setStep('loading')

      const { error: profileError } = await upsertOwnProfile({
        email: cleanEmail,
        fullName,
        role: nextRole,
        avatarUrl,
      })

      if (profileError) throw profileError

      const { error: userUpdateError } = await supabase.auth.updateUser({
        data: {
          full_name: fullName,
          avatar_url: avatarUrl,
          role: nextRole,
          role_confirmed: true,
        },
      })

      if (userUpdateError) throw userUpdateError

      if (nextRole === 'driver') {
        const { error: driverProfileError } = await upsertOwnDriverProfile({
          fullName,
          avatarUrl,
          email: cleanEmail,
        })

        if (driverProfileError) throw driverProfileError

        const { error: driverDetailsError } = await supabase
          .from('driver_profiles')
          .update({
            phone: details.phone,
            car_brand: details.carBrand,
            car_model: details.carModel,
            car_color: details.carColor || null,
            plate: details.plate,
            vehicle_year: details.vehicleYear,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', activeUser.id)

        if (driverDetailsError) throw driverDetailsError
      }

      cacheProfile({ email: cleanEmail, fullName, role: nextRole, avatarUrl })
      markRoleConfirmed(cleanEmail)
            if (redirectingRef.current) return

      redirectingRef.current = true
      goToRole(nextRole)
    } catch (err) {
      console.error('ROLE SAVE ERROR:', err)
      setErrorMessage(
        nextRole === 'driver'
          ? 'No pude guardar tus datos de chofer. Revisa los campos e intenta de nuevo.'
          : 'No pude guardar tu perfil. Intenta de nuevo.'
      )
      setStep(nextRole === 'driver' ? 'driverDetails' : 'role')
    } finally {
      setBusy(false)
    }
  }

  function handleRoleChoice(nextRole) {
    if (nextRole === 'driver') {
      setErrorMessage('')
      setStep('driverDetails')
      return
    }

    saveRoleAndEnter('passenger')
  }

  function handleDriverDetailsSubmit(e) {
    e.preventDefault()
    setErrorMessage('')

    const phone = driverDetails.phone.trim()
    const carBrand = driverDetails.carBrand.trim()
    const carModel = driverDetails.carModel.trim()
    const carColor = driverDetails.carColor.trim()
    const plate = driverDetails.plate.trim().toUpperCase()
    const vehicleYearText = driverDetails.vehicleYear.trim()
    const vehicleYear = vehicleYearText ? Number(vehicleYearText) : null
    const currentYear = new Date().getFullYear()

    if (!phone || !carBrand || !carModel || !plate) {
      setErrorMessage('Completa telefono, marca, modelo y chapa del auto.')
      return
    }

    if (vehicleYear && (Number.isNaN(vehicleYear) || vehicleYear < 1990 || vehicleYear > currentYear + 1)) {
      setErrorMessage('Revisa el anio del vehiculo.')
      return
    }

    saveRoleAndEnter('driver', {
      phone,
      carBrand,
      carModel,
      carColor,
      plate,
      vehicleYear,
    })
  }

  async function handleEmailNext(e) {
    e.preventDefault()
    setErrorMessage('')

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Pone un correo valido.')
      return
    }

    setEmail(cleanEmail)
    setKnownUser({
      email: cleanEmail,
      name: '',
      role: '',
      photo: '',
    })
    setStep('password')
    loadProfilePreview(cleanEmail)
  }

  async function handleLogin(e) {
    e.preventDefault()
    setErrorMessage('')

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !password) {
      setErrorMessage('Completa tu correo y clave.')
      return
    }

    try {
      setBusy(true)
      setStep('loading')

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      })

      if (error) {
        setErrorMessage(
          error.message === 'Failed to fetch'
            ? 'No pude conectar con Supabase. Revisa el Project URL en .env y reinicia Vite.'
            : error.message
        )
        setStep('password')
        return
      }

      const user = data.user
      const { data: profile, error: profileError } = await getOwnProfile()

      if (profileError) {
        console.warn('PROFILE LOAD ERROR:', profileError)
      }

      const pendingUpload = !profile?.avatar_url
        ? await uploadPendingRegistrationAvatar(user, cleanEmail)
        : null
      const role = pendingUpload?.role || resolveRole(user, profile, cleanEmail)
      const fullName = profile?.full_name || pendingUpload?.fullName || user?.user_metadata?.full_name || ''
      const storedAvatar = !profile?.avatar_url && !pendingUpload?.avatarUrl
        ? await findStoredAvatarUrl(user.id)
        : ''
      const avatarUrl = profile?.avatar_url || pendingUpload?.avatarUrl || storedAvatar || user?.user_metadata?.avatar_url || ''

      if (!role) {
        setSessionUser(user)
        setKnownUser({
          email: cleanEmail,
          name: fullName,
          role: '',
          photo: avatarUrl,
        })
        setProfileDraft({ fullName, avatarUrl })
        cacheProfile({ email: cleanEmail, fullName, avatarUrl })
        setStep('role')
        return
      }

      cacheProfile({ email: cleanEmail, fullName, role, avatarUrl })
      markRoleConfirmed(cleanEmail)

      if ((!profile || !profile.avatar_url) && !profileError) {
        await upsertOwnProfile({
          email: cleanEmail,
          fullName,
          role,
          avatarUrl,
        })
      }

      if (pendingUpload?.avatarUrl || pendingUpload?.fullName || pendingUpload?.role) {
        await supabase.auth.updateUser({
          data: {
            full_name: fullName,
            avatar_url: avatarUrl,
            role,
            role_confirmed: true,
          },
        })
      }

            if (redirectingRef.current) return

      redirectingRef.current = true
      goToRole(role)
    } catch (err) {
      console.error(err)
      setErrorMessage('No se pudo iniciar sesion. Revisa la conexion con Supabase.')
      setStep('password')
    } finally {
      setBusy(false)
    }
  }
  async function handlePasswordReset() {
    setErrorMessage('')
    setSuccessMessage('')

    const cleanEmail = normalizeEmail(email || knownUser?.email)

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Primero escribí tu correo para enviarte el enlace.')
      setStep('email')
      return
    }

    try {
      setBusy(true)

      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/login`,
      })

      if (error) {
        setErrorMessage(error.message || 'No pude enviar el enlace de recuperación.')
        return
      }

      setSuccessMessage('Te enviamos un enlace para recuperar tu clave. Revisá tu correo.')
    } catch (err) {
      console.error('PASSWORD RESET ERROR:', err)
      setErrorMessage('No pude enviar el enlace. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setBusy(false)
    }
  }
  async function handleGoogleAuth() {
    setErrorMessage('')

    try {
      setBusy(true)
      setStep('loading')

      const { error } = await signInWithGoogle()

      if (error) {
        setErrorMessage(error.message || 'No pude iniciar con Google.')
        setStep('welcome')
      }
    } catch (err) {
      console.error(err)
      setErrorMessage('No pude iniciar con Google. Revisa la configuracion en Supabase.')
      setStep('welcome')
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

          {['password', 'role', 'driverDetails'].includes(step) && knownUser?.email && (
            <div className="login-user-avatar-fallback">
              {isAvatarImage(knownUser?.photo) ? (
                <img src={knownUser.photo} alt="Usuario" />
              ) : (
                <span>{knownUser?.name?.charAt(0)?.toUpperCase() || 'U'}</span>
              )}
            </div>
          )}

          <h1>{title}</h1>

          <p className="login-subtitle">{subtitle}</p>

                    {errorMessage && (
            <div className="login-error-message">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div className="login-success-message">
              {successMessage}
            </div>
          )}

          {step === 'welcome' && (
            <div className="auth-action-stack">
              <button
                type="button"
                className="login-google-btn login-google-btn-primary"
                onClick={handleGoogleAuth}
                disabled={busy}
              >
                <span className="google-mark" aria-hidden="true" />
                {busy ? 'Conectando...' : 'Accede con Google'}
              </button>

              <button
                type="button"
                className="login-main-btn auth-mail-btn"
                onClick={() => setStep('email')}
              >
                Ya soy usuario
              </button>

              <a className="login-create-link" href="/registro">
                Crear cuenta nueva
              </a>

              <InstallMiChoferButton className="login-install-btn" />
            </div>
          )}

          {step === 'email' && (
            <form className="login-step-form" onSubmit={handleEmailNext}>
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
                onClick={() => setStep('welcome')}
              >
                {'<-'} Atras
              </button>
            </form>
          )}

          {step === 'password' && (
            <form className="login-step-form" onSubmit={handleLogin}>
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
                {busy ? 'Entrando...' : 'Entrar'}
              </button>

                            <button
                type="button"
                className="login-text-btn"
                onClick={handlePasswordReset}
                disabled={busy}
              >
                Olvidé mi clave
              </button>

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('email')}
              >
                Cambiar correo
              </button>
            </form>
          )}

          {step === 'role' && (
            <div className="login-step-form auth-role-form">
              <div className="login-recognized-pill">{email}</div>

              <button
                type="button"
                className="login-choice-btn auth-role-choice"
                onClick={() => handleRoleChoice('passenger')}
                disabled={busy}
              >
                Soy pasajero
              </button>

              <button
                type="button"
                className="login-choice-btn auth-role-choice"
                onClick={() => handleRoleChoice('driver')}
                disabled={busy}
              >
                Soy chofer
              </button>

              <button
                type="button"
                className="login-text-btn"
                onClick={async () => {
                  await supabase.auth.signOut()
                  localStorage.removeItem('michofer_last_email')
                  localStorage.removeItem('michofer_last_name')
                  localStorage.removeItem('michofer_last_photo')
                  localStorage.removeItem('michofer_last_role')
                  setSessionUser(null)
                  setKnownUser(null)
                  setEmail('')
                  setPassword('')
                  setStep('welcome')
                }}
              >
                Cambiar cuenta
              </button>
            </div>
          )}

          {step === 'driverDetails' && (
            <form className="login-step-form driver-onboarding-form" onSubmit={handleDriverDetailsSubmit}>
              <input
                autoFocus
                placeholder="Telefono"
                type="tel"
                autoComplete="tel"
                value={driverDetails.phone}
                onChange={(e) => updateDriverDetail('phone', e.target.value)}
              />

              <input
                placeholder="Marca del auto"
                autoComplete="off"
                value={driverDetails.carBrand}
                onChange={(e) => updateDriverDetail('carBrand', e.target.value)}
              />

              <input
                placeholder="Modelo"
                autoComplete="off"
                value={driverDetails.carModel}
                onChange={(e) => updateDriverDetail('carModel', e.target.value)}
              />

              <input
                placeholder="Color"
                autoComplete="off"
                value={driverDetails.carColor}
                onChange={(e) => updateDriverDetail('carColor', e.target.value)}
              />

              <input
                placeholder="Chapa / matricula"
                autoComplete="off"
                value={driverDetails.plate}
                onChange={(e) => updateDriverDetail('plate', e.target.value)}
              />

              <input
                placeholder="Anio del vehiculo"
                inputMode="numeric"
                value={driverDetails.vehicleYear}
                onChange={(e) => updateDriverDetail('vehicleYear', e.target.value)}
              />

              <button
                className="login-main-btn"
                disabled={busy}
                type="submit"
              >
                {busy ? 'Guardando...' : 'Enviar perfil'}
              </button>

              <button
                type="button"
                className="login-text-btn"
                onClick={() => setStep('role')}
              >
                {'<-'} Atras
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
    </div>
  )
}
