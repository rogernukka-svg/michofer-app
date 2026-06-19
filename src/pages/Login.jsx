import { useEffect, useMemo, useState } from 'react'
import InstallMiChoferButton from '../components/InstallMiChoferButton.jsx'
import { getOwnProfile, signInWithGoogle, supabase, upsertOwnProfile } from '../lib/supabase'
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
    'passenger'
  )
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

function goToRole(role) {
  window.location.href = role === 'driver' ? '/driver' : '/client'
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
  const [errorMessage, setErrorMessage] = useState('')

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

        cacheProfile({ email: cleanEmail, fullName, role, avatarUrl })

        if ((!profile || !profile.avatar_url) && !profileError) {
          await upsertOwnProfile({
            email: cleanEmail,
            fullName,
            role: pendingUpload?.role || role,
            avatarUrl,
          })
        }

        if (pendingUpload?.avatarUrl || pendingUpload?.fullName || pendingUpload?.role) {
          await supabase.auth.updateUser({
            data: {
              full_name: fullName,
              avatar_url: avatarUrl,
              role,
            },
          })
        }

        goToRole(role)
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
    if (step === 'loading') return 'Entrando...'

    return 'MiChofer'
  }, [step, knownUser])

  const subtitle = useMemo(() => {
    if (knownUser?.email && step === 'password') {
      return 'Tu dispositivo ya está registrado.'
    }

    if (step === 'welcome') return 'Acceso rápido, claro y seguro.'
    if (step === 'email') return 'Usá tu correo y clave de MiChofer.'
    if (step === 'password') return 'Último paso y seguimos.'
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

  async function handleEmailNext(e) {
    e.preventDefault()
    setErrorMessage('')

    const cleanEmail = normalizeEmail(email)

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMessage('Poné un correo válido.')
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
      setErrorMessage('Completá tu correo y clave.')
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
            ? 'No pude conectar con Supabase. Revisá el Project URL en .env y reiniciá Vite.'
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

      cacheProfile({ email: cleanEmail, fullName, role, avatarUrl })

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
          },
        })
      }

      goToRole(role)
    } catch (err) {
      console.error(err)
      setErrorMessage('No se pudo iniciar sesión. Revisá la conexión con Supabase.')
      setStep('password')
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
      setErrorMessage('No pude iniciar con Google. Revisá la configuración en Supabase.')
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

          {step === 'password' && (
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

          {step === 'welcome' && (
            <div className="auth-action-stack">
              <button
                type="button"
                className="login-google-btn login-google-btn-primary"
                onClick={handleGoogleAuth}
                disabled={busy}
              >
                <span className="google-mark" aria-hidden="true" />
                {busy ? 'Conectando...' : 'Entrar con Google'}
              </button>

              <button
                type="button"
                className="login-main-btn auth-mail-btn"
                onClick={() => setStep('email')}
              >
                Entrar con correo
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
                ← Atrás
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
                onClick={() => setStep('email')}
              >
                ← Cambiar correo
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
